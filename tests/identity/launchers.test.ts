import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { z } from "zod"

import { applyClockOffset } from "@/core/clock/clock"
import { getCentralDb } from "@/core/db/database"
import { resetDemo } from "@/core/demo/reset"
import { commit } from "@/core/engine/commit"
import { ConflictError, RuleViolation } from "@/core/engine/errors"
import type { CommandDef } from "@/core/engine/types"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { SEED_REFS } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { findLikelyDuplicates } from "@/core/search/fuzzy"
import { actorFor } from "@/core/session/persona"
import {
  confirmExistingPatient,
  registerPatient,
  updateContact,
  type RegisterInput,
} from "@/modules/identity/commands"

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!
const desk = actorFor(findPersona("per_reception_farhana")!)

async function run<S extends z.ZodType, O>(
  def: CommandDef<S, O>,
  input: z.input<S>
): Promise<O> {
  return (await commit(def, input, { db: getCentralDb(), actor: desk })).result
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected a failure")
}

/** The S1 form as the launcher prefills it (front desk S1_PREFILL). */
const S1_FORM: RegisterInput = {
  nameEn: SEED_REFS.s1.variantNameEn,
  nameBn: SEED_REFS.s1.variantNameBn,
  dob: SEED_REFS.s1.dob,
  sex: "M",
  phone: SEED_REFS.s1.variantPhone,
  idMissingReason: "not-brought",
  household: { mode: "none" },
  consents: { treatment: true, sms: true, app: false },
}

beforeAll(async () => {
  await resetDemo()
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

describe("S1 duplicate patient launcher", () => {
  it("opens the prefilled form on every run; saving warns, both answers are recorded, and a known NID is a hard stop", async () => {
    const db = getCentralDb()
    for (let run1 = 1; run1 <= 2; run1++) {
      const { outcome, route } = await runScenario(scenario("S1"))
      expect(route).toBe(`/reception?register=S1&r=S1-${run1}`)
      expect(outcome.params).toMatchObject({
        name: SEED_REFS.s1.variantNameEn,
        existing: SEED_REFS.s1.existingNameEn,
        nid: SEED_REFS.nidCollisions[0].nid,
        dob: "12-03-1978",
      })

      // Save: the ranked warning comes first, with the seeded record among the matches.
      const active = await db.patients
        .where("identityStatus")
        .equals("active")
        .toArray()
      const candidates = findLikelyDuplicates(
        { nameEn: S1_FORM.nameEn, dob: S1_FORM.dob, phone: S1_FORM.phone },
        active
      )
      const existing = candidates.find(
        (c) => c.patientId === SEED_REFS.s1.existingPatientId
      )
      expect(existing?.reasons).toEqual(expect.arrayContaining(["name", "dob"]))
      if (run1 === 1)
        expect(candidates[0].patientId).toBe(SEED_REFS.s1.existingPatientId)
      const unanswered = await failure(run(registerPatient, S1_FORM))
      expect((unanswered as RuleViolation).code).toBe("DUPLICATE_UNRESOLVED")

      if (run1 === 1) {
        // Different person, with a reason: registered, and the decision kept.
        const registered = await run(registerPatient, {
          ...S1_FORM,
          duplicateDecision: {
            candidateIds: candidates.map((c) => c.patientId),
            score: candidates[0].score,
            reason: "Father's name differs on the NID slip",
          },
        })
        expect(
          (
            await db.duplicateDecisions
              .where("newPatientId")
              .equals(registered.patientId)
              .first()
          )?.decision
        ).toBe("different")
      } else {
        // Same person: nothing is registered, the decision is kept.
        await run(confirmExistingPatient, {
          patientId: SEED_REFS.s1.existingPatientId,
          candidateIds: candidates.map((c) => c.patientId),
          score: existing!.score,
        })
        const decisions = await db.duplicateDecisions
          .where("candidateIds")
          .equals(SEED_REFS.s1.existingPatientId)
          .toArray()
        expect(decisions.some((d) => d.decision === "same")).toBe(true)
      }

      // A known NID: INV-02 blocks it for every role, and the attempt is audited.
      const auditBefore = await db.audit.count()
      const blocked = await failure(
        run(registerPatient, {
          ...S1_FORM,
          nid: SEED_REFS.nidCollisions[0].nid,
        })
      )
      expect(blocked).toBeInstanceOf(RuleViolation)
      expect((blocked as RuleViolation).code).toBe("NID_EXISTS")
      expect((blocked as RuleViolation).audit).toBe(true)
      const audited = (await db.audit.toArray()).slice(auditBefore)
      expect(audited.some((row) => row.action === "blocked")).toBe(true)
    }
  }, 60_000)
})

describe("S16 concurrent edit launcher", () => {
  it("opens the same patient's contact form on every run; a stale save is refused naming who changed it", async () => {
    const db = getCentralDb()
    for (let n = 1; n <= 2; n++) {
      const { outcome, route } = await runScenario(scenario("S16"))
      expect(route).toBe(
        `/reception?patient=${SEED_REFS.patient.shahnaz}&edit=contact&r=S16-${n}`
      )
      expect(outcome.refs?.patientId).toBe(SEED_REFS.patient.shahnaz)

      // Two panes open the form on the same version.
      const opened = (await db.patients.get(SEED_REFS.patient.shahnaz))!
      const pane1 = await run(updateContact, {
        patientId: opened.id,
        expectedVersion: opened.version,
        phone: n === 1 ? "01712-000111" : "01712-000333",
        address: opened.address,
      })
      expect(pane1.version).toBe(opened.version + 1)
      const stale = await failure(
        run(updateContact, {
          patientId: opened.id,
          expectedVersion: opened.version,
          phone: "01712-000222",
        })
      )
      expect(stale).toBeInstanceOf(ConflictError)
      expect(stale).toMatchObject({
        expectedVersion: opened.version,
        actualVersion: opened.version + 1,
        updatedBy: desk.staffId,
      })
      // Reload and re-apply: the save goes through on the new version.
      const again = await run(updateContact, {
        patientId: opened.id,
        expectedVersion: pane1.version,
        phone: "01712-000222",
      })
      expect(again.version).toBe(pane1.version + 1)
      expect(await db.patients.get(opened.id)).toMatchObject({
        phone: "01712-000222",
        phoneVerified: false,
      })
    }
  }, 60_000)
})
