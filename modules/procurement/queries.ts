/**
 * Reads behind the procurement screens. Each takes the window's database and
 * runs inside `useLiveQuery`, so every window re-renders the moment another
 * one commits (a request approved in Tariq's window shows in Habibur's).
 */

import type { BranchCode } from "@/config/brand.config"
import type { MedcoreDb } from "@/core/db/database"
import type {
  ApprovalRow,
  BrandRow,
  GrnLineRow,
  GrnRow,
  Id,
  PayableRow,
  PoLineRow,
  PrLineRow,
  PurchaseOrderRow,
  PurchaseRequestRow,
  StaffRow,
  ThreeWayMatchRow,
  VendorInvoiceRow,
  VendorRow,
} from "@/core/db/schema"

import { liveLines } from "./calc"

const unique = <T>(values: (T | undefined | null)[]): T[] => [
  ...new Set(values.filter((v): v is T => v !== undefined && v !== null)),
]

function byId<T extends { id: Id }>(rows: (T | undefined)[]): Map<Id, T> {
  return new Map(rows.filter((r): r is T => !!r).map((r) => [r.id, r]))
}

export type PrItem = {
  pr: PurchaseRequestRow
  lines: PrLineRow[]
  requester?: StaffRow
  decider?: StaffRow
  pos: PurchaseOrderRow[]
}

export type PrData = {
  items: PrItem[]
  brands: Map<Id, BrandRow>
}

/** Purchase requests at a branch (or every branch), newest first, with lines and people. */
export async function loadPrs(
  db: MedcoreDb,
  branch: BranchCode | null,
  opts: { status?: PurchaseRequestRow["status"][] } = {}
): Promise<PrData> {
  let prs = branch
    ? await db.purchaseRequests.where("branchId").equals(branch).toArray()
    : await db.purchaseRequests.toArray()
  if (opts.status) prs = prs.filter((pr) => opts.status!.includes(pr.status))
  return withDetails(db, prs)
}

/** One request with its lines and people (undefined while loading, null when missing). */
export async function loadPr(db: MedcoreDb, prId: Id): Promise<PrData | null> {
  const pr = await db.purchaseRequests.get(prId)
  if (!pr) return null
  return withDetails(db, [pr])
}

async function withDetails(db: MedcoreDb, prs: PurchaseRequestRow[]): Promise<PrData> {
  const ids = prs.map((p) => p.id)
  const [lines, pos, staff] = await Promise.all([
    ids.length ? db.prLines.where("prId").anyOf(ids).toArray() : [],
    ids.length ? db.purchaseOrders.where("prId").anyOf(ids).toArray() : [],
    db.staff.bulkGet(unique(prs.flatMap((p) => [p.requestedBy, p.decidedBy]))),
  ])
  const brands = byId(await db.brands.bulkGet(unique(lines.map((l) => l.brandId))))
  const people = byId(staff)
  const items = prs
    .map((pr) => ({
      pr,
      lines: liveLines(
        lines
          .filter((l) => l.prId === pr.id)
          .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      ),
      requester: people.get(pr.requestedBy),
      decider: pr.decidedBy ? people.get(pr.decidedBy) : undefined,
      pos: pos.filter((po) => po.prId === pr.id),
    }))
    .sort(
      (a, b) =>
        (b.pr.submittedAt ?? b.pr.updatedAt) - (a.pr.submittedAt ?? a.pr.updatedAt) ||
        b.pr.prNo.localeCompare(a.pr.prNo)
    )
  return { items, brands }
}

export type PoItem = {
  po: PurchaseOrderRow
  lines: PoLineRow[]
  vendor?: VendorRow
}

export type PoData = {
  items: PoItem[]
  brands: Map<Id, BrandRow>
}

/** Purchase orders at a branch (or every branch), newest first. */
export async function loadPos(
  db: MedcoreDb,
  branch: BranchCode | null,
  opts: { status?: PurchaseOrderRow["status"][] } = {}
): Promise<PoData> {
  let pos = branch
    ? await db.purchaseOrders.where("branchId").equals(branch).toArray()
    : await db.purchaseOrders.toArray()
  if (opts.status) pos = pos.filter((po) => opts.status!.includes(po.status))
  const ids = pos.map((p) => p.id)
  const [lines, vendors] = await Promise.all([
    ids.length ? db.poLines.where("poId").anyOf(ids).toArray() : [],
    db.vendors.bulkGet(unique(pos.map((p) => p.vendorId))),
  ])
  const brands = byId(await db.brands.bulkGet(unique(lines.map((l) => l.brandId))))
  const vendorById = byId(vendors)
  return {
    items: pos
      .map((po) => ({
        po,
        lines: lines.filter((l) => l.poId === po.id).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
        vendor: vendorById.get(po.vendorId),
      }))
      .sort((a, b) => b.po.issuedAt - a.po.issuedAt || b.po.poNo.localeCompare(a.po.poNo)),
    brands,
  }
}

export type GrnItem = { grn: GrnRow; lines: GrnLineRow[]; receivedBy?: StaffRow }
export type InvoiceItem = {
  invoice: VendorInvoiceRow
  match?: ThreeWayMatchRow
  payable?: PayableRow
}

export type PoDetail = {
  po: PurchaseOrderRow
  lines: PoLineRow[]
  vendor?: VendorRow
  pr?: PurchaseRequestRow
  brands: Map<Id, BrandRow>
  grns: GrnItem[]
  invoices: InvoiceItem[]
}

/** Everything about one order: lines, supplier, request, receipts, invoices and matches. */
export async function loadPoDetail(db: MedcoreDb, poId: Id): Promise<PoDetail | null> {
  const po = await db.purchaseOrders.get(poId)
  if (!po) return null
  const [lines, vendor, pr, grns, invoices, matches, payables] = await Promise.all([
    db.poLines.where("poId").equals(po.id).toArray(),
    db.vendors.get(po.vendorId),
    po.prId ? db.purchaseRequests.get(po.prId) : undefined,
    db.grns.where("poId").equals(po.id).toArray(),
    db.vendorInvoices.where("poId").equals(po.id).toArray(),
    db.threeWayMatches.where("poId").equals(po.id).toArray(),
    db.payables.where("poId").equals(po.id).toArray(),
  ])
  const grnIds = grns.map((g) => g.id)
  const [grnLines, staff, brandRows] = await Promise.all([
    grnIds.length ? db.grnLines.where("grnId").anyOf(grnIds).toArray() : [],
    db.staff.bulkGet(unique(grns.map((g) => g.receivedBy))),
    db.brands.bulkGet(unique(lines.map((l) => l.brandId))),
  ])
  const people = byId(staff)
  return {
    po,
    lines: lines.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    vendor,
    pr,
    brands: byId(brandRows),
    grns: grns
      .map((grn) => ({
        grn,
        lines: grnLines.filter((l) => l.grnId === grn.id),
        receivedBy: people.get(grn.receivedBy),
      }))
      .sort((a, b) => b.grn.receivedAt - a.grn.receivedAt),
    invoices: invoices
      .map((invoice) => ({
        invoice,
        match: matches.find((m) => m.vendorInvoiceId === invoice.id),
        payable: payables.find((p) => p.vendorInvoiceId === invoice.id),
      }))
      .sort((a, b) => b.invoice.receivedAt - a.invoice.receivedAt),
  }
}

export type ApprovalsData = {
  pending: PrItem[]
  decided: PrItem[]
  brands: Map<Id, BrandRow>
}

/**
 * The approvals inbox for a person: submitted requests they may decide
 * (branch personas: their own branch only), and recent decisions in scope.
 */
export async function loadApprovals(
  db: MedcoreDb,
  scope: { branch: BranchCode | null },
  mayDecide: (pr: PurchaseRequestRow) => boolean
): Promise<ApprovalsData> {
  const [submitted, decided] = await Promise.all([
    db.purchaseRequests.where("status").equals("submitted").toArray(),
    db.purchaseRequests.where("status").anyOf("approved", "rejected", "ordered").toArray(),
  ])
  const inScope = (pr: PurchaseRequestRow) => !scope.branch || pr.branchId === scope.branch
  const pending = submitted.filter((pr) => inScope(pr) && mayDecide(pr))
  const recent = decided
    .filter((pr) => inScope(pr) && pr.decidedAt)
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
    .slice(0, 30)
  const [p, d] = await Promise.all([withDetails(db, pending), withDetails(db, recent)])
  return {
    pending: p.items,
    decided: d.items.sort((a, b) => (b.pr.decidedAt ?? 0) - (a.pr.decidedAt ?? 0)),
    brands: new Map([...p.brands, ...d.brands]),
  }
}

export type CounterApproval = {
  approval: ApprovalRow
  approver?: StaffRow
  requester?: StaffRow
}

/** Approvals given outside procurement (discounts, refunds, variances, merges...), newest first. */
export async function loadCounterApprovals(db: MedcoreDb, limit = 60): Promise<CounterApproval[]> {
  const rows = (await db.approvals.toArray())
    .filter((a) => a.kind !== "pr")
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))
    .slice(0, limit)
  const people = byId(
    await db.staff.bulkGet(unique(rows.flatMap((a) => [a.approverId, a.requestedBy])))
  )
  return rows.map((approval) => ({
    approval,
    approver: approval.approverId ? people.get(approval.approverId) : undefined,
    requester: people.get(approval.requestedBy),
  }))
}
