import type { MedcoreDb } from "@/core/db/database"
import type { CounterRow } from "@/core/db/schema"
import { hashSeed } from "@/lib/mock/rng"

import { createSeedCtx, type SeedBag } from "./context"
import { seedCorporate } from "./generators/corporate"
import { seedDailyStats } from "./generators/daily-stats"
import { seedHistory } from "./generators/history"
import { seedInpatient } from "./generators/inpatient"
import { seedLabCatalogue } from "./generators/lab-catalogue"
import { seedMedicines } from "./generators/medicines"
import {
  seedDoctors,
  seedOrganisation,
  seedStaffAndPersonas,
} from "./generators/org"
import { seedPatients } from "./generators/patients"
import { seedProcurement } from "./generators/procurement"
import { seedScheduling } from "./generators/scheduling"
import { seedStock } from "./generators/stock"
import { seedToday } from "./generators/today"
import { DAY } from "./time"
import type { SeedOptions, SeedSummary } from "./types"

/**
 * Seeds the central database with the full demo dataset (plan §7): master
 * data, the hero story, scenario master data, PRD history records and
 * dashboard history. Deterministic for a given `opts` (every random stream is
 * derived from "medcore-seed-v1") and anchored to `opts.now` / `opts.today`.
 *
 * Contract (./types.ts): rows are built with `seedRow()` (version 1, origin
 * central, created by "system" unless a history actor is recorded), counters
 * continue after the seeded history, and no events or audit rows are written.
 */
export async function seedDatabase(
  db: MedcoreDb,
  opts: SeedOptions
): Promise<SeedSummary> {
  const started = performance.now()
  const { bag, counters } = buildSeed(opts)
  await writeBag(db, bag, counters)

  const counts: Record<string, number> = {}
  for (const name of bag.tableNames()) counts[name] = bag.count(name)
  counts.counters = counters.length
  return { counts, durationMs: Math.round(performance.now() - started) }
}

/** Builds every seed row in memory (no IndexedDB access). */
export function buildSeed(opts: SeedOptions): {
  bag: SeedBag
  counters: CounterRow[]
} {
  const ctx = createSeedCtx(opts)

  // Master data
  seedOrganisation(ctx)
  seedStaffAndPersonas(ctx)
  const doctors = seedDoctors(ctx)
  seedLabCatalogue(ctx)
  const brands = seedMedicines(ctx)
  const { ledger } = seedStock(ctx, brands)
  const pools = seedPatients(ctx)

  // Schedules and transactional history
  const sched = seedScheduling(ctx, doctors, pools)
  seedProcurement(ctx, ledger)
  seedToday(ctx, sched, doctors, pools, ledger)
  seedCorporate(ctx, pools, doctors)
  seedHistory(ctx, sched, doctors, pools, ledger)
  seedInpatient(ctx, pools, doctors, sched)
  seedDailyStats(ctx)

  // Close the books: opening stock movements, then document numbers.
  ledger.finalize(ctx.now - 45 * DAY)
  const counters = ctx.numbers.finalize(defaultCounterBase)
  return { bag: ctx.bag, counters }
}

/** Where numbering starts for series without an explicit base: mid-year looking numbers. */
function defaultCounterBase(key: string): number {
  const jitter = hashSeed(key) % 400
  if (
    key.startsWith("inv-off:") ||
    key.startsWith("uhid-off:") ||
    key.startsWith("acc-off:")
  )
    return 0
  if (key.startsWith("inv:")) return 4000 + jitter
  if (key.startsWith("rcpt:")) return 11000 + jitter
  if (key.startsWith("lab:")) return 5200 + jitter
  if (key.startsWith("acc:")) return 8800 + jitter
  if (key.startsWith("rpt:")) return 4100 + jitter
  if (key.startsWith("rx:")) return 6100 + jitter
  if (key.startsWith("img:")) return 900 + jitter
  if (key.startsWith("rf:")) return 40 + (jitter % 40)
  if (key.startsWith("cn:")) return 30 + (jitter % 30)
  return 0
}

async function writeBag(
  db: MedcoreDb,
  bag: SeedBag,
  counters: CounterRow[]
): Promise<void> {
  const names = bag.tableNames()
  await db.transaction(
    "rw",
    [...names.map((n) => db.table(n)), db.counters],
    async () => {
      await Promise.all(names.map((n) => db.table(n).bulkPut(bag.all(n))))
      await db.counters.bulkPut(counters)
    }
  )
}
