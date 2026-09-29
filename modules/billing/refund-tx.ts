import {
  fiscalYearTag,
  getBranch,
  type BranchCode,
} from "@/config/brand.config"
import { notifyPatient, queueSms } from "@/core/comms/sms"
import type {
  ApprovalKind,
  Id,
  InvoiceLineRow,
  InvoiceRow,
  PaymentRow,
  Poisha,
  Refs,
  RefundRow,
  Tender,
} from "@/core/db/schema"
import { nextRefundNo } from "@/core/engine/docNumbers"
import type { Tx } from "@/core/engine/types"
import type { Locale } from "@/lib/i18n/config"
import { formatMoney } from "@/lib/i18n/format"

import { billingBn } from "./i18n/bn"
import { billingEn } from "./i18n/en"
import {
  allocateRefund,
  holds,
  type LineStage,
  type RefundablePayment,
} from "./refunds"
import { moneyParams, openShiftOf, tenderParams } from "./settle"
import { merchantRefundRef } from "./simulated"

/**
 * The transaction side of cancellations and refunds (plan §9): recording a
 * supervisor's inline approval, stopping the work behind a line, and the one
 * refund routine both `billing.cancelLine` and `billing.refund` use. Every
 * effect lands in the calling command's single commit.
 */

/** A supervisor's inline approval from the override dialog (plan §3.10). */
export type ApprovalInput = {
  approverStaffId: Id
  reason: string
  pinVerified: true
}

/** The kind of approval in both languages, for event labels. */
function approvalParams(kind: ApprovalKind): Record<string, string> {
  const en = billingEn.billing.approvalKind as Record<string, string>
  const bn = billingBn.billing.approvalKind as Record<string, string>
  return { what: en[kind] ?? kind, whatBn: bn[kind] ?? kind }
}

/**
 * Records an approval after checking that it comes from a second person who
 * holds every authority the step needs. Without one, the command is refused
 * with `missingCode` (the screen then opens the override dialog). The
 * approver and reason are written on this commit's audit rows too.
 */
export async function recordApproval(
  tx: Tx,
  opts: {
    kind: ApprovalKind
    authorities: string[]
    approval: ApprovalInput | undefined
    refs: Refs
    amountP?: Poisha
    missingCode: string
    missingParams?: Record<string, string | number>
  }
): Promise<Id> {
  const { approval } = opts
  if (!approval) tx.reject(opts.missingCode, opts.missingParams ?? {})
  if (approval.approverStaffId === tx.actor.staffId)
    tx.reject("APPROVAL_SAME_PERSON", {})
  const approver = await tx.find("staff", approval.approverStaffId)
  if (!approver)
    tx.reject("APPROVER_NOT_ALLOWED", { name: approval.approverStaffId })
  for (const needed of opts.authorities) {
    if (!holds(approver.authorities, needed)) {
      tx.reject("APPROVER_NOT_ALLOWED", { name: approver.nameEn })
    }
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
  tx.emit(opts.kind === "variance" ? "VarianceApproved" : "RefundApproved", {
    refs: { ...opts.refs, approvalId: row.id },
    params: {
      approver: approver.nameEn,
      approverBn: approver.nameBn,
      ...approvalParams(opts.kind),
      ...moneyParams(Math.abs(opts.amountP ?? 0)),
    },
  })
  return row.id
}

/** An active line of a paid invoice at the cashier's branch, or a refusal. */
export async function refundableLine(
  tx: Tx,
  lineId: Id,
  branch: BranchCode
): Promise<{ line: InvoiceLineRow; invoice: InvoiceRow }> {
  const line = await tx.get("invoiceLines", lineId)
  const invoice = await tx.get("invoices", line.invoiceId)
  if (invoice.branchId !== branch)
    tx.reject("REFUND_WRONG_BRANCH", { invoiceNo: invoice.invoiceNo })
  if (invoice.status !== "paid")
    tx.reject("INVOICE_NOT_PAID", { invoiceNo: invoice.invoiceNo })
  if (line.status !== "active")
    tx.reject("LINE_NOT_ACTIVE", { item: line.description })
  return { line, invoice }
}

/**
 * Stops the work behind a cancelled line, in the same commit as its refund:
 * the lab item is cancelled (its tube too once nothing on it is still live,
 * and the order once every item is off), or the imaging order is cancelled.
 * Payment clearance is withdrawn so nothing downstream treats it as paid.
 */
export async function cancelWork(
  tx: Tx,
  line: InvoiceLineRow,
  stage: LineStage,
  reason: string
): Promise<void> {
  if (line.sourceType === "test") {
    const item = await tx.get("labOrderItems", line.sourceId)
    await tx.update("labOrderItems", item.id, {
      status: "cancelled",
      cancelReason: reason,
      paymentCleared: false,
    })
    if (item.specimenId) {
      const specimen = await tx.get("specimens", item.specimenId)
      let live = false
      for (const id of specimen.itemIds) {
        const other = await tx.find("labOrderItems", id)
        if (
          other &&
          other.status !== "cancelled" &&
          other.status !== "rejected"
        )
          live = true
      }
      // A tube with nothing live left on it is cancelled with its tests.
      if (
        !live &&
        specimen.status !== "rejected" &&
        specimen.status !== "consumed" &&
        specimen.status !== "cancelled"
      ) {
        await tx.update("specimens", specimen.id, { status: "cancelled" })
      }
    }
    const items = await tx.list("labOrderItems", "labOrderId", item.labOrderId)
    if (
      items.every((i) => i.status === "cancelled" || i.status === "rejected")
    ) {
      await tx.update("labOrders", item.labOrderId, { status: "cancelled" })
    }
    const order = await tx.get("labOrders", item.labOrderId)
    const test = await tx.get("labTests", item.testId)
    tx.emit("ServiceCancelled", {
      refs: {
        patientId: item.patientId,
        labOrderId: order.id,
        labItemId: item.id,
      },
      params: {
        item: test.code,
        orderNo: order.orderNo,
        ...stageParams(stage),
      },
    })
  } else if (line.sourceType === "imaging") {
    const order = await tx.get("imagingOrders", line.sourceId)
    await tx.update("imagingOrders", order.id, {
      status: "cancelled",
      paymentCleared: false,
    })
    const test = await tx.get("labTests", order.testId)
    tx.emit("ServiceCancelled", {
      refs: { patientId: order.patientId, imagingOrderId: order.id },
      params: {
        item: test.code,
        orderNo: order.orderNo,
        ...stageParams(stage),
      },
    })
  }
}

function stageParams(stage: LineStage): Record<string, string> {
  const en = billingEn.billing.stage as Record<string, string>
  const bn = billingBn.billing.stage as Record<string, string>
  return { stage: en[stage] ?? stage, stageBn: bn[stage] ?? stage }
}

/* ------------------------------------------------------------------ *
 * Credit note numbering
 * ------------------------------------------------------------------ */

/**
 * Credit notes are numbered per company and fiscal year, like invoices:
 * `CN-C1-2627-000001`. While a branch is offline they come from its own
 * range (`CN-C1-B1-2627-OFF-0001`), so replay can never collide.
 */
export async function nextCreditNoteNo(
  tx: Tx,
  branch: BranchCode
): Promise<string> {
  const company = getBranch(branch).company
  const fy = fiscalYearTag(new Date(tx.now()))
  if (tx.isEdge) {
    const n = await tx.nextNumber(`cn-off:${company}-${branch}-${fy}`)
    return `CN-${company}-${branch}-${fy}-OFF-${String(n).padStart(4, "0")}`
  }
  const n = await tx.nextNumber(`cn:${company}-${fy}`)
  return `CN-${company}-${fy}-${String(n).padStart(6, "0")}`
}

/* ------------------------------------------------------------------ *
 * Refund to the original tender
 * ------------------------------------------------------------------ */

export type RefundPart = {
  refundId: Id
  refundNo: string
  paymentId: Id
  tender: Tender
  amountP: Poisha
  /** Simulated merchant refund or card reversal reference */
  ref?: string
}

export type ReversalPart = {
  accrualId: Id
  reversalOfId: Id
  doctorId: Id
  doctor: string
  doctorBn: string
  shareP: Poisha
  whtP: Poisha
}

export type RefundOutcome = {
  invoiceId: Id
  invoiceNo: string
  creditNoteId: Id
  creditNoteNo: string
  amountP: Poisha
  refunds: RefundPart[]
  reversals: ReversalPart[]
  /** The verified phone the "refund issued" SMS went to */
  smsTo?: string
}

/** What each payment of an invoice brought in and has already given back. */
export async function refundablePayments(
  tx: Tx,
  invoiceId: Id
): Promise<{ payments: PaymentRow[]; pool: RefundablePayment[] }> {
  const payments = (await tx.list("payments", "invoiceId", invoiceId)).filter(
    (p) => p.status === "confirmed" || p.status === "refunded"
  )
  const done = (await tx.list("refunds", "invoiceId", invoiceId)).filter(
    (r) => r.status === "completed"
  )
  const refunded = new Map<Id, Poisha>()
  for (const r of done)
    refunded.set(r.paymentId, (refunded.get(r.paymentId) ?? 0) + r.amountP)
  payments.sort(
    (a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id)
  )
  return {
    payments,
    pool: payments.map((p) => ({
      id: p.id,
      tender: p.tender,
      amountP: p.amountP,
      refundedP: refunded.get(p.id) ?? 0,
    })),
  }
}

/**
 * Refunds invoice lines to the tenders that paid for them, in one commit
 * (plan §9): split pro rata over the invoice's payments (bKash back to bKash
 * as a simulated merchant refund, card back to the card, cash out of the
 * cashier's drawer, a company's share back to its account), one credit note
 * per company and fiscal year number, a refund row per tender, the lines
 * marked, the invoice's refunded amount and status updated, every consultant
 * or radiologist fee share on the lines reversed (negative rows pointing at
 * the original), an SMS to a verified phone and a patient-app notice, none
 * of them naming the service.
 */
export async function refundInvoiceLines(
  tx: Tx,
  opts: {
    invoice: InvoiceRow
    lines: InvoiceLineRow[]
    lineStatus: "cancelled" | "refunded"
    reason: string
    approvalId?: Id
    smsLang: Locale
  }
): Promise<RefundOutcome> {
  const { invoice, lines } = opts
  const branch = invoice.branchId
  const amountP = lines.reduce((sum, line) => sum + line.netP, 0)
  const { payments, pool } = await refundablePayments(tx, invoice.id)
  const slices = allocateRefund(amountP, pool)
  const allocated = slices.reduce((sum, s) => sum + s.amountP, 0)
  if (amountP <= 0 || allocated !== amountP) {
    tx.reject("NOTHING_TO_REFUND", { invoiceNo: invoice.invoiceNo })
  }
  const cashP = slices
    .filter((s) => s.tender === "cash")
    .reduce((sum, s) => sum + s.amountP, 0)
  if (cashP > 0 && !(await openShiftOf(tx, tx.actor.staffId, branch))) {
    tx.reject("NO_OPEN_SHIFT_REFUND", {})
  }
  if (tx.isEdge && slices.some((s) => s.tender !== "cash")) {
    tx.reject("REFUND_OFFLINE_CASH_ONLY", {})
  }

  /* The credit note: what the invoice is reduced by, line by line */
  const creditNoteNo = await nextCreditNoteNo(tx, branch)
  const creditNote = tx.insert("creditNotes", {
    creditNoteNo,
    invoiceId: invoice.id,
    amountP,
    reason: opts.reason,
    lines: lines.map((line) => ({
      invoiceLineId: line.id,
      amountP: line.netP,
    })),
  })
  const refsBase = { patientId: invoice.patientId, invoiceId: invoice.id }
  tx.emit("CreditNoteIssued", {
    branchId: branch,
    refs: refsBase,
    params: {
      creditNoteNo,
      invoiceNo: invoice.invoiceNo,
      ...moneyParams(amountP),
    },
  })

  /* One refund per tender, back to where the money came from */
  const parts: RefundPart[] = []
  const byId = new Map(payments.map((p) => [p.id, p]))
  const already = new Map(pool.map((p) => [p.id, p.refundedP]))
  for (const slice of slices) {
    const refundNo = await nextRefundNo(tx, branch)
    const row: RefundRow = tx.insert("refunds", {
      refundNo,
      invoiceId: invoice.id,
      invoiceLineIds: lines.map((line) => line.id),
      paymentId: slice.paymentId,
      tender: slice.tender,
      amountP: slice.amountP,
      reason: opts.reason,
      approvalId: opts.approvalId,
      status: "completed",
      completedAt: tx.now(),
      creditNoteId: creditNote.id,
    })
    const payment = byId.get(slice.paymentId)!
    if ((already.get(payment.id) ?? 0) + slice.amountP >= payment.amountP) {
      await tx.update("payments", payment.id, { status: "refunded" })
    }
    if (slice.tender === "corporate")
      await creditCorporateLimit(tx, invoice, slice.amountP)
    const ref = merchantRefundRef(slice.tender, row.id)
    parts.push({
      refundId: row.id,
      refundNo,
      paymentId: payment.id,
      tender: slice.tender,
      amountP: slice.amountP,
      ref,
    })
    tx.emit("RefundIssued", {
      branchId: branch,
      refs: { ...refsBase, paymentId: payment.id, refundId: row.id },
      params: {
        refundNo,
        invoiceNo: invoice.invoiceNo,
        ...tenderParams(slice.tender),
        ...moneyParams(slice.amountP),
      },
    })
  }

  /* The lines and the invoice */
  for (const line of lines) {
    await tx.update("invoiceLines", line.id, { status: opts.lineStatus })
  }
  const refundedP = invoice.refundedP + amountP
  await tx.update("invoices", invoice.id, {
    refundedP,
    status: refundedP >= invoice.paidP ? "refunded" : invoice.status,
  })

  /* Fee share reversals (PRD §10.9): negative lines against the originals */
  const reversals: ReversalPart[] = []
  for (const line of lines) {
    const accruals = await tx.list("feeShareAccruals", "invoiceLineId", line.id)
    const reversed = new Set(
      accruals.map((a) => a.reversalOfId).filter(Boolean)
    )
    for (const original of accruals) {
      if (original.reversalOfId || reversed.has(original.id)) continue
      const reversal = tx.insert("feeShareAccruals", {
        doctorId: original.doctorId,
        invoiceId: original.invoiceId,
        invoiceLineId: original.invoiceLineId,
        contractId: original.contractId,
        contractVersion: original.contractVersion,
        serviceType: original.serviceType,
        month: tx.today().slice(0, 7),
        patientUhid: original.patientUhid,
        grossP: -original.grossP,
        discountP: -original.discountP,
        netP: -original.netP,
        basis: original.basis,
        shareP: -original.shareP,
        whtP: -original.whtP,
        reversalOfId: original.id,
        at: tx.now(),
      })
      const doctor = await tx.find("doctors", original.doctorId)
      const staff = doctor ? await tx.find("staff", doctor.staffId) : undefined
      const names = {
        doctor: staff?.nameEn ?? original.doctorId,
        doctorBn: staff?.nameBn ?? staff?.nameEn ?? original.doctorId,
      }
      reversals.push({
        accrualId: reversal.id,
        reversalOfId: original.id,
        doctorId: original.doctorId,
        ...names,
        shareP: reversal.shareP,
        whtP: reversal.whtP,
      })
      tx.emit("FeeShareReversed", {
        branchId: branch,
        refs: refsBase,
        params: { ...names, ...moneyParams(original.shareP) },
      })
    }
  }

  /* SMS and the patient-app notice: an amount and a document number only */
  const patient = await tx.get("patients", invoice.patientId)
  const smsConsent = patient.consents.find((c) => c.purpose === "sms")
  let smsTo: string | undefined
  if (patient.phone && patient.phoneVerified && smsConsent?.granted !== false) {
    smsTo = patient.phone
    queueRefundSms(tx, {
      to: patient.phone,
      patientId: patient.id,
      lang: opts.smsLang,
      amount: formatMoney(amountP, opts.smsLang),
      creditNoteNo,
    })
  }
  notifyPatient(tx, {
    patientId: patient.id,
    kind: "refundIssued",
    titleKey: "billing.notices.refundIssued",
    params: {
      creditNoteNo,
      invoiceNo: invoice.invoiceNo,
      amount: formatMoney(amountP, "en"),
    },
    refs: refsBase,
  })

  return {
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    creditNoteId: creditNote.id,
    creditNoteNo,
    amountP,
    refunds: parts,
    reversals,
    smsTo,
  }
}

/** A company's share refunded goes back to the employee's annual limit. */
async function creditCorporateLimit(
  tx: Tx,
  invoice: InvoiceRow,
  amountP: Poisha
): Promise<void> {
  const patient = await tx.get("patients", invoice.patientId)
  if (!patient.corporateEmployeeId) return
  const employee = await tx.find(
    "corporateEmployees",
    patient.corporateEmployeeId
  )
  if (!employee) return
  await tx.update("corporateEmployees", employee.id, {
    usedP: Math.max(0, employee.usedP - amountP),
  })
}

/**
 * The "refund issued" SMS (simulated aggregator, PRD §10.19): an amount and a
 * credit note number, never the test or service. Held while offline.
 */
function queueRefundSms(
  tx: Tx,
  opts: {
    to: string
    patientId: Id
    lang: Locale
    amount: string
    creditNoteNo: string
  }
): void {
  queueSms(tx, {
    to: opts.to,
    patientId: opts.patientId,
    lang: opts.lang,
    templateId: "refund-issued",
    params: { amount: opts.amount, creditNoteNo: opts.creditNoteNo },
  })
}
