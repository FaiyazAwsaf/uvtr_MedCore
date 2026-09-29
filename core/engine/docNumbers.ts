import {
  fiscalYearTag,
  getBranch,
  type BranchCode,
  type CompanyCode,
} from "@/config/brand.config"
import {
  counterKey,
  docNo,
  uhidFromSerial,
  type OfflineDocKind,
} from "@/core/db/numbering"

import type { Tx } from "./types"

/**
 * Document numbers that are aware of offline mode (PRD §16): on a branch edge
 * store, UHIDs, invoice numbers and accession numbers come from that branch's
 * pre-allocated offline ranges so they can never collide with central.
 */

/** Branch of the edge store the transaction writes to, if offline. */
function edgeBranch(tx: Tx): BranchCode | null {
  return tx.isEdge ? tx.db.edgeBranch : null
}

export async function nextUhid(
  tx: Tx
): Promise<{ uhid: string; provisional: boolean }> {
  const branch = edgeBranch(tx)
  if (branch) {
    const n = await tx.nextNumber(counterKey.provisionalUhid(branch))
    return { uhid: docNo.provisionalUhid(branch, n), provisional: true }
  }
  const n = await tx.nextNumber(counterKey.uhid())
  return { uhid: uhidFromSerial(n), provisional: false }
}

export async function nextInvoiceNo(
  tx: Tx,
  branch: BranchCode
): Promise<{ invoiceNo: string; companyId: CompanyCode; offline: boolean }> {
  const companyId = getBranch(branch).company
  const fy = fiscalYearTag(new Date(tx.now()))
  if (edgeBranch(tx)) {
    const n = await tx.nextNumber(counterKey.offlineInvoice(companyId, branch, fy))
    return { invoiceNo: docNo.offlineInvoice(companyId, branch, fy, n), companyId, offline: true }
  }
  const n = await tx.nextNumber(counterKey.invoice(companyId, branch, fy))
  return { invoiceNo: docNo.invoice(companyId, branch, fy, n), companyId, offline: false }
}

export async function nextAccessionNo(tx: Tx, branch: BranchCode): Promise<string> {
  if (edgeBranch(tx)) {
    const n = await tx.nextNumber(counterKey.offlineAccession(branch))
    return docNo.offlineAccession(branch, n)
  }
  const n = await tx.nextNumber(counterKey.accession(branch))
  return docNo.accession(branch, n)
}

export const nextRxNo = async (tx: Tx, branch: BranchCode) =>
  docNo.rx(branch, await tx.nextNumber(counterKey.rx(branch)))
export const nextReceiptNo = async (tx: Tx, branch: BranchCode) =>
  docNo.receipt(branch, await tx.nextNumber(counterKey.receipt(branch)))
export const nextLabOrderNo = async (tx: Tx, branch: BranchCode) =>
  docNo.labOrder(branch, await tx.nextNumber(counterKey.labOrder(branch)))
export const nextImagingOrderNo = async (tx: Tx, branch: BranchCode) =>
  docNo.imagingOrder(branch, await tx.nextNumber(counterKey.imagingOrder(branch)))
export const nextReportNo = async (tx: Tx, branch: BranchCode) =>
  docNo.report(branch, await tx.nextNumber(counterKey.report(branch)))
export const nextRefundNo = async (tx: Tx, branch: BranchCode) =>
  docNo.refund(branch, await tx.nextNumber(counterKey.refund(branch)))
export const nextCreditNoteNo = async (tx: Tx, branch: BranchCode) =>
  docNo.creditNote(branch, await tx.nextNumber(counterKey.creditNote(branch)))
export const nextAdmissionNo = async (tx: Tx, branch: BranchCode) =>
  docNo.admission(branch, await tx.nextNumber(counterKey.admission(branch)))
/**
 * Network-wide series (PR, PO, GRN, transfer, vendor invoice) share one
 * counter across branches, so a branch working offline numbers from its own
 * range instead (PO-B1-OFF-0001): the replayed documents can never collide
 * with numbers central issued meanwhile (purchase order numbers are unique).
 */
async function networkDocNo(
  tx: Tx,
  kind: OfflineDocKind,
  online: (n: number) => string
): Promise<string> {
  const branch = edgeBranch(tx)
  if (branch) {
    return docNo.offlineDoc(kind, branch, await tx.nextNumber(counterKey.offlineDoc(kind, branch)))
  }
  return online(await tx.nextNumber(ONLINE_KEY[kind]))
}

const ONLINE_KEY: Record<OfflineDocKind, string> = {
  pr: counterKey.purchaseRequest(),
  po: counterKey.purchaseOrder(),
  grn: counterKey.grn(),
  trf: counterKey.transfer(),
  vinv: counterKey.vendorInvoice(),
}

export const nextPurchaseRequestNo = (tx: Tx) =>
  networkDocNo(tx, "pr", docNo.purchaseRequest)
export const nextPurchaseOrderNo = (tx: Tx) =>
  networkDocNo(tx, "po", docNo.purchaseOrder)
export const nextGrnNo = (tx: Tx) => networkDocNo(tx, "grn", docNo.grn)
export const nextTransferNo = (tx: Tx) => networkDocNo(tx, "trf", docNo.transfer)
export const nextVendorInvoiceNo = (tx: Tx) =>
  networkDocNo(tx, "vinv", docNo.vendorInvoice)
