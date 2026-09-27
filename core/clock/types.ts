import type { z } from "zod"

import type { MedcoreDb } from "@/core/db/database"
import type { Ms } from "@/core/db/schema"
import type { CommandDef, CommitResult } from "@/core/engine/types"

export type SweepContext = {
  /** The database being swept: central, or an offline branch's edge store */
  db: MedcoreDb
  now: Ms
  /** Commit a command as the System actor against `db` */
  commitSystem: <S extends z.ZodType, O>(
    def: CommandDef<S, O>,
    input: z.input<S>
  ) => Promise<CommitResult<O>>
}

/**
 * A time-driven job (plan §3.8): critical escalation, MFS timeout, SMS
 * delivery, balance expiry, deposit alerts. Runs in the leader window every
 * couple of seconds and after every demo-clock change. Must be idempotent:
 * it looks for due work and commits only what is due.
 */
export type SweepJob = {
  id: string
  run: (ctx: SweepContext) => Promise<void>
}
