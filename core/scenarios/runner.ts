import { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { advanceClock } from "@/core/clock/control"
import { dhakaDate } from "@/core/clock/dates"
import { getControlDb } from "@/core/db/control"
import { getCentralDb, getEdgeDb, type MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Actor, Tx } from "@/core/engine/types"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"
import { cutBranch } from "@/core/sync/offline"
import { reconnectBranch } from "@/core/sync/replay"

import type { ScenarioDef, ScenarioKit, ScenarioOutcome } from "./types"

/** The store a branch works on right now: its edge store while offline, else central. */
export async function storeFor(branch: BranchCode | null): Promise<MedcoreDb> {
  if (!branch) return getCentralDb()
  const row = await getControlDb().network.get(branch)
  return row && row.status !== "online" ? getEdgeDb(branch) : getCentralDb()
}

function personaOf(personaId: string) {
  const persona = findPersona(personaId)
  if (!persona) throw new Error(`Unknown persona ${personaId}`)
  return persona
}

/** Records that a launcher ran (plan §5.9), with the records it prepared. */
export const recordScenarioRun = defineCommand({
  name: "scenario.recordRun",
  roles: "any",
  input: z.object({
    scenarioId: z.string(),
    personaId: z.string(),
    refs: z.record(z.string(), z.string()).default({}),
  }),
  async run(tx, input) {
    const row = tx.insert("scenarioRuns", {
      scenarioId: input.scenarioId,
      at: tx.now(),
      personaId: input.personaId,
      refs: input.refs,
    })
    tx.emit("ScenarioLaunched", {
      refs: input.refs,
      params: { scenario: input.scenarioId },
    })
    return { runId: row.id }
  },
})

/** The "Demo setup" identity that fixture commits run as. */
function setupActor(branch: BranchCode | null): Actor {
  return {
    staffId: "demo-setup",
    role: "system",
    branchId: branch,
    name: "Demo setup",
    authorities: ["*"],
  }
}

export function createKit(scenario: ScenarioDef): ScenarioKit {
  const target = personaOf(scenario.persona)
  let fixtures = 0
  const kit: ScenarioKit = {
    scenarioId: scenario.id,
    now: () => now(),
    today: () => dhakaDate(now()),
    actor: (personaId) => actorFor(personaOf(personaId)),
    db: (personaId = target.id) => storeFor(personaOf(personaId).branchId),
    async run(def, input, as, opts) {
      const persona = personaOf(as)
      const store = opts?.storeOf ? personaOf(opts.storeOf) : persona
      const db = await storeFor(store.branchId)
      return (await commit(def, input, { db, actor: actorFor(persona) })).result
    },
    async fixture<O>(
      label: string,
      write: (tx: Tx) => Promise<O>,
      as = target.id
    ) {
      const persona = personaOf(as)
      const db = await storeFor(persona.branchId)
      fixtures += 1
      const def = defineCommand({
        name: `demo.setup.${scenario.id}`,
        roles: "any",
        input: z.object({ label: z.string(), step: z.number() }),
        run: (tx) => write(tx),
      })
      return (
        await commit(
          def,
          { label, step: fixtures },
          { db, actor: setupActor(persona.branchId) }
        )
      ).result
    },
    cutBranch: (branch) => cutBranch(branch),
    reconnectBranch: (branch) => reconnectBranch(branch),
    advanceClock: (ms) => advanceClock(ms),
  }
  return kit
}

export type ScenarioLaunch = {
  outcome: ScenarioOutcome
  route: string
}

/**
 * Runs a launcher's setup and records the run: the data side of a launch.
 * The window side (persona, cue card, navigation) is `useScenarioLauncher`.
 */
export async function runScenario(
  scenario: ScenarioDef
): Promise<ScenarioLaunch> {
  const kit = createKit(scenario)
  const outcome = (scenario.setup ? await scenario.setup(kit) : undefined) ?? {}
  const refs = Object.fromEntries(
    Object.entries(outcome.refs ?? {}).filter(([, v]) => typeof v === "string")
  ) as Record<string, string>
  await kit.run(
    recordScenarioRun,
    { scenarioId: scenario.id, personaId: scenario.persona, refs },
    scenario.persona
  )
  return { outcome, route: scenario.route(outcome) }
}
