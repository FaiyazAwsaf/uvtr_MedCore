import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { now } from "@/core/clock/clock"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import type { Actor } from "@/core/engine/types"
import { HERO, SEED_REFS } from "@/core/seed/content"
import {
  collectSpecimen,
  enterManualResults,
  importAnalyserResults,
  logCriticalCall,
  printSpecimenLabel,
  receiveSpecimen,
  rejectSpecimen,
  releaseReport,
  signAndRelease,
  validateItem,
} from "@/modules/lab/commands"

import {
  doctor,
  labtech,
  pathologist,
  placeLabOrder,
  releaseClock,
  seededDb,
  setPaymentCleared,
} from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("lab-gates-test")
}, 60_000)

afterAll(async () => {
  releaseClock()
  await db?.delete()
})

/** Collect and receive every specimen of an order, with the phone digits. */
async function toBench(
  specimens: { id: string }[],
  phoneDigits: string,
  actor: Actor = labtech
) {
  for (const s of specimens) {
    await commit(collectSpecimen, { specimenId: s.id, secondIdentifier: phoneDigits }, { db, actor })
    await commit(receiveSpecimen, { specimenId: s.id }, { db, actor })
  }
}

async function lastFour(patientId: string): Promise<string> {
  const patient = (await db.patients.get(patientId))!
  return (patient.phone ?? patient.attendantPhone ?? "").replace(/\D/g, "").slice(-4)
}

describe("payment gate (INV-10)", () => {
  it("refuses to collect an unpaid item", async () => {
    const { result } = await commit(
      placeLabOrder,
      { patientId: HERO.patient.rokeyaBegum, testIds: [SEED_REFS.test.rbs], paid: false },
      { db, actor: labtech }
    )
    await expect(
      commit(
        collectSpecimen,
        {
          specimenId: result.specimens[0].id,
          secondIdentifier: await lastFour(HERO.patient.rokeyaBegum),
        },
        { db, actor: labtech }
      )
    ).rejects.toMatchObject({ code: "PAYMENT_GATE", params: { step: "collection" } })
    expect((await db.specimens.get(result.specimens[0].id))?.status).toBe("awaiting-collection")
  })

  it("holds a signed report while any item is unpaid, then releases it once paid", async () => {
    const { result: order } = await commit(
      placeLabOrder,
      {
        patientId: HERO.patient.rokeyaBegum,
        doctorId: HERO.doctor.kamal,
        testIds: [SEED_REFS.test.creatinine],
      },
      { db, actor: labtech }
    )
    await toBench(order.specimens, await lastFour(HERO.patient.rokeyaBegum))
    await commit(importAnalyserResults, { specimenId: order.specimens[0].id }, { db, actor: labtech })
    await commit(validateItem, { itemId: order.itemIds[0] }, { db, actor: labtech })

    // A reversed payment after validation: the report must not reach the patient.
    await commit(setPaymentCleared, { itemIds: order.itemIds, cleared: false }, { db, actor: labtech })
    const inboxBefore = await db.inboxItems.count()
    const notesBefore = await db.notifications.count()
    const { result: signed } = await commit(
      signAndRelease,
      { labOrderId: order.orderId },
      { db, actor: pathologist }
    )
    expect(signed).toMatchObject({ released: false, held: true })
    const held = (await db.labReports.get(signed.reportId))!
    expect(held).toMatchObject({ status: "signed", heldForPayment: true })
    expect(held.releasedAt).toBeUndefined()
    expect(await db.inboxItems.count()).toBe(inboxBefore)
    expect(await db.notifications.count()).toBe(notesBefore)
    expect((await db.events.orderBy("seq").last())?.type).toBe("ReportHeldForPayment")

    await expect(
      commit(releaseReport, { reportId: signed.reportId }, { db, actor: pathologist })
    ).rejects.toMatchObject({ code: "PAYMENT_GATE" })

    await commit(setPaymentCleared, { itemIds: order.itemIds, cleared: true }, { db, actor: labtech })
    await commit(releaseReport, { reportId: signed.reportId }, { db, actor: pathologist })
    const released = (await db.labReports.get(signed.reportId))!
    expect(released).toMatchObject({ status: "released", heldForPayment: false })
    expect(released.releasedAt).toBeGreaterThan(0)
    const inbox = await db.inboxItems.where("doctorId").equals(HERO.doctor.kamal).toArray()
    expect(inbox.some((i) => i.refs.reportId === signed.reportId)).toBe(true)
    const notes = await db.notifications.where("patientId").equals(HERO.patient.rokeyaBegum).toArray()
    expect(notes.find((n) => n.refs.reportId === signed.reportId)?.kind).toBe("reportReady")
  })

  it("lets only the pathologist sign, and audits the denied attempt", async () => {
    const auditBefore = await db.audit.count()
    await expect(
      commit(signAndRelease, { labOrderId: "lo_any" }, { db, actor: doctor })
    ).rejects.toMatchObject({ kind: "denied" })
    expect(await db.audit.count()).toBe(auditBefore + 1)
  })
})

describe("specimen rejection with a free recollection (S5)", () => {
  it("rejects a collected EDTA tube, orders a free recollection and tells the patient", async () => {
    const { result: order } = await commit(
      placeLabOrder,
      {
        patientId: HERO.patient.tanvirKarim,
        doctorId: HERO.doctor.kamal,
        testIds: [SEED_REFS.test.cbc, SEED_REFS.test.esr],
      },
      { db, actor: labtech }
    )
    expect(order.specimens).toHaveLength(1)
    const specimen = order.specimens[0]
    await commit(
      collectSpecimen,
      { specimenId: specimen.id, secondIdentifier: await lastFour(HERO.patient.tanvirKarim) },
      { db, actor: labtech }
    )
    const { result } = await commit(
      rejectSpecimen,
      { specimenId: specimen.id, reason: "haemolysed", note: "Pink plasma after spin" },
      { db, actor: labtech }
    )
    expect((await db.specimens.get(specimen.id))).toMatchObject({
      status: "rejected",
      rejectReason: "haemolysed",
    })
    const oldItems = await db.labOrderItems.bulkGet(order.itemIds)
    expect(oldItems.every((i) => i?.status === "rejected")).toBe(true)

    const fresh = await db.labOrderItems.where("labOrderId").equals(result.recollectionOrderId).toArray()
    expect(fresh).toHaveLength(2)
    for (const item of fresh) {
      expect(item).toMatchObject({
        status: "paid",
        paymentCleared: true,
        isFreeRecollection: true,
      })
      expect(order.itemIds).toContain(item.recollectionOfItemId)
    }
    expect(result.specimenIds).toHaveLength(1)
    const newSpecimen = (await db.specimens.get(result.specimenIds[0]))!
    expect(newSpecimen).toMatchObject({ status: "awaiting-collection", container: "EDTA" })
    expect(newSpecimen.accessionNo).not.toBe(specimen.accessionNo)
    // Nothing to pay: no basket line for the recollection.
    const basket = await db.basketLines.where("patientId").equals(HERO.patient.tanvirKarim).toArray()
    expect(basket.some((b) => fresh.some((i) => i.id === b.sourceId))).toBe(false)

    const sms = (await db.sms.where("patientId").equals(HERO.patient.tanvirKarim).toArray()).filter(
      (s) => s.templateId === "sample-recollection"
    )
    expect(sms).toHaveLength(1)
    expect(sms[0]).toMatchObject({ templateId: "sample-recollection", status: "queued" })
    const notes = await db.notifications.where("patientId").equals(HERO.patient.tanvirKarim).toArray()
    expect(notes.find((n) => n.kind === "sampleRecollection")?.titleKey).toBe(
      "patientApp.notifications.sampleRecollection"
    )
    const last = (await db.events.orderBy("seq").reverse().limit(2).toArray()).map((e) => e.type)
    expect(last).toEqual(["RecollectionOrdered", "SpecimenRejected"])
  })

  it("refuses to reject a specimen whose tests already have results", async () => {
    const { result: order } = await commit(
      placeLabOrder,
      { patientId: HERO.patient.tanvirKarim, testIds: [SEED_REFS.test.rbs] },
      { db, actor: labtech }
    )
    await toBench(order.specimens, await lastFour(HERO.patient.tanvirKarim))
    await commit(importAnalyserResults, { specimenId: order.specimens[0].id }, { db, actor: labtech })
    await expect(
      commit(rejectSpecimen, { specimenId: order.specimens[0].id, reason: "clotted" }, { db, actor: labtech })
    ).rejects.toMatchObject({ code: "LAB_SPECIMEN_IN_USE" })
  })
})

describe("label printing", () => {
  it("records the label print time", async () => {
    const { result } = await commit(
      placeLabOrder,
      { patientId: HERO.patient.abdulKarim, testIds: [SEED_REFS.test.hba1c] },
      { db, actor: labtech }
    )
    const { result: printed } = await commit(
      printSpecimenLabel,
      { specimenId: result.specimens[0].id },
      { db, actor: labtech }
    )
    expect((await db.specimens.get(result.specimens[0].id))?.labelPrintedAt).toBe(printed.printedAt)
  })
})

describe("manual results need a second person's check", () => {
  it("refuses validation without a second checker, or with the same person", async () => {
    const { result: order } = await commit(
      placeLabOrder,
      { patientId: HERO.patient.abdulKarim, testIds: [SEED_REFS.test.potassium] },
      { db, actor: labtech }
    )
    await toBench(order.specimens, "3418")
    await expect(
      commit(enterManualResults, { itemId: order.itemIds[0], values: [] }, { db, actor: labtech })
    ).rejects.toMatchObject({ kind: "validation" })
    await commit(
      enterManualResults,
      { itemId: order.itemIds[0], values: [{ analyteCode: "K", value: 4.2 }] },
      { db, actor: labtech }
    )
    const [result] = await db.results.where("labOrderItemId").equals(order.itemIds[0]).toArray()
    expect(result).toMatchObject({ source: "manual", value: 4.2, flag: "N", status: "pending" })

    await expect(
      commit(validateItem, { itemId: order.itemIds[0] }, { db, actor: labtech })
    ).rejects.toMatchObject({ code: "LAB_SECOND_CHECK_REQUIRED" })
    await expect(
      commit(validateItem, { itemId: order.itemIds[0], secondCheckBy: labtech.staffId }, { db, actor: labtech })
    ).rejects.toMatchObject({ code: "LAB_SECOND_CHECK_SAME_PERSON" })
    await expect(
      commit(validateItem, { itemId: order.itemIds[0], secondCheckBy: "stf_farhana_akter" }, { db, actor: labtech })
    ).rejects.toMatchObject({ code: "LAB_SECOND_CHECKER_INVALID" })

    await commit(
      validateItem,
      { itemId: order.itemIds[0], secondCheckBy: "stf_b1_monira" },
      { db, actor: labtech }
    )
    expect((await db.results.get(result.id))).toMatchObject({
      status: "validated",
      secondCheckBy: "stf_b1_monira",
      validatedBy: labtech.staffId,
    })
  })
})

describe("critical values (S7 and HAZ-05)", () => {
  it("flags the scripted potassium of 6.8 as critical and logs the call", async () => {
    const { result: order } = await commit(
      placeLabOrder,
      {
        patientId: SEED_REFS.patient.jahanara,
        doctorId: HERO.doctor.kamal,
        testIds: [SEED_REFS.test.potassium],
      },
      { db, actor: labtech }
    )
    await toBench(order.specimens, await lastFour(SEED_REFS.patient.jahanara))
    const { result } = await commit(
      importAnalyserResults,
      { specimenId: order.specimens[0].id },
      { db, actor: labtech }
    )
    expect(result.critical).toBe(1)
    const [k] = await db.results.where("labOrderItemId").equals(order.itemIds[0]).toArray()
    expect(k).toMatchObject({ value: 6.8, flag: "HH", critical: true })
    const flagged = (await db.events.orderBy("seq").last())!
    expect(flagged).toMatchObject({ type: "CriticalFlagged", refs: { resultId: k.id } })

    await commit(validateItem, { itemId: order.itemIds[0] }, { db, actor: labtech })
    const { result: call } = await commit(
      logCriticalCall,
      {
        resultId: k.id,
        calledPerson: "Dr. Kamal Hossain",
        calledRole: "ordering-doctor",
        readBack: true,
        readBackText: "Potassium six point eight",
      },
      { db, actor: pathologist }
    )
    expect(call.valueText).toBe("Potassium 6.8 mmol/L")
    expect((await db.criticalCalls.get(call.callId))).toMatchObject({
      status: "open",
      readBack: true,
      calledRole: "ordering-doctor",
      loggedBy: pathologist.staffId,
      branchId: "B1",
    })
    expect((await db.events.orderBy("seq").last())?.type).toBe("CriticalCallLogged")
    await expect(
      commit(
        logCriticalCall,
        {
          resultId: k.id,
          calledPerson: "Dr. Saiful Islam",
          calledRole: "duty-doctor",
          calledAt: now() + 3_600_000,
          readBack: true,
        },
        { db, actor: pathologist }
      )
    ).rejects.toMatchObject({ code: "LAB_CALL_IN_FUTURE" })

    // The released report goes to the doctor's inbox as critical.
    await commit(signAndRelease, { labOrderId: order.orderId }, { db, actor: pathologist })
    const inbox = await db.inboxItems.where("doctorId").equals(HERO.doctor.kamal).toArray()
    const critical = inbox.filter((i) => i.refs.labOrderId === order.orderId)
    expect(critical.map((i) => i.kind)).toEqual(["critical"])
  })

  it("refuses to log a call for a normal result", async () => {
    const normal = await db.results.where("status").equals("validated").filter((r) => !r.critical).first()
    await expect(
      commit(
        logCriticalCall,
        { resultId: normal!.id, calledPerson: "Ward B", calledRole: "ward", readBack: false },
        { db, actor: pathologist }
      )
    ).rejects.toMatchObject({ code: "LAB_NOT_CRITICAL" })
  })
})
