import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { rules } from "@/config/rules.config"
import { applyClockOffset, getClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate, HOUR, MINUTE } from "@/core/clock/dates"
import { getCentralDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { RuleViolation } from "@/core/engine/errors"
import { payLines } from "@/core/scenarios/fixtures"
import { SCENARIOS } from "@/core/scenarios/registry"
import { createKit, runScenario } from "@/core/scenarios/runner"
import { seedDatabase } from "@/core/seed"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { TSH_UNIT_ERROR } from "@/core/seed/content/analyser-scripts"
import {
  collectSpecimen,
  correctReport,
  decideAddOn,
  escalateCritical,
  importAnalyserResults,
  logCriticalCall,
  rejectSpecimen,
} from "@/modules/lab/commands"
import { loadVerification } from "@/modules/lab/verify"

import { labtech, pathologist } from "./fixtures"

/**
 * The lab and pathology launchers (plan §10, P3.3): each setup runs twice in
 * a row on fresh records, prepares the state its cue card describes, routes
 * to the right screen, and its key action commits every time.
 */

const db = getCentralDb()
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!

async function refused(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof RuleViolation) return error.code
    throw error
  }
  throw new Error("expected a refusal")
}

beforeAll(async () => {
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "11:30") - Date.now())
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
}, 60_000)

afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("lab launchers are registered", () => {
  it("lists S5, S6, S6B, S7 and S8 with personas and cue steps", () => {
    for (const id of ["S5", "S6", "S6B", "S7", "S8"]) {
      const s = scenario(id)
      expect(s, id).toBeDefined()
      expect(s.module).toBe("lab")
      expect(s.cueKeys.length).toBeGreaterThanOrEqual(4)
    }
    expect(scenario("S5").persona).toBe("per_labtech_rubel")
    expect(scenario("S7").persona).toBe("per_pathologist_mizanur")
  })
})

describe("S5 sample rejection", () => {
  it("prepares a fresh collected EDTA tube; rejecting it orders a free recollection, an SMS and an app notice", async () => {
    const seen = new Set<string>()
    const smsOf = async (patientId: string) =>
      (await db.sms.where("patientId").equals(patientId).toArray()).filter(
        (m) => m.templateId === "sample-recollection"
      )
    const noticesOf = async (patientId: string) =>
      (
        await db.notifications.where("patientId").equals(patientId).toArray()
      ).filter((n) => n.kind === "sampleRecollection")
    for (let run = 0; run < 2; run++) {
      const { outcome, route } = await runScenario(scenario("S5"))
      const specimenId = outcome.refs!.specimenId!
      expect(seen.has(specimenId)).toBe(false)
      seen.add(specimenId)
      expect(route).toBe(`/lab/reception?focus=${specimenId}`)
      const specimen = (await db.specimens.get(specimenId))!
      expect(specimen.status).toBe("collected")
      expect(specimen.container).toBe("EDTA")
      expect(specimen.branchId).toBe("B1")
      const patient = (await db.patients.get(specimen.patientId))!
      expect(patient.phoneVerified).toBe(true)
      expect(outcome.params!.accessionNo).toBe(specimen.accessionNo)
      const smsBefore = (await smsOf(patient.id)).length
      const noticesBefore = (await noticesOf(patient.id)).length

      const { result } = await commit(
        rejectSpecimen,
        { specimenId, reason: "haemolysed", smsLang: "bn" },
        { db, actor: labtech }
      )
      expect((await db.specimens.get(specimenId))!.status).toBe("rejected")
      const fresh = (await db.specimens.get(result.specimenIds[0]))!
      expect(fresh.status).toBe("awaiting-collection")
      const items = await db.labOrderItems.bulkGet(fresh.itemIds)
      for (const item of items) {
        expect(item!.isFreeRecollection).toBe(true)
        expect(item!.paymentCleared).toBe(true)
        // Free (৳0): nothing reaches the billing basket.
        expect(item!.basketLineId).toBeUndefined()
        expect(
          await db.basketLines.where("sourceId").equals(item!.id).count()
        ).toBe(0)
      }
      // A simulated SMS and an app notice, neither with clinical content.
      const sms = await smsOf(patient.id)
      expect(sms.length).toBe(smsBefore + 1)
      expect(sms.every((m) => !/CBC|haemo|blood/i.test(m.text))).toBe(true)
      expect((await noticesOf(patient.id)).length).toBe(noticesBefore + 1)
    }
  }, 60_000)
})

describe("S6 add-on on the same specimen", () => {
  it("prepares a 2-hour-old serum tube with Dr. Kamal's creatinine request; approving bills it and the analyser runs it once paid", async () => {
    for (let run = 0; run < 2; run++) {
      const { outcome, route } = await runScenario(scenario("S6"))
      const itemId = outcome.refs!.labItemId!
      const specimenId = outcome.refs!.specimenId!
      expect(route).toBe(`/lab/reception?focus=${itemId}`)
      const specimen = (await db.specimens.get(specimenId))!
      expect(specimen.container).toBe("plain")
      expect(specimen.status).toBe("received")
      const age = now() - specimen.collectedAt!
      expect(age).toBeGreaterThanOrEqual(2 * HOUR)
      expect(age).toBeLessThan(2 * HOUR + 5 * MINUTE)
      const request = (await db.labOrderItems.get(itemId))!
      expect(request.testId).toBe(SEED_REFS.test.creatinine)
      expect(request.addOnOfItemId).toBeDefined()
      expect(request.basketLineId).toBeUndefined()
      expect(request.createdBy).toBe("stf_kamal_hossain")

      const { result } = await commit(
        decideAddOn,
        { itemId, decision: "approve" },
        { db, actor: labtech }
      )
      expect(result.specimenId).toBe(specimenId)
      const approved = (await db.labOrderItems.get(itemId))!
      expect(approved.specimenId).toBe(specimenId)
      expect(approved.paymentCleared).toBe(false)
      expect((await db.specimens.get(specimenId))!.itemIds).toContain(itemId)
      const line = (await db.basketLines.get(result.basketLineId))!
      expect(line.status).toBe("open")
      expect(line.sourceId).toBe(itemId)
      const inbox = (
        await db.inboxItems
          .where("doctorId")
          .equals(HERO.doctor.kamal)
          .toArray()
      ).filter((i) => i.refs.labItemId === itemId)
      expect(inbox.map((i) => [i.kind, i.titleKey])).toEqual([
        ["add-on", "lab.inbox.addOnApproved"],
      ])

      // The payment gate: nothing runs until the add-on is paid.
      expect(
        await refused(
          commit(importAnalyserResults, { specimenId }, { db, actor: labtech })
        )
      ).toBe("LAB_NOTHING_TO_RUN")
      await payLines(createKit(scenario("S6")), {
        patientId: request.patientId,
        basketLineIds: [result.basketLineId],
      })
      const before = (await db.specimens.get(specimenId))!.volumeRemainingMl
      const run2 = await commit(
        importAnalyserResults,
        { specimenId },
        { db, actor: labtech }
      )
      expect(run2.result.itemIds).toEqual([itemId])
      expect((await db.labOrderItems.get(itemId))!.status).toBe("resulted")
      expect((await db.specimens.get(specimenId))!.volumeRemainingMl).toBe(
        Math.round((before - 0.5) * 10) / 10
      )
    }
  }, 60_000)
})

describe("S6B add-on beyond stability", () => {
  it("refuses to approve on a 52-hour-old tube and orders a new collection, which waits for payment", async () => {
    for (let run = 0; run < 2; run++) {
      const { outcome } = await runScenario(scenario("S6B"))
      const itemId = outcome.refs!.labItemId!
      const specimenId = outcome.refs!.specimenId!
      expect(Number(outcome.params!.hours)).toBeGreaterThan(48)
      expect(
        await refused(
          commit(
            decideAddOn,
            { itemId, decision: "approve" },
            { db, actor: labtech }
          )
        )
      ).toBe("LAB_ADDON_STABILITY")

      const { result } = await commit(
        decideAddOn,
        { itemId, decision: "new-collection" },
        { db, actor: labtech }
      )
      expect(result.specimenId).not.toBe(specimenId)
      const fresh = (await db.specimens.get(result.specimenId))!
      expect(fresh.status).toBe("awaiting-collection")
      expect(fresh.itemIds).toEqual([itemId])
      expect((await db.specimens.get(specimenId))!.itemIds).not.toContain(
        itemId
      )
      const inbox = (
        await db.inboxItems
          .where("doctorId")
          .equals(HERO.doctor.kamal)
          .toArray()
      ).filter((i) => i.refs.labItemId === itemId)
      expect(inbox.map((i) => i.titleKey)).toEqual([
        "lab.inbox.addOnNewCollection",
      ])
      // Billed like any test: collection waits for payment (INV-10).
      const patient = (await db.patients.get(fresh.patientId))!
      expect(
        await refused(
          commit(
            collectSpecimen,
            { specimenId: fresh.id, secondIdentifier: patient.dob },
            { db, actor: labtech }
          )
        )
      ).toBe("PAYMENT_GATE")
    }
  }, 60_000)
})

describe("S7 critical call log", () => {
  it("prepares Jahanara's validated K+ 6.8; a logged call escalates to the duty doctor only after 30 minutes", async () => {
    for (let run = 0; run < 2; run++) {
      const { outcome, route } = await runScenario(scenario("S7"))
      const resultId = outcome.refs!.resultId!
      expect(route).toBe(`/pathology?tab=critical&focus=${resultId}`)
      const result = (await db.results.get(resultId))!
      expect(result.patientId).toBe(SEED_REFS.patient.jahanara)
      expect(result.value).toBe(6.8)
      expect(result.critical).toBe(true)
      expect(result.status).toBe("validated")
      expect(outcome.params!.duty).toBe("Dr. Saiful Islam")

      const { result: call } = await commit(
        logCriticalCall,
        {
          resultId,
          calledPerson: String(outcome.params!.doctor),
          calledRole: "ordering-doctor",
          readBack: true,
          readBackText: "potassium six point eight",
        },
        { db, actor: pathologist }
      )
      const escalate = () =>
        commit(
          escalateCritical,
          { callId: call.callId },
          { db, actor: pathologist }
        )
      expect(await refused(escalate())).toBe("LAB_CALL_NOT_OVERDUE")
      applyClockOffset(getClockOffset() + 15 * MINUTE)
      expect(await refused(escalate())).toBe("LAB_CALL_NOT_OVERDUE")
      applyClockOffset(getClockOffset() + 15 * MINUTE)
      const { result: done } = await escalate()
      expect(done.escalatedTo).toBe(HERO.doctor.saiful)
      expect(done.auto).toBe(false)
      const row = (await db.criticalCalls.get(call.callId))!
      expect(row.status).toBe("escalated")
      expect(row.escalatedAt! - row.calledAt).toBeGreaterThanOrEqual(
        rules.criticalEscalationMin * MINUTE
      )
      const inbox = (
        await db.inboxItems
          .where("doctorId")
          .equals(HERO.doctor.saiful)
          .toArray()
      ).filter((i) => i.refs.resultId === resultId)
      expect(inbox.map((i) => i.kind)).toEqual(["critical"])
    }
  }, 60_000)
})

describe("S8 corrected report", () => {
  it("prepares Shahidul's released TSH v1 at 0.52; correcting signs v2, keeps v1 and tells the doctor, the app and the QR page", async () => {
    for (let run = 0; run < 2; run++) {
      const { outcome, route } = await runScenario(scenario("S8"))
      const v1Id = outcome.refs!.reportId!
      expect(route).toBe(`/pathology?tab=released&focus=${v1Id}`)
      const v1 = (await db.labReports.get(v1Id))!
      expect(v1.status).toBe("released")
      expect(v1.reportVersion).toBe(1)
      const [tsh] = await db.results
        .where("labOrderItemId")
        .anyOf(v1.itemIds)
        .toArray()
      expect(tsh.value).toBe(TSH_UNIT_ERROR.v1.value)
      expect(tsh.flag).toBe("N")
      expect(tsh.source).toBe("manual")
      expect(tsh.secondCheckBy).toBeDefined()

      const { result } = await commit(
        correctReport,
        {
          reportId: v1Id,
          reason: TSH_UNIT_ERROR.reason,
          changeSummary: TSH_UNIT_ERROR.changeSummary,
          corrections: [{ resultId: tsh.id, value: TSH_UNIT_ERROR.v2.value }],
          smsLang: "bn",
        },
        { db, actor: pathologist }
      )
      const v2 = (await db.labReports.get(result.reportId))!
      expect(v2.reportVersion).toBe(2)
      expect(v2.status).toBe("released")
      expect(v2.correctionReason).toBe(TSH_UNIT_ERROR.reason)
      expect((await db.labReports.get(v1Id))!.status).toBe("superseded")
      expect((await db.results.get(tsh.id))!.flag).toBe("H")
      const inbox = (
        await db.inboxItems
          .where("doctorId")
          .equals(HERO.doctor.kamal)
          .toArray()
      ).filter((i) => i.refs.reportId === v2.id)
      expect(inbox.map((i) => i.kind)).toEqual(["corrected"])
      const notices = (
        await db.notifications
          .where("patientId")
          .equals(TSH_UNIT_ERROR.patientId)
          .toArray()
      ).filter((n) => n.refs.reportId === v2.id)
      expect(notices.map((n) => n.kind)).toEqual(["reportUpdated"])
      const verification = await loadVerification(db, v1Id)
      expect(verification.state).toBe("genuine")
      if (verification.state === "genuine") {
        expect(verification.current.id).toBe(v2.id)
      }
    }
  }, 60_000)
})
