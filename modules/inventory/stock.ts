/**
 * Stock helpers shared by the pharmacy and inventory commands. They run inside
 * a transaction (`tx`), so every read sees this commit's own buffered writes
 * and every change lands in the same atomic commit as the dispense, sale or
 * transfer that caused it.
 *
 * Ledger rule (matches the seed): a movement's `qty` is the signed change to
 * the level's dispensable `qty`. Quarantine moves units between `qty` and
 * `quarantinedQty`; in-transit counters never have movements of their own.
 */

import type { BranchCode } from "@/config/brand.config"
import type {
  BatchRow,
  BrandRow,
  Refs,
  StockLevelRow,
  StockMovementRow,
} from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"
import { fefoAllocate, type FefoPick } from "@/core/stock/availability"

export type BrandStock = { levels: StockLevelRow[]; batches: BatchRow[] }

/** Every stock level of a brand at a branch, with their batches. */
export async function brandStockAt(
  tx: Tx,
  branch: BranchCode,
  brandId: string
): Promise<BrandStock> {
  const levels = await tx.list("stockLevels", "[branchId+brandId]", [branch, brandId])
  const batches: BatchRow[] = []
  for (const level of levels) {
    const batch = await tx.find("batches", level.batchId)
    if (batch) batches.push(batch)
  }
  return { levels, batches }
}

/** On-hand units of a brand at a branch, as the stock badge counts them. */
export function onHand(levels: StockLevelRow[]): number {
  return levels.reduce((sum, level) => sum + Math.max(0, level.qty), 0)
}

/** Units that may be dispensed today: batch ok and not expired (INV-08). */
export function usableUnits(
  levels: StockLevelRow[],
  batches: BatchRow[],
  today: string
): number {
  const byId = new Map(batches.map((b) => [b.id, b]))
  return levels.reduce((sum, level) => {
    const batch = byId.get(level.batchId)
    if (!batch || batch.status !== "ok" || batch.expiry < today) return sum
    return sum + Math.max(0, level.qty)
  }, 0)
}

/**
 * First-expiry-first-out picks for `qty` units. A preferred batch (the one
 * the pharmacist scanned) is used first when it is usable; FEFO covers the
 * rest. Expired and quarantined batches are never picked.
 */
export function allocateFefo(
  qty: number,
  branch: BranchCode,
  brandId: string,
  stock: BrandStock,
  today: string,
  preferBatchId?: string
): { picks: FefoPick[]; shortfall: number } {
  if (!preferBatchId) {
    return fefoAllocate(qty, branch, brandId, stock.levels, stock.batches, today)
  }
  const preferred = fefoAllocate(
    qty,
    branch,
    brandId,
    stock.levels.filter((l) => l.batchId === preferBatchId),
    stock.batches,
    today
  )
  const rest = fefoAllocate(
    preferred.shortfall,
    branch,
    brandId,
    stock.levels.filter((l) => l.batchId !== preferBatchId),
    stock.batches,
    today
  )
  return {
    picks: [...preferred.picks, ...rest.picks],
    shortfall: rest.shortfall,
  }
}

/** A level row for a batch at a branch, created empty when the branch never held it. */
export async function levelFor(
  tx: Tx,
  branch: BranchCode,
  brandId: string,
  batchId: string
): Promise<StockLevelRow> {
  const [existing] = await tx.list("stockLevels", "[branchId+batchId]", [branch, batchId])
  if (existing) return existing
  return tx.insert("stockLevels", {
    branchId: branch,
    brandId,
    batchId,
    qty: 0,
    quarantinedQty: 0,
    inTransitIn: 0,
    inTransitOut: 0,
    asAt: tx.now(),
  })
}

/**
 * Change a stock level and record the movement. `qty` is the signed change to
 * dispensable stock; `quarantined`, `inTransitIn` and `inTransitOut` are
 * signed changes to those counters. INV-01 refuses any negative result.
 */
export async function moveStock(
  tx: Tx,
  level: StockLevelRow,
  change: {
    type: StockMovementRow["type"]
    qty: number
    quarantined?: number
    inTransitIn?: number
    inTransitOut?: number
    refs?: Refs
    reason?: string
  }
): Promise<{ level: StockLevelRow; movement: StockMovementRow }> {
  const current = (await tx.get("stockLevels", level.id)) as StockLevelRow
  const next = await tx.update("stockLevels", level.id, {
    qty: current.qty + change.qty,
    quarantinedQty: current.quarantinedQty + (change.quarantined ?? 0),
    inTransitIn: current.inTransitIn + (change.inTransitIn ?? 0),
    inTransitOut: current.inTransitOut + (change.inTransitOut ?? 0),
    asAt: tx.now(),
  })
  const movement = tx.insert("stockMovements", {
    branchId: current.branchId,
    brandId: current.brandId,
    batchId: current.batchId,
    type: change.type,
    qty: change.qty,
    refs: change.refs ?? {},
    reason: change.reason,
    at: tx.now(),
  })
  return { level: next, movement }
}

/** Only the in-transit counters change (no movement: the units are on the road). */
export async function adjustInTransit(
  tx: Tx,
  level: StockLevelRow,
  change: { inTransitIn?: number; inTransitOut?: number }
): Promise<StockLevelRow> {
  const current = (await tx.get("stockLevels", level.id)) as StockLevelRow
  return tx.update("stockLevels", level.id, {
    inTransitIn: current.inTransitIn + (change.inTransitIn ?? 0),
    inTransitOut: current.inTransitOut + (change.inTransitOut ?? 0),
    asAt: tx.now(),
  })
}

/** "Napa 500 mg": how a brand reads in event params and messages (never translated). */
export function brandLabel(brand: Pick<BrandRow, "name" | "strength">): string {
  return `${brand.name} ${brand.strength}`.trim()
}

/**
 * Tracks a brand's on-hand units at a branch across a commit, and emits
 * StockBelowReorder when the commit takes it from above its reorder level to
 * at or below it (objective §3D: "Napa 500 below reorder level").
 */
export async function watchReorder(tx: Tx, branch: BranchCode, brand: BrandRow) {
  const before = onHand(await tx.list("stockLevels", "[branchId+brandId]", [branch, brand.id]))
  return async () => {
    const after = onHand(await tx.list("stockLevels", "[branchId+brandId]", [branch, brand.id]))
    const [reorder] = await tx.list("reorderLevels", "[branchId+brandId]", [branch, brand.id])
    if (!reorder) return
    if (before > reorder.reorderLevel && after <= reorder.reorderLevel) {
      tx.emit("StockBelowReorder", {
        branchId: branch,
        params: {
          item: brandLabel(brand),
          branch,
          onHand: after,
          reorderLevel: reorder.reorderLevel,
        },
      })
    }
  }
}
