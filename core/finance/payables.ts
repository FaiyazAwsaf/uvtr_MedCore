import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type { PayableRow, Poisha, VendorInvoiceRow } from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"
import { formatDmy, formatMoney } from "@/lib/i18n/format"

/**
 * A vendor payable (PRD §8.7), created in the same commit as the decision
 * that allows it: a vendor invoice that passes the three-way match
 * (procurement, WS-H) or a mismatch that finance resolves (WS-I). Due on the
 * vendor's payment terms counted from the supplier's invoice date (the day it
 * arrived when the invoice has no date). The vendor invoice becomes payable.
 */
export async function createPayable(
  tx: Tx,
  opts: { vendorInvoice: VendorInvoiceRow; amountP: Poisha }
): Promise<PayableRow> {
  const invoice = opts.vendorInvoice
  const vendor = await tx.get("vendors", invoice.vendorId)
  const po = await tx.get("purchaseOrders", invoice.poId)
  const from = invoice.invoiceDate ?? dhakaDate(invoice.receivedAt)
  const payable = tx.insert("payables", {
    vendorId: vendor.id,
    vendorInvoiceId: invoice.id,
    poId: po.id,
    amountP: opts.amountP,
    dueDate: addDaysISO(from, vendor.paymentTermsDays),
    status: "open",
  })
  await tx.update("vendorInvoices", invoice.id, { status: "payable" })
  tx.emit("PayableCreated", {
    branchId: po.branchId,
    refs: { poId: po.id, vendorInvoiceId: invoice.id, payableId: payable.id },
    params: {
      vendor: vendor.name,
      poNo: po.poNo,
      vendorInvoiceNo: invoice.vendorInvoiceNo,
      amount: formatMoney(opts.amountP, "en"),
      amountBn: formatMoney(opts.amountP, "bn"),
      dueDate: formatDmy(payable.dueDate, "en"),
      dueDateBn: formatDmy(payable.dueDate, "bn"),
    },
  })
  return payable
}
