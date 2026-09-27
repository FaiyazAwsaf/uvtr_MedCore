/**
 * Stock status for the Rx pad badge, the library's branch stock and
 * dispensing (objective §3B, PRD §10.4, HAZ-15). Pure functions over rows so
 * they work in liveQueries, commands and tests alike.
 */

import { branches, type BranchCode } from "@/config/brand.config"
import type {
  BatchRow,
  ISODate,
  ReorderLevelRow,
  StockLevelRow,
} from "@/core/db/schema"

export type StockStatus =
  | "in-stock"
  | "low"
  | "out"
  | "other-branch"
  | "unavailable-offline"

export type BranchStock = { onHand: number; reorderLevel: number; inTransitIn: number }

/** On-hand dispensable units per branch for one brand (quarantine excluded). */
export function stockByBranch(
  brandId: string,
  levels: StockLevelRow[],
  reorderLevels: ReorderLevelRow[]
): Record<BranchCode, BranchStock> {
  const out = Object.fromEntries(
    branches.map((b) => [b.code, { onHand: 0, reorderLevel: 0, inTransitIn: 0 }])
  ) as Record<BranchCode, BranchStock>
  for (const level of levels) {
    if (level.brandId !== brandId) continue
    out[level.branchId].onHand += Math.max(0, level.qty)
    out[level.branchId].inTransitIn += level.inTransitIn
  }
  for (const r of reorderLevels) {
    if (r.brandId === brandId) out[r.branchId].reorderLevel = r.reorderLevel
  }
  return out
}

/**
 * The badge for `branch`. While `offline`, other branches are unknown, so an
 * empty shelf reads "out" and nothing claims another branch has stock.
 */
export function stockStatus(
  branch: BranchCode,
  byBranch: Record<BranchCode, BranchStock>,
  { offline = false }: { offline?: boolean } = {}
): { status: StockStatus; onHand: number; otherBranches: BranchCode[] } {
  const here = byBranch[branch]
  const otherBranches = offline
    ? []
    : (Object.keys(byBranch) as BranchCode[]).filter(
        (code) => code !== branch && byBranch[code].onHand > 0
      )
  if (here.onHand > here.reorderLevel) return { status: "in-stock", onHand: here.onHand, otherBranches }
  if (here.onHand > 0) return { status: "low", onHand: here.onHand, otherBranches }
  if (otherBranches.length) return { status: "other-branch", onHand: 0, otherBranches }
  return { status: "out", onHand: 0, otherBranches }
}

export type FefoPick = { batch: BatchRow; level: StockLevelRow; take: number }

/**
 * First-expiry-first-out allocation of `qty` units at a branch, skipping
 * expired and quarantined batches. Returns the picks and any shortfall.
 */
export function fefoAllocate(
  qty: number,
  branch: BranchCode,
  brandId: string,
  levels: StockLevelRow[],
  batches: BatchRow[],
  today: ISODate
): { picks: FefoPick[]; shortfall: number } {
  const byId = new Map(batches.map((b) => [b.id, b]))
  const usable = levels
    .filter((l) => l.branchId === branch && l.brandId === brandId && l.qty > 0)
    .map((level) => ({ level, batch: byId.get(level.batchId) }))
    .filter(
      (x): x is { level: StockLevelRow; batch: BatchRow } =>
        !!x.batch && x.batch.status === "ok" && x.batch.expiry >= today
    )
    .sort((a, b) => a.batch.expiry.localeCompare(b.batch.expiry))
  const picks: FefoPick[] = []
  let remaining = qty
  for (const { level, batch } of usable) {
    if (remaining <= 0) break
    const take = Math.min(remaining, level.qty)
    picks.push({ batch, level, take })
    remaining -= take
  }
  return { picks, shortfall: Math.max(0, remaining) }
}
