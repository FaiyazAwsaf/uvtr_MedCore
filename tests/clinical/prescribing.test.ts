import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { signNote } from "@/modules/consultation/commands"
import {
  addRxLine,
  decideSubstitution,
  removeRxLine,
  reviseRxCommand,
  signRx,
} from "@/modules/prescribing/commands"
import type { RxLineInput } from "@/modules/prescribing/commands"

import {
  dropDb,
  kamal,
  arif,
  seededDb,
  shirin,
  startVisit,
  testCriticalResult,
  testDispense,
  testRequestSubstitution,
} from "./helpers"

/**
 * Prescribing rules beyond the hero path: draft edits, revise before a
 * dispense (v2, same number, queue and basket repointed), replace after a
 * dispense (a new Rx), the substitution decision, and the three
 * interruptive alerts.
 */

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("clinical-rx-test")
})
afterAll(async () => {
  await dropDb(db)
})

const line = (brandId: string, dosePattern = "1+0+1", durationDays = 5): RxLineInput => ({
  brandId,
  dosePattern,
  mealTiming: "after",
  durationDays,
})

async function signedRxFor(patientId: string, lines: RxLineInput[]) {
  const { encounterId } = await startVisit(db, patientId)
  let rxId = ""
  for (const l of lines) {
    rxId = (await commit(addRxLine, { encounterId, line: l }, { db, actor: kamal })).result.rxId
  }
  await commit(signRx, { rxId }, { db, actor: kamal })
  return { encounterId, rxId }
}

describe("draft lines", () => {
  it("renumbers the lines left after a removal when the Rx is signed", async () => {
    const { encounterId } = await startVisit(db, HERO.patient.rokeyaBegum)
    const a = await commit(addRxLine, { encounterId, line: line(SEED_REFS.brand.fexo120, "0+0+1", 7) }, { db, actor: kamal })
    const b = await commit(addRxLine, { encounterId, line: line(SEED_REFS.brand.ace500) }, { db, actor: kamal })
    await commit(removeRxLine, { lineId: a.result.lineId }, { db, actor: kamal })
    await commit(signRx, { rxId: b.result.rxId }, { db, actor: kamal })
    const lines = await db.rxLines.where("rxId").equals(b.result.rxId).toArray()
    expect(lines.find((l) => l.id === a.result.lineId)?.status).toBe("cancelled")
    expect(lines.find((l) => l.id === b.result.lineId)).toMatchObject({ lineNo: 1, status: "open" })
    // Cancelled lines get no basket line.
    expect(await db.basketLines.where("sourceId").equals(a.result.lineId).count()).toBe(0)
  })

  it("refuses an empty Rx and a quantity of zero", async () => {
    const { encounterId } = await startVisit(db, "pat_0312")
    const added = await commit(addRxLine, { encounterId, line: line(SEED_REFS.brand.ace500) }, { db, actor: kamal })
    await commit(removeRxLine, { lineId: added.result.lineId }, { db, actor: kamal })
    await expect(
      commit(signRx, { rxId: added.result.rxId }, { db, actor: kamal })
    ).rejects.toMatchObject({ code: "RX_EMPTY" })
    await expect(
      commit(addRxLine, { encounterId, line: { ...line(SEED_REFS.brand.ace500, "SOS", 3) } }, { db, actor: kamal })
    ).rejects.toMatchObject({ code: "QTY_REQUIRED" })
    // With the quantity typed, "when needed" is fine.
    await commit(
      addRxLine,
      { encounterId, line: { ...line(SEED_REFS.brand.ace500, "SOS", 3), qtyPrescribed: 6 } },
      { db, actor: kamal }
    )
  })

  it("lets only the encounter's doctor write its Rx", async () => {
    const { encounterId } = await startVisit(db, "pat_0092")
    await expect(
      commit(addRxLine, { encounterId, line: line(SEED_REFS.brand.ace500) }, { db, actor: arif })
    ).rejects.toMatchObject({ code: "NOT_YOUR_PATIENT" })
    await expect(
      commit(addRxLine, { encounterId, line: line(SEED_REFS.brand.ace500) }, { db, actor: shirin })
    ).rejects.toMatchObject({ kind: "denied" })
  })

  it("flags a medicine outside the dictionary without stock or basket", async () => {
    const { encounterId } = await startVisit(db, "pat_0327")
    const { result } = await commit(
      addRxLine,
      {
        encounterId,
        line: {
          nonDictionaryName: "Herbal cough syrup",
          strength: "100 ml",
          form: "syrup",
          dosePattern: "1+1+1",
          mealTiming: "after",
          durationDays: 5,
          qtyPrescribed: 1,
        },
      },
      { db, actor: kamal }
    )
    await commit(signRx, { rxId: result.rxId }, { db, actor: kamal })
    const saved = (await db.rxLines.get(result.lineId))!
    expect(saved).toMatchObject({ nonDictionaryName: "Herbal cough syrup", isAntibiotic: false })
    expect(saved.brandId).toBeUndefined()
    expect(await db.basketLines.where("sourceId").equals(result.lineId).count()).toBe(0)
  })
})

describe("the three interruptive alerts", () => {
  it("lets the doctor override an allergy only with a reason, recorded in the audit", async () => {
    const { encounterId } = await startVisit(db, HERO.patient.abdulKarim)
    await expect(
      commit(
        addRxLine,
        {
          encounterId,
          line: line(SEED_REFS.brand.moxacil500, "1+1+1", 7),
          overrides: [{ kind: "allergy" }],
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "ALLERGY_OVERRIDE_REQUIRED" })
    const { result } = await commit(
      addRxLine,
      {
        encounterId,
        line: line(SEED_REFS.brand.moxacil500, "1+1+1", 7),
        overrides: [{ kind: "allergy", reason: "Tolerated amoxicillin last year" }],
      },
      { db, actor: kamal }
    )
    const audit = (await db.audit.where("entityId").equals(result.lineId).toArray())[0]
    expect(audit.reason).toContain("allergy: Tolerated amoxicillin last year")
  })

  it("asks to acknowledge a duplicate of an active Rx (Abdul's Comet 500)", async () => {
    const encounter = (await db.encounters.where("patientId").equals(HERO.patient.abdulKarim).toArray()).find(
      (e) => e.status === "open"
    )!
    await expect(
      commit(addRxLine, { encounterId: encounter.id, line: line(SEED_REFS.brand.comet500, "1+0+1", 30) }, { db, actor: kamal })
    ).rejects.toMatchObject({ code: "DUPLICATE_ACK_REQUIRED" })
    await commit(
      addRxLine,
      {
        encounterId: encounter.id,
        line: line(SEED_REFS.brand.comet500, "1+0+1", 30),
        overrides: [{ kind: "duplicate" }],
      },
      { db, actor: kamal }
    )
  })

  it("asks to acknowledge a critical result on file", async () => {
    const { encounterId } = await startVisit(db, "pat_0231")
    await commit(testCriticalResult, { patientId: "pat_0231" }, { db, actor: shirin })
    await expect(
      commit(addRxLine, { encounterId, line: line(SEED_REFS.brand.fexo120, "0+0+1", 7) }, { db, actor: kamal })
    ).rejects.toMatchObject({ code: "CRITICAL_ACK_REQUIRED" })
    await commit(
      addRxLine,
      { encounterId, line: line(SEED_REFS.brand.fexo120, "0+0+1", 7), overrides: [{ kind: "critical" }] },
      { db, actor: kamal }
    )
  })
})

describe("revise and replace", () => {
  it("revises before any dispense: v2 with the same number, queue and basket repointed", async () => {
    const { rxId } = await signedRxFor("pat_0456", [
      line(SEED_REFS.brand.ace500),
      line(SEED_REFS.brand.fexo120, "0+0+1", 7),
    ])
    const v1 = (await db.prescriptions.get(rxId))!
    const [ace, fexo] = (await db.rxLines.where("rxId").equals(rxId).sortBy("lineNo"))
    const queueBefore = (await db.pharmacyQueue.where("rxId").equals(rxId).toArray())[0]
    const aceBasket = (await db.basketLines.where("sourceId").equals(ace.id).toArray())[0]
    const fexoBasket = (await db.basketLines.where("sourceId").equals(fexo.id).toArray())[0]

    const { result } = await commit(
      reviseRxCommand,
      {
        rxId,
        expectedVersion: v1.version,
        reason: "Longer course of fexofenadine",
        advice: v1.advice,
        lines: [
          { ...line(SEED_REFS.brand.ace500), keepLineId: ace.id },
          { ...line(SEED_REFS.brand.fexo120, "0+0+1", 14), keepLineId: fexo.id },
        ],
      },
      { db, actor: kamal }
    )
    expect(result.mode).toBe("revised")
    const v2 = (await db.prescriptions.get(result.rxId))!
    expect(v2).toMatchObject({ rxNo: v1.rxNo, rxVersion: 2, supersedesId: v1.id, status: "signed" })
    expect((await db.prescriptions.get(rxId))?.status).toBe("superseded")

    // The queue entry now points at v2.
    const queueAfter = (await db.pharmacyQueue.get(queueBefore.id))!
    expect(queueAfter).toMatchObject({ rxId: v2.id, status: "waiting" })
    expect(await db.pharmacyQueue.where("rxId").equals(rxId).count()).toBe(0)

    const newLines = await db.rxLines.where("rxId").equals(v2.id).sortBy("lineNo")
    // Unchanged line: its basket line follows it.
    expect((await db.basketLines.get(aceBasket.id))?.sourceId).toBe(newLines[0].id)
    // Changed line: the old basket line is withdrawn and a new one made.
    expect((await db.basketLines.get(fexoBasket.id))?.status).toBe("removed")
    const fresh = await db.basketLines.where("sourceId").equals(newLines[1].id).toArray()
    expect(fresh).toHaveLength(1)
    expect(fresh[0].qty).toBe(14)
    // The superseded version's lines are no longer live.
    for (const old of await db.rxLines.where("rxId").equals(rxId).toArray()) {
      expect(old.status).toBe("cancelled")
    }
    const events = (await db.events.toArray()).map((e) => e.type)
    expect(events).toContain("PrescriptionRevised")
  })

  it("replaces after a dispense: a new Rx that points at the old one", async () => {
    const { rxId } = await signedRxFor("pat_0068", [
      line(SEED_REFS.brand.ace500),
      line(SEED_REFS.brand.fexo120, "0+0+1", 7),
    ])
    const [ace, fexo] = await db.rxLines.where("rxId").equals(rxId).sortBy("lineNo")
    await commit(testDispense, { rxLineId: ace.id, qty: 10 }, { db, actor: shirin })
    const fexoBasket = (await db.basketLines.where("sourceId").equals(fexo.id).toArray())[0]
    const old = (await db.prescriptions.get(rxId))!

    const { result } = await commit(
      reviseRxCommand,
      {
        rxId,
        reason: "Change the antihistamine",
        advice: old.advice,
        lines: [line(SEED_REFS.brand.alatrol10, "0+0+1", 7)],
      },
      { db, actor: kamal }
    )
    expect(result.mode).toBe("replaced")
    const next = (await db.prescriptions.get(result.rxId))!
    expect(next).toMatchObject({ replacesId: rxId, rxVersion: 1, status: "signed" })
    expect(next.rxNo).not.toBe(old.rxNo)
    expect((await db.prescriptions.get(rxId))?.status).toBe("replaced")
    // Dispensed line stays as it was; the undispensed one is withdrawn.
    expect((await db.rxLines.get(ace.id))?.status).toBe("dispensed")
    expect((await db.rxLines.get(fexo.id))?.status).toBe("cancelled")
    expect((await db.basketLines.get(fexoBasket.id))?.status).toBe("removed")
    const oldQueue = await db.pharmacyQueue.where("rxId").equals(rxId).toArray()
    expect(oldQueue.every((q) => q.status === "cancelled")).toBe(true)
    const newQueue = await db.pharmacyQueue.where("rxId").equals(next.id).toArray()
    expect(newQueue).toHaveLength(1)
    expect((await db.events.toArray()).map((e) => e.type)).toContain("PrescriptionReplaced")
  })

  it("keeps a signed note immutable: signing again is refused", async () => {
    const encounter = (await db.encounters.where("patientId").equals("pat_0068").first())!
    await commit(
      signNote,
      {
        encounterId: encounter.id,
        sections: { chiefComplaint: "Itchy eyes", history: "", examination: "", assessment: "", plan: "" },
        diagnoses: [],
        templateId: "tpl_medicine",
        lang: "en",
      },
      { db, actor: kamal }
    )
    await expect(
      commit(
        signNote,
        {
          encounterId: encounter.id,
          sections: { chiefComplaint: "Changed", history: "", examination: "", assessment: "", plan: "" },
          diagnoses: [],
          templateId: "tpl_medicine",
          lang: "en",
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "NOTE_SIGNED" })
  })
})

describe("substitution requests from the pharmacy", () => {
  it("approves: Rx v2 with the proposed brand, in the queue, the request closed", async () => {
    const { rxId } = await signedRxFor(HERO.patient.tanvirKarim, [
      line(SEED_REFS.brand.monas10, "0+0+1", 14),
      line(SEED_REFS.brand.ace500),
    ])
    const [monas] = await db.rxLines.where("rxId").equals(rxId).sortBy("lineNo")
    // Monas 10 is out at B1: nothing to bill today.
    expect(await db.basketLines.where("sourceId").equals(monas.id).count()).toBe(0)
    const { result: req } = await commit(
      testRequestSubstitution,
      { rxLineId: monas.id, proposedBrandId: SEED_REFS.brand.montair10, reason: "Out of stock" },
      { db, actor: shirin }
    )
    const { result } = await commit(
      decideSubstitution,
      { substitutionId: req.substitutionId, decision: "approve" },
      { db, actor: kamal }
    )
    expect(result).toMatchObject({ decision: "approved", rxVersion: 2 })
    const sub = (await db.substitutionRequests.get(req.substitutionId))!
    expect(sub).toMatchObject({ status: "approved", resultRxId: result.rxId, decidedBy: kamal.staffId })
    const v2Lines = await db.rxLines.where("rxId").equals(result.rxId).sortBy("lineNo")
    expect(v2Lines[0]).toMatchObject({
      brandId: SEED_REFS.brand.montair10,
      substitutedFromLineId: monas.id,
      dosePattern: "0+0+1",
      status: "open",
    })
    expect(await db.basketLines.where("sourceId").equals(v2Lines[0].id).count()).toBe(1)
    const queue = await db.pharmacyQueue.where("rxId").equals(result.rxId).toArray()
    expect(queue).toHaveLength(1)
    const inbox = (await db.inboxItems.where("doctorId").equals(HERO.doctor.kamal).toArray()).find(
      (i) => i.refs.substitutionId === req.substitutionId
    )
    expect(inbox?.status).toBe("actioned")
    const types = (await db.events.toArray()).map((e) => e.type)
    expect(types).toContain("SubstitutionApproved")

    await expect(
      commit(decideSubstitution, { substitutionId: req.substitutionId, decision: "reject" }, { db, actor: kamal })
    ).rejects.toMatchObject({ code: "SUBSTITUTION_DECIDED" })
  })

  it("keeps a paid line's payment when the brand is swapped", async () => {
    const { rxId } = await signedRxFor("pat_0181", [
      line(SEED_REFS.brand.ace500),
    ])
    const [ace] = await db.rxLines.where("rxId").equals(rxId).toArray()
    const basket = (await db.basketLines.where("sourceId").equals(ace.id).toArray())[0]
    // As if the cashier had taken payment.
    await db.transaction("rw", [db.rxLines, db.basketLines], async () => {
      await db.rxLines.update(ace.id, { paymentCleared: true })
      await db.basketLines.update(basket.id, { status: "invoiced" })
    })
    const { result: req } = await commit(
      testRequestSubstitution,
      { rxLineId: ace.id, proposedBrandId: SEED_REFS.brand.napa500, reason: "Patient prefers Napa" },
      { db, actor: shirin }
    )
    const { result } = await commit(
      decideSubstitution,
      { substitutionId: req.substitutionId, decision: "approve" },
      { db, actor: kamal }
    )
    const [napa] = await db.rxLines.where("rxId").equals(result.rxId).toArray()
    expect(napa).toMatchObject({ brandId: SEED_REFS.brand.napa500, paymentCleared: true })
    expect((await db.basketLines.get(basket.id))?.sourceId).toBe(napa.id)
    expect(await db.basketLines.where("sourceId").equals(napa.id).count()).toBe(1)
  })

  it("rejects with a note: the line goes back to the pharmacy unchanged", async () => {
    const { rxId } = await signedRxFor("pat_0406", [line(SEED_REFS.brand.fexo120, "0+0+1", 7)])
    const [fexo] = await db.rxLines.where("rxId").equals(rxId).toArray()
    const { result: req } = await commit(
      testRequestSubstitution,
      { rxLineId: fexo.id, proposedBrandId: SEED_REFS.brand.alatrol10, reason: "Cheaper" },
      { db, actor: shirin }
    )
    expect((await db.rxLines.get(fexo.id))?.status).toBe("awaiting-prescriber")
    await commit(
      decideSubstitution,
      { substitutionId: req.substitutionId, decision: "reject", note: "Keep the prescribed brand" },
      { db, actor: kamal }
    )
    expect(await db.substitutionRequests.get(req.substitutionId)).toMatchObject({
      status: "rejected",
      decisionNote: "Keep the prescribed brand",
    })
    expect((await db.rxLines.get(fexo.id))?.status).toBe("open")
    expect((await db.prescriptions.get(rxId))?.status).toBe("signed")
    expect((await db.events.toArray()).map((e) => e.type)).toContain("SubstitutionRejected")
  })
})
