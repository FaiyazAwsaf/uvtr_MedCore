/**
 * Fixtures for the procurement suite: the store and finance actors, a
 * request taken through to an issued order, and the stock ledger check.
 */

import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import type { BranchCode, PackSize } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import type { Actor } from "@/core/engine/types"
import { SEED_REFS } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"
import { estUnitCostP } from "@/modules/procurement/calc"
import { decidePr, issuePo, savePr, submitPr } from "@/modules/procurement/commands"

export const habibur: Actor = actorFor(findPersona("per_store_habibur")!)
export const tariq: Actor = actorFor(findPersona("per_store_tariq")!)
export const sabrina: Actor = actorFor(findPersona("per_finance_sabrina")!)
/** Uttara's store manager (seeded staff, not a persona) */
export const anisur: Actor = {
  staffId: "stf_b2_anisur",
  role: "store",
  branchId: "B2",
  name: "Anisur",
  authorities: ["approve:pr:50000"],
}

export const NAPA = SEED_REFS.brand.napa500
export const DEPOT = SEED_REFS.vendor.beximcoDepot

export const today = () => dhakaDate(now())
export const inDays = (days: number) => addDaysISO(today(), days)

export async function napaBox(db: MedcoreDb): Promise<{ pack: PackSize; costP: number }> {
  const brand = (await db.brands.get(NAPA))!
  const pack = brand.packSizes.find((p) => p.label === "10 x 10 strip")!
  const batches = await db.batches.where("brandId").equals(NAPA).toArray()
  return { pack, costP: estUnitCostP(brand, batches, pack) }
}

/** Habibur's request for `boxes` of Napa 500, approved by Tariq and ordered from the Beximco depot. */
export async function orderedNapa(
  db: MedcoreDb,
  boxes = 100
): Promise<{ prId: string; poId: string; poNo: string; poLineId: string; costP: number }> {
  const { pack, costP } = await napaBox(db)
  const pr = (
    await commit(
      savePr,
      { lines: [{ brandId: NAPA, qty: boxes, pack, estUnitCostP: costP }], vendorId: DEPOT },
      { db, actor: habibur }
    )
  ).result
  await commit(submitPr, { prId: pr.prId }, { db, actor: habibur })
  await commit(decidePr, { prId: pr.prId, decision: "approve" }, { db, actor: tariq })
  const { pos } = (await commit(issuePo, { prId: pr.prId }, { db, actor: habibur })).result
  const [line] = await db.poLines.where("poId").equals(pos[0].poId).toArray()
  return { prId: pr.prId, poId: pos[0].poId, poNo: pos[0].poNo, poLineId: line.id, costP }
}

/** On-hand dispensable and quarantined units of a brand at a branch. */
export async function stockOf(db: MedcoreDb, branch: BranchCode, brandId: string) {
  const levels = await db.stockLevels.where("[branchId+brandId]").equals([branch, brandId]).toArray()
  return {
    qty: levels.reduce((s, l) => s + l.qty, 0),
    quarantined: levels.reduce((s, l) => s + l.quarantinedQty, 0),
  }
}

/** Every stock level equals the sum of its movements (the seed's ledger rule). */
export async function ledgerMismatches(db: MedcoreDb): Promise<string[]> {
  const sums = new Map<string, number>()
  for (const m of await db.stockMovements.toArray()) {
    const key = `${m.branchId}:${m.batchId}`
    sums.set(key, (sums.get(key) ?? 0) + m.qty)
  }
  const bad: string[] = []
  for (const level of await db.stockLevels.toArray()) {
    const sum = sums.get(`${level.branchId}:${level.batchId}`) ?? 0
    if (sum !== level.qty || level.qty < 0 || level.quarantinedQty < 0) bad.push(level.id)
  }
  return bad
}
