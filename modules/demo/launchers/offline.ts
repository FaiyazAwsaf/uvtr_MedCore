import { RuleViolation } from "@/core/engine/errors"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { findLikelyDuplicates } from "@/core/search/fuzzy"
import { getNetworkRow } from "@/core/sync/network"
import {
  registerPatient,
  type RegisterInput,
} from "@/modules/identity/commands"

/**
 * S14 and S15 (plan §10): a branch loses its internet and keeps working on
 * its own store, then reconnects and replays its queued work in order, with
 * the one identity it cannot settle sent to the review queue.
 */

/** Synthetic people for S15, one per run: the offline spelling and the central one. */
const S15_PEOPLE = [
  {
    en: "Rehana Parvin",
    variant: "Rehana Parveen",
    bn: "রেহানা পারভীন",
    sex: "F",
    dob: "1986-04-17",
    phone: "01712-604518",
  },
  {
    en: "Golam Mostofa",
    variant: "Golam Mostafa",
    bn: "গোলাম মোস্তফা",
    sex: "M",
    dob: "1971-11-02",
    phone: "01813-227094",
  },
  {
    en: "Nazma Begum",
    variant: "Nazma Begom",
    bn: "নাজমা বেগম",
    sex: "F",
    dob: "1979-08-25",
    phone: "01914-338265",
  },
  {
    en: "Delwar Hossain",
    variant: "Delowar Hossain",
    bn: "দেলোয়ার হোসেন",
    sex: "M",
    dob: "1968-02-09",
    phone: "01715-449376",
  },
  {
    en: "Farida Yasmin",
    variant: "Farida Yeasmin",
    bn: "ফরিদা ইয়াসমিন",
    sex: "F",
    dob: "1990-06-30",
    phone: "01616-550487",
  },
  {
    en: "Monirul Islam",
    variant: "Moniruzzaman Islam",
    bn: "মনিরুল ইসলাম",
    sex: "M",
    dob: "1983-12-14",
    phone: "01517-661598",
  },
] as const

const OFFLINE_DESK = "per_reception_farhana"
const CENTRAL_DESK = "per_reception_sumon"

async function ensureOffline(kit: ScenarioKit): Promise<void> {
  if ((await getNetworkRow("B1")).status === "online") await kit.cutBranch("B1")
}

/**
 * Register through the real command. Earlier runs may have left a similar
 * record behind: answer that warning as "different person", as the front
 * desk would after checking, so the setup always completes.
 */
async function register(kit: ScenarioKit, input: RegisterInput, as: string) {
  try {
    return await kit.run(registerPatient, input, as)
  } catch (error) {
    if (
      !(error instanceof RuleViolation) ||
      error.code !== "DUPLICATE_UNRESOLVED"
    )
      throw error
    const db = await kit.db(as)
    const active = await db.patients
      .where("identityStatus")
      .equals("active")
      .toArray()
    const candidates = findLikelyDuplicates(
      {
        nameEn: input.nameEn,
        dob: input.dob,
        phone: input.phone,
        nid: input.nid,
        brn: input.brn,
      },
      active
    )
    return kit.run(
      registerPatient,
      {
        ...input,
        duplicateDecision: {
          candidateIds: candidates.map((c) => c.patientId),
          score: candidates[0]?.score ?? 0,
          reason:
            "Checked at the desk: an earlier demo registration, not this visit",
        },
      },
      as
    )
  }
}

export const offlineScenarios: ScenarioDef[] = [
  {
    id: "S14",
    kind: "scenario",
    module: "demo",
    titleKey: "demo.launchers.S14.title",
    summaryKey: "demo.launchers.S14.summary",
    persona: OFFLINE_DESK,
    async setup(kit) {
      await ensureOffline(kit)
    },
    route: () => "/reception",
    cueKeys: [
      "demo.launchers.S14.cue.1",
      "demo.launchers.S14.cue.2",
      "demo.launchers.S14.cue.3",
      "demo.launchers.S14.cue.4",
      "demo.launchers.S14.cue.5",
    ],
  },
  {
    id: "S15",
    kind: "scenario",
    module: "demo",
    titleKey: "demo.launchers.S15.title",
    summaryKey: "demo.launchers.S15.summary",
    persona: OFFLINE_DESK,
    async setup(kit) {
      await ensureOffline(kit)
      const central = await kit.db(CENTRAL_DESK)
      const runs = await central.scenarioRuns
        .where("scenarioId")
        .equals("S15")
        .count()
      const person = S15_PEOPLE[runs % S15_PEOPLE.length]
      const base: RegisterInput = {
        nameEn: person.en,
        nameBn: person.bn,
        dob: person.dob,
        sex: person.sex,
        phone: person.phone,
        idMissingReason: "not-brought",
        household: { mode: "none" },
        consents: { treatment: true, sms: true, app: false },
      }
      // Dhanmondi registers the walk-in while offline: queued on its store.
      const offline = await register(kit, base, OFFLINE_DESK)
      // Mirpur registers the same person online with a slightly different spelling.
      const online = await register(
        kit,
        { ...base, nameEn: person.variant },
        CENTRAL_DESK
      )
      return {
        refs: { patientId: online.patientId },
        params: {
          name: person.en,
          nameBn: person.bn,
          variant: person.variant,
          offlineUhid: offline.uhid,
        },
      }
    },
    route: () => "/reception/review",
    cueKeys: [
      "demo.launchers.S15.cue.1",
      "demo.launchers.S15.cue.2",
      "demo.launchers.S15.cue.3",
      "demo.launchers.S15.cue.4",
    ],
  },
]
