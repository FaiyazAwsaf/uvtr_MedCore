/**
 * Out-of-stock alternatives on the Rx pad (objective §3B, PRD §10.4): other
 * brands of the same generic and strength, other strengths, and other
 * branches that hold the medicine. HAZ-04: lists are alphabetical (brands) or
 * by branch code (branches), never ranked by stock, price or margin, and the
 * system never swaps a medicine: only the doctor changes the Rx.
 */

import { branches, type BranchCode } from "@/config/brand.config"
import type {
  BatchRow,
  BrandRow,
  ISODate,
  StockLevelRow,
} from "@/core/db/schema"
import { brandsOfGeneric } from "@/core/search/medicines"
import type { BranchStock } from "@/core/stock/availability"

export type BranchHolding = { branch: BranchCode; onHand: number }

export type Alternatives = {
  /** Same generic and strength, other brands (alphabetical) */
  sameStrength: BrandRow[]
  /** Same generic, other strengths or forms (alphabetical) */
  otherStrengths: BrandRow[]
  /** Other branches holding this brand (by branch code); empty while offline */
  otherBranches: BranchHolding[]
}

const strengthKey = (s: string) => s.toLowerCase().replace(/\s+/g, "")

export function alternativesFor(
  brand: BrandRow,
  catalog: BrandRow[],
  byBranch: Record<BranchCode, BranchStock>,
  branch: BranchCode,
  { offline = false }: { offline?: boolean } = {}
): Alternatives {
  const siblings = brandsOfGeneric(brand.genericId, catalog).filter(
    (b) => b.id !== brand.id
  )
  const same = strengthKey(brand.strength)
  return {
    sameStrength: siblings.filter((b) => strengthKey(b.strength) === same),
    otherStrengths: siblings.filter((b) => strengthKey(b.strength) !== same),
    otherBranches: offline
      ? []
      : branches
          .map((b) => b.code)
          .filter(
            (code) => code !== branch && (byBranch[code]?.onHand ?? 0) > 0
          )
          .sort()
          .map((code) => ({ branch: code, onHand: byBranch[code].onHand })),
  }
}

/**
 * Units that can be dispensed at a branch right now: stock on hand in batches
 * that are neither quarantined nor expired (what the pharmacy can hand over).
 */
export function dispensableOnHand(
  levels: StockLevelRow[],
  batches: Map<string, BatchRow> | ((id: string) => BatchRow | undefined),
  branch: BranchCode,
  brandId: string,
  today: ISODate
): number {
  const lookup =
    typeof batches === "function" ? batches : (id: string) => batches.get(id)
  let total = 0
  for (const level of levels) {
    if (
      level.branchId !== branch ||
      level.brandId !== brandId ||
      level.qty <= 0
    )
      continue
    const batch = lookup(level.batchId)
    if (!batch || batch.status !== "ok" || batch.expiry < today) continue
    total += level.qty
  }
  return total
}
