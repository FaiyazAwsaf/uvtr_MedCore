import { z } from "zod"

import { rules } from "@/config/rules.config"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import type { Id, InvoiceLineRow, InvoiceRow, PaymentRow, Poisha } from "@/core/db/schema"

import { discountLimit, isMfs } from "./pricing"
import {
  cancelWork,
  recordApproval,
  refundableLine,
  refundInvoiceLines,
  type RefundOutcome,
} from "./refund-tx"
import {
  APPROVAL_AUTHORITY,
  authoritiesFor,
  cancelApproval,
  CASHIER_REFUND_LIMIT_P,
  lineStage,
  refundApproval,
  type LineStage,
} from "./refunds"
import { countedFrom, DENOMINATIONS, shiftCash } from "./shift"
import {
  actorBranch,
  addPayments,
  billablePatient,
  checkTenders,
  confirmPayment,
  createInvoice,
  loadBillLines,
  moneyParams,
  openShiftOf,
  patientMayActFor,
  refreshInvoice,
  requireShift,
  tenderParams,
  type TenderInput,
} from "./settle"

/**
 * Billing commands (plan §6 `billing.checkout`, `billing.confirmMfs` /
 * `timeoutMfs`). Each is ONE atomic commit: the invoice, its lines, the
 * payments and, once confirmed money covers the total, every unlock (lab,
 * imaging, pharmacy), fee share, receipt, SMS and notification, or nothing.
 */

const tender = z.object({
  tender: z.enum(["cash", "card", "bkash", "nagad"]),
  amountP: z.number().int().positive(),
  tenderedP: z.number().int().nonnegative().optional(),
  ref: z.string().min(1).max(40).optional(),
})

const idempotencyKey = z.string().min(8).max(80)
const smsLang = z.enum(["en", "bn"]).default("bn")

/** Inline supervisor approval from the override dialog (plan §3.10). */
const discountApproval = z.object({
  approverStaffId: z.string(),
  reason: z.string().trim().min(1).max(300),
  pinVerified: z.literal(true),
})

export type CheckoutResult = {
  invoiceId: Id
  invoiceNo: string
  status: "unpaid" | "partial" | "paid"
  totalP: number
  corporateShareP: number
  patientDueP: number
  changeDueP: number
  paymentIds: Id[]
  pendingPaymentIds: Id[]
  receiptNo?: string
}

/**
 * Take payment at the counter for chosen basket lines of one patient: one
 * invoice for the branch's company, the discount (above the cashier's own
 * authority only with a supervisor's approval, recorded in `approvals`),
 * the company's share for covered corporate lines, and the counter tenders.
 * Cash and an approved card count at once; bKash and Nagad wait for the
 * customer's approval and unlock nothing until then (INV-09).
 */
export const checkout = defineCommand({
  name: "billing.checkout",
  roles: ["cashier"],
  input: z.object({
    patientId: z.string(),
    basketLineIds: z.array(z.string()).min(1).max(60),
    discountPct: z.number().int().min(0).max(100).default(0),
    discountApproval: discountApproval.optional(),
    tenders: z.array(tender).max(6),
    smsLang,
    idempotencyKey,
  }),
  async run(tx, input): Promise<CheckoutResult> {
    const branch = actorBranch(tx)
    const patient = await billablePatient(tx, input.patientId)
    const shift = await requireShift(tx, branch)
    const { lines } = await loadBillLines(tx, {
      patientId: patient.id,
      lineIds: input.basketLineIds,
      branch,
    })

    const approvalId = await recordDiscountApproval(tx, input.discountPct, input.discountApproval, {
      patientId: patient.id,
    })
    const created = await createInvoice(tx, {
      patient,
      branch,
      lines,
      discountPct: input.discountPct,
      discountApprovalId: approvalId,
      shiftId: shift.id,
      cashierId: tx.actor.staffId,
    })
    if (approvalId) {
      await tx.update("approvals", approvalId, {
        refs: { patientId: patient.id, invoiceId: created.invoice.id },
        amountP: created.invoice.discountP,
      })
    }

    const { changeDueP } = await checkTenders(tx, input.tenders, created.patientDueP, branch)
    const payments = addPayments(tx, {
      invoice: created.invoice,
      tenders: input.tenders,
      idempotencyKey: input.idempotencyKey,
      shiftId: shift.id,
    })
    const { invoice, settlement } = await refreshInvoice(tx, created.invoice.id, {
      smsLang: input.smsLang,
    })
    return {
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      status: invoice.status as CheckoutResult["status"],
      totalP: invoice.totalP,
      corporateShareP: created.corporateShareP,
      patientDueP: created.patientDueP,
      changeDueP,
      paymentIds: payments.map((p) => p.id),
      pendingPaymentIds: payments.filter((p) => p.status === "pending").map((p) => p.id),
      receiptNo: settlement?.receiptNo,
    }
  },
})

/**
 * INV-16: a discount above the cashier's own authority needs a second
 * person who holds it. The approval is written in the same commit as the
 * invoice, with the approver's identity, the simulated PIN check and the
 * reason; the audit rows of this commit carry the approver too.
 */
async function recordDiscountApproval(
  tx: Tx,
  pct: number,
  approval: z.output<typeof discountApproval> | undefined,
  refs: { patientId: Id }
): Promise<Id | undefined> {
  if (pct <= discountLimit(tx.actor.authorities)) return undefined
  if (!approval) tx.reject("DISCOUNT_APPROVAL_REQUIRED", { pct })
  if (approval.approverStaffId === tx.actor.staffId) tx.reject("APPROVER_SAME_PERSON", {})
  const approver = await tx.find("staff", approval.approverStaffId)
  if (!approver) tx.reject("APPROVER_LACKS_AUTHORITY", { name: approval.approverStaffId, limit: 0 })
  const limit = discountLimit(approver.authorities)
  if (pct > limit) {
    tx.reject("APPROVER_LACKS_AUTHORITY", { name: approver.nameEn, limit })
  }
  const row = tx.insert("approvals", {
    kind: "discount",
    refs,
    requestedBy: tx.actor.staffId,
    approverId: approver.id,
    status: "approved",
    pinVerified: true,
    reason: approval.reason,
    decidedAt: tx.now(),
  })
  tx.auditContext({ reason: approval.reason, approvedBy: approver.id })
  tx.emit("DiscountApproved", {
    refs: { ...refs, approvalId: row.id },
    params: { pct, approver: approver.nameEn, approverBn: approver.nameBn },
  })
  return row.id
}

/** A pending bKash or Nagad payment the actor may act on. */
async function pendingMfs(tx: Tx, paymentId: Id): Promise<PaymentRow> {
  const payment = await tx.get("payments", paymentId)
  if (!isMfs(payment.tender)) tx.reject("NOT_MFS", {})
  if (tx.actor.role === "patient") {
    const own =
      payment.createdBy === tx.actor.staffId || (await patientMayActFor(tx, payment.patientId))
    if (!own) tx.reject("NOT_YOUR_PAYMENT", {})
  } else if (tx.actor.role === "cashier" && payment.branchId !== tx.actor.branchId) {
    tx.reject("PAYMENT_WRONG_BRANCH", {})
  }
  if (payment.status !== "pending") tx.reject("PAYMENT_NOT_PENDING", {})
  return payment
}

export type MfsResult = {
  paymentId: Id
  invoiceId: Id
  invoiceNo: string
  invoiceStatus: string
  receiptNo?: string
}

/**
 * The customer approved the bKash or Nagad push (simulated): the payment is
 * confirmed and, if that completes the invoice, every unlock of checkout is
 * applied in this commit. Allowed for the cashier and, in the patient app,
 * for the payer or a linked family member.
 */
export const confirmMfs = defineCommand({
  name: "billing.confirmMfs",
  roles: ["cashier", "patient"],
  input: z.object({
    paymentId: z.string(),
    /** Transaction id from the provider; simulated when absent */
    trxId: z.string().min(4).max(40).optional(),
    smsLang,
    idempotencyKey: idempotencyKey.optional(),
  }),
  async run(tx, input): Promise<MfsResult> {
    const payment = await pendingMfs(tx, input.paymentId)
    const invoice = await tx.get("invoices", payment.invoiceId)
    if (invoice.paidP + payment.amountP > invoice.totalP) {
      tx.reject("INVOICE_OVERPAID", { invoiceNo: invoice.invoiceNo })
    }
    await confirmPayment(tx, payment, invoice, input.trxId)
    const refreshed = await refreshInvoice(tx, invoice.id, { smsLang: input.smsLang })
    return {
      paymentId: payment.id,
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      invoiceStatus: refreshed.invoice.status,
      receiptNo: refreshed.settlement?.receiptNo,
    }
  },
})

/**
 * The customer did not approve in time (or the cashier gave up waiting):
 * the payment becomes a timeout, a reconciliation item. Nothing unlocks,
 * nothing else changes; the balance can be taken again with any tender.
 * The sweeper runs this for pushes older than `rules.mfsPendingTimeoutMin`.
 */
export const timeoutMfs = defineCommand({
  name: "billing.timeoutMfs",
  roles: ["cashier", "patient"],
  input: z.object({
    paymentId: z.string(),
    idempotencyKey: idempotencyKey.optional(),
  }),
  async run(tx, input) {
    const payment = await pendingMfs(tx, input.paymentId)
    const invoice = await tx.get("invoices", payment.invoiceId)
    await tx.update("payments", payment.id, { status: "timeout" })
    tx.emit("PaymentTimedOut", {
      branchId: payment.branchId,
      refs: { patientId: payment.patientId, invoiceId: invoice.id, paymentId: payment.id },
      params: {
        invoiceNo: invoice.invoiceNo,
        ...tenderParams(payment.tender),
        ...moneyParams(payment.amountP),
      },
    })
    return { paymentId: payment.id, invoiceId: invoice.id, invoiceNo: invoice.invoiceNo }
  },
})

/** The balance still due on an invoice, and whether a push is still waiting. */
async function balanceOf(tx: Tx, invoiceId: Id) {
  const invoice = await tx.get("invoices", invoiceId)
  if (invoice.status !== "unpaid" && invoice.status !== "partial") {
    tx.reject("INVOICE_NOT_OPEN", { invoiceNo: invoice.invoiceNo })
  }
  const payments = await tx.list("payments", "invoiceId", invoiceId)
  if (payments.some((p) => p.status === "pending")) {
    tx.reject("MFS_STILL_PENDING", { invoiceNo: invoice.invoiceNo })
  }
  return { invoice, dueP: invoice.totalP - invoice.paidP }
}

/**
 * Take the rest of a partly paid invoice at the counter, typically after a
 * bKash push timed out. Same tender rules as checkout; settling it applies
 * the same unlocks.
 */
export const collectBalance = defineCommand({
  name: "billing.collectBalance",
  roles: ["cashier"],
  input: z.object({
    invoiceId: z.string(),
    tenders: z.array(tender).min(1).max(6),
    smsLang,
    idempotencyKey,
  }),
  async run(tx, input): Promise<CheckoutResult> {
    const branch = actorBranch(tx)
    const shift = await requireShift(tx, branch)
    const { invoice, dueP } = await balanceOf(tx, input.invoiceId)
    if (invoice.branchId !== branch) tx.reject("PAYMENT_WRONG_BRANCH", {})
    const { changeDueP } = await checkTenders(tx, input.tenders, dueP, branch)
    const payments = addPayments(tx, {
      invoice,
      tenders: input.tenders,
      idempotencyKey: input.idempotencyKey,
      shiftId: shift.id,
    })
    const refreshed = await refreshInvoice(tx, invoice.id, { smsLang: input.smsLang })
    return {
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      status: refreshed.invoice.status as CheckoutResult["status"],
      totalP: invoice.totalP,
      corporateShareP: 0,
      patientDueP: dueP,
      changeDueP,
      paymentIds: payments.map((p) => p.id),
      pendingPaymentIds: payments.filter((p) => p.status === "pending").map((p) => p.id),
      receiptNo: refreshed.settlement?.receiptNo,
    }
  },
})

export type PayOnlineResult = {
  invoiceId: Id
  invoiceNo: string
  /** The pending bKash or Nagad payment to approve (absent when nothing was due) */
  paymentId?: Id
  amountP: number
  invoiceStatus: string
  receiptNo?: string
}

/**
 * Pay from the patient app (plan §9 `/app` bills and pay): chosen open basket
 * lines of the patient or a linked family member, at one branch, by bKash or
 * Nagad. Creates the invoice and a PENDING payment; the app's simulated
 * "Approve in bKash" step then calls `billing.confirmMfs`. Passing
 * `invoiceId` instead pays the balance of an invoice whose push timed out.
 */
export const payOnline = defineCommand({
  name: "billing.payOnline",
  roles: ["patient"],
  input: z
    .object({
      patientId: z.string(),
      basketLineIds: z.array(z.string()).min(1).max(60).optional(),
      invoiceId: z.string().optional(),
      tender: z.enum(["bkash", "nagad"]),
      smsLang,
      idempotencyKey,
    })
    .refine((value) => !!value.basketLineIds !== !!value.invoiceId, {
      message: "Pass either basketLineIds or invoiceId",
    }),
  async run(tx, input): Promise<PayOnlineResult> {
    if (!(await patientMayActFor(tx, input.patientId))) tx.reject("NOT_YOUR_PATIENT", {})
    const patient = await billablePatient(tx, input.patientId)
    const push = (amountP: number): TenderInput[] =>
      amountP > 0 ? [{ tender: input.tender, amountP }] : []

    if (input.invoiceId) {
      const { invoice, dueP } = await balanceOf(tx, input.invoiceId)
      if (invoice.patientId !== patient.id) tx.reject("NOT_YOUR_PATIENT", {})
      const [payment] = addPayments(tx, {
        invoice,
        tenders: push(dueP),
        idempotencyKey: input.idempotencyKey,
      })
      return {
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        paymentId: payment?.id,
        amountP: dueP,
        invoiceStatus: invoice.status,
      }
    }

    const { lines, branch } = await loadBillLines(tx, {
      patientId: patient.id,
      lineIds: input.basketLineIds ?? [],
    })
    const created = await createInvoice(tx, {
      patient,
      branch,
      lines,
      discountPct: 0,
      cashierId: tx.actor.staffId,
    })
    const [payment] = addPayments(tx, {
      invoice: created.invoice,
      tenders: push(created.patientDueP),
      idempotencyKey: input.idempotencyKey,
    })
    const refreshed = await refreshInvoice(tx, created.invoice.id, { smsLang: input.smsLang })
    return {
      invoiceId: created.invoice.id,
      invoiceNo: created.invoice.invoiceNo,
      paymentId: payment?.id,
      amountP: created.patientDueP,
      invoiceStatus: refreshed.invoice.status,
      receiptNo: refreshed.settlement?.receiptNo,
    }
  },
})

/**
 * Open a cash shift with a float (plan §9 `/cashier/shift`). One open shift
 * per cashier; `billing.closeShift` closes it with the denomination count.
 */
export const openShift = defineCommand({
  name: "billing.openShift",
  roles: ["cashier"],
  input: z.object({
    floatP: z.number().int().min(0).max(10_000_000),
    idempotencyKey: idempotencyKey.optional(),
  }),
  async run(tx, input) {
    const branch = actorBranch(tx)
    if (await openShiftOf(tx, tx.actor.staffId, branch)) tx.reject("SHIFT_ALREADY_OPEN", {})
    const shift = tx.insert("shifts", {
      cashierId: tx.actor.staffId,
      branchId: branch,
      date: tx.today(),
      openedAt: tx.now(),
      floatP: input.floatP,
      status: "open",
    })
    const staff = await tx.find("staff", tx.actor.staffId)
    tx.emit("ShiftOpened", {
      refs: { shiftId: shift.id },
      params: {
        cashier: staff?.nameEn ?? tx.actor.name,
        cashierBn: staff?.nameBn ?? tx.actor.name,
        ...moneyParams(input.floatP),
      },
    })
    return { shiftId: shift.id }
  },
})

/* ------------------------------------------------------------------ *
 * Cancellation and refund after payment (plan §9)
 * ------------------------------------------------------------------ */

const approvalInput = z.object({
  approverStaffId: z.string(),
  reason: z.string().trim().min(1).max(300),
  pinVerified: z.literal(true),
})

export type CancelResult = RefundOutcome & {
  stage: LineStage
  approvalId?: Id
}

/**
 * Cancel a paid lab test or imaging study and refund it to the tenders that
 * paid for it (PRD §9 cancellation by stage, `rules.cancellationByStage`):
 * - before collection (scan not done): cancelled and refunded at once; a
 *   refund above the cashier's own limit needs a supervisor ("refund");
 * - after collection (scan done): only with a supervisor's approval
 *   ("cancel-after-collection");
 * - after validation (report exists): refused and audited; the result stays
 *   and only a goodwill refund (`billing.refund`, kind "goodwill") is possible.
 * The item (and its tube or order once nothing live is left), the refund,
 * credit note and fee-share reversal land in this one commit.
 */
export const cancelLine = defineCommand({
  name: "billing.cancelLine",
  roles: ["cashier"],
  input: z.object({
    invoiceLineId: z.string(),
    reason: z.string().trim().min(3).max(300),
    approval: approvalInput.optional(),
    smsLang,
    idempotencyKey,
  }),
  async run(tx, input): Promise<CancelResult> {
    const branch = actorBranch(tx)
    const { line, invoice } = await refundableLine(tx, input.invoiceLineId, branch)
    const info = await lineStage(tx, line)
    if (info.action !== "cancel") {
      tx.reject(
        info.action === "refund"
          ? "USE_REFUND"
          : info.action === "goodwill"
            ? "NOT_CANCELLABLE_GOODWILL"
            : info.stage === "medicine"
              ? "MEDICINE_RETURN_AT_PHARMACY"
              : "CONSULT_CANCEL_AT_RECEPTION",
        { item: line.description }
      )
    }
    if (info.rule === "blocked") {
      tx.reject(
        "CANCEL_AFTER_VALIDATION",
        { item: line.description, invoiceNo: invoice.invoiceNo },
        { audit: true }
      )
    }
    const amountP = line.netP
    const kind = cancelApproval(info.rule, amountP)
    const approvalId = kind
      ? await recordApproval(tx, {
          kind,
          authorities: authoritiesFor(kind, amountP),
          approval: input.approval,
          refs: { patientId: invoice.patientId, invoiceId: invoice.id },
          amountP,
          missingCode:
            kind === "cancel-after-collection"
              ? "CANCEL_APPROVAL_REQUIRED"
              : "REFUND_APPROVAL_REQUIRED",
          missingParams: { item: line.description, limitP: CASHIER_REFUND_LIMIT_P },
        })
      : undefined
    await cancelWork(tx, line, info.stage, input.reason)
    const outcome = await refundInvoiceLines(tx, {
      invoice,
      lines: [line],
      lineStatus: "cancelled",
      reason: input.reason,
      approvalId,
      smsLang: input.smsLang,
    })
    return { ...outcome, stage: info.stage, approvalId }
  },
})

/** Lines of one paid invoice at the cashier's branch, each still active. */
async function refundableLines(
  tx: Tx,
  lineIds: Id[]
): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] }> {
  const branch = actorBranch(tx)
  const lines: InvoiceLineRow[] = []
  let invoice: InvoiceRow | undefined
  for (const id of new Set(lineIds)) {
    const found = await refundableLine(tx, id, branch)
    if (invoice && found.invoice.id !== invoice.id) tx.reject("LINES_MIXED_INVOICE", {})
    invoice = found.invoice
    lines.push(found.line)
  }
  if (!invoice) tx.reject("NOTHING_SELECTED", {})
  return { invoice, lines }
}

/**
 * Refund paid lines to their original tenders without cancelling any work
 * (plan §9):
 * - kind "refund": the service is already off, such as an appointment the
 *   patient cancelled after a doctor delay with "refund" as their choice, or
 *   an order cancelled elsewhere. Lines whose work is still going ahead are
 *   refused (cancel them instead). Above the cashier's own limit a
 *   supervisor approves ("refund").
 * - kind "goodwill": the service and any result stand; always with a
 *   supervisor's approval ("goodwill").
 * Same effects as a cancellation's refund: tenders pro rata, credit note,
 * refund rows, fee-share reversal, SMS and app notice, in one commit.
 */
export const refund = defineCommand({
  name: "billing.refund",
  roles: ["cashier"],
  input: z.object({
    invoiceLineIds: z.array(z.string()).min(1).max(30),
    kind: z.enum(["refund", "goodwill"]).default("refund"),
    reason: z.string().trim().min(3).max(300),
    approval: approvalInput.optional(),
    smsLang,
    idempotencyKey,
  }),
  async run(tx, input): Promise<RefundOutcome & { approvalId?: Id }> {
    const { invoice, lines } = await refundableLines(tx, input.invoiceLineIds)
    if (input.kind === "refund") {
      for (const line of lines) {
        const info = await lineStage(tx, line)
        if (info.action === "refund") continue
        tx.reject(
          info.action === "cancel" && info.rule !== "blocked"
            ? "LINE_STILL_ACTIVE"
            : info.stage === "consult-open"
              ? "CONSULT_CANCEL_AT_RECEPTION"
              : info.stage === "medicine"
                ? "MEDICINE_RETURN_AT_PHARMACY"
                : "GOODWILL_ONLY",
          { item: line.description }
        )
      }
    }
    const amountP: Poisha = lines.reduce((sum, line) => sum + line.netP, 0)
    const kind = refundApproval(input.kind, amountP)
    const approvalId = kind
      ? await recordApproval(tx, {
          kind,
          authorities: [APPROVAL_AUTHORITY[kind]],
          approval: input.approval,
          refs: { patientId: invoice.patientId, invoiceId: invoice.id },
          amountP,
          missingCode:
            kind === "goodwill" ? "GOODWILL_APPROVAL_REQUIRED" : "REFUND_APPROVAL_REQUIRED",
          missingParams: { limitP: CASHIER_REFUND_LIMIT_P },
        })
      : undefined
    const outcome = await refundInvoiceLines(tx, {
      invoice,
      lines,
      lineStatus: "refunded",
      reason: input.reason,
      approvalId,
      smsLang: input.smsLang,
    })
    return { ...outcome, approvalId }
  },
})

/* ------------------------------------------------------------------ *
 * Shift close (plan §9, S13)
 * ------------------------------------------------------------------ */

export type CloseShiftResult = {
  shiftId: Id
  countedP: Poisha
  expectedP: Poisha
  varianceP: Poisha
  approvalId?: Id
}

const DENOMINATION_KEYS = DENOMINATIONS.map(String) as [string, ...string[]]

/**
 * Close the cashier's shift with the drawer counted by denomination (PRD §9):
 * expected cash is the float plus cash taken minus cash refunded out; a
 * variance either way above `rules.cashVarianceThresholdP` needs a
 * supervisor's approval ("variance"), within it the shift closes directly.
 * A closed shift is locked (INV-12): no more payments on it, and the
 * cashier opens a new shift to take money again.
 */
export const closeShift = defineCommand({
  name: "billing.closeShift",
  roles: ["cashier"],
  input: z.object({
    shiftId: z.string(),
    denominations: z.partialRecord(
      z.enum(DENOMINATION_KEYS),
      z.number().int().min(0).max(100_000)
    ),
    approval: approvalInput.optional(),
    expectedVersion: z.number().int().optional(),
    idempotencyKey: idempotencyKey.optional(),
  }),
  async run(tx, input): Promise<CloseShiftResult> {
    const branch = actorBranch(tx)
    const shift = await tx.get("shifts", input.shiftId, {
      expectedVersion: input.expectedVersion,
    })
    if (shift.cashierId !== tx.actor.staffId || shift.branchId !== branch) {
      tx.reject("SHIFT_NOT_YOURS", {})
    }
    if (shift.status !== "open") tx.reject("SHIFT_CLOSED", {})
    const payments = await tx.list("payments", "shiftId", shift.id)
    const refunds = await tx.list("refunds", "status", "completed")
    const { expectedP } = shiftCash(shift, payments, refunds)
    const denominations: Record<string, number> = {}
    for (const [value, count] of Object.entries(input.denominations)) {
      if (count && count > 0) denominations[value] = count
    }
    const countedP = countedFrom(denominations)
    const varianceP = countedP - expectedP
    const approvalId =
      Math.abs(varianceP) > rules.cashVarianceThresholdP
        ? await recordApproval(tx, {
            kind: "variance",
            authorities: [APPROVAL_AUTHORITY.variance],
            approval: input.approval,
            refs: { shiftId: shift.id },
            amountP: varianceP,
            missingCode: "VARIANCE_APPROVAL_REQUIRED",
            missingParams: { varianceP, limitP: rules.cashVarianceThresholdP },
          })
        : undefined
    await tx.update("shifts", shift.id, {
      status: "closed",
      closedAt: tx.now(),
      countedP,
      denominations,
      expectedP,
      varianceP,
      varianceApprovalId: approvalId,
    })
    const staff = await tx.find("staff", tx.actor.staffId)
    tx.emit("ShiftClosed", {
      refs: { shiftId: shift.id, approvalId },
      params: {
        cashier: staff?.nameEn ?? tx.actor.name,
        cashierBn: staff?.nameBn ?? tx.actor.name,
        ...moneyParams(countedP, "counted"),
        ...moneyParams(varianceP, "variance"),
      },
    })
    return { shiftId: shift.id, countedP, expectedP, varianceP, approvalId }
  },
})
