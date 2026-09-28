import type {
  BasketLineRow,
  BranchCode,
  InvoiceRow,
  Poisha,
} from "@/core/db/schema"

/** A basket line's amount: quantity times unit price, in poisha. */
export function lineAmount(
  line: Pick<BasketLineRow, "qty" | "unitPriceP">
): Poisha {
  return line.qty * line.unitPriceP
}

export type OpenCharges = {
  branchId: BranchCode
  lines: BasketLineRow[]
  totalP: Poisha
}

/** Charges not yet invoiced (open basket lines), one group per branch. */
export function openChargesByBranch(lines: BasketLineRow[]): OpenCharges[] {
  const groups = new Map<BranchCode, BasketLineRow[]>()
  for (const line of lines) {
    if (line.status !== "open") continue
    groups.set(line.branchId, [...(groups.get(line.branchId) ?? []), line])
  }
  return [...groups.entries()]
    .map(([branchId, grouped]) => ({
      branchId,
      lines: [...grouped].sort((a, b) => a.createdAt - b.createdAt),
      totalP: grouped.reduce((sum, l) => sum + lineAmount(l), 0),
    }))
    .sort((a, b) => a.branchId.localeCompare(b.branchId))
}

/** What is still owed on an invoice (nothing on paid, void or refunded ones). */
export function invoiceDue(invoice: InvoiceRow): Poisha {
  if (invoice.status !== "unpaid" && invoice.status !== "partial") return 0
  return Math.max(0, invoice.totalP - invoice.paidP)
}

/** Invoices newest first. */
export function sortInvoices(invoices: InvoiceRow[]): InvoiceRow[] {
  return [...invoices].sort((a, b) => b.createdAt - a.createdAt)
}

type PaymentLike = {
  status: string
  tender: string
  invoiceId: string
  requestedAt: number
}

const isMfsTender = (tender: string) => tender === "bkash" || tender === "nagad"

/** bKash or Nagad pushes still waiting for the customer's approval, oldest first. */
export function pendingOnlinePayments<P extends PaymentLike>(
  payments: P[]
): P[] {
  return payments
    .filter((p) => p.status === "pending" && isMfsTender(p.tender))
    .sort((a, b) => a.requestedAt - b.requestedAt)
}

/** The latest bKash or Nagad push on an invoice that expired unapproved, if any. */
export function lastTimedOut<P extends PaymentLike>(
  payments: P[],
  invoiceId: string
): P | undefined {
  return payments
    .filter(
      (p) =>
        p.invoiceId === invoiceId &&
        p.status === "timeout" &&
        isMfsTender(p.tender)
    )
    .sort((a, b) => b.requestedAt - a.requestedAt)[0]
}
