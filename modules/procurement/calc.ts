/**
 * Pure procurement helpers shared by the commands, the screens and the S12
 * launcher: pack arithmetic, cost estimates, suggested vendors, purchase
 * order progress and what a vendor invoice may still bill. They take rows
 * and return numbers, so they run inside commands, live queries and tests.
 *
 * Units: a purchase request, order, goods receipt or vendor invoice line
 * counts packs when its PO line (or PR line) has a `pack`, base units
 * otherwise (the seeded history). Stock always moves in base units.
 */

import { rules } from "@/config/rules.config"
import { addDaysISO } from "@/core/clock/dates"
import type {
  BatchRow,
  BrandRow,
  GrnLineRow,
  ISODate,
  Id,
  PackSize,
  PoLineRow,
  Poisha,
  PrLineRow,
  VendorInvoiceRow,
} from "@/core/db/schema"
import type { PrTier } from "@/core/procurement/rules"
import { companyId } from "@/core/seed/content/medicines/companies"
import { VENDORS } from "@/core/seed/content/partners"

/** Share of MRP used as the cost estimate when a brand has never been received. */
export const COST_FALLBACK_SHARE = 0.76

/** The general distributor used when a brand's manufacturer has no depot. */
export const FALLBACK_VENDOR_ID = "ven_nirvik"

/** Base units in one ordering unit: the pack's units, or 1 for loose units. */
export function unitsPer(pack?: PackSize): number {
  return pack?.units ?? 1
}

/** The brand's newest batch (last received), whatever its status. */
export function latestBatch(batches: readonly BatchRow[]): BatchRow | undefined {
  return [...batches].sort(
    (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)
  )[0]
}

/**
 * Estimated cost of one ordering unit: the newest batch's cost per base unit
 * times the pack's units, or 76% of MRP when the brand was never received.
 */
export function estUnitCostP(
  brand: Pick<BrandRow, "mrpP">,
  batches: readonly BatchRow[],
  pack?: PackSize
): Poisha {
  const perUnit = latestBatch(batches)?.costP ?? brand.mrpP * COST_FALLBACK_SHARE
  return Math.round(perUnit * unitsPer(pack))
}

/** Cost per base unit of a received lot: the pack price spread over its units. */
export function costPerBaseUnitP(unitCostP: Poisha, pack?: PackSize): Poisha {
  return Math.round(unitCostP / unitsPer(pack))
}

/** The brand's manufacturer depot, or the general distributor. */
export function suggestedVendorId(brand: Pick<BrandRow, "companyId">): Id {
  return (
    VENDORS.find((v) => v.companyKey && companyId(v.companyKey) === brand.companyId)?.id ??
    FALLBACK_VENDOR_ID
  )
}

/** Purchase request lines still on the request (a removed line keeps its row with quantity 0). */
export function liveLines<T extends Pick<PrLineRow, "qty">>(lines: readonly T[]): T[] {
  return lines.filter((line) => line.qty > 0)
}

/** Packs to order to cover `units` base units, rounded up to whole packs. */
export function packsFor(units: number, pack?: PackSize): number {
  return Math.max(1, Math.ceil(units / unitsPer(pack)))
}

/* ------------------------------------------------------------------ *
 * Purchase order progress
 * ------------------------------------------------------------------ */

/** Accepted so far on a PO line (received minus rejected). */
export function acceptedOf(line: Pick<PoLineRow, "qtyReceived" | "qtyRejected">): number {
  return line.qtyReceived - line.qtyRejected
}

/** Still to come on a PO line: ordered minus accepted. */
export function pendingOf(
  line: Pick<PoLineRow, "qtyOrdered" | "qtyReceived" | "qtyRejected">
): number {
  return Math.max(0, line.qtyOrdered - acceptedOf(line))
}

/** Accepted and pending over a whole order ("80 received · 20 pending"). */
export function poProgress(
  lines: readonly Pick<PoLineRow, "qtyOrdered" | "qtyReceived" | "qtyRejected">[]
): { ordered: number; accepted: number; rejected: number; pending: number } {
  return lines.reduce(
    (sum, line) => ({
      ordered: sum.ordered + line.qtyOrdered,
      accepted: sum.accepted + acceptedOf(line),
      rejected: sum.rejected + line.qtyRejected,
      pending: sum.pending + pendingOf(line),
    }),
    { ordered: 0, accepted: 0, rejected: 0, pending: 0 }
  )
}

/** Invoices that still bill their quantities (a rejected invoice does not). */
export function billingInvoices<T extends Pick<VendorInvoiceRow, "status">>(
  invoices: readonly T[]
): T[] {
  return invoices.filter((invoice) => invoice.status !== "rejected")
}

/** Quantity billed per PO line on the given invoices. */
export function invoicedByLine(
  invoices: readonly Pick<VendorInvoiceRow, "lines">[]
): Record<Id, number> {
  const out: Record<Id, number> = {}
  for (const invoice of invoices) {
    for (const line of invoice.lines) out[line.poLineId] = (out[line.poLineId] ?? 0) + line.qty
  }
  return out
}

/**
 * What a new vendor invoice may bill per PO line: accepted on the order's
 * goods receipts minus what earlier invoices (not rejected) already billed.
 */
export function acceptedNotInvoiced(
  grnLines: readonly Pick<GrnLineRow, "poLineId" | "qtyAccepted">[],
  invoices: readonly Pick<VendorInvoiceRow, "lines" | "status">[]
): Record<Id, number> {
  const billed = invoicedByLine(billingInvoices(invoices))
  const out: Record<Id, number> = {}
  for (const line of grnLines) out[line.poLineId] = (out[line.poLineId] ?? 0) + line.qtyAccepted
  for (const id of Object.keys(out)) out[id] = Math.max(0, out[id] - (billed[id] ?? 0))
  return out
}

/**
 * True when every line of an order is fully received and billed on
 * invoices that passed the match (matched, or already payable).
 */
export function isSettled(
  lines: readonly Pick<PoLineRow, "id" | "qtyOrdered" | "qtyReceived" | "qtyRejected">[],
  invoices: readonly Pick<VendorInvoiceRow, "lines" | "status">[]
): boolean {
  const billed = invoicedByLine(
    invoices.filter((invoice) => invoice.status === "matched" || invoice.status === "payable")
  )
  return lines.every(
    (line) => pendingOf(line) === 0 && (billed[line.id] ?? 0) >= line.qtyOrdered
  )
}

/* ------------------------------------------------------------------ *
 * Goods receipt
 * ------------------------------------------------------------------ */

/** The earliest expiry a delivered lot may have (today + the minimum shelf life). */
export function minExpiryFor(today: ISODate): ISODate {
  return addDaysISO(today, rules.grnMinShelfLifeDays)
}

/** A lot expiring before the minimum shelf life must be refused in full as short expiry. */
export function isShortExpiry(expiry: ISODate, today: ISODate): boolean {
  return expiry < minExpiryFor(today)
}

/* ------------------------------------------------------------------ *
 * Approval tiers
 * ------------------------------------------------------------------ */

/** A tier's value range: from (inclusive) and below (exclusive, Infinity for the CFO). */
export function tierRange(tier: PrTier): { fromP: Poisha; belowP: Poisha } {
  const index = rules.prApproval.findIndex((t) => t.approver === tier)
  return {
    fromP: index > 0 ? rules.prApproval[index - 1].maxP : 0,
    belowP: rules.prApproval[index].maxP,
  }
}
