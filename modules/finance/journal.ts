import type { CompanyCode } from "@/config/brand.config"
import type { ISODate, Poisha, ServiceType, Tender } from "@/core/db/schema"

import { csvCell } from "./csv"
import { financeEn } from "./i18n/en"

/**
 * The daily accounting journal per company (plan §3.13, simulated export):
 * built from the day's records only, as balanced double entries. Pure, so
 * the preview, the export command and the tests all use the same postings.
 *
 * - Money received: Dr the tender (cash, card clearing, bKash, Nagad,
 *   corporate receivable), Cr patient receivable.
 * - Invoices issued: Dr patient receivable, Cr revenue by service type (the
 *   lines' net). What was billed but not yet received stays in patient
 *   receivable; the two receivable postings are netted into one row.
 * - Refunds and credit notes: Dr revenue by the lines they credit, Cr the
 *   tender refunded (or corporate receivable for a dispute credit note).
 * - Fee share: Dr fee-share expense, Cr consultant payable and WHT payable
 *   (reversals post negative amounts).
 * - Inpatient deposits: Dr the tender, Cr patient deposits.
 * - Vendor payables created: Dr inventory, Cr vendor payable; paid: Dr vendor
 *   payable, Cr bank.
 */

export type AccountKey =
  | "cash"
  | "card"
  | "bkash"
  | "nagad"
  | "bank"
  | "patientReceivable"
  | "corporateReceivable"
  | "inventory"
  | "vendorPayable"
  | "consultantPayable"
  | "whtPayable"
  | "patientDeposits"
  | "feeShareExpense"
  | `revenue.${ServiceType}`

const REVENUE_CODE: Record<ServiceType, string> = {
  consultation: "4110",
  "follow-up": "4120",
  lab: "4210",
  "lab-reporting": "4220",
  imaging: "4310",
  "imaging-reporting": "4320",
  procedure: "4410",
  medicine: "4510",
  bed: "4610",
  "inpatient-visit": "4620",
  other: "4910",
}

const ACCOUNT_CODE: Record<Exclude<AccountKey, `revenue.${string}`>, string> = {
  cash: "1110",
  card: "1120",
  bkash: "1131",
  nagad: "1132",
  bank: "1140",
  patientReceivable: "1210",
  corporateReceivable: "1220",
  inventory: "1310",
  vendorPayable: "2110",
  consultantPayable: "2120",
  whtPayable: "2130",
  patientDeposits: "2140",
  feeShareExpense: "5110",
}

/** Chart-of-accounts code (simulated) for an account. */
export function accountCode(account: AccountKey): string {
  if (account.startsWith("revenue.")) {
    return REVENUE_CODE[account.slice("revenue.".length) as ServiceType] ?? "4990"
  }
  return ACCOUNT_CODE[account as Exclude<AccountKey, `revenue.${string}`>]
}

/** The ledger account money in a tender lands in. */
export function tenderAccount(tender: Tender): AccountKey {
  switch (tender) {
    case "cash":
      return "cash"
    case "card":
      return "card"
    case "bkash":
      return "bkash"
    case "nagad":
      return "nagad"
    case "corporate":
      return "corporateReceivable"
    case "deposit":
      return "patientDeposits"
  }
}

export type JournalSection =
  | "receipts"
  | "revenue"
  | "receivable"
  | "refunds"
  | "feeShare"
  | "deposits"
  | "purchases"
  | "vendorPayments"

export const JOURNAL_SECTIONS: readonly JournalSection[] = [
  "receipts",
  "revenue",
  "receivable",
  "refunds",
  "feeShare",
  "deposits",
  "purchases",
  "vendorPayments",
]

/* ---------------- The day's records, per company ---------------- */

export type JournalInvoice = {
  companyId: CompanyCode
  invoiceNo: string
  lines: { serviceType: ServiceType; netP: Poisha }[]
}
export type JournalPayment = { companyId: CompanyCode; tender: Tender; amountP: Poisha }
export type JournalCreditNote = {
  companyId: CompanyCode
  creditNoteNo: string
  kind: "refund" | "corporate-dispute"
  lines: { serviceType: ServiceType; amountP: Poisha }[]
  /** Refund slices back to each tender (refund credit notes) */
  refunds: { tender: Tender; amountP: Poisha }[]
}
export type JournalAccrual = { companyId: CompanyCode; shareP: Poisha; whtP: Poisha }
export type JournalDeposit = { companyId: CompanyCode; tender: Tender; amountP: Poisha }
export type JournalPayable = { companyId: CompanyCode; amountP: Poisha }

export type JournalRecords = {
  date: ISODate
  invoices: JournalInvoice[]
  payments: JournalPayment[]
  creditNotes: JournalCreditNote[]
  accruals: JournalAccrual[]
  deposits: JournalDeposit[]
  payablesCreated: JournalPayable[]
  payablesPaid: JournalPayable[]
}

export type JournalRow = {
  key: string
  section: JournalSection
  account: AccountKey
  code: string
  debitP: Poisha
  creditP: Poisha
  /** Records posted into this row */
  count: number
}

export type Journal = {
  date: ISODate
  companyId: CompanyCode
  rows: JournalRow[]
  totalDebitP: Poisha
  totalCreditP: Poisha
  balanced: boolean
  /** Records behind the journal, for the preview's caption */
  counts: {
    invoices: number
    payments: number
    creditNotes: number
    accruals: number
    deposits: number
    payables: number
  }
}

/** Build one company's balanced journal for the day. */
export function buildJournal(records: JournalRecords, companyId: CompanyCode): Journal {
  const net = new Map<string, { section: JournalSection; account: AccountKey; amount: number; count: number }>()
  /** Positive amounts debit the account, negative amounts credit it. */
  const post = (section: JournalSection, account: AccountKey, amount: Poisha) => {
    if (!amount) return
    const key = `${section}:${account}`
    const row = net.get(key) ?? { section, account, amount: 0, count: 0 }
    row.amount += amount
    row.count += 1
    net.set(key, row)
  }
  const mine = <T extends { companyId: CompanyCode }>(rows: readonly T[]) =>
    rows.filter((row) => row.companyId === companyId)

  const invoices = mine(records.invoices)
  for (const invoice of invoices) {
    let billed = 0
    for (const line of invoice.lines) {
      post("revenue", `revenue.${line.serviceType}`, -line.netP)
      billed += line.netP
    }
    post("receivable", "patientReceivable", billed)
  }

  const payments = mine(records.payments)
  for (const payment of payments) {
    post("receipts", tenderAccount(payment.tender), payment.amountP)
    post("receivable", "patientReceivable", -payment.amountP)
  }

  const creditNotes = mine(records.creditNotes)
  for (const note of creditNotes) {
    let credited = 0
    for (const line of note.lines) {
      post("refunds", `revenue.${line.serviceType}`, line.amountP)
      credited += line.amountP
    }
    if (note.kind === "corporate-dispute") {
      post("refunds", "corporateReceivable", -credited)
      continue
    }
    let paidBack = 0
    for (const refund of note.refunds) {
      post("refunds", tenderAccount(refund.tender), -refund.amountP)
      paidBack += refund.amountP
    }
    // Anything credited but not paid back reduces what the patient owes.
    post("refunds", "patientReceivable", -(credited - paidBack))
  }

  const accruals = mine(records.accruals)
  for (const accrual of accruals) {
    post("feeShare", "feeShareExpense", accrual.shareP)
    post("feeShare", "consultantPayable", -(accrual.shareP - accrual.whtP))
    post("feeShare", "whtPayable", -accrual.whtP)
  }

  const deposits = mine(records.deposits)
  for (const deposit of deposits) {
    post("deposits", tenderAccount(deposit.tender), deposit.amountP)
    post("deposits", "patientDeposits", -deposit.amountP)
  }

  const created = mine(records.payablesCreated)
  for (const payable of created) {
    post("purchases", "inventory", payable.amountP)
    post("purchases", "vendorPayable", -payable.amountP)
  }
  const paid = mine(records.payablesPaid)
  for (const payable of paid) {
    post("vendorPayments", "vendorPayable", payable.amountP)
    post("vendorPayments", "bank", -payable.amountP)
  }

  const rows: JournalRow[] = [...net.entries()]
    .filter(([, row]) => row.amount !== 0)
    .map(([key, row]) => ({
      key,
      section: row.section,
      account: row.account,
      code: accountCode(row.account),
      debitP: row.amount > 0 ? row.amount : 0,
      creditP: row.amount < 0 ? -row.amount : 0,
      count: row.count,
    }))
    .sort(
      (a, b) =>
        JOURNAL_SECTIONS.indexOf(a.section) - JOURNAL_SECTIONS.indexOf(b.section) ||
        (b.debitP > 0 ? 1 : 0) - (a.debitP > 0 ? 1 : 0) ||
        a.code.localeCompare(b.code)
    )
  const totalDebitP = rows.reduce((sum, row) => sum + row.debitP, 0)
  const totalCreditP = rows.reduce((sum, row) => sum + row.creditP, 0)
  return {
    date: records.date,
    companyId,
    rows,
    totalDebitP,
    totalCreditP,
    balanced: totalDebitP === totalCreditP,
    counts: {
      invoices: invoices.length,
      payments: payments.length,
      creditNotes: creditNotes.length,
      accruals: accruals.length,
      deposits: deposits.length,
      payables: created.length + paid.length,
    },
  }
}

/* ---------------- CSV (the simulated accounting connector) ---------------- */

/** The export's file name, e.g. "C1-journal-2026-09-28.csv". */
export function journalFileName(companyId: CompanyCode, date: ISODate): string {
  return `${companyId}-journal-${date}.csv`
}

const takaText = (poisha: Poisha) => (poisha / 100).toFixed(2)

/** The account's name in English (accounting systems take the ledger in English). */
export function accountNameEn(account: AccountKey): string {
  if (account.startsWith("revenue.")) {
    const service = account.slice("revenue.".length) as ServiceType
    return `${financeEn.finance.export.revenuePrefix}: ${financeEn.finance.serviceType[service]}`
  }
  return financeEn.finance.accounts[account as keyof typeof financeEn.finance.accounts]
}

/** The journal as CSV: one row per account posting and a totals row. Dates DD-MM-YYYY, Latin digits. */
export function journalCsv(journal: Journal): string {
  const [y, m, d] = journal.date.split("-")
  const date = `${d}-${m}-${y}`
  const header = ["Date", "Company", "Account code", "Account", "Memo", "Debit", "Credit"]
  const lines = [header.join(",")]
  for (const row of journal.rows) {
    lines.push(
      [
        date,
        journal.companyId,
        row.code,
        accountNameEn(row.account),
        financeEn.finance.export.section[row.section],
        row.debitP ? takaText(row.debitP) : "",
        row.creditP ? takaText(row.creditP) : "",
      ]
        .map(csvCell)
        .join(",")
    )
  }
  lines.push(
    [date, journal.companyId, "", "", "Total", takaText(journal.totalDebitP), takaText(journal.totalCreditP)]
      .map(csvCell)
      .join(",")
  )
  return `${lines.join("\n")}\n`
}
