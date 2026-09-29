import type { BranchCode } from "@/config/brand.config"
import { atDhaka } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import type {
  ApprovalRow,
  BasketLineRow,
  Id,
  InvoiceLineRow,
  InvoiceRow,
  ISODate,
  Ms,
  PatientRow,
  PaymentRow,
  Poisha,
  ReceiptRow,
  ShiftRow,
  Tender,
} from "@/core/db/schema"
import type { Row, TableName } from "@/core/db/tables"

import { isMfs } from "./pricing"
import { coverFor, type Cover, type RowReader } from "./settle"

/**
 * Read models for the cashier screens, run inside `useLiveQuery` so every
 * window updates the moment any window commits. Reads only; writes go
 * through the commands.
 */

export function dbReader(db: MedcoreDb): RowReader {
  return {
    find: <T extends TableName>(table: T, id: Id) =>
      db.t(table).get(id) as Promise<Row<T> | undefined>,
  }
}

const OPEN_INVOICE: InvoiceRow["status"][] = ["unpaid", "partial"]

/* ------------------------------------------------------------------ *
 * Patients with open bills
 * ------------------------------------------------------------------ */

export type OpenBill = {
  patient: PatientRow
  lines: BasketLineRow[]
  totalP: Poisha
  /** Newest line, for ordering and the "added" time */
  latestAt: Ms
  counts: Partial<Record<BasketLineRow["sourceType"], number>>
}

/** Patients with open basket lines at a branch, newest activity first. */
export async function openBillsAt(
  db: MedcoreDb,
  branch: BranchCode
): Promise<OpenBill[]> {
  const lines = await db.basketLines
    .where("status")
    .equals("open")
    .filter((line) => line.branchId === branch)
    .toArray()
  const byPatient = new Map<Id, BasketLineRow[]>()
  for (const line of lines) {
    const list = byPatient.get(line.patientId) ?? []
    list.push(line)
    byPatient.set(line.patientId, list)
  }
  const ids = [...byPatient.keys()]
  const patients = await db.patients.bulkGet(ids)
  const bills: OpenBill[] = []
  ids.forEach((id, index) => {
    const patient = patients[index]
    if (!patient) return
    const list = byPatient.get(id)!
    const counts: OpenBill["counts"] = {}
    for (const line of list)
      counts[line.sourceType] = (counts[line.sourceType] ?? 0) + 1
    bills.push({
      patient,
      lines: list,
      totalP: list.reduce((sum, line) => sum + line.qty * line.unitPriceP, 0),
      latestAt: Math.max(...list.map((line) => line.createdAt)),
      counts,
    })
  })
  return bills.sort((a, b) => b.latestAt - a.latestAt)
}

/* ------------------------------------------------------------------ *
 * Invoices still due (partly paid, or waiting for a bKash/Nagad approval)
 * ------------------------------------------------------------------ */

export type DueInvoice = {
  invoice: InvoiceRow
  patient?: PatientRow
  payments: PaymentRow[]
  pending: PaymentRow[]
  dueP: Poisha
}

async function withPayments(
  db: MedcoreDb,
  invoices: InvoiceRow[],
  loadPatients: boolean
): Promise<DueInvoice[]> {
  const patients = loadPatients
    ? await db.patients.bulkGet(invoices.map((invoice) => invoice.patientId))
    : []
  const out: DueInvoice[] = []
  for (const [index, invoice] of invoices.entries()) {
    const payments = await db.payments
      .where("invoiceId")
      .equals(invoice.id)
      .toArray()
    out.push({
      invoice,
      patient: patients[index],
      payments,
      pending: payments.filter((p) => p.status === "pending"),
      dueP: invoice.totalP - invoice.paidP,
    })
  }
  return out.sort((a, b) => b.invoice.createdAt - a.invoice.createdAt)
}

/** Every invoice still due at a branch (the "waiting for payment" list). */
export async function dueInvoicesAt(
  db: MedcoreDb,
  branch: BranchCode
): Promise<DueInvoice[]> {
  const invoices = await db.invoices
    .where("status")
    .anyOf(OPEN_INVOICE)
    .filter((invoice) => invoice.branchId === branch)
    .toArray()
  return withPayments(db, invoices, true)
}

/** A patient's invoices still due at a branch. */
export async function dueInvoicesOf(
  db: MedcoreDb,
  patientId: Id,
  branch: BranchCode
): Promise<DueInvoice[]> {
  const invoices = await db.invoices
    .where("patientId")
    .equals(patientId)
    .filter(
      (invoice) =>
        invoice.branchId === branch && OPEN_INVOICE.includes(invoice.status)
    )
    .toArray()
  return withPayments(db, invoices, false)
}

/* ------------------------------------------------------------------ *
 * One patient's open basket
 * ------------------------------------------------------------------ */

export type PatientBasket = {
  lines: BasketLineRow[]
  cover: Cover | null
  /** Consultation fees for a visit after today, by basket line: paid at that visit unless chosen now */
  laterVisits: Record<Id, ISODate>
}

export async function basketOf(
  db: MedcoreDb,
  patient: PatientRow,
  branch: BranchCode,
  today: string
): Promise<PatientBasket> {
  const lines = await db.basketLines
    .where("[patientId+status]")
    .equals([patient.id, "open"])
    .filter((line) => line.branchId === branch)
    .toArray()
  lines.sort(
    (a, b) =>
      a.createdAt - b.createdAt || a.description.localeCompare(b.description)
  )
  const cover = lines.some((line) => line.payerType === "corporate")
    ? await coverFor(dbReader(db), patient, today)
    : null
  const laterVisits: Record<Id, ISODate> = {}
  for (const line of lines) {
    if (line.sourceType !== "consult") continue
    const appointment = await db.appointments.get(line.sourceId)
    if (appointment && appointment.date > today)
      laterVisits[line.id] = appointment.date
  }
  return { lines, cover, laterVisits }
}

/* ------------------------------------------------------------------ *
 * One invoice in full (payment state, receipt, what it unlocked)
 * ------------------------------------------------------------------ */

export type InvoiceDetail = {
  invoice: InvoiceRow
  lines: InvoiceLineRow[]
  payments: PaymentRow[]
  receipt?: ReceiptRow
  approval?: ApprovalRow
  /** Who approved a discount above the cashier's authority */
  approver?: { en: string; bn: string }
  patient?: PatientRow
  /** Staff name of the cashier, when the invoice was taken at a counter */
  cashier?: { en: string; bn: string }
  corporateClient?: { en: string; bn: string }
  /** Bangla text of each line, from its basket line (invoice lines keep English only) */
  descriptionBn: Record<Id, string | undefined>
  /** Display order of each line: the order its basket line was added */
  lineOrder: Record<Id, number>
  unlocked: {
    tests: number
    specimens: number
    imaging: number
    medicines: number
  }
}

export async function invoiceDetail(
  db: MedcoreDb,
  invoiceId: Id
): Promise<InvoiceDetail | null> {
  const invoice = await db.invoices.get(invoiceId)
  if (!invoice) return null
  const [lines, payments, receipts, patient, staff] = await Promise.all([
    db.invoiceLines.where("invoiceId").equals(invoiceId).toArray(),
    db.payments.where("invoiceId").equals(invoiceId).toArray(),
    db.receipts.where("invoiceId").equals(invoiceId).toArray(),
    db.patients.get(invoice.patientId),
    db.staff.get(invoice.cashierId),
  ])
  const approval = invoice.discountApprovalId
    ? await db.approvals.get(invoice.discountApprovalId)
    : undefined
  const approverStaff = approval?.approverId
    ? await db.staff.get(approval.approverId)
    : undefined
  const client = invoice.corporateClientId
    ? await db.corporateClients.get(invoice.corporateClientId)
    : undefined

  const unlocked = { tests: 0, specimens: 0, imaging: 0, medicines: 0 }
  const specimenIds = new Set<Id>()
  for (const line of lines) {
    if (line.sourceType === "test") {
      const item = await db.labOrderItems.get(line.sourceId)
      if (item?.paymentCleared) {
        unlocked.tests += 1
        if (item.specimenId) specimenIds.add(item.specimenId)
      }
    } else if (line.sourceType === "imaging") {
      const order = await db.imagingOrders.get(line.sourceId)
      if (order?.paymentCleared) unlocked.imaging += 1
    } else if (line.sourceType === "rx-line") {
      const rxLine = await db.rxLines.get(line.sourceId)
      if (rxLine?.paymentCleared) unlocked.medicines += 1
    }
  }
  unlocked.specimens = specimenIds.size
  payments.sort(
    (a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id)
  )
  const baskets = await db.basketLines.bulkGet(
    lines.map((line) => line.basketLineId ?? "")
  )
  const descriptionBn: Record<Id, string | undefined> = {}
  lines.forEach((line, index) => {
    descriptionBn[line.id] = baskets[index]?.descriptionBn
  })
  const lineOrder: Record<Id, number> = {}
  lines
    .map((line, index) => ({
      line,
      at: baskets[index]?.createdAt ?? line.createdAt,
    }))
    .sort(
      (a, b) =>
        a.at - b.at || a.line.description.localeCompare(b.line.description)
    )
    .forEach(({ line }, index) => {
      lineOrder[line.id] = index
    })
  return {
    descriptionBn,
    lineOrder,
    invoice,
    lines,
    payments,
    receipt: receipts.sort((a, b) => b.at - a.at)[0],
    approval,
    approver: approverStaff
      ? { en: approverStaff.nameEn, bn: approverStaff.nameBn }
      : undefined,
    patient,
    cashier: staff ? { en: staff.nameEn, bn: staff.nameBn } : undefined,
    corporateClient: client ? client.name : undefined,
    unlocked,
  }
}

/* ------------------------------------------------------------------ *
 * Today's collections at a branch (the KPI row)
 * ------------------------------------------------------------------ */

export type TenderTotals = Record<Tender, Poisha>

export type TodayKpis = {
  collectedP: Poisha
  byTender: TenderTotals
  payments: Partial<Record<Tender, number>>
  pendingP: Poisha
  pendingCount: number
  invoices: number
}

const emptyTotals = (): TenderTotals => ({
  cash: 0,
  card: 0,
  bkash: 0,
  nagad: 0,
  deposit: 0,
  corporate: 0,
})

export async function todayKpisAt(
  db: MedcoreDb,
  branch: BranchCode,
  today: string
): Promise<TodayKpis> {
  const start = atDhaka(today, "00:00")
  const end = start + 24 * 60 * 60 * 1000
  const [payments, invoices] = await Promise.all([
    db.payments.where("branchId").equals(branch).toArray(),
    db.invoices
      .where("date")
      .equals(today)
      .filter((i) => i.branchId === branch)
      .count(),
  ])
  const byTender = emptyTotals()
  const counts: TodayKpis["payments"] = {}
  let pendingP = 0
  let pendingCount = 0
  for (const payment of payments) {
    if (payment.status === "pending" && isMfs(payment.tender)) {
      pendingP += payment.amountP
      pendingCount += 1
      continue
    }
    const at = payment.confirmedAt ?? payment.requestedAt
    if (payment.status !== "confirmed" && payment.status !== "refunded")
      continue
    if (at < start || at >= end) continue
    byTender[payment.tender] += payment.amountP
    counts[payment.tender] = (counts[payment.tender] ?? 0) + 1
  }
  const collectedP =
    byTender.cash + byTender.card + byTender.bkash + byTender.nagad
  return {
    collectedP,
    byTender,
    payments: counts,
    pendingP,
    pendingCount,
    invoices,
  }
}

/* ------------------------------------------------------------------ *
 * Cash shift
 * ------------------------------------------------------------------ */

export type ShiftSummary = {
  shift: ShiftRow
  byTender: TenderTotals
  counts: Partial<Record<Tender, number>>
  cashInP: Poisha
  cashRefundsP: Poisha
  /** Float plus cash taken minus cash refunded: what the drawer should hold */
  expectedCashP: Poisha
  pendingMfsP: Poisha
  payments: (PaymentRow & { invoiceNo?: string; patient?: PatientRow })[]
}

/** The cashier's open shift at a branch, if any. */
export async function openShiftFor(
  db: MedcoreDb,
  cashierId: Id,
  branch: BranchCode
): Promise<ShiftRow | undefined> {
  return db.shifts
    .where("[branchId+status]")
    .equals([branch, "open"])
    .filter((shift) => shift.cashierId === cashierId)
    .first()
}

/**
 * The running figures of a shift (plan §9 `/cashier/shift`). Expected cash
 * is derived on read: the float, plus confirmed cash taken on this shift,
 * minus cash refunds the cashier paid out during it. Closing snapshots it.
 */
export async function shiftSummary(
  db: MedcoreDb,
  shift: ShiftRow,
  nowMs: Ms
): Promise<ShiftSummary> {
  const payments = await db.payments.where("shiftId").equals(shift.id).toArray()
  const byTender = emptyTotals()
  const counts: ShiftSummary["counts"] = {}
  let pendingMfsP = 0
  for (const payment of payments) {
    if (payment.status === "pending") {
      pendingMfsP += payment.amountP
      continue
    }
    if (payment.status !== "confirmed" && payment.status !== "refunded")
      continue
    byTender[payment.tender] += payment.amountP
    counts[payment.tender] = (counts[payment.tender] ?? 0) + 1
  }
  const until = shift.closedAt ?? nowMs
  const refunds = await db.refunds
    .filter(
      (refund) =>
        refund.tender === "cash" &&
        refund.status === "completed" &&
        refund.createdBy === shift.cashierId &&
        refund.createdAt >= shift.openedAt &&
        refund.createdAt <= until
    )
    .toArray()
  const cashRefundsP = refunds.reduce((sum, refund) => sum + refund.amountP, 0)

  const invoiceIds = [...new Set(payments.map((p) => p.invoiceId))]
  const invoices = await db.invoices.bulkGet(invoiceIds)
  const invoiceById = new Map(invoices.filter(Boolean).map((i) => [i!.id, i!]))
  const patients = await db.patients.bulkGet([
    ...new Set(payments.map((p) => p.patientId)),
  ])
  const patientById = new Map(patients.filter(Boolean).map((p) => [p!.id, p!]))
  const rows = payments
    .map((payment) => ({
      ...payment,
      invoiceNo: invoiceById.get(payment.invoiceId)?.invoiceNo,
      patient: patientById.get(payment.patientId),
    }))
    .sort((a, b) => b.requestedAt - a.requestedAt || b.id.localeCompare(a.id))

  return {
    shift,
    byTender,
    counts,
    cashInP: byTender.cash,
    cashRefundsP,
    expectedCashP: shift.floatP + byTender.cash - cashRefundsP,
    pendingMfsP,
    payments: rows,
  }
}
