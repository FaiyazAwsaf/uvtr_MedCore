import type { BranchCode } from "@/config/brand.config"
import { atDhaka } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import type {
  AppointmentRow,
  ApprovalRow,
  BasketLineRow,
  CreditNoteRow,
  FeeShareAccrualRow,
  Id,
  InvoiceLineRow,
  InvoiceRow,
  ISODate,
  Ms,
  PatientRow,
  PaymentRow,
  Poisha,
  ReceiptRow,
  RefundRow,
  ShiftRow,
  Tender,
} from "@/core/db/schema"
import type { Row, TableName } from "@/core/db/tables"

import { isMfs } from "./pricing"
import { lineStage, type RefundablePayment, type StageInfo } from "./refunds"
import { coverFor, type Cover, type RowReader } from "./settle"
import { shiftCash } from "./shift"

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
  /** Inpatient deposits taken in cash on this shift */
  cashDepositsP: Poisha
  /** Float plus cash taken and cash deposits, minus cash refunded: what the drawer should hold */
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
  shift: ShiftRow
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
  const refunds = await db.refunds.where("status").equals("completed").toArray()
  const deposits = await db.deposits.filter((d) => d.shiftId === shift.id).toArray()
  const cash = shiftCash(shift, payments, refunds, deposits)

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
    cashInP: cash.cashInP,
    cashRefundsP: cash.cashRefundsP,
    cashDepositsP: cash.cashDepositsP,
    expectedCashP: cash.expectedP,
    pendingMfsP,
    payments: rows,
  }
}

/** The cashier's most recently closed shift at a branch (shown locked after close). */
export async function lastClosedShiftFor(
  db: MedcoreDb,
  cashierId: Id,
  branch: BranchCode
): Promise<ShiftRow | undefined> {
  const closed = await db.shifts
    .where("[branchId+status]")
    .equals([branch, "closed"])
    .filter((shift) => shift.cashierId === cashierId)
    .toArray()
  return closed.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0]
}

export type Names = { en: string; bn: string }

async function staffNames(db: MedcoreDb, staffId?: Id): Promise<Names | undefined> {
  if (!staffId) return undefined
  const staff = await db.staff.get(staffId)
  return staff ? { en: staff.nameEn, bn: staff.nameBn } : undefined
}

/** Staff names of doctors, by doctor id. */
async function doctorNames(db: MedcoreDb, doctorIds: Id[]): Promise<Map<Id, Names>> {
  const ids = [...new Set(doctorIds)]
  const doctors = await db.doctors.bulkGet(ids)
  const staff = await db.staff.bulkGet(doctors.map((d) => d?.staffId ?? ""))
  const out = new Map<Id, Names>()
  ids.forEach((id, index) => {
    const person = staff[index]
    if (person) out.set(id, { en: person.nameEn, bn: person.nameBn })
  })
  return out
}

export type ShiftReport = ShiftSummary & {
  cashier?: Names
  approval?: ApprovalRow
  approver?: Names
  /** Every refund this cashier paid out while the shift was open, by tender */
  refundsByTender: TenderTotals
  refundCount: number
}

/** Everything the Z-report prints for a shift (plan §9 shift close). */
export async function shiftReport(
  db: MedcoreDb,
  shift: ShiftRow
): Promise<ShiftReport> {
  const summary = await shiftSummary(db, shift)
  const until = shift.closedAt ?? Number.POSITIVE_INFINITY
  const refunds = (await db.refunds.where("status").equals("completed").toArray()).filter(
    (r) =>
      r.createdBy === shift.cashierId && r.createdAt >= shift.openedAt && r.createdAt <= until
  )
  const refundsByTender = emptyTotals()
  for (const r of refunds) refundsByTender[r.tender] += r.amountP
  const approval = shift.varianceApprovalId
    ? await db.approvals.get(shift.varianceApprovalId)
    : undefined
  return {
    ...summary,
    cashier: await staffNames(db, shift.cashierId),
    approval,
    approver: await staffNames(db, approval?.approverId),
    refundsByTender,
    refundCount: refunds.length,
  }
}

/* ------------------------------------------------------------------ *
 * Refunds and cancellations (plan §9 `/cashier/refunds`)
 * ------------------------------------------------------------------ */

export type RefundLineView = {
  line: InvoiceLineRow
  descriptionBn?: string
  info: StageInfo
  /** Fee shares on the line that are not reversed yet */
  accruals: (FeeShareAccrualRow & { doctor?: Names })[]
}

export type RefundInvoiceView = {
  invoice: InvoiceRow
  patient?: PatientRow
  /** Payments that brought money in (confirmed, or since refunded) */
  payments: PaymentRow[]
  /** What each payment brought in and has given back (for the refund split) */
  pool: RefundablePayment[]
  lines: RefundLineView[]
  creditNotes: CreditNoteRow[]
  refunds: (RefundRow & { approver?: Names })[]
  reversals: (FeeShareAccrualRow & { doctor?: Names })[]
  /** When the invoice was settled */
  paidAt: Ms
}

/** One paid invoice with each line's stage, its payments and its refunds so far. */
export async function refundView(
  db: MedcoreDb,
  invoiceId: Id
): Promise<RefundInvoiceView | null> {
  const invoice = await db.invoices.get(invoiceId)
  if (!invoice) return null
  const [lines, allPayments, refunds, creditNotes, accruals, patient] = await Promise.all([
    db.invoiceLines.where("invoiceId").equals(invoiceId).toArray(),
    db.payments.where("invoiceId").equals(invoiceId).toArray(),
    db.refunds.where("invoiceId").equals(invoiceId).toArray(),
    db.creditNotes.where("invoiceId").equals(invoiceId).toArray(),
    db.feeShareAccruals.where("invoiceId").equals(invoiceId).toArray(),
    db.patients.get(invoice.patientId),
  ])
  const payments = allPayments
    .filter((p) => p.status === "confirmed" || p.status === "refunded")
    .sort((a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id))
  const done = refunds.filter((r) => r.status === "completed")
  const refundedBy = new Map<Id, Poisha>()
  for (const r of done) refundedBy.set(r.paymentId, (refundedBy.get(r.paymentId) ?? 0) + r.amountP)

  const names = await doctorNames(db, accruals.map((a) => a.doctorId))
  const reversedIds = new Set(accruals.map((a) => a.reversalOfId).filter(Boolean))
  const withDoctor = (a: FeeShareAccrualRow) => ({ ...a, doctor: names.get(a.doctorId) })
  const reader = dbReader(db)
  const baskets = await db.basketLines.bulkGet(lines.map((l) => l.basketLineId ?? ""))
  const order = new Map<Id, number>()
  lines.forEach((line, index) => order.set(line.id, baskets[index]?.createdAt ?? line.createdAt))
  const views: RefundLineView[] = []
  for (const [index, line] of lines.entries()) {
    views.push({
      line,
      descriptionBn: baskets[index]?.descriptionBn,
      info: await lineStage(reader, line),
      accruals: accruals
        .filter((a) => a.invoiceLineId === line.id && !a.reversalOfId && !reversedIds.has(a.id))
        .map(withDoctor),
    })
  }
  views.sort(
    (a, b) =>
      (order.get(a.line.id) ?? 0) - (order.get(b.line.id) ?? 0) ||
      a.line.description.localeCompare(b.line.description)
  )

  const approvals = new Map<Id, Names | undefined>()
  for (const r of done) {
    if (!r.approvalId || approvals.has(r.approvalId)) continue
    const approval = await db.approvals.get(r.approvalId)
    approvals.set(r.approvalId, await staffNames(db, approval?.approverId))
  }
  return {
    invoice,
    patient,
    payments,
    pool: payments.map((p) => ({
      id: p.id,
      tender: p.tender,
      amountP: p.amountP,
      refundedP: refundedBy.get(p.id) ?? 0,
    })),
    lines: views,
    creditNotes: creditNotes.sort((a, b) => a.createdAt - b.createdAt),
    refunds: done
      .sort((a, b) => a.createdAt - b.createdAt || a.refundNo.localeCompare(b.refundNo))
      .map((r) => ({ ...r, approver: r.approvalId ? approvals.get(r.approvalId) : undefined })),
    reversals: accruals.filter((a) => a.reversalOfId).map(withDoctor),
    paidAt: Math.max(invoice.createdAt, ...payments.map((p) => p.confirmedAt ?? p.requestedAt)),
  }
}

/** A patient's paid (or refunded) invoices at a branch, newest first. */
export async function paidInvoicesOf(
  db: MedcoreDb,
  patientId: Id,
  branch: BranchCode,
  limit = 6
): Promise<RefundInvoiceView[]> {
  const invoices = (
    await db.invoices
      .where("patientId")
      .equals(patientId)
      .filter(
        (invoice) =>
          invoice.branchId === branch &&
          (invoice.status === "paid" || invoice.status === "refunded")
      )
      .toArray()
  )
    .sort((a, b) => b.createdAt - a.createdAt || b.invoiceNo.localeCompare(a.invoiceNo))
    .slice(0, limit)
  const views: RefundInvoiceView[] = []
  for (const invoice of invoices) {
    const view = await refundView(db, invoice.id)
    if (view) views.push(view)
  }
  return views
}

/** An invoice at this branch by its number (as printed on the receipt). */
export async function invoiceByNo(
  db: MedcoreDb,
  invoiceNo: string,
  branch: BranchCode
): Promise<InvoiceRow | undefined> {
  const invoice = await db.invoices.where("invoiceNo").equals(invoiceNo.trim().toUpperCase()).first()
  return invoice && invoice.branchId === branch ? invoice : undefined
}

export type RefundRequest = {
  appointment: AppointmentRow
  patient?: PatientRow
  doctor?: Names
  line: InvoiceLineRow
  invoice: InvoiceRow
}

/**
 * "Refund requested" (plan §9): appointments cancelled after a doctor delay
 * with "refund" as the patient's choice, whose consultation fee was paid and
 * is not refunded yet. The front desk records the choice; the cashier pays
 * it back here in one step.
 */
export async function refundRequestsAt(
  db: MedcoreDb,
  branch: BranchCode
): Promise<RefundRequest[]> {
  const cancelled = await db.appointments
    .where("status")
    .equals("cancelled")
    .filter((a) => a.branchId === branch && a.delayChoice === "refund" && !!a.feeBasketLineId)
    .toArray()
  const out: RefundRequest[] = []
  for (const appointment of cancelled) {
    const line = await db.invoiceLines
      .where("basketLineId")
      .equals(appointment.feeBasketLineId!)
      .filter((l) => l.status === "active")
      .first()
    if (!line) continue
    const invoice = await db.invoices.get(line.invoiceId)
    if (!invoice || invoice.status !== "paid") continue
    const [patient, names] = await Promise.all([
      db.patients.get(appointment.patientId),
      doctorNames(db, [appointment.doctorId]),
    ])
    out.push({ appointment, patient, doctor: names.get(appointment.doctorId), line, invoice })
  }
  return out.sort((a, b) => b.appointment.updatedAt - a.appointment.updatedAt)
}

export type RecentRefund = {
  creditNoteId: Id
  creditNoteNo?: string
  invoice?: InvoiceRow
  patient?: PatientRow
  refunds: RefundRow[]
  amountP: Poisha
  at: Ms
}

/** Refunds paid at a branch today, one row per credit note, newest first. */
export async function refundsTodayAt(
  db: MedcoreDb,
  branch: BranchCode,
  today: string
): Promise<RecentRefund[]> {
  const start = atDhaka(today, "00:00")
  const refunds = (await db.refunds.where("status").equals("completed").toArray()).filter(
    (r) => r.createdAt >= start
  )
  const groups = new Map<Id, RefundRow[]>()
  for (const r of refunds) {
    const key = r.creditNoteId ?? r.id
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const out: RecentRefund[] = []
  for (const [creditNoteId, rows] of groups) {
    const invoice = await db.invoices.get(rows[0].invoiceId)
    if (!invoice || invoice.branchId !== branch) continue
    const creditNote = await db.creditNotes.get(creditNoteId)
    out.push({
      creditNoteId,
      creditNoteNo: creditNote?.creditNoteNo,
      invoice,
      patient: await db.patients.get(invoice.patientId),
      refunds: rows,
      amountP: rows.reduce((sum, r) => sum + r.amountP, 0),
      at: Math.max(...rows.map((r) => r.createdAt)),
    })
  }
  return out.sort((a, b) => b.at - a.at)
}
