import Dexie from "dexie"

import { branches } from "@/config/brand.config"
import { chainAudit, GENESIS_HASH } from "@/core/audit/chain"
import { rules } from "@/config/rules.config"
import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { getControlDb } from "@/core/db/control"
import { getCentralDb, getEdgeDb, type MedcoreDb } from "@/core/db/database"
import { newId } from "@/core/db/ids"
import type { EventRow } from "@/core/db/schema"
import { toActorRef } from "@/core/engine/commit"
import { commitLockName, withLock } from "@/core/engine/locks"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { publish } from "@/core/events/bus"
import { EVENT_CATALOG } from "@/core/events/registry"
import { seedDatabase } from "@/core/seed"
import type { SeedSummary } from "@/core/seed/types"
import { onlineRow } from "@/core/sync/network"
import { clearDatabase } from "@/core/sync/offline"

/** Bump when the seed changes shape, so stale browsers re-seed on load. */
export const SEED_VERSION = 3
const SEED_LOCK = "mc:seed"

/** Empty every branch edge store that exists in this browser. */
async function clearEdges(): Promise<void> {
  const names = await Dexie.getDatabaseNames().catch(() => [] as string[])
  for (const branch of branches) {
    const edge = getEdgeDb(branch.code)
    if (names.includes(edge.name)) await clearDatabase(edge)
  }
}

async function writeGenesis(db: MedcoreDb, summary: SeedSummary): Promise<void> {
  const at = now()
  const commitId = newId("cm")
  const actor = toActorRef(SYSTEM_ACTOR)
  const [genesis] = chainAudit(
    [
      {
        commitId,
        command: "demo.reset",
        at,
        actor,
        action: "system",
        entity: "demo",
        entityId: "seed",
        after: { seedVersion: SEED_VERSION, counts: summary.counts },
        origin: "central",
      },
    ],
    { seq: 0, hash: GENESIS_HASH }
  )
  const def = EVENT_CATALOG.DemoReset
  const event: EventRow = {
    seq: 1,
    id: newId("ev"),
    type: "DemoReset",
    v: 1,
    at,
    realAt: Date.now(),
    actor,
    branchId: null,
    refs: {},
    summaryKey: def?.labelKey ?? "events.DemoReset",
    params: {},
    consumers: def?.consumers ?? [],
    commitId,
    command: "demo.reset",
    origin: "central",
  }
  await db.transaction("rw", [db.audit, db.events], async () => {
    await db.audit.add(genesis)
    await db.events.add(event)
  })
}

/** Reset without taking the seed lock (callers hold it). */
async function resetUnlocked(): Promise<SeedSummary> {
  const central = getCentralDb()
  const control = getControlDb()
  return withLock(commitLockName(central.name), async () => {
    await clearEdges()
    await clearDatabase(central)
    // Anchor the demo clock to clinic time today (rules.simulated.clinicTime).
    const wall = Date.now()
    const offsetMs = atDhaka(dhakaDate(wall), rules.simulated.clinicTime) - wall
    await control.clock.put({ id: "clock", offsetMs, updatedAt: wall })
    applyClockOffset(offsetMs)
    await control.network.bulkPut(branches.map((b) => onlineRow(b.code)))
    const at = now()
    const summary = await seedDatabase(central, { now: at, today: dhakaDate(at) })
    await writeGenesis(central, summary)
    await control.demoMeta.put({
      id: "meta",
      seedVersion: SEED_VERSION,
      seededAt: Date.now(),
      seedDate: dhakaDate(at),
    })
    return summary
  })
}

/**
 * One-click demo reset (plan §3.8): wipes every store, sets the demo clock to
 * clinic time today (`rules.simulated.clinicTime`), brings all branches
 * online, re-seeds for that moment and tells every window to reload.
 */
export async function resetDemo(): Promise<SeedSummary> {
  const summary = await withLock(SEED_LOCK, resetUnlocked)
  publish({ kind: "reset" })
  return summary
}

/**
 * First load: seed if this browser has no data yet, or if the seed version is
 * stale. Safe to call from every window at once. Returns true if it seeded.
 */
export async function ensureSeeded(): Promise<boolean> {
  return withLock(SEED_LOCK, async () => {
    const control = getControlDb()
    const meta = await control.demoMeta.get("meta")
    const central = getCentralDb()
    const hasData = (await central.personas.count()) > 0
    if (meta && meta.seedVersion === SEED_VERSION && hasData) return false
    await resetUnlocked()
    return true
  })
}
