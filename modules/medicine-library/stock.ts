/**
 * Staff-only stock per branch for the brand page (objective §3C "staff
 * extras", HAZ-15). Built on core/stock/availability so the library, the Rx
 * pad badge and the pharmacy all read stock the same way.
 */

import { branches, type Bilingual, type BranchCode } from "@/config/brand.config"
import type { NetworkRow, ReorderLevelRow, StockLevelRow } from "@/core/db/schema"
import {
  stockByBranch,
  stockStatus,
  type StockStatus,
} from "@/core/stock/availability"

export type BranchStockRow = {
  code: BranchCode
  name: Bilingual
  status: StockStatus
  /** On-hand dispensable units (quarantine excluded) */
  onHand: number
  reorderLevel: number
  inTransitIn: number
  /** The branch keeps this brand (it has a stock record or a reorder level) */
  stocked: boolean
  /** This window's branch */
  mine: boolean
  /** The branch is cut off from central (seen from another branch) */
  branchOffline: boolean
  /** When set, the figures are a snapshot taken at this time (HAZ-15) */
  asAt?: number
}

export type StockViewContext = {
  /** This window's branch (null for network-level personas) */
  myBranch: BranchCode | null
  /** This window works on its branch's edge store (its branch is offline) */
  isEdge: boolean
  network: NetworkRow[]
}

/**
 * One row per pharmacy branch (plus any other branch holding the brand).
 * Each row's status is about that branch alone: in stock, low (at or below
 * its reorder level) or out. While this window's branch is offline, the
 * other branches read "unavailable offline" and its own row carries an
 * "as at" time; a branch that is offline elsewhere shows its snapshot time.
 */
export function branchStockRows(
  brandId: string,
  levels: StockLevelRow[],
  reorders: ReorderLevelRow[],
  { myBranch, isEdge, network }: StockViewContext
): BranchStockRow[] {
  const byBranch = stockByBranch(brandId, levels, reorders)
  const mineLevels = levels.filter((l) => l.brandId === brandId)
  return branches
    .filter(
      (b) =>
        b.services.includes("pharmacy") ||
        mineLevels.some((l) => l.branchId === b.code)
    )
    .map((b) => {
      const stock = byBranch[b.code]
      const mine = b.code === myBranch
      const net = network.find((n) => n.branchId === b.code)
      const branchOffline = !!net && net.status !== "online"
      const branchLevels = mineLevels.filter((l) => l.branchId === b.code)
      const stocked =
        branchLevels.length > 0 ||
        reorders.some((r) => r.brandId === brandId && r.branchId === b.code)
      // `offline: true` leaves other branches out: the status of this branch alone.
      let status: StockStatus = stockStatus(b.code, byBranch, { offline: true }).status
      let asAt: number | undefined
      if (isEdge && !mine) {
        status = "unavailable-offline"
      } else if (isEdge && mine) {
        const latest = Math.max(0, ...branchLevels.map((l) => l.asAt))
        asAt = latest || net?.since
      } else if (branchOffline) {
        asAt = net?.since
      }
      return {
        code: b.code,
        name: b.name,
        status,
        onHand: stock.onHand,
        reorderLevel: stock.reorderLevel,
        inTransitIn: stock.inTransitIn,
        stocked,
        mine,
        branchOffline,
        asAt,
      }
    })
}

/**
 * The badge for this window's branch, as the Rx pad shows it: in stock, low,
 * out, or at another branch (never claimed while offline).
 */
export function myBranchStock(
  brandId: string,
  levels: StockLevelRow[],
  reorders: ReorderLevelRow[],
  myBranch: BranchCode,
  isEdge: boolean
) {
  return stockStatus(myBranch, stockByBranch(brandId, levels, reorders), {
    offline: isEdge,
  })
}
