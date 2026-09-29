import { z } from "zod"

import { getCompany, type CompanyCode } from "@/config/brand.config"
import { createPayable } from "@/core/finance/payables"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import type { ApprovalKind, Id, MfsSettlementRow, Poisha, Refs } from "@/core/db/schema"
import { formatDmy } from "@/lib/i18n/format"
import { spreadDiscount } from "@/modules/billing/pricing"
import { nextCreditNoteNo } from "@/modules/billing/refund-tx"
import { moneyParams } from "@/modules/billing/settle"

import { financeBn } from "./i18n/bn"
import { financeEn } from "./i18n/en"
import { buildJournal, journalFileName } from "./journal"
import { loadJournalRecords } from "./records"
import {
  acceptedByPoLine,
  acceptNeedsCfo,
  autoMatchLines,
  bankTransferRef,
  candidateProblem,
  CFO_AUTHORITY,
  CORPORATE_CN_CFO_LIMIT_P,
  corporateMoney,
  creditNoteRoomP,
  holdsCfo,
  matchedPaymentIds,
  resolutionAmountP,
  settlementStatus,
  type Resolution,
} from "./rules"

/**
 * Finance commands (plan §9 finance routes). Each is ONE atomic commit: the
 * settlement file and every line it matched, the resolved match with its
 * payable, the credit note with the employee's restored limit, or nothing.
 * Every refusal is a `finance.rules.<CODE>` message in both languages.
 */

const idempotencyKey = z.string().min(8).max(80)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** The CFO's inline approval from the override dialog (plan §3.10, simulated PIN). */
const approvalInput = z
  .object({
    approverStaffId: z.string().min(1),
    reason: z.string().trim().min(1).max(300),
    pinVerified: z.literal(true),
  })
  .optional()

type ApprovalInput = z.output<typeof approvalInput>

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function providerParams(provider: MfsSettlementRow["provider"]): Record<string, string> {
  return {
    provider: financeEn.finance.provider[provider],
    providerBn: financeBn.finance.provider[provider],
  }
}

function dateParams(date: string, key = "date"): Record<string, string> {
  return { [key]: formatDmy(date, "en"), [`${key}Bn`]: formatDmy(date, "bn") }
}

/**
 * A CFO-level step (plan §3.10): the CFO decides herself; anyone else needs
 * her inline approval, recorded as an approval row by a second person who
 * holds the CFO's authority. Returns the approval id, or undefined when the
 * actor is the CFO.
 */
async function cfoApproval(
  tx: Tx,
  opts: {
    kind: ApprovalKind
    approval: ApprovalInput
    refs: Refs
    amountP: Poisha
    missingCode: string
    missingParams?: Record<string, string | number>
  }
): Promise<Id | undefined> {
  if (holdsCfo(tx.actor.authorities)) return undefined
  const { approval } = opts
  if (!approval) tx.reject(opts.missingCode, opts.missingParams ?? {})
  if (approval.approverStaffId === tx.actor.staffId) tx.reject("APPROVAL_SAME_PERSON", {})
  const approver = await tx.find("staff", approval.approverStaffId)
  if (!approver || !holdsCfo(approver.authorities)) {
    tx.reject("APPROVER_NOT_CFO", { name: approver?.nameEn ?? approval.approverStaffId })
  }
  const row = tx.insert("approvals", {
    kind: opts.kind,
    refs: opts.refs,
    requestedBy: tx.actor.staffId,
    approverId: approver.id,
    status: "approved",
    pinVerified: true,
    reason: approval.reason,
    amountP: opts.amountP,
    decidedAt: tx.now(),
  })
  tx.auditContext({ reason: approval.reason, approvedBy: approver.id })
  const what = opts.kind === "credit-note" ? "creditNote" : "mismatch"
  tx.emit("CfoApproved", {
    branchId: null,
    refs: { ...opts.refs, approvalId: row.id },
    params: {
      approver: approver.nameEn,
      approverBn: approver.nameBn,
      what: financeEn.finance.approvalKind[what],
      whatBn: financeBn.finance.approvalKind[what],
      ...moneyParams(opts.amountP),
    },
  })
  return row.id
}

/* ------------------------------------------------------------------ *
 * MFS settlement: import, match by hand, note
 * ------------------------------------------------------------------ */

/**
 * `finance.importSettlement` (simulated connector): the provider's file for a
 * day is taken in, and each line is matched automatically to a confirmed
 * payment of that provider with the same transaction id and amount. The file
 * is reconciled when every line matched, otherwise the rest wait on
 * /finance/mfs for a hand match or a note.
 */
export const importSettlement = defineCommand({
  name: "finance.importSettlement",
  roles: ["finance"],
  input: z.object({
    settlementId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const file = await tx.get("mfsSettlements", input.settlementId, {
      expectedVersion: input.expectedVersion,
    })
    if (file.status !== "pending-import") {
      tx.reject("SETTLEMENT_ALREADY_IMPORTED", { date: file.date })
    }
    const payments = await tx.list("payments", "tender", file.provider)
    const taken = matchedPaymentIds(await tx.all("mfsSettlements"))
    const { lines, matched, unmatched } = autoMatchLines(file.provider, file.lines, payments, taken)
    const status = settlementStatus(lines)
    await tx.update("mfsSettlements", file.id, { lines, status, importedAt: tx.now() })
    const refs = { settlementId: file.id }
    tx.emit("SettlementImported", {
      branchId: null,
      refs,
      params: { ...providerParams(file.provider), ...dateParams(file.date), matched, unmatched },
    })
    if (status === "reconciled") {
      tx.emit("SettlementReconciled", {
        branchId: null,
        refs,
        params: { ...providerParams(file.provider), ...dateParams(file.date), lines: lines.length },
      })
    }
    return { settlementId: file.id, status, matched, unmatched }
  },
})

/**
 * `finance.matchSettlementLine`: finance explains an unmatched line with a
 * payment received that day for the same amount, either the provider's own
 * payment or cash (bKash received by the hospital but recorded as cash at the
 * counter). The payment itself is not changed; the line records who matched it.
 */
export const matchSettlementLine = defineCommand({
  name: "finance.matchSettlementLine",
  roles: ["finance"],
  input: z.object({
    settlementId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    ref: z.string().min(1),
    paymentId: z.string().min(1),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const file = await tx.get("mfsSettlements", input.settlementId, {
      expectedVersion: input.expectedVersion,
    })
    if (file.status === "pending-import") tx.reject("SETTLEMENT_NOT_IMPORTED", {})
    const line = file.lines.find((l) => l.ref === input.ref)
    if (!line) tx.reject("LINE_NOT_FOUND", { ref: input.ref })
    if (line.matchedPaymentId) tx.reject("LINE_ALREADY_MATCHED", { ref: line.ref })
    const payment = await tx.find("payments", input.paymentId)
    if (!payment) tx.reject("PAYMENT_NOT_FOUND", {})
    const taken = matchedPaymentIds(await tx.all("mfsSettlements"))
    const problem = candidateProblem(file, line, payment, taken)
    if (problem) {
      tx.reject(problem, { ref: line.ref, amountP: line.amountP, date: file.date })
    }
    const lines = file.lines.map((l) =>
      l.ref === line.ref ? { ...l, matchedPaymentId: payment.id, matchedBy: tx.actor.staffId } : l
    )
    const status = settlementStatus(lines)
    await tx.update("mfsSettlements", file.id, { lines, status })
    const invoice = await tx.find("invoices", payment.invoiceId)
    tx.emit("SettlementLineMatched", {
      branchId: payment.branchId,
      refs: { settlementId: file.id, paymentId: payment.id, invoiceId: payment.invoiceId },
      params: {
        ...providerParams(file.provider),
        ref: line.ref,
        invoiceNo: invoice?.invoiceNo ?? "",
        ...moneyParams(line.amountP),
        how: financeEn.finance.mfs.matchedAs[payment.tender === "cash" ? "cash" : "mfs"],
        howBn: financeBn.finance.mfs.matchedAs[payment.tender === "cash" ? "cash" : "mfs"],
      },
    })
    if (status === "reconciled") {
      tx.emit("SettlementReconciled", {
        branchId: null,
        refs: { settlementId: file.id },
        params: { ...providerParams(file.provider), ...dateParams(file.date), lines: lines.length },
      })
    }
    return { settlementId: file.id, status }
  },
})

/** `finance.noteSettlementLine`: a note on a line nobody can match yet ("under investigation"). */
export const noteSettlementLine = defineCommand({
  name: "finance.noteSettlementLine",
  roles: ["finance"],
  input: z.object({
    settlementId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    ref: z.string().min(1),
    note: z.string().trim().min(1).max(200),
    /** Optional: a double click saves the note once */
    idempotencyKey: idempotencyKey.optional(),
  }),
  async run(tx: Tx, input) {
    const file = await tx.get("mfsSettlements", input.settlementId, {
      expectedVersion: input.expectedVersion,
    })
    if (file.status === "pending-import") tx.reject("SETTLEMENT_NOT_IMPORTED", {})
    const line = file.lines.find((l) => l.ref === input.ref)
    if (!line) tx.reject("LINE_NOT_FOUND", { ref: input.ref })
    if (line.matchedPaymentId) tx.reject("LINE_ALREADY_MATCHED", { ref: line.ref })
    const lines = file.lines.map((l) => (l.ref === line.ref ? { ...l, note: input.note } : l))
    await tx.update("mfsSettlements", file.id, { lines })
    tx.emit("SettlementLineNoted", {
      branchId: null,
      refs: { settlementId: file.id },
      params: { ...providerParams(file.provider), ref: line.ref, note: input.note },
    })
    return { settlementId: file.id }
  },
})

/* ------------------------------------------------------------------ *
 * Three-way mismatch (PRD §8.7)
 * ------------------------------------------------------------------ */

/**
 * `finance.resolveMismatch`: settle a vendor invoice that failed the
 * three-way match. Pay at the PO price (what was accepted into stock at the
 * ordered price), accept the invoice as billed (outside tolerance: the CFO
 * decides, or approves inline), or reject it so the vendor reissues. The
 * match, the vendor invoice and the payable change together; purchase orders
 * are left as they are (procurement owns them).
 */
export const resolveMismatch = defineCommand({
  name: "finance.resolveMismatch",
  roles: ["finance"],
  input: z.object({
    matchId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    resolution: z.enum(["pay-po-price", "accept-invoice", "reject-invoice"]),
    note: z.string().trim().max(300).optional(),
    approval: approvalInput,
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const match = await tx.get("threeWayMatches", input.matchId, {
      expectedVersion: input.expectedVersion,
    })
    if (match.status !== "mismatch") tx.reject("MATCH_NOT_OPEN", {})
    const vendorInvoice = await tx.get("vendorInvoices", match.vendorInvoiceId)
    if (vendorInvoice.status !== "mismatch") {
      tx.reject("VENDOR_INVOICE_SETTLED", { vendorInvoiceNo: vendorInvoice.vendorInvoiceNo })
    }
    const po = await tx.get("purchaseOrders", match.poId)
    const resolution = input.resolution as Resolution
    const note = input.note?.trim() || undefined
    if (resolution === "reject-invoice" && !note) tx.reject("MATCH_NOTE_REQUIRED", {})

    const poLines = await tx.list("poLines", "poId", po.id)
    const grnLines = []
    for (const grnId of match.grnIds) grnLines.push(...(await tx.list("grnLines", "grnId", grnId)))
    const amountP = resolutionAmountP(resolution, {
      vendorInvoice,
      poLines,
      accepted: acceptedByPoLine(grnLines, match.grnIds),
    })
    if (amountP !== null && amountP <= 0) tx.reject("NOTHING_TO_PAY", { poNo: po.poNo })

    const refs = { poId: po.id, vendorInvoiceId: vendorInvoice.id, matchId: match.id }
    let approvalId: Id | undefined
    if (resolution === "accept-invoice" && acceptNeedsCfo(match.diffs)) {
      approvalId = await cfoApproval(tx, {
        kind: "mismatch",
        approval: input.approval,
        refs,
        amountP: vendorInvoice.amountP,
        missingCode: "MISMATCH_NEEDS_CFO",
        missingParams: { vendorInvoiceNo: vendorInvoice.vendorInvoiceNo },
      })
    }

    await tx.update(
      "threeWayMatches",
      match.id,
      {
        status: "resolved",
        resolution,
        resolvedBy: tx.actor.staffId,
        resolvedAt: tx.now(),
        note: note ?? match.note,
        approvalId,
      },
      { expectedVersion: input.expectedVersion }
    )
    let payableId: Id | undefined
    if (resolution === "reject-invoice") {
      await tx.update("vendorInvoices", vendorInvoice.id, { status: "rejected" })
    } else {
      const payable = await createPayable(tx, { vendorInvoice, amountP: amountP! })
      payableId = payable.id
    }
    tx.emit("MismatchResolved", {
      branchId: po.branchId,
      refs: { ...refs, ...(payableId ? { payableId } : {}), ...(approvalId ? { approvalId } : {}) },
      params: {
        poNo: po.poNo,
        vendorInvoiceNo: vendorInvoice.vendorInvoiceNo,
        resolution: financeEn.finance.resolution[resolution],
        resolutionBn: financeBn.finance.resolution[resolution],
        ...moneyParams(amountP ?? 0),
      },
    })
    return { matchId: match.id, resolution, payableId, amountP: amountP ?? 0, approvalId }
  },
})

/* ------------------------------------------------------------------ *
 * Payables
 * ------------------------------------------------------------------ */

/** `finance.schedulePayable`: put an open (or already scheduled) payable on a payment run. */
export const schedulePayable = defineCommand({
  name: "finance.schedulePayable",
  roles: ["finance"],
  input: z.object({
    payableId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    scheduledFor: isoDate,
    /** Optional: a double click schedules once */
    idempotencyKey: idempotencyKey.optional(),
  }),
  async run(tx: Tx, input) {
    const payable = await tx.get("payables", input.payableId, {
      expectedVersion: input.expectedVersion,
    })
    if (payable.status === "paid") tx.reject("PAYABLE_PAID", {})
    if (input.scheduledFor < tx.today()) {
      tx.reject("SCHEDULE_DATE_PAST", { date: input.scheduledFor })
    }
    await tx.update(
      "payables",
      payable.id,
      { status: "scheduled", scheduledFor: input.scheduledFor },
      { expectedVersion: input.expectedVersion }
    )
    const vendor = await tx.get("vendors", payable.vendorId)
    const po = await tx.find("purchaseOrders", payable.poId)
    tx.emit("PayableScheduled", {
      branchId: po?.branchId ?? null,
      refs: { payableId: payable.id, poId: payable.poId, vendorInvoiceId: payable.vendorInvoiceId },
      params: { vendor: vendor.name, ...moneyParams(payable.amountP), ...dateParams(input.scheduledFor) },
    })
    return { payableId: payable.id, scheduledFor: input.scheduledFor }
  },
})

/**
 * `finance.payPayable`: pay a vendor by a simulated bank transfer (BEFTN). The
 * payable is paid with the time and the transfer reference; the purchase
 * order is not touched.
 */
export const payPayable = defineCommand({
  name: "finance.payPayable",
  roles: ["finance"],
  input: z.object({
    payableId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const payable = await tx.get("payables", input.payableId, {
      expectedVersion: input.expectedVersion,
    })
    if (payable.status === "paid") tx.reject("PAYABLE_PAID", {})
    const paymentRef = bankTransferRef(payable.id)
    await tx.update(
      "payables",
      payable.id,
      { status: "paid", paidAt: tx.now(), paymentRef },
      { expectedVersion: input.expectedVersion }
    )
    const vendor = await tx.get("vendors", payable.vendorId)
    const po = await tx.find("purchaseOrders", payable.poId)
    tx.emit("PayablePaid", {
      branchId: po?.branchId ?? null,
      refs: { payableId: payable.id, poId: payable.poId, vendorInvoiceId: payable.vendorInvoiceId },
      params: { vendor: vendor.name, ref: paymentRef, ...moneyParams(payable.amountP) },
    })
    return { payableId: payable.id, paymentRef }
  },
})

/* ------------------------------------------------------------------ *
 * Corporate credit note on a disputed statement line (PRD §10.10)
 * ------------------------------------------------------------------ */

/**
 * `finance.issueCorporateCreditNote`: the company disputes part of an
 * invoice on its statement. The credit note (numbered like billing's) is
 * spread over the invoice's lines, reduces what the company owes, and gives
 * the amount back to the employee's annual limit, in one commit. Invoice and
 * payment rows are left untouched. Above ৳5,000 the CFO decides or approves.
 */
export const issueCorporateCreditNote = defineCommand({
  name: "finance.issueCorporateCreditNote",
  roles: ["finance"],
  input: z.object({
    invoiceId: z.string().min(1),
    amountP: z.number().int(),
    reason: z.string().trim().min(3).max(300),
    approval: approvalInput,
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const invoice = await tx.get("invoices", input.invoiceId)
    if (invoice.payerType !== "corporate" || !invoice.corporateClientId) {
      tx.reject("CN_NOT_CORPORATE", { invoiceNo: invoice.invoiceNo })
    }
    if (input.amountP <= 0) tx.reject("CN_AMOUNT_INVALID", {})
    const payments = await tx.list("payments", "invoiceId", invoice.id)
    const refunds = await tx.list("refunds", "invoiceId", invoice.id)
    const notes = await tx.list("creditNotes", "invoiceId", invoice.id)
    const money = corporateMoney({
      totalP: invoice.totalP,
      payments,
      refunds,
      disputes: notes.filter((n) => n.kind === "corporate-dispute"),
    })
    const roomP = creditNoteRoomP(money)
    if (input.amountP > roomP) {
      tx.reject("CN_ABOVE_SHARE", { maxP: roomP, invoiceNo: invoice.invoiceNo })
    }
    const client = await tx.get("corporateClients", invoice.corporateClientId)
    const refs = {
      invoiceId: invoice.id,
      patientId: invoice.patientId,
      corporateClientId: client.id,
    }
    let approvalId: Id | undefined
    if (input.amountP > CORPORATE_CN_CFO_LIMIT_P) {
      approvalId = await cfoApproval(tx, {
        kind: "credit-note",
        approval: input.approval,
        refs,
        amountP: input.amountP,
        missingCode: "CN_NEEDS_CFO",
        missingParams: { limitP: CORPORATE_CN_CFO_LIMIT_P },
      })
    }

    /* The credit note, spread over the invoice's active lines by their net */
    const allLines = (await tx.list("invoiceLines", "invoiceId", invoice.id))
      .filter((line) => line.netP > 0)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    const active = allLines.filter((line) => line.status === "active")
    const base = active.length ? active : allLines
    if (!base.length) tx.reject("CN_NO_LINES", { invoiceNo: invoice.invoiceNo })
    const shares = spreadDiscount(
      base.map((line) => line.netP),
      input.amountP
    )
    const creditNoteNo = await nextCreditNoteNo(tx, invoice.branchId)
    const note = tx.insert("creditNotes", {
      creditNoteNo,
      invoiceId: invoice.id,
      amountP: input.amountP,
      reason: input.reason,
      lines: base
        .map((line, index) => ({ invoiceLineId: line.id, amountP: shares[index] }))
        .filter((part) => part.amountP > 0),
      kind: "corporate-dispute",
      corporateClientId: client.id,
      approvalId,
    })

    /* The employee's annual limit gets the amount back */
    const patient = await tx.get("patients", invoice.patientId)
    let employee = patient.corporateEmployeeId
      ? await tx.find("corporateEmployees", patient.corporateEmployeeId)
      : undefined
    if (!employee || employee.clientId !== client.id) {
      employee = (await tx.list("corporateEmployees", "patientId", patient.id)).find(
        (e) => e.clientId === client.id
      )
    }
    let usedP: Poisha | undefined
    if (employee) {
      usedP = Math.max(0, employee.usedP - input.amountP)
      await tx.update("corporateEmployees", employee.id, { usedP })
    }

    const eventRefs = { ...refs, creditNoteId: note.id, ...(approvalId ? { approvalId } : {}) }
    tx.emit("CreditNoteIssued", {
      branchId: invoice.branchId,
      refs: eventRefs,
      params: { creditNoteNo, invoiceNo: invoice.invoiceNo, ...moneyParams(input.amountP) },
    })
    tx.emit("CorporateCreditNoteIssued", {
      branchId: invoice.branchId,
      refs: eventRefs,
      params: {
        client: client.name.en,
        clientBn: client.name.bn,
        creditNoteNo,
        invoiceNo: invoice.invoiceNo,
        ...moneyParams(input.amountP),
      },
    })
    return {
      creditNoteId: note.id,
      creditNoteNo,
      amountP: input.amountP,
      employeeId: employee?.id,
      usedP,
      approvalId,
    }
  },
})

/* ------------------------------------------------------------------ *
 * Accounting export (simulated connector)
 * ------------------------------------------------------------------ */

/**
 * `finance.recordExport`: the day's journal for one company was sent to the
 * accounting system (a CSV downloaded in the browser, simulated). The
 * journal is rebuilt here from the committed records, so an export is only
 * recorded when it balances and matches the preview the user downloaded.
 */
export const recordExport = defineCommand({
  name: "finance.recordExport",
  roles: ["finance"],
  input: z.object({
    date: isoDate,
    companyId: z.enum(["C1", "C2", "C3"]),
    totalDebitP: z.number().int().nonnegative(),
    totalCreditP: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    if (input.date > tx.today()) tx.reject("EXPORT_FUTURE_DATE", { date: input.date })
    const companyId = input.companyId as CompanyCode
    const journal = buildJournal(await loadJournalRecords(tx, input.date), companyId)
    if (!journal.balanced) {
      tx.reject("JOURNAL_UNBALANCED", {
        debitP: journal.totalDebitP,
        creditP: journal.totalCreditP,
      })
    }
    if (
      journal.totalDebitP !== input.totalDebitP ||
      journal.totalCreditP !== input.totalCreditP ||
      journal.rows.length !== input.rows
    ) {
      tx.reject("EXPORT_STALE", {})
    }
    const fileName = journalFileName(companyId, input.date)
    const row = tx.insert("accountingExports", {
      date: input.date,
      companyId,
      rows: journal.rows.length,
      totalDebitP: journal.totalDebitP,
      totalCreditP: journal.totalCreditP,
      fileName,
      exportedBy: tx.actor.staffId,
    })
    const company = getCompany(companyId)
    tx.emit("AccountingExported", {
      branchId: null,
      refs: { exportId: row.id },
      params: {
        company: company.name.en,
        companyBn: company.name.bn,
        ...dateParams(input.date),
        rows: journal.rows.length,
        fileName,
        ...moneyParams(journal.totalDebitP),
      },
    })
    return { exportId: row.id, fileName, rows: journal.rows.length, totalDebitP: journal.totalDebitP }
  },
})

/** Every finance command, for the tests and the screens. */
export const financeCommands = {
  importSettlement,
  matchSettlementLine,
  noteSettlementLine,
  resolveMismatch,
  schedulePayable,
  payPayable,
  issueCorporateCreditNote,
  recordExport,
}

export { CFO_AUTHORITY }
