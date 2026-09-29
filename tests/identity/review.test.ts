import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { z } from "zod"

import { applyClockOffset, now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { getCentralDb } from "@/core/db/database"
import type { ReviewItemRow } from "@/core/db/schema"
import { resetDemo } from "@/core/demo/reset"
import { commit } from "@/core/engine/commit"
import { RuleViolation, ValidationError } from "@/core/engine/errors"
import type { Actor, CommandDef } from "@/core/engine/types"
import { pickPatient } from "@/core/scenarios/fixtures"
import { SCENARIOS } from "@/core/scenarios/registry"
import { createKit, runScenario } from "@/core/scenarios/runner"
import type { ScenarioDef } from "@/core/scenarios/types"
import { HERO } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"
import { nameKeys } from "@/core/search/fuzzy"
import { reconnectBranch } from "@/core/sync/replay"
import { resolveReview } from "@/modules/identity/commands"
import {
  parseReviewDetail,
  provisionalUhidOf,
  splitDuplicate,
} from "@/modules/identity/review"
import { bookAppointment } from "@/modules/scheduling/commands"
import { isSessionBookable } from "@/modules/scheduling/slots"

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!
const actor = (personaId: string) => actorFor(findPersona(personaId)!)
const farhana = actor("per_reception_farhana")
const sumon = actor("per_reception_sumon")
const MAHMUDUL = findPersona("per_reception_mahmudul")!.staff!.id

async function run<S extends z.ZodType, O>(
  def: CommandDef<S, O>,
  input: z.input<S>,
  as: Actor = farhana
): Promise<O> {
  return (await commit(def, input, { db: getCentralDb(), actor: as })).result
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof RuleViolation) return error.code
    if (error instanceof ValidationError) return "VALIDATION"
    throw error
  }
  throw new Error("expected a refusal")
}

/** S15, then the presenter reconnects B1: the review item for the pair. */
async function s15Review(): Promise<{
  item: ReviewItemRow
  centralId: string
}> {
  const { outcome } = await runScenario(scenario("S15"))
  await reconnectBranch("B1")
  const centralId = outcome.refs!.patientId!
  const item = (
    await getCentralDb().reviewQueue.where("status").equals("open").toArray()
  ).find((r) => r.kind === "sync-duplicate" && r.patientIds.includes(centralId))
  if (!item) throw new Error("no review item after reconnect")
  return { item, centralId }
}

beforeAll(async () => {
  await resetDemo()
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

describe("identity.resolveReview: sync duplicates (S15 after reconnect)", () => {
  it("merges the same person with a second person's approval; the survivor keeps the other UHIDs and the open work", async () => {
    const db = getCentralDb()
    const { item, centralId } = await s15Review()
    const patients = new Map(
      (await db.patients.bulkGet(item.patientIds)).map((p) => [p!.id, p!])
    )
    const { incoming, candidates } = splitDuplicate(item, patients)
    expect(incoming?.identityStatus).toBe("under-review")
    expect(candidates.map((c) => c.id)).toContain(centralId)
    const provisional = provisionalUhidOf(incoming!)
    expect(provisional).toMatch(/^P-B1-/)
    expect(
      parseReviewDetail(item.detail).get(centralId)?.score
    ).toBeGreaterThanOrEqual(0.6)

    // Open work on the record from the branch: a booking in one of Dr. Arif's later sessions.
    const today = dhakaDate(now())
    const later = (
      await db.sessions.where("doctorId").equals(HERO.doctor.arif).toArray()
    )
      .filter((s) => s.date > today && isSessionBookable(s))
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    const booked = await run(bookAppointment, {
      sessionId: later.id,
      patientId: incoming!.id,
      source: "counter",
    })

    const same = (approverStaffId: string) =>
      run(resolveReview, {
        reviewId: item.id,
        decision: "same",
        survivorId: centralId,
        mergedId: incoming!.id,
        approval: {
          approverStaffId,
          reason: "NID slip and photo match",
          pinVerified: true,
        },
      })
    // Two people: the requester cannot approve, nor can someone without the authority.
    expect(await refusal(same(farhana.staffId))).toBe("APPROVER_SAME_PERSON")
    expect(await refusal(same(sumon.staffId))).toBe(
      "MERGE_APPROVER_LACKS_AUTHORITY"
    )

    const result = await same(MAHMUDUL)
    expect(result).toMatchObject({ resolution: "same", survivorId: centralId })
    expect(result.moved?.appointments).toBe(1)

    const survivor = (await db.patients.get(centralId))!
    const merged = (await db.patients.get(incoming!.id))!
    expect(survivor.identityStatus).toBe("active")
    expect(survivor.aliases).toEqual(
      expect.arrayContaining([merged.uhid, provisional])
    )
    expect(survivor.nameSearchKeys).toEqual(
      expect.arrayContaining(merged.nameSearchKeys)
    )
    expect(merged).toMatchObject({
      identityStatus: "merged",
      mergedInto: centralId,
    })
    // The old UHIDs find the survivor (search skips merged records).
    const byAlias = await db.patients
      .where("aliases")
      .equals(provisional!)
      .toArray()
    expect(
      byAlias.filter((p) => p.identityStatus !== "merged").map((p) => p.id)
    ).toEqual([centralId])

    const appointment = (await db.appointments.get(booked.appointmentId))!
    expect(appointment.patientId).toBe(centralId)
    expect(
      (await db.basketLines.get(appointment.feeBasketLineId!))?.patientId
    ).toBe(centralId)

    expect(await db.reviewQueue.get(item.id)).toMatchObject({
      status: "resolved",
      resolution: "same",
      resolvedBy: farhana.staffId,
    })
    const approval = (
      await db.approvals.where("kind").equals("merge").toArray()
    ).find((a) => a.refs.reviewId === item.id)
    expect(approval).toMatchObject({
      approverId: MAHMUDUL,
      requestedBy: farhana.staffId,
      pinVerified: true,
      status: "approved",
    })
    const decision = (
      await db.duplicateDecisions
        .where("candidateIds")
        .equals(centralId)
        .toArray()
    ).at(-1)
    expect(decision).toMatchObject({
      decision: "same",
      reason: "NID slip and photo match",
    })
    const audit = await db.audit.where("entityId").equals(merged.id).toArray()
    expect(audit.at(-1)).toMatchObject({
      approvedBy: MAHMUDUL,
      reason: "NID slip and photo match",
    })
    expect(await db.events.where("type").equals("PatientsMerged").count()).toBe(
      1
    )

    expect(await refusal(same(MAHMUDUL))).toBe("REVIEW_ALREADY_RESOLVED")
  }, 60_000)

  it("records different people with a reason and keeps both records active", async () => {
    const db = getCentralDb()
    const { item, centralId } = await s15Review()
    const incomingId = item.patientIds[0]
    expect(
      await refusal(
        run(resolveReview, {
          reviewId: item.id,
          decision: "different",
          reason: "",
        })
      )
    ).toBe("VALIDATION")
    // Only "same" or "different" fit a duplicate; field choices are for conflicts.
    expect(
      await refusal(
        run(resolveReview, { reviewId: item.id, decision: "fields", keep: {} })
      )
    ).toBe("REVIEW_WRONG_KIND")

    await run(resolveReview, {
      reviewId: item.id,
      decision: "different",
      reason: "Different father's name on the NID slip",
    })
    expect((await db.patients.get(incomingId))?.identityStatus).toBe("active")
    expect((await db.patients.get(centralId))?.identityStatus).toBe("active")
    expect(await db.reviewQueue.get(item.id)).toMatchObject({
      status: "resolved",
      resolution: "different",
      reason: "Different father's name on the NID slip",
    })
    const decision = (
      await db.duplicateDecisions
        .where("newPatientId")
        .equals(incomingId)
        .toArray()
    ).at(-1)
    expect(decision).toMatchObject({ decision: "different" })
    expect(decision?.candidateIds).toContain(centralId)
  }, 60_000)
})

describe("identity.resolveReview: identity conflicts", () => {
  it("keeps the central or the branch value field by field", async () => {
    const db = getCentralDb()
    const def: ScenarioDef = {
      id: "T-conflict",
      kind: "scenario",
      module: "identity",
      titleKey: "identity.title",
      persona: "per_reception_farhana",
      route: () => "/",
      cueKeys: [],
    }
    const kit = createKit(def)
    const patient = await pickPatient(kit, { branch: "B1", minAge: 18 })
    await kit.cutBranch("B1")
    // Offline at Dhanmondi, and online at Mirpur, the same person's details change.
    await kit.fixture("edge change", async (tx) => {
      await tx.update("patients", patient.id, {
        nameEn: "Branch Spelling",
        dob: "1980-01-01",
      })
    })
    await kit.fixture(
      "central change",
      async (tx) => {
        await tx.update("patients", patient.id, {
          nameEn: "Central Spelling",
          dob: "1981-02-02",
        })
      },
      "per_reception_sumon"
    )
    await kit.reconnectBranch("B1")
    const item = (
      await db.reviewQueue.where("status").equals("open").toArray()
    ).find(
      (r) => r.kind === "identity-conflict" && r.patientIds[0] === patient.id
    )!
    expect(item.fields?.map((f) => f.field).sort()).toEqual(["dob", "nameEn"])

    expect(
      await refusal(
        run(resolveReview, {
          reviewId: item.id,
          decision: "fields",
          keep: { nameEn: "edge" },
        })
      )
    ).toBe("REVIEW_FIELD_CHOICE_REQUIRED")
    await run(resolveReview, {
      reviewId: item.id,
      decision: "fields",
      keep: { nameEn: "edge", dob: "central" },
    })
    const after = (await db.patients.get(patient.id))!
    expect(after).toMatchObject({
      nameEn: "Branch Spelling",
      dob: "1981-02-02",
    })
    expect(after.nameSearchKeys).toEqual(
      nameKeys("Branch Spelling", after.nameBn)
    )
    expect(await db.reviewQueue.get(item.id)).toMatchObject({
      status: "resolved",
      resolution: "kept-edge",
    })
  }, 60_000)
})
