import type { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import type { MedcoreDb } from "@/core/db/database"
import type { ISODate, Ms, Refs } from "@/core/db/schema"
import type { Actor, CommandDef, Tx } from "@/core/engine/types"
import type { ReplayOutcome } from "@/core/sync/replay"

/**
 * What a launcher's setup returns: the records it prepared (saved on the
 * `scenarioRuns` row and handed to `route`), plus display values for the
 * cue card and the route (a token label, a name, an accession number).
 */
export type ScenarioOutcome = {
  refs?: Refs
  params?: Record<string, string | number>
}

/**
 * The toolkit a launcher's setup works with (plan §10). Every write goes
 * through the engine, so setups are validated, audited, synced to other
 * windows and visible in the event stream like any other work.
 *
 * Setups must succeed when run twice in a row: create fresh records (or
 * reuse a fixed one on purpose), never rely on what an earlier run left.
 * Never book into a real clinic session for background data: the hero's
 * places in Dr. Kamal's session are limited (use `fixtures.openEncounter`).
 */
export type ScenarioKit = {
  readonly scenarioId: string
  /** Demo-clock time */
  now(): Ms
  /** Dhaka calendar day of `now()` */
  today(): ISODate
  /** The acting identity of a persona (commits run "as" that person) */
  actor(personaId: string): Actor
  /**
   * The store a persona works on: central, or its branch's edge store while
   * that branch is offline. Defaults to the launching persona.
   */
  db(personaId?: string): Promise<MedcoreDb>
  /**
   * Run a real command as a persona. Refusals throw (RuleViolation etc.).
   * It runs on that persona's store, or on `storeOf`'s: an HQ approver acting
   * on a branch's records while that branch is offline (as if it happened
   * before the cut; it replays with the branch's work on reconnect).
   */
  run<S extends z.ZodType, O>(
    def: CommandDef<S, O>,
    input: z.input<S>,
    as: string,
    opts?: { storeOf?: string }
  ): Promise<O>
  /**
   * Direct writes in one engine commit named `demo.setup.<id>`, for what no
   * command can do (backdating a collection, topping up stock, planting a
   * past visit). Invariants still apply. Runs on the store of `as` (default:
   * the launching persona) as the "Demo setup" actor.
   */
  fixture<O>(
    label: string,
    write: (tx: Tx) => Promise<O>,
    as?: string
  ): Promise<O>
  /** Cut a branch's internet (as the demo panel does) */
  cutBranch(branch: BranchCode): Promise<void>
  /** Restore it and replay its queued work */
  reconnectBranch(branch: BranchCode): Promise<ReplayOutcome>
  /** Move the shared demo clock (all windows follow) */
  advanceClock(ms: number): Promise<void>
}

/** A scenario launcher (S1 to S16) or a main-journey jump launcher (J1 to J6). */
export type ScenarioDef = {
  /** Stable id: "S1".."S16", "J1".."J6", or a companion such as "S4D" */
  id: string
  kind: "scenario" | "jump"
  /** Owning module; its `<module>.title` groups the launcher in the panel */
  module: string
  /** i18n key of the launcher title */
  titleKey: string
  /** i18n key of one line on what it proves (shown under the title) */
  summaryKey?: string
  /** Persona this window switches to (a PERSONAS id) */
  persona: string
  /** Prepares fresh data. Omit when the scenario needs no data. */
  setup?: (kit: ScenarioKit) => Promise<ScenarioOutcome | void>
  /** Where the window goes afterwards */
  route: (outcome: ScenarioOutcome) => string
  /** i18n keys of the cue-card steps; they may use `params` placeholders */
  cueKeys: string[]
}
