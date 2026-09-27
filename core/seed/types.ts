import type { MedcoreDb } from "@/core/db/database"
import type { ISODate, Ms } from "@/core/db/schema"

export type SeedOptions = {
  /** Demo-clock "now" the data is anchored to (relative dates, plan §7) */
  now: Ms
  /** Calendar day of `now` in Dhaka, YYYY-MM-DD */
  today: ISODate
}

export type SeedSummary = {
  /** Rows written per table */
  counts: Record<string, number>
  durationMs: number
}

/**
 * Contract: write every domain row with `seedRow()`/`baseFields()` (version 1,
 * origin central, createdBy "system"), set `counters` so numbering continues
 * after the seeded history, and write NO events or audit rows (the engine
 * writes the genesis audit row and a DemoReset event after seeding).
 */
export type SeedFn = (db: MedcoreDb, opts: SeedOptions) => Promise<SeedSummary>
