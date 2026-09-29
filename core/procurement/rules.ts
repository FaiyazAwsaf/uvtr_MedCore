import { rules } from "@/config/rules.config"
import type {
  Id,
  Poisha,
  PoLineRow,
  PurchaseRequestRow,
  ThreeWayMatchRow,
} from "@/core/db/schema"

/**
 * Procurement rules shared by the purchase-request commands (WS-H), the
 * finance worklist (WS-I) and the seed, so every part of the demo applies the
 * same approval tiers (PRD §11) and three-way match tolerances (PRD §8.7).
 * Pure functions: they run inside commands, screens and tests alike.
 */

export type PrTier = PurchaseRequestRow["approvalTier"]

/** Tiers from the lowest authority to the highest. */
export const PR_TIERS: readonly PrTier[] = rules.prApproval.map(
  (tier) => tier.approver as PrTier
)

/** Upper bound (exclusive) of the values a tier approves: ৳50,000, ৳5,00,000, unlimited. */
export function tierLimitP(tier: PrTier): number {
  return rules.prApproval.find((t) => t.approver === tier)!.maxP
}

/** The tier a PR value falls in (PRD §11): below ৳50,000 store manager, below ৳5,00,000 procurement head, above that the CFO. */
export function valueTier(totalP: Poisha): PrTier {
  const tier =
    rules.prApproval.find((t) => totalP < t.maxP) ??
    rules.prApproval[rules.prApproval.length - 1]
  return tier.approver as PrTier
}

/**
 * The largest PR value a person may approve, from their authorities:
 * `approve:pr:<taka>` approves values below that many taka,
 * `approve:pr:unlimited` or `*` approves any value, nothing approves none.
 */
export function prApprovalLimitP(authorities: readonly string[]): number {
  let limit = 0
  for (const authority of authorities) {
    if (authority === "*" || authority === "approve:pr:unlimited") {
      return Number.POSITIVE_INFINITY
    }
    const match = /^approve:pr:(\d+)$/.exec(authority)
    if (match) limit = Math.max(limit, Number(match[1]) * 100)
  }
  return limit
}

/**
 * Who must approve a purchase request. Approval is by value (PRD §11) with a
 * strict two-person rule (the owner's rule for merges applies here too): the
 * requester never approves their own request, so when the requester holds the
 * authority of the value's tier, the request goes one tier up. A B1 store
 * manager's ৳9,120 request therefore goes to the procurement head.
 */
export function approvalTierFor(
  totalP: Poisha,
  requesterAuthorities: readonly string[]
): PrTier {
  const own = prApprovalLimitP(requesterAuthorities)
  const start = PR_TIERS.indexOf(valueTier(totalP))
  for (const tier of PR_TIERS.slice(start)) {
    if (tierLimitP(tier) > own) return tier
  }
  return PR_TIERS[PR_TIERS.length - 1]
}

/**
 * Whether a person may decide a request routed to `tier`: they hold at least
 * that tier's authority, their limit covers the value, and they did not raise it.
 */
export function mayApprovePr(
  approver: { id: Id; authorities: readonly string[] },
  pr: Pick<PurchaseRequestRow, "approvalTier" | "totalP" | "requestedBy">
): boolean {
  if (approver.id === pr.requestedBy) return false
  const limit = prApprovalLimitP(approver.authorities)
  return limit >= tierLimitP(pr.approvalTier) && limit > pr.totalP
}

/* ------------------------------------------------------------------ *
 * Three-way match (PRD §8.7): vendor invoice against PO and goods receipt
 * ------------------------------------------------------------------ */

export type MatchDiff = ThreeWayMatchRow["diffs"][number]

export type MatchInvoiceLine = { poLineId: Id; qty: number; unitCostP: Poisha }

/**
 * Compare a vendor invoice with its purchase order and goods receipts.
 * `acceptedQty` is, per PO line, the quantity accepted on the goods receipts
 * that this invoice covers and that no earlier invoice has billed. Quantity
 * must match exactly (tolerance 0); the unit price may differ from the PO
 * price by at most ±2%. Goods received but not yet invoiced are not a
 * mismatch (a later invoice may bill them). Quantities and prices are in the
 * PO line's unit (packs when the line is ordered in packs).
 */
export function threeWayMatch(
  poLines: readonly Pick<PoLineRow, "id" | "qtyOrdered" | "unitCostP">[],
  acceptedQty: Readonly<Record<Id, number>>,
  invoiceLines: readonly MatchInvoiceLine[],
  tolerance: {
    quantityTolerance: number
    priceTolerancePct: number
  } = rules.threeWayMatch
): { status: "matched" | "mismatch"; diffs: MatchDiff[] } {
  const byId = new Map(poLines.map((line) => [line.id, line]))
  const diffs: MatchDiff[] = []
  for (const line of invoiceLines) {
    const po = byId.get(line.poLineId)
    const grn = acceptedQty[line.poLineId] ?? 0
    if (!po) {
      diffs.push({ poLineId: line.poLineId, field: "qty", po: 0, grn, invoice: line.qty })
      continue
    }
    if (Math.abs(line.qty - grn) > tolerance.quantityTolerance) {
      diffs.push({ poLineId: po.id, field: "qty", po: po.qtyOrdered, grn, invoice: line.qty })
    }
    if (priceOff(po.unitCostP, line.unitCostP, tolerance.priceTolerancePct)) {
      diffs.push({
        poLineId: po.id,
        field: "price",
        po: po.unitCostP,
        grn: po.unitCostP,
        invoice: line.unitCostP,
      })
    }
  }
  return { status: diffs.length ? "mismatch" : "matched", diffs }
}

/** True when an invoiced price is outside the tolerance around the PO price. */
export function priceOff(poP: Poisha, invoiceP: Poisha, tolerancePct: number): boolean {
  if (poP <= 0) return invoiceP !== poP
  return (Math.abs(invoiceP - poP) * 100) / poP > tolerancePct
}
