import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { rules } from "@/config/rules.config"
import { applyClockOffset, getClockOffset, now } from "@/core/clock/clock"
import { HOUR, MINUTE } from "@/core/clock/dates"
import { sweepOnce } from "@/core/clock/sweeper"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { RuleViolation } from "@/core/engine/errors"
import type { Actor } from "@/core/engine/types"
import { HERO, SEED_REFS } from "@/core/seed/content"
import {
  acknowledgeCritical,
  collectSpecimen,
  decideAddOn,
  escalateCritical,
  importAnalyserResults,
  logCriticalCall,
  receiveSpecimen,
  rejectSpecimen,
  requestAddOn,
  validateItem,
} from "@/modules/lab/commands"
import { criticalEscalationJob, labJobs } from "@/modules/lab/jobs"
import { addOnCheck, isCallOverdue } from "@/modules/lab/logic"

import {
  doctor,
  labtech,
  pathologist,
  placeLabOrder,
  releaseClock,
  seededDb,
} from "./fixtures"

/**
 * Add-on tests (S6) and critical call escalation (S7): the stability, volume
 * and tube checks, the payment gate on add-ons, escalation timing on the
 * demo clock, and the sweeper that escalates only when auto-escalation is on.
 */

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("lab-addon-critical-test")
}, 60_000)

afterAll(async () => {
  releaseClock()
  await db?.delete()
})

async function refused(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof RuleViolation) return error.code
    throw error
  }
  throw new Error("expected a refusal")
}

const as = (actor: Actor) => ({ db, actor })

/** Moves a specimen's collection time and remaining volume (test fixture). */
const setSpecimen = defineCommand({
  name: "test.setSpecimen",
  roles: "any",
  input: z.object({
    specimenId: z.string(),
    hoursAgo: z.number().optional(),
    volumeMl: z.number().optional(),
  }),
  async run(tx, input) {
    await tx.update("specimens", input.specimenId, {
      ...(input.hoursAgo !== undefined
        ? { collectedAt: tx.now() - input.hoursAgo * HOUR }
        : {}),
      ...(input.volumeMl !== undefined
        ? { volumeRemainingMl: input.volumeMl }
        : {}),
    })
  },
})

/** A paid order at B1, collected and received: the tube is on the bench. */
async function onBench(testIds: string[], patientId: string = HERO.patient.rokeyaBegum) {
  const { result } = await commit(
    placeLabOrder,
    { patientId, doctorId: HERO.doctor.kamal, testIds },
    as(labtech)
  )
  const patient = (await db.patients.get(patientId))!
  for (const s of result.specimens) {
    await commit(
      collectSpecimen,
      { specimenId: s.id, secondIdentifier: patient.dob },
      as(labtech)
    )
    await commit(receiveSpecimen, { specimenId: s.id }, as(labtech))
  }
  return result
}

describe("add-on check (pure)", () => {
  const test = { code: "CREAT", stabilityHours: 48, container: "plain" as const }
  const base = {
    collectedAt: 1_000_000_000_000,
    volumeRemainingMl: 2.5,
    container: "plain" as const,
  }
  it("passes within stability and fails beyond it", () => {
    const within = addOnCheck({
      specimen: base,
      test,
      now: base.collectedAt + 48 * HOUR,
    })
    expect(within.stable).toBe(true)
    expect(within.ok).toBe(true)
    const beyond = addOnCheck({
      specimen: base,
      test,
      now: base.collectedAt + 48 * HOUR + MINUTE,
    })
    expect(beyond.stable).toBe(false)
    expect(beyond.ok).toBe(false)
    expect(beyond.hours).toBe(48)
  })
  it("checks the sample left, less what approved add-ons will use", () => {
    const at = base.collectedAt + HOUR
    expect(addOnCheck({ specimen: base, test, now: at }).enoughVolume).toBe(true)
    const low = addOnCheck({
      specimen: { ...base, volumeRemainingMl: 0.4 },
      test,
      now: at,
    })
    expect(low.enoughVolume).toBe(false)
    const reserved = addOnCheck({ specimen: base, test, now: at, reservedMl: 2.2 })
    expect(reserved.remainingMl).toBe(0.3)
    expect(reserved.enoughVolume).toBe(false)
  })
  it("needs the same kind of tube", () => {
    const check = addOnCheck({
      specimen: { ...base, container: "EDTA" },
      test,
      now: base.collectedAt,
    })
    expect(check.sameContainer).toBe(false)
    expect(check.ok).toBe(false)
  })
})

describe("lab.requestAddOn and lab.decideAddOn", () => {
  it("refuses a different tube, a duplicate test and a tube not yet collected", async () => {
    const edta = await onBench([SEED_REFS.test.cbc])
    expect(
      await refused(
        commit(
          requestAddOn,
          { specimenId: edta.specimens[0].id, testId: SEED_REFS.test.creatinine },
          as(doctor)
        )
      )
    ).toBe("LAB_ADDON_CONTAINER")

    const serum = await onBench([SEED_REFS.test.electrolytes])
    const specimenId = serum.specimens[0].id
    expect(
      await refused(
        commit(
          requestAddOn,
          { specimenId, testId: SEED_REFS.test.electrolytes },
          as(doctor)
        )
      )
    ).toBe("LAB_ADDON_DUPLICATE")
    await commit(
      requestAddOn,
      { specimenId, testId: SEED_REFS.test.creatinine },
      as(doctor)
    )
    expect(
      await refused(
        commit(
          requestAddOn,
          { specimenId, testId: SEED_REFS.test.creatinine },
          as(doctor)
        )
      )
    ).toBe("LAB_ADDON_DUPLICATE")

    const { result: waiting } = await commit(
      placeLabOrder,
      {
        patientId: HERO.patient.rokeyaBegum,
        testIds: [SEED_REFS.test.electrolytes],
      },
      as(labtech)
    )
    expect(
      await refused(
        commit(
          requestAddOn,
          {
            specimenId: waiting.specimens[0].id,
            testId: SEED_REFS.test.creatinine,
          },
          as(doctor)
        )
      )
    ).toBe("LAB_SPECIMEN_STATE")
    // Only doctors ask for add-ons; only the lab decides them.
    await expect(
      commit(
        requestAddOn,
        { specimenId, testId: SEED_REFS.test.crp },
        as(labtech)
      )
    ).rejects.toMatchObject({ kind: "denied" })
  })

  it("approves within stability and volume, then refuses a second decision", async () => {
    const serum = await onBench([SEED_REFS.test.electrolytes])
    const specimenId = serum.specimens[0].id
    await commit(setSpecimen, { specimenId, hoursAgo: 47 }, as(labtech))
    const { result: request } = await commit(
      requestAddOn,
      { specimenId, testId: SEED_REFS.test.creatinine },
      as(doctor)
    )
    const { result } = await commit(
      decideAddOn,
      { itemId: request.itemId, decision: "approve" },
      as(labtech)
    )
    expect(result.check.stable).toBe(true)
    expect(result.check.enoughVolume).toBe(true)
    expect(
      await refused(
        commit(
          decideAddOn,
          { itemId: request.itemId, decision: "new-collection" },
          as(labtech)
        )
      )
    ).toBe("LAB_ADDON_DECIDED")
    const events = await db.events.orderBy("seq").reverse().limit(1).toArray()
    expect(events[0].type).toBe("AddOnApproved")
  })

  it("refuses to approve beyond stability or without enough sample", async () => {
    const old = await onBench([SEED_REFS.test.electrolytes])
    await commit(
      setSpecimen,
      { specimenId: old.specimens[0].id, hoursAgo: 49 },
      as(labtech)
    )
    const { result: late } = await commit(
      requestAddOn,
      { specimenId: old.specimens[0].id, testId: SEED_REFS.test.creatinine },
      as(doctor)
    )
    expect(
      await refused(
        commit(
          decideAddOn,
          { itemId: late.itemId, decision: "approve" },
          as(labtech)
        )
      )
    ).toBe("LAB_ADDON_STABILITY")

    const small = await onBench([SEED_REFS.test.electrolytes])
    await commit(
      setSpecimen,
      { specimenId: small.specimens[0].id, volumeMl: 0.3 },
      as(labtech)
    )
    const { result: dry } = await commit(
      requestAddOn,
      { specimenId: small.specimens[0].id, testId: SEED_REFS.test.creatinine },
      as(doctor)
    )
    expect(
      await refused(
        commit(
          decideAddOn,
          { itemId: dry.itemId, decision: "approve" },
          as(labtech)
        )
      )
    ).toBe("LAB_ADDON_VOLUME")
  })

  it("counts sample promised to an approved add-on that has not run", async () => {
    const serum = await onBench([SEED_REFS.test.electrolytes])
    const specimenId = serum.specimens[0].id
    await commit(setSpecimen, { specimenId, volumeMl: 0.8 }, as(labtech))
    const first = await commit(
      requestAddOn,
      { specimenId, testId: SEED_REFS.test.creatinine },
      as(doctor)
    )
    const second = await commit(
      requestAddOn,
      { specimenId, testId: SEED_REFS.test.crp },
      as(doctor)
    )
    await commit(
      decideAddOn,
      { itemId: first.result.itemId, decision: "approve" },
      as(labtech)
    )
    // 0.8 ml less the 0.5 ml promised to creatinine leaves 0.3 ml for CRP.
    expect(
      await refused(
        commit(
          decideAddOn,
          { itemId: second.result.itemId, decision: "approve" },
          as(labtech)
        )
      )
    ).toBe("LAB_ADDON_VOLUME")
  })

  it("rejecting a tube withdraws an unpaid add-on's bill line and recollects only paid tests", async () => {
    const serum = await onBench([SEED_REFS.test.electrolytes])
    const specimenId = serum.specimens[0].id
    const { result: request } = await commit(
      requestAddOn,
      { specimenId, testId: SEED_REFS.test.creatinine },
      as(doctor)
    )
    const { result: approved } = await commit(
      decideAddOn,
      { itemId: request.itemId, decision: "approve" },
      as(labtech)
    )
    const { result } = await commit(
      rejectSpecimen,
      { specimenId, reason: "haemolysed" },
      as(labtech)
    )
    expect((await db.labOrderItems.get(request.itemId))!.status).toBe(
      "rejected"
    )
    expect((await db.basketLines.get(approved.basketLineId))!.status).toBe(
      "removed"
    )
    const fresh = (await db.specimens.get(result.specimenIds[0]))!
    const tests = (await db.labOrderItems.bulkGet(fresh.itemIds)).map(
      (i) => i!.testId
    )
    expect(tests).toEqual([SEED_REFS.test.electrolytes])
  })

  it("keeps an unpaid add-on off the analyser and runs it once paid", async () => {
    const serum = await onBench([SEED_REFS.test.electrolytes])
    const specimenId = serum.specimens[0].id
    await commit(importAnalyserResults, { specimenId }, as(labtech))
    const { result: request } = await commit(
      requestAddOn,
      { specimenId, testId: SEED_REFS.test.creatinine },
      as(doctor)
    )
    await commit(
      decideAddOn,
      { itemId: request.itemId, decision: "approve" },
      as(labtech)
    )
    expect(
      await refused(
        commit(importAnalyserResults, { specimenId }, as(labtech))
      )
    ).toBe("LAB_NOTHING_TO_RUN")
    await commit(markPaid, { itemId: request.itemId }, as(labtech))
    const { result } = await commit(
      importAnalyserResults,
      { specimenId },
      as(labtech)
    )
    expect(result.itemIds).toEqual([request.itemId])
    await commit(validateItem, { itemId: request.itemId }, as(labtech))
    expect((await db.labOrderItems.get(request.itemId))!.status).toBe(
      "validated"
    )
  })
})

/** What billing.checkout does to a paid lab item (the payment gate opens). */
const markPaid = defineCommand({
  name: "test.markPaid",
  roles: "any",
  input: z.object({ itemId: z.string() }),
  async run(tx, input) {
    await tx.update("labOrderItems", input.itemId, {
      paymentCleared: true,
      status: "paid",
    })
  },
})

describe("critical call escalation", () => {
  /** A validated critical potassium for Jahanara, with a logged call. */
  async function openCall() {
    const bench = await onBench(
      [SEED_REFS.test.potassium],
      SEED_REFS.patient.jahanara
    )
    await commit(
      importAnalyserResults,
      { specimenId: bench.specimens[0].id },
      as(labtech)
    )
    await commit(validateItem, { itemId: bench.itemIds[0] }, as(labtech))
    const [result] = await db.results
      .where("labOrderItemId")
      .equals(bench.itemIds[0])
      .toArray()
    expect(result.critical).toBe(true)
    const { result: call } = await commit(
      logCriticalCall,
      {
        resultId: result.id,
        calledPerson: "Dr. Kamal Hossain",
        calledRole: "ordering-doctor",
        readBack: true,
      },
      as(pathologist)
    )
    return call.callId
  }

  const advance = (minutes: number) =>
    applyClockOffset(getClockOffset() + minutes * MINUTE)

  it("is overdue from the escalation minute onwards, and only while open", () => {
    const limit = rules.criticalEscalationMin
    const call = { calledAt: 0, status: "open" as const }
    expect(isCallOverdue(call, limit * MINUTE - 1, limit)).toBe(false)
    expect(isCallOverdue(call, limit * MINUTE, limit)).toBe(true)
    expect(
      isCallOverdue({ ...call, status: "acknowledged" }, limit * MINUTE, limit)
    ).toBe(false)
  })

  it("escalates by hand only after 30 minutes, to the branch's duty doctor", async () => {
    const callId = await openCall()
    const escalate = () =>
      commit(escalateCritical, { callId }, as(pathologist))
    advance(29)
    expect(await refused(escalate())).toBe("LAB_CALL_NOT_OVERDUE")
    advance(1)
    const { result } = await escalate()
    expect(result.escalatedTo).toBe(HERO.doctor.saiful)
    const call = (await db.criticalCalls.get(callId))!
    expect(call.status).toBe("escalated")
    expect(call.auto).toBeUndefined()
    expect(await refused(escalate())).toBe("LAB_CALL_STATE")
    // The duty doctor can still acknowledge it afterwards.
    await commit(acknowledgeCritical, { callId }, as(doctor))
    expect((await db.criticalCalls.get(callId))!.status).toBe("acknowledged")
  })

  it("does not escalate an acknowledged call", async () => {
    const callId = await openCall()
    await commit(acknowledgeCritical, { callId }, as(pathologist))
    advance(45)
    expect(
      await refused(commit(escalateCritical, { callId }, as(pathologist)))
    ).toBe("LAB_CALL_STATE")
    expect(
      await refused(commit(acknowledgeCritical, { callId }, as(pathologist)))
    ).toBe("LAB_CALL_STATE")
  })

  it("the sweeper escalates overdue calls only when auto-escalation is on", async () => {
    const overdue = await openCall()
    advance(31)
    const recent = await openCall()

    // Release 1: rules.criticalAutoEscalation is off, so nothing happens.
    expect(rules.criticalAutoEscalation).toBe(false)
    await sweepOnce([db], labJobs)
    await sweepOnce([db], [criticalEscalationJob(() => false)])
    expect((await db.criticalCalls.get(overdue))!.status).toBe("open")

    // Tier 2 toggle on: the overdue call goes to the duty doctor, automatically.
    const job = criticalEscalationJob(() => true)
    await sweepOnce([db], [job])
    const escalated = (await db.criticalCalls.get(overdue))!
    expect(escalated.status).toBe("escalated")
    expect(escalated.auto).toBe(true)
    expect(escalated.escalatedTo).toBe(HERO.doctor.saiful)
    expect((await db.criticalCalls.get(recent))!.status).toBe("open")
    const inbox = (
      await db.inboxItems.where("doctorId").equals(HERO.doctor.saiful).toArray()
    ).filter((i) => i.refs.resultId === escalated.resultId)
    expect(inbox).toHaveLength(1)

    // Idempotent: a second sweep changes nothing; the recent call follows the clock.
    await sweepOnce([db], [job])
    expect((await db.criticalCalls.get(overdue))!.version).toBe(
      escalated.version
    )
    advance(30)
    await sweepOnce([db], [job])
    expect((await db.criticalCalls.get(recent))!.status).toBe("escalated")
    expect(now()).toBeGreaterThan(escalated.escalatedAt!)
  })
})
