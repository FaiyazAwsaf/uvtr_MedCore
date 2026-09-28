import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { HERO, SEED_REFS } from "@/core/seed/content"
import {
  collectSpecimen,
  correctReport,
  importAnalyserResults,
  receiveSpecimen,
  signAndRelease,
  validateItem,
} from "@/modules/lab/commands"
import { reportHash } from "@/modules/lab/logic"
import { loadVerification } from "@/modules/lab/verify"

import {
  labtech,
  pathologist,
  placeLabOrder,
  releaseClock,
  seededDb,
  tamperReport,
} from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("lab-journey-test")
}, 60_000)

afterAll(async () => {
  releaseClock()
  await db?.delete()
})

describe("hero CBC and CRP from accession to released report", () => {
  let orderId = ""
  let itemIds: string[] = []
  let specimens: { id: string; accessionNo: string; container: string; itemIds: string[] }[] = []
  let reportId = ""
  let eventsBefore = 0

  it("places a paid CBC + CRP order for Abdul Karim with one tube per container", async () => {
    eventsBefore = await db.events.count()
    const { result } = await commit(
      placeLabOrder,
      {
        patientId: HERO.patient.abdulKarim,
        doctorId: HERO.doctor.kamal,
        testIds: [SEED_REFS.test.cbc, SEED_REFS.test.crp],
      },
      { db, actor: labtech }
    )
    orderId = result.orderId
    itemIds = result.itemIds
    specimens = result.specimens
    expect(specimens.map((s) => s.container).sort()).toEqual(["EDTA", "plain"])
    for (const s of specimens) {
      expect(s.accessionNo).toMatch(/^B1-\d{6}$/)
      expect((await db.specimens.get(s.id))?.status).toBe("awaiting-collection")
    }
  })

  it("refuses collection on a wrong second identifier and audits the attempt", async () => {
    const auditBefore = await db.audit.count()
    await expect(
      commit(
        collectSpecimen,
        { specimenId: specimens[0].id, secondIdentifier: "0000" },
        { db, actor: labtech }
      )
    ).rejects.toMatchObject({ code: "LAB_SECOND_ID_MISMATCH" })
    expect((await db.specimens.get(specimens[0].id))?.status).toBe("awaiting-collection")
    const blocked = (await db.audit.orderBy("seq").reverse().limit(1).toArray())[0]
    expect(await db.audit.count()).toBe(auditBefore + 1)
    expect(blocked).toMatchObject({ action: "blocked", code: "LAB_SECOND_ID_MISMATCH" })
  })

  it("collects with the date of birth or the last four phone digits", async () => {
    const patient = (await db.patients.get(HERO.patient.abdulKarim))!
    const [y, m, d] = patient.dob.split("-")
    const byDob = await commit(
      collectSpecimen,
      { specimenId: specimens[0].id, secondIdentifier: `${d}-${m}-${y}` },
      { db, actor: labtech }
    )
    expect(byDob.result.matchedBy).toBe("dob")
    const byPhone = await commit(
      collectSpecimen,
      // Bangla digits for "3418" work too.
      { specimenId: specimens[1].id, secondIdentifier: "৩৪১৮" },
      { db, actor: labtech }
    )
    expect(byPhone.result.matchedBy).toBe("phone")
    for (const s of specimens) {
      const row = (await db.specimens.get(s.id))!
      expect(row).toMatchObject({ status: "collected", collectedBy: labtech.staffId })
    }
    const items = await db.labOrderItems.bulkGet(itemIds)
    expect(items.map((i) => i?.status)).toEqual(["collected", "collected"])
  })

  it("receives both specimens and refuses a second receive", async () => {
    for (const s of specimens) {
      await commit(receiveSpecimen, { specimenId: s.id }, { db, actor: labtech })
    }
    await expect(
      commit(receiveSpecimen, { specimenId: specimens[0].id }, { db, actor: labtech })
    ).rejects.toMatchObject({ code: "LAB_SPECIMEN_STATE" })
    const items = await db.labOrderItems.bulkGet(itemIds)
    expect(items.map((i) => i?.status)).toEqual(["received", "received"])
  })

  it("imports the scripted analyser values: mild leukocytosis and a raised CRP", async () => {
    for (const s of specimens) {
      const { result } = await commit(
        importAnalyserResults,
        { specimenId: s.id },
        { db, actor: labtech }
      )
      expect(result.critical).toBe(0)
    }
    const results = await db.results.where("patientId").equals(HERO.patient.abdulKarim).toArray()
    const ours = results.filter((r) => itemIds.includes(r.labOrderItemId))
    const cbc = (await db.labTests.get(SEED_REFS.test.cbc))!
    expect(ours).toHaveLength(cbc.analytes.length + 1)
    const byCode = new Map(ours.map((r) => [r.analyteCode, r]))
    expect(byCode.get("WBC")).toMatchObject({ value: 12.8, flag: "H", unit: "x10^9/L", source: "analyser", status: "pending", critical: false })
    expect(byCode.get("NEUT")).toMatchObject({ value: 79, flag: "H" })
    expect(byCode.get("HB")).toMatchObject({ value: 13.4, flag: "N" })
    expect(byCode.get("CRP")).toMatchObject({ value: 48, flag: "H", unit: "mg/L" })
    const items = await db.labOrderItems.bulkGet(itemIds)
    expect(items.map((i) => i?.status)).toEqual(["resulted", "resulted"])
  })

  it("validates each item and sends it to the pathologist", async () => {
    for (const itemId of itemIds) {
      await commit(validateItem, { itemId }, { db, actor: labtech })
    }
    const items = await db.labOrderItems.bulkGet(itemIds)
    expect(items.map((i) => i?.status)).toEqual(["validated", "validated"])
    const results = await db.results.where("labOrderItemId").anyOf(itemIds).toArray()
    expect(results.every((r) => r.status === "validated" && r.validatedBy === labtech.staffId)).toBe(true)
  })

  it("signs and releases: report v1, doctor inbox, patient notification and SMS", async () => {
    const { result } = await commit(signAndRelease, { labOrderId: orderId }, { db, actor: pathologist })
    expect(result).toMatchObject({ released: true, held: false })
    reportId = result.reportId
    const report = (await db.labReports.get(reportId))!
    expect(report).toMatchObject({
      reportVersion: 1,
      status: "released",
      signedBy: pathologist.staffId,
      labOrderId: orderId,
    })
    expect(report.reportNo).toMatch(/^RPT-B1-\d{6}$/)
    expect(report.itemIds.sort()).toEqual([...itemIds].sort())
    const results = await db.results.where("labOrderItemId").anyOf(itemIds).toArray()
    expect(report.hash).toBe(reportHash(report, results))

    const items = await db.labOrderItems.bulkGet(itemIds)
    expect(items.every((i) => i?.status === "released" && i.reportId === reportId)).toBe(true)
    expect((await db.labOrders.get(orderId))?.status).toBe("completed")

    const inbox = await db.inboxItems.where("doctorId").equals(HERO.doctor.kamal).toArray()
    const item = inbox.find((i) => i.refs.reportId === reportId)
    expect(item).toMatchObject({
      kind: "abnormal",
      titleKey: "consultation.inbox.kind.abnormal",
      status: "unread",
      patientId: HERO.patient.abdulKarim,
    })

    const notes = await db.notifications.where("patientId").equals(HERO.patient.abdulKarim).toArray()
    expect(notes.find((n) => n.refs.reportId === reportId)).toMatchObject({
      kind: "reportReady",
      titleKey: "patientApp.notifications.reportReady",
      read: false,
    })

    const sms = (await db.sms.where("patientId").equals(HERO.patient.abdulKarim).toArray()).filter(
      (s) => s.templateId === "report-ready" && s.status === "queued"
    )
    expect(sms).toHaveLength(1)
    // No clinical content in the SMS.
    expect(sms[0].text).not.toMatch(/CRP|CBC|WBC|48|12\.8/)
    expect(sms[0].to).toBe(HERO.karimPhone)
  })

  it("emits the lab events in order with their consumers", async () => {
    const events = (await db.events.toArray()).slice(eventsBefore)
    const types = events.map((e) => e.type).filter((t) => t !== "RuleViolationBlocked")
    expect(types).toEqual([
      "SpecimenCollected",
      "SpecimenCollected",
      "SpecimenReceived",
      "SpecimenReceived",
      "ResultsReceived",
      "ResultsReceived",
      "TechnicallyValidated",
      "TechnicallyValidated",
      "ReportSigned",
      "ReportReleased",
    ])
    const released = events.find((e) => e.type === "ReportReleased")!
    expect(released.summaryKey).toBe("lab.events.ReportReleased")
    expect(released.consumers).toEqual([
      "lab.consumers.doctorInbox",
      "lab.consumers.patientApp",
      "lab.consumers.sms",
      "lab.consumers.audit",
    ])
    expect(released.refs).toMatchObject({ reportId, patientId: HERO.patient.abdulKarim })
  })

  it("keeps a released report immutable (INV-04)", async () => {
    await expect(
      commit(tamperReport, { reportId }, { db, actor: pathologist })
    ).rejects.toMatchObject({ code: "SIGNED_IMMUTABLE" })
  })

  it("corrects to v2 and keeps v1 as superseded", async () => {
    const crp = (await db.results.where("labOrderItemId").anyOf(itemIds).toArray()).find(
      (r) => r.analyteCode === "CRP"
    )!
    const v1Hash = (await db.labReports.get(reportId))!.hash
    const { result } = await commit(
      correctReport,
      {
        reportId,
        reason: "Transcription error",
        changeSummary: "CRP corrected from 48.0 to 4.8 mg/L. Flag changed from High to Normal.",
        corrections: [{ resultId: crp.id, value: 4.8 }],
      },
      { db, actor: pathologist }
    )
    expect(result).toMatchObject({ version: 2, supersededId: reportId, released: true })
    const v1 = (await db.labReports.get(reportId))!
    const v2 = (await db.labReports.get(result.reportId))!
    expect(v1).toMatchObject({ status: "superseded", reportVersion: 1, hash: v1Hash })
    expect(v2).toMatchObject({
      status: "released",
      reportVersion: 2,
      reportNo: v1.reportNo,
      supersedesId: v1.id,
      correctionReason: "Transcription error",
    })
    expect(v2.hash).not.toBe(v1.hash)
    expect((await db.results.get(crp.id))).toMatchObject({ value: 4.8, flag: "N" })
    const items = await db.labOrderItems.bulkGet(itemIds)
    expect(items.every((i) => i?.reportId === v2.id)).toBe(true)

    const inbox = await db.inboxItems.where("doctorId").equals(HERO.doctor.kamal).toArray()
    expect(inbox.find((i) => i.refs.reportId === v2.id)).toMatchObject({
      kind: "corrected",
      titleKey: "consultation.inbox.kind.corrected",
    })
    const notes = await db.notifications.where("patientId").equals(HERO.patient.abdulKarim).toArray()
    expect(notes.find((n) => n.refs.reportId === v2.id)).toMatchObject({
      kind: "reportUpdated",
      titleKey: "patientApp.notifications.reportUpdated",
    })
    const sms = await db.sms.where("patientId").equals(HERO.patient.abdulKarim).toArray()
    expect(sms.filter((s) => s.templateId === "report-updated")).toHaveLength(1)
    const last = (await db.events.orderBy("seq").reverse().limit(2).toArray()).map((e) => e.type)
    expect(last).toEqual(["ReportReleased", "ReportCorrected"])
  })

  it("verifies: v1 points to the current v2, which is genuine and current", async () => {
    const old = await loadVerification(db, reportId)
    expect(old.state).toBe("genuine")
    if (old.state !== "genuine" || old.kind !== "lab") throw new Error("expected a lab report")
    expect(old.report.reportVersion).toBe(1)
    expect(old.current.reportVersion).toBe(2)
    expect(old.versions.map((v) => v.reportVersion)).toEqual([1, 2])
    expect(old.initials).toBe("A. K.")
    expect(old.tests.map((t) => t.code).sort()).toEqual(["CBC", "CRP"])
    expect(old.signer?.nameEn).toBe("Dr. Mizanur Rahman")

    const current = await loadVerification(db, old.current.id)
    expect(current.state === "genuine" && current.report.id === current.current.id).toBe(true)
    expect(await loadVerification(db, "rpt_missing")).toEqual({ state: "not-found" })
  })
})
