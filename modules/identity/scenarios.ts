import { groupUhid } from "@/core/db/numbering"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { bnDigits } from "@/core/seed/content/bn"
import { SEED_REFS } from "@/core/seed/content/seed-refs"

/**
 * Front desk identity launchers (plan §10):
 * - S1 duplicate patient: the registration form opens prefilled with a
 *   spelling variant of a seeded patient; saving shows the ranked duplicate
 *   warning, and a known NID is a hard stop (INV-02, audited).
 * - S16 concurrent edit: the same patient's contact form, so launching it in
 *   two Demo Wall panes shows the engine's version conflict.
 */

const DESK = "per_reception_farhana"

/** This launcher's run number in the window's store (keeps each launch's address unique). */
async function runNumber(kit: ScenarioKit): Promise<number> {
  const db = await kit.db()
  return (
    (await db.scenarioRuns.where("scenarioId").equals(kit.scenarioId).count()) +
    1
  )
}

async function activePatient(kit: ScenarioKit, patientId: string) {
  const db = await kit.db()
  const patient = await db.patients.get(patientId)
  if (!patient || patient.identityStatus !== "active") {
    throw new Error(
      `Seeded patient ${patientId} is missing or merged: reset the demo data`
    )
  }
  return patient
}

const dmyOf = (iso: string) => iso.split("-").reverse().join("-")

export const identityScenarios: ScenarioDef[] = [
  {
    id: "S1",
    kind: "scenario",
    module: "identity",
    titleKey: "identity.scenarios.S1.title",
    summaryKey: "identity.scenarios.S1.summary",
    persona: DESK,
    async setup(kit) {
      // The seed holds the existing record; the form itself is the scenario.
      const existing = await activePatient(kit, SEED_REFS.s1.existingPatientId)
      const dob = dmyOf(SEED_REFS.s1.dob)
      return {
        refs: { patientId: existing.id },
        params: {
          run: await runNumber(kit),
          name: SEED_REFS.s1.variantNameEn,
          nameBn: SEED_REFS.s1.variantNameBn,
          existing: existing.nameEn,
          existingBn: existing.nameBn,
          uhid: groupUhid(existing.uhid),
          dob,
          dobBn: bnDigits(dob),
          nid: SEED_REFS.nidCollisions[0].nid,
        },
      }
    },
    route: ({ params }) => `/reception?register=S1&r=S1-${params?.run ?? 1}`,
    cueKeys: [
      "identity.scenarios.S1.cue.1",
      "identity.scenarios.S1.cue.2",
      "identity.scenarios.S1.cue.3",
      "identity.scenarios.S1.cue.4",
      "identity.scenarios.S1.cue.5",
    ],
  },
  {
    id: "S16",
    kind: "scenario",
    module: "identity",
    titleKey: "identity.scenarios.S16.title",
    summaryKey: "identity.scenarios.S16.summary",
    persona: DESK,
    async setup(kit) {
      // One fixed patient on every run, so two panes open the same record.
      const patient = await activePatient(kit, SEED_REFS.patient.shahnaz)
      return {
        refs: { patientId: patient.id },
        params: {
          run: await runNumber(kit),
          name: patient.nameEn,
          nameBn: patient.nameBn,
          uhid: groupUhid(patient.uhid),
          version: patient.version,
        },
      }
    },
    route: ({ refs, params }) =>
      `/reception?patient=${refs?.patientId ?? SEED_REFS.patient.shahnaz}&edit=contact&r=S16-${params?.run ?? 1}`,
    cueKeys: [
      "identity.scenarios.S16.cue.1",
      "identity.scenarios.S16.cue.2",
      "identity.scenarios.S16.cue.3",
      "identity.scenarios.S16.cue.4",
      "identity.scenarios.S16.cue.5",
    ],
  },
]
