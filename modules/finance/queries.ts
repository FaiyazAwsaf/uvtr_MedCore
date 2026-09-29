import { companies, type BranchCode, type CompanyCode } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { addDaysISO, atDhaka, dhakaDate } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import type {
  AccountingExportRow,
  CorporateClientRow,
  CorporateContractRow,
  CorporateEmployeeRow,
  CreditNoteRow,
  FeeShareAccrualRow,
  FeeShareContractRow,
  Id,
  InvoiceRow,
  ISODate,
  MfsSettlementRow,
  PatientRow,
  PayableRow,
  PaymentRow,
  Poisha,
  ShiftRow,
  ThreeWayMatchRow,
  VendorInvoiceRow,
} from "@/core/db/schema"
import { isMfs } from "@/modules/billing/pricing"
import { shiftSummary, type ShiftSummary } from "@/modules/billing/queries"

import { buildJournal, type Journal } from "./journal"
import { loadJournalRecords, readerOf } from "./records"
import {
  acceptedByPoLine,
  agingBucket,
  AGING_BUCKETS,
  corporateMoney,
  daysOverdue,
  handMatchCandidates,
  matchedPaymentIds,
  payAtPoPriceP,
  reproduceAccrual,
  statementTotals,
  type AgingBucket,
  type CandidateKind,
  type CorporateMoney,
  type ReproduceIssue,
  type SettlementLine,
  type StatementTotals,
} from "./rules"

/**
 * Read models for the finance screens, run inside `useLiveQuery` so a
 * payment taken at any counter, in any window, shows here within the same
 * tick. Finance personas are network level: every query takes an optional
 * branch filter (null means all branches).
 */

export type Names = { en: string; bn: string }

async function staffNames(db: MedcoreDb, ids: (Id | undefined)[]): Promise<Map<Id, Names>> {
  const unique = [...new Set(ids.filter((id): id is Id => !!id))]
  const rows = await db.staff.bulkGet(unique)
  const out = new Map<Id, Names>()
  rows.forEach((row) => {
    if (row) out.set(row.id, { en: row.nameEn, bn: row.nameBn })
  })
  return out
}

async function patientsById(db: MedcoreDb, ids: Id[]): Promise<Map<Id, PatientRow>> {
  const unique = [...new Set(ids)]
  const rows = await db.patients.bulkGet(unique)
  const out = new Map<Id, PatientRow>()
  rows.forEach((row) => {
    if (row) out.set(row.id, row)
  })
  return out
}

async function invoicesById(db: MedcoreDb, ids: Id[]): Promise<Map<Id, InvoiceRow>> {
  const unique = [...new Set(ids)]
  const rows = await db.invoices.bulkGet(unique)
  const out = new Map<Id, InvoiceRow>()
  rows.forEach((row) => {
    if (row) out.set(row.id, row)
  })
  return out
}

const inBranch = (filter: BranchCode | null, branch: BranchCode | undefined | null) =>
  !filter || branch === filter

/* ------------------------------------------------------------------ *
 * Cash control (/finance)
 * ------------------------------------------------------------------ */

export type OpenShiftView = {
  shift: ShiftRow
  cashier?: Names
  summary: ShiftSummary
}

export type ClosedShiftView = {
  shift: ShiftRow
  cashier?: Names
  approver?: Names
  reason?: string
}

export type QueuedPayment = {
  payment: PaymentRow
  invoiceNo?: string
  patient?: PatientRow
}

export type UnmatchedLine = {
  settlementId: Id
  provider: MfsSettlementRow["provider"]
  date: ISODate
  line: SettlementLine
}

export type OfflineReceipt = { invoice: InvoiceRow; patient?: PatientRow }

export type CashControl = {
  openShifts: OpenShiftView[]
  closedShifts: ClosedShiftView[]
  queue: QueuedPayment[]
  unmatched: UnmatchedLine[]
  offline: OfflineReceipt[]
  kpi: {
    drawerCashP: Poisha
    openShifts: number
    pendingMfsP: Poisha
    pendingMfs: number
    timedOut: number
    unmatchedLines: number
    unmatchedP: Poisha
    varianceWeekP: Poisha
    varianceShifts: number
  }
}

export async function cashControl(
  db: MedcoreDb,
  branch: BranchCode | null,
  today: ISODate
): Promise<CashControl> {
  const shifts = (await db.shifts.toArray()).filter((s) => inBranch(branch, s.branchId))
  const open = shifts
    .filter((s) => s.status !== "closed")
    .sort((a, b) => a.branchId.localeCompare(b.branchId) || a.openedAt - b.openedAt)
  const since14 = atDhaka(addDaysISO(today, -13), "00:00")
  const since7 = atDhaka(addDaysISO(today, -6), "00:00")
  const closed = shifts
    .filter((s) => s.status === "closed" && (s.closedAt ?? 0) >= since14)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))

  const approvals = await db.approvals.bulkGet(closed.map((s) => s.varianceApprovalId ?? ""))
  const names = await staffNames(db, [
    ...shifts.map((s) => s.cashierId),
    ...approvals.map((a) => a?.approverId),
  ])

  const openShifts: OpenShiftView[] = []
  for (const shift of open) {
    openShifts.push({ shift, cashier: names.get(shift.cashierId), summary: await shiftSummary(db, shift) })
  }
  const closedShifts: ClosedShiftView[] = closed.map((shift, index) => ({
    shift,
    cashier: names.get(shift.cashierId),
    approver: approvals[index]?.approverId ? names.get(approvals[index]!.approverId!) : undefined,
    reason: approvals[index]?.reason,
  }))

  /* bKash and Nagad not confirmed: waiting, timed out or failed */
  const waiting = (
    await db.payments.where("status").anyOf(["pending", "timeout", "failed"]).toArray()
  )
    .filter((p) => isMfs(p.tender) && inBranch(branch, p.branchId))
    .sort((a, b) => b.requestedAt - a.requestedAt)
  const invoices = await invoicesById(db, waiting.map((p) => p.invoiceId))
  const patients = await patientsById(db, waiting.map((p) => p.patientId))
  const queue = waiting.map((payment) => ({
    payment,
    invoiceNo: invoices.get(payment.invoiceId)?.invoiceNo,
    patient: patients.get(payment.patientId),
  }))

  /* Settlement lines no payment explains yet (imported files; network wide) */
  const unmatched: UnmatchedLine[] = []
  for (const file of await db.mfsSettlements.toArray()) {
    if (file.status === "pending-import") continue
    for (const line of file.lines) {
      if (!line.matchedPaymentId) {
        unmatched.push({ settlementId: file.id, provider: file.provider, date: file.date, line })
      }
    }
  }
  unmatched.sort((a, b) => b.line.at - a.line.at)

  /* Invoices numbered from an offline range */
  const offlineInvoices = (await db.invoices.toArray())
    .filter((i) => (i.offline || i.invoiceNo.includes("-OFF-")) && inBranch(branch, i.branchId))
    .sort((a, b) => b.createdAt - a.createdAt)
  const offlinePatients = await patientsById(db, offlineInvoices.map((i) => i.patientId))

  const week = shifts.filter((s) => s.status === "closed" && (s.closedAt ?? 0) >= since7 && !!s.varianceP)
  return {
    openShifts,
    closedShifts,
    queue,
    unmatched,
    offline: offlineInvoices.map((invoice) => ({ invoice, patient: offlinePatients.get(invoice.patientId) })),
    kpi: {
      drawerCashP: openShifts.reduce((sum, s) => sum + s.summary.expectedCashP, 0),
      openShifts: openShifts.length,
      pendingMfsP: waiting.filter((p) => p.status === "pending").reduce((s, p) => s + p.amountP, 0),
      pendingMfs: waiting.filter((p) => p.status === "pending").length,
      timedOut: waiting.filter((p) => p.status === "timeout").length,
      unmatchedLines: unmatched.length,
      unmatchedP: unmatched.reduce((sum, u) => sum + u.line.amountP, 0),
      varianceWeekP: week.reduce((sum, s) => sum + Math.abs(s.varianceP ?? 0), 0),
      varianceShifts: week.length,
    },
  }
}

/* ------------------------------------------------------------------ *
 * MFS settlement (/finance/mfs)
 * ------------------------------------------------------------------ */

export type SettlementSummary = {
  file: MfsSettlementRow
  matched: number
  unmatched: number
  totalP: Poisha
}

export async function settlementFiles(db: MedcoreDb): Promise<SettlementSummary[]> {
  const files = await db.mfsSettlements.toArray()
  return files
    .map((file) => ({
      file,
      matched: file.lines.filter((l) => l.matchedPaymentId).length,
      unmatched: file.lines.filter((l) => !l.matchedPaymentId).length,
      totalP: file.lines.reduce((sum, l) => sum + l.amountP, 0),
    }))
    .sort(
      (a, b) =>
        b.file.date.localeCompare(a.file.date) ||
        a.file.provider.localeCompare(b.file.provider)
    )
}

export type PaymentBrief = {
  payment: PaymentRow
  invoiceNo?: string
  patient?: PatientRow
}

export type SettlementLineView = {
  line: SettlementLine
  payment?: PaymentBrief
  /** "auto" or the staff member who matched it by hand */
  matchedBy?: "auto" | Names
  candidates: (PaymentBrief & { kind: CandidateKind })[]
}

export type SettlementDetail = {
  file: MfsSettlementRow
  lines: SettlementLineView[]
}

export async function settlementDetail(
  db: MedcoreDb,
  settlementId: Id
): Promise<SettlementDetail | null> {
  const file = await db.mfsSettlements.get(settlementId)
  if (!file) return null
  const all = await db.mfsSettlements.toArray()
  const taken = matchedPaymentIds(all)
  const needCandidates = file.status !== "pending-import" && file.lines.some((l) => !l.matchedPaymentId)
  const pool = needCandidates
    ? (await db.payments.where("tender").anyOf([file.provider, "cash"]).toArray())
    : []
  const matchedIds = file.lines.map((l) => l.matchedPaymentId).filter((id): id is Id => !!id)
  const matchedPayments = await db.payments.bulkGet(matchedIds)
  const byId = new Map<Id, PaymentRow>()
  for (const p of [...pool, ...matchedPayments]) if (p) byId.set(p.id, p)

  const candidateLists = file.lines.map((line) =>
    line.matchedPaymentId || !needCandidates ? [] : handMatchCandidates(file, line, pool, taken)
  )
  const involved = [...matchedIds, ...candidateLists.flat().map((c) => c.payment.id)]
  const payments = involved.map((id) => byId.get(id)).filter((p): p is PaymentRow => !!p)
  const invoices = await invoicesById(db, payments.map((p) => p.invoiceId))
  const patients = await patientsById(db, payments.map((p) => p.patientId))
  const brief = (payment: PaymentRow): PaymentBrief => ({
    payment,
    invoiceNo: invoices.get(payment.invoiceId)?.invoiceNo,
    patient: patients.get(payment.patientId),
  })
  const names = await staffNames(
    db,
    file.lines.map((l) => (l.matchedBy && l.matchedBy !== "auto" ? l.matchedBy : undefined))
  )

  return {
    file,
    lines: file.lines
      .map((line, index) => {
        const payment = line.matchedPaymentId ? byId.get(line.matchedPaymentId) : undefined
        const matchedBy: SettlementLineView["matchedBy"] = line.matchedPaymentId
          ? !line.matchedBy || line.matchedBy === "auto"
            ? "auto"
            : names.get(line.matchedBy)
          : undefined
        return {
          line,
          payment: payment ? brief(payment) : undefined,
          matchedBy,
          candidates: candidateLists[index].map((c) => ({ ...brief(c.payment), kind: c.kind })),
        }
      })
      .sort((a, b) => a.line.at - b.line.at),
  }
}

/* ------------------------------------------------------------------ *
 * Three-way match worklist (/finance/match)
 * ------------------------------------------------------------------ */

export type MatchDiffView = ThreeWayMatchRow["diffs"][number] & { item: string }

export type MatchView = {
  match: ThreeWayMatchRow
  poNo: string
  branchId?: BranchCode
  vendor?: string
  grnNos: string[]
  vendorInvoice?: VendorInvoiceRow
  diffs: MatchDiffView[]
  atPoPriceP: Poisha
  payable?: PayableRow
  resolvedBy?: Names
  approver?: Names
}

export async function matchWorklist(
  db: MedcoreDb,
  branch: BranchCode | null
): Promise<{ open: MatchView[]; resolved: MatchView[]; matched: number }> {
  const matches = await db.threeWayMatches.toArray()
  const views: MatchView[] = []
  for (const match of matches) {
    if (match.status === "matched") continue
    const po = await db.purchaseOrders.get(match.poId)
    if (!inBranch(branch, po?.branchId)) continue
    const [vendorInvoice, grns, poLines, payables] = await Promise.all([
      db.vendorInvoices.get(match.vendorInvoiceId),
      db.grns.bulkGet(match.grnIds),
      db.poLines.where("poId").equals(match.poId).toArray(),
      db.payables.where("vendorInvoiceId").equals(match.vendorInvoiceId).toArray(),
    ])
    const vendor = po ? await db.vendors.get(po.vendorId) : undefined
    const grnLines = (
      await Promise.all(match.grnIds.map((id) => db.grnLines.where("grnId").equals(id).toArray()))
    ).flat()
    const brands = await db.brands.bulkGet(poLines.map((l) => l.brandId))
    const itemOf = new Map(
      poLines.map((line, index) => [
        line.id,
        brands[index] ? `${brands[index]!.name} ${brands[index]!.strength}`.trim() : line.brandId,
      ])
    )
    const approval = match.approvalId ? await db.approvals.get(match.approvalId) : undefined
    const names = await staffNames(db, [match.resolvedBy, approval?.approverId])
    views.push({
      match,
      poNo: po?.poNo ?? "",
      branchId: po?.branchId,
      vendor: vendor?.name,
      grnNos: grns.map((g) => g?.grnNo ?? "").filter(Boolean),
      vendorInvoice,
      diffs: match.diffs.map((diff) => ({ ...diff, item: itemOf.get(diff.poLineId) ?? diff.poLineId })),
      atPoPriceP: vendorInvoice
        ? payAtPoPriceP(vendorInvoice.lines, poLines, acceptedByPoLine(grnLines, match.grnIds))
        : 0,
      payable: payables[0],
      resolvedBy: match.resolvedBy ? names.get(match.resolvedBy) : undefined,
      approver: approval?.approverId ? names.get(approval.approverId) : undefined,
    })
  }
  const open = views
    .filter((v) => v.match.status === "mismatch")
    .sort((a, b) => a.match.createdAt - b.match.createdAt)
  const resolved = views
    .filter((v) => v.match.status === "resolved")
    .sort((a, b) => (b.match.resolvedAt ?? b.match.updatedAt) - (a.match.resolvedAt ?? a.match.updatedAt))
  return { open, resolved, matched: matches.filter((m) => m.status === "matched").length }
}

/* ------------------------------------------------------------------ *
 * Payables (/finance/payables)
 * ------------------------------------------------------------------ */

export type PayableView = {
  payable: PayableRow
  vendor?: string
  poNo?: string
  branchId?: BranchCode
  vendorInvoice?: VendorInvoiceRow
  overdueDays: number
  bucket: AgingBucket
}

export type PayablesView = {
  rows: PayableView[]
  aging: Record<AgingBucket, { amountP: Poisha; count: number }>
  byVendor: { vendor: string; amountP: Poisha; count: number }[]
  openP: Poisha
}

export async function payablesView(
  db: MedcoreDb,
  today: ISODate,
  branch: BranchCode | null
): Promise<PayablesView> {
  const payables = await db.payables.toArray()
  const pos = await db.purchaseOrders.bulkGet([...new Set(payables.map((p) => p.poId))])
  const poById = new Map(pos.filter(Boolean).map((po) => [po!.id, po!]))
  const vendors = await db.vendors.toArray()
  const vendorById = new Map(vendors.map((v) => [v.id, v]))
  const invoices = await db.vendorInvoices.bulkGet(payables.map((p) => p.vendorInvoiceId))
  const rows: PayableView[] = payables
    .map((payable, index) => {
      const po = poById.get(payable.poId)
      return {
        payable,
        vendor: vendorById.get(payable.vendorId)?.name,
        poNo: po?.poNo,
        branchId: po?.branchId,
        vendorInvoice: invoices[index],
        overdueDays: payable.status === "paid" ? 0 : Math.max(0, daysOverdue(payable.dueDate, today)),
        bucket: agingBucket(payable.dueDate, today),
      }
    })
    .filter((row) => inBranch(branch, row.branchId))
    .sort(
      (a, b) =>
        (a.payable.status === "paid" ? 1 : 0) - (b.payable.status === "paid" ? 1 : 0) ||
        a.payable.dueDate.localeCompare(b.payable.dueDate) ||
        a.payable.id.localeCompare(b.payable.id)
    )
  const aging = Object.fromEntries(AGING_BUCKETS.map((b) => [b, { amountP: 0, count: 0 }])) as PayablesView["aging"]
  const vendorTotals = new Map<string, { amountP: number; count: number }>()
  let openP = 0
  for (const row of rows) {
    if (row.payable.status === "paid") continue
    aging[row.bucket].amountP += row.payable.amountP
    aging[row.bucket].count += 1
    openP += row.payable.amountP
    const key = row.vendor ?? row.payable.vendorId
    const total = vendorTotals.get(key) ?? { amountP: 0, count: 0 }
    total.amountP += row.payable.amountP
    total.count += 1
    vendorTotals.set(key, total)
  }
  return {
    rows,
    aging,
    byVendor: [...vendorTotals.entries()]
      .map(([vendor, total]) => ({ vendor, ...total }))
      .sort((a, b) => b.amountP - a.amountP),
    openP,
  }
}

/* ------------------------------------------------------------------ *
 * Fee-share statement (/finance/fee-share)
 * ------------------------------------------------------------------ */

export type FeeShareDoctorOption = { doctorId: Id; names: Names; months: string[] }

/** Consultants with fee share, and the months each has lines in (newest first). */
export async function feeShareDoctors(db: MedcoreDb): Promise<FeeShareDoctorOption[]> {
  const accruals = await db.feeShareAccruals.toArray()
  const months = new Map<Id, Set<string>>()
  for (const a of accruals) {
    const set = months.get(a.doctorId) ?? new Set<string>()
    set.add(a.month)
    months.set(a.doctorId, set)
  }
  const doctors = await db.doctors.bulkGet([...months.keys()])
  const names = await staffNames(db, doctors.map((d) => d?.staffId))
  const out: FeeShareDoctorOption[] = []
  for (const doctor of doctors) {
    if (!doctor) continue
    out.push({
      doctorId: doctor.id,
      names: names.get(doctor.staffId) ?? { en: doctor.id, bn: doctor.id },
      months: [...(months.get(doctor.id) ?? [])].sort().reverse(),
    })
  }
  return out.sort((a, b) => a.names.en.localeCompare(b.names.en))
}

export type StatementLine = {
  accrual: FeeShareAccrualRow
  invoice?: InvoiceRow
  description?: string
  /** Rule value (share %) for percentage bases */
  pct?: number
  reverses?: { invoiceNo?: string; at: number }
  reproduce: { ok: true } | { ok: false; issue: ReproduceIssue }
}

export type FeeShareStatement = {
  doctorId: Id
  names?: Names
  bmdcNo?: string
  month: string
  versions: number[]
  whtPct?: number
  lines: StatementLine[]
  totals: StatementTotals
  reproduced: number
  failed: StatementLine[]
}

export async function feeShareStatement(
  db: MedcoreDb,
  doctorId: Id,
  month: string
): Promise<FeeShareStatement> {
  const accruals = (
    await db.feeShareAccruals.where("[doctorId+month]").equals([doctorId, month]).toArray()
  ).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const doctor = await db.doctors.get(doctorId)
  const names = doctor ? await staffNames(db, [doctor.staffId]) : new Map<Id, Names>()
  const contracts = await db.feeShareContracts.where("doctorId").equals(doctorId).toArray()
  const contractById = new Map<Id, FeeShareContractRow>(contracts.map((c) => [c.id, c]))
  const lines = await db.invoiceLines.bulkGet(accruals.map((a) => a.invoiceLineId))
  const invoices = await invoicesById(db, accruals.map((a) => a.invoiceId))
  const originalIds = accruals.map((a) => a.reversalOfId).filter((id): id is Id => !!id)
  const originals = await db.feeShareAccruals.bulkGet(originalIds)
  const originalById = new Map(originals.filter(Boolean).map((o) => [o!.id, o!]))

  const statementLines: StatementLine[] = accruals.map((accrual, index) => {
    const line = lines[index]
    const contract = contractById.get(accrual.contractId)
    const result = reproduceAccrual(accrual, {
      line,
      contract,
      original: accrual.reversalOfId ? originalById.get(accrual.reversalOfId) : undefined,
    })
    const rule = contract?.rules.find((r) => r.serviceType === (line?.serviceType ?? accrual.serviceType))
    const original = accrual.reversalOfId ? originalById.get(accrual.reversalOfId) : undefined
    return {
      accrual,
      invoice: invoices.get(accrual.invoiceId),
      description: line?.description,
      pct: rule && rule.basis !== "fixed" ? rule.value : undefined,
      reverses: original
        ? { invoiceNo: invoices.get(original.invoiceId)?.invoiceNo, at: original.at }
        : undefined,
      reproduce: result.ok ? { ok: true } : { ok: false, issue: result.issue },
    }
  })
  const versions = [...new Set(accruals.map((a) => a.contractVersion))].sort((a, b) => a - b)
  const latest = contracts
    .filter((c) => versions.includes(c.contractVersion))
    .sort((a, b) => b.contractVersion - a.contractVersion)[0]
  const failed = statementLines.filter((l) => !l.reproduce.ok)
  return {
    doctorId,
    names: doctor ? names.get(doctor.staffId) : undefined,
    bmdcNo: doctor?.bmdcNo,
    month,
    versions,
    whtPct: latest?.whtPct,
    lines: statementLines,
    totals: statementTotals(accruals),
    reproduced: statementLines.length - failed.length,
    failed,
  }
}

/* ------------------------------------------------------------------ *
 * Corporate billing (/finance/corporate)
 * ------------------------------------------------------------------ */

export type RosterEntry = {
  employee: CorporateEmployeeRow
  patient?: PatientRow
}

export type CorporateClientView = {
  client: CorporateClientRow
  contract?: CorporateContractRow
  roster: RosterEntry[]
  months: string[]
}

export async function corporateClients(db: MedcoreDb): Promise<CorporateClientView[]> {
  const clients = await db.corporateClients.toArray()
  const invoices = (await db.invoices.where("status").anyOf(["paid", "partial", "unpaid", "refunded"]).toArray())
    .filter((i) => i.payerType === "corporate" && !!i.corporateClientId)
  const out: CorporateClientView[] = []
  for (const client of clients.sort((a, b) => a.name.en.localeCompare(b.name.en))) {
    const contracts = await db.corporateContracts.where("clientId").equals(client.id).toArray()
    const contract =
      contracts.find((c) => c.status === "active") ??
      contracts.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
    const employees = await db.corporateEmployees.where("clientId").equals(client.id).toArray()
    const patients = await patientsById(
      db,
      employees.map((e) => e.patientId).filter((id): id is Id => !!id)
    )
    const months = [
      ...new Set(invoices.filter((i) => i.corporateClientId === client.id).map((i) => i.date.slice(0, 7))),
    ]
      .sort()
      .reverse()
    out.push({
      client,
      contract,
      roster: employees
        .map((employee) => ({
          employee,
          patient: employee.patientId ? patients.get(employee.patientId) : undefined,
        }))
        .sort(
          (a, b) =>
            a.employee.employeeNo.localeCompare(b.employee.employeeNo) ||
            (a.employee.relation === "employee" ? 0 : 1) - (b.employee.relation === "employee" ? 0 : 1)
        ),
      months,
    })
  }
  return out
}

export type CorporateStatementLine = {
  invoice: InvoiceRow
  patient?: PatientRow
  employee?: CorporateEmployeeRow
  services: string[]
  money: CorporateMoney
  disputes: CreditNoteRow[]
}

export type CorporateStatement = {
  clientId: Id
  month: string
  lines: CorporateStatementLine[]
  totals: CorporateMoney
}

export async function corporateStatement(
  db: MedcoreDb,
  clientId: Id,
  month: string
): Promise<CorporateStatement> {
  const invoices = (await db.invoices.toArray())
    .filter(
      (i) =>
        i.payerType === "corporate" &&
        i.corporateClientId === clientId &&
        i.date.slice(0, 7) === month &&
        i.status !== "void"
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNo.localeCompare(b.invoiceNo))
  const patients = await patientsById(db, invoices.map((i) => i.patientId))
  const employees = await db.corporateEmployees.where("clientId").equals(clientId).toArray()
  const lines: CorporateStatementLine[] = []
  for (const invoice of invoices) {
    const [payments, refunds, notes, invoiceLines] = await Promise.all([
      db.payments.where("invoiceId").equals(invoice.id).toArray(),
      db.refunds.where("invoiceId").equals(invoice.id).toArray(),
      db.creditNotes.where("invoiceId").equals(invoice.id).toArray(),
      db.invoiceLines.where("invoiceId").equals(invoice.id).toArray(),
    ])
    const disputes = notes
      .filter((n) => n.kind === "corporate-dispute")
      .sort((a, b) => a.createdAt - b.createdAt)
    const patient = patients.get(invoice.patientId)
    lines.push({
      invoice,
      patient,
      employee:
        employees.find((e) => e.id === patient?.corporateEmployeeId) ??
        employees.find((e) => e.patientId === invoice.patientId),
      services: invoiceLines.map((l) => l.description),
      money: corporateMoney({ totalP: invoice.totalP, payments, refunds, disputes }),
      disputes,
    })
  }
  const totals: CorporateMoney = { totalP: 0, coPayP: 0, companyShareP: 0, creditNotesP: 0, dueP: 0 }
  for (const line of lines) {
    totals.totalP += line.money.totalP
    totals.coPayP += line.money.coPayP
    totals.companyShareP += line.money.companyShareP
    totals.creditNotesP += line.money.creditNotesP
    totals.dueP += line.money.dueP
  }
  return { clientId, month, lines, totals }
}

/* ------------------------------------------------------------------ *
 * Accounting export (/finance/export)
 * ------------------------------------------------------------------ */

/** The day's journal for one company, as the export command will rebuild it. */
export async function journalPreview(
  db: MedcoreDb,
  date: ISODate,
  companyId: CompanyCode
): Promise<Journal> {
  return buildJournal(await loadJournalRecords(readerOf(db), date), companyId)
}

export type ExportHistoryRow = { row: AccountingExportRow; by?: Names }

export async function exportHistory(db: MedcoreDb): Promise<ExportHistoryRow[]> {
  const rows = (await db.accountingExports.toArray()).sort(
    (a, b) => b.createdAt - a.createdAt || a.companyId.localeCompare(b.companyId)
  )
  const names = await staffNames(db, rows.map((r) => r.exportedBy))
  return rows.map((row) => ({ row, by: names.get(row.exportedBy) }))
}

export const COMPANY_CODES: CompanyCode[] = companies.map((c) => c.code)

/** The cash-variance threshold shown on the closed-shift card. */
export const VARIANCE_THRESHOLD_P = rules.cashVarianceThresholdP

/** Today on the demo clock, for screens. */
export function dayOf(ms: number): ISODate {
  return dhakaDate(ms)
}
