import type {
  AppointmentRow,
  ApprovalKind,
  Id,
  ImagingOrderRow,
  InvoiceLineRow,
  LabOrderItemRow,
  Poisha,
  RxLineRow,
  Tender,
} from "@/core/db/schema"

import type { RowReader } from "./settle"

/**
 * Cancellation and refund rules (plan §9, PRD §9 `rules.cancellationByStage`),
 * shared by the commands, the read models and the refunds screen so the
 * screen always says exactly what the command will do.
 */

/**
 * What a cashier may refund on their own in one action. Above it a
 * supervisor approves the refund (approval kind "refund"). A demo value
 * (CONFIRM: HOSPITAL): consultation fees fit under it, a ৳1,800 ultrasound
 * does not.
 */
export const CASHIER_REFUND_LIMIT_P: Poisha = 1_500_00

/** Approval kinds used by cancellations and refunds, with the authority each needs. */
export type RefundApprovalKind = Extract<
  ApprovalKind,
  "cancel-after-collection" | "refund" | "goodwill"
>

export const APPROVAL_AUTHORITY: Record<
  RefundApprovalKind | "variance",
  string
> = {
  "cancel-after-collection": "approve:cancel-after-collection",
  refund: "approve:refund",
  goodwill: "approve:refund",
  variance: "approve:variance",
}

/** Where the work behind a paid line stands, for cancelling it. */
export type LineStage =
  /* Lab: paid, sample not yet taken / taken / validated or later */
  | "lab-awaiting"
  | "lab-collected"
  | "lab-validated"
  /* Imaging: not done yet / done / reported */
  | "imaging-pending"
  | "imaging-done"
  | "imaging-reported"
  /* Consultation: appointment still on / seen / cancelled */
  | "consult-open"
  | "consult-seen"
  | "consult-cancelled"
  /* Medicines: returned through the pharmacy */
  | "medicine"
  /* The order was cancelled elsewhere (lab, imaging, pharmacy) */
  | "source-cancelled"
  | "other"
  /* The line itself is already cancelled or refunded */
  | "line-cancelled"
  | "line-refunded"

/**
 * What the cashier can do with a line:
 * - cancel: cancel the work and refund (auto, with approval, or blocked)
 * - refund: refund only, the work is already off (appointment cancelled)
 * - goodwill: the service stands; only a goodwill refund
 * - none: nothing here (already refunded, or returns go through the pharmacy
 *   or the appointment must be cancelled at reception first)
 */
export type LineAction = "cancel" | "refund" | "goodwill" | "none"

/** How a cancellation goes (PRD §9): straight away, with approval, or blocked. */
export type CancelRule = "auto" | "approval" | "blocked"

export type StageInfo = {
  stage: LineStage
  action: LineAction
  rule?: CancelRule
}

const LAB_AWAITING: LabOrderItemRow["status"][] = ["ordered", "paid"]
const LAB_COLLECTED: LabOrderItemRow["status"][] = [
  "collected",
  "received",
  "resulted",
  "rejected",
]
const LAB_VALIDATED: LabOrderItemRow["status"][] = [
  "validated",
  "signed",
  "released",
]

export type LineSource =
  | { kind: "test"; item?: LabOrderItemRow }
  | { kind: "imaging"; order?: ImagingOrderRow }
  | { kind: "consult"; appointment?: AppointmentRow }
  | { kind: "rx-line"; rxLine?: RxLineRow }
  | { kind: "other" }

/** The stage of a paid invoice line, from the record behind it. */
export function stageOf(
  line: Pick<InvoiceLineRow, "status">,
  source: LineSource
): StageInfo {
  if (line.status === "cancelled")
    return { stage: "line-cancelled", action: "none" }
  if (line.status === "refunded")
    return { stage: "line-refunded", action: "none" }
  switch (source.kind) {
    case "test": {
      const status = source.item?.status
      if (!status || status === "cancelled")
        return { stage: "source-cancelled", action: "refund" }
      if (LAB_AWAITING.includes(status))
        return { stage: "lab-awaiting", action: "cancel", rule: "auto" }
      if (LAB_COLLECTED.includes(status))
        return { stage: "lab-collected", action: "cancel", rule: "approval" }
      if (LAB_VALIDATED.includes(status))
        return { stage: "lab-validated", action: "cancel", rule: "blocked" }
      return { stage: "other", action: "goodwill" }
    }
    case "imaging": {
      const status = source.order?.status
      if (!status || status === "cancelled")
        return { stage: "source-cancelled", action: "refund" }
      if (status === "ordered" || status === "paid")
        return { stage: "imaging-pending", action: "cancel", rule: "auto" }
      if (status === "done")
        return { stage: "imaging-done", action: "cancel", rule: "approval" }
      return { stage: "imaging-reported", action: "cancel", rule: "blocked" }
    }
    case "consult": {
      const status = source.appointment?.status
      if (!status || status === "cancelled")
        return { stage: "consult-cancelled", action: "refund" }
      if (status === "in-consult" || status === "done")
        return { stage: "consult-seen", action: "goodwill" }
      return { stage: "consult-open", action: "none" }
    }
    case "rx-line": {
      const rxLine = source.rxLine
      if (
        !rxLine ||
        rxLine.status === "cancelled" ||
        (rxLine.status === "bought-elsewhere" && rxLine.dispensedQty === 0)
      ) {
        return { stage: "source-cancelled", action: "refund" }
      }
      return { stage: "medicine", action: "none" }
    }
    default:
      return { stage: "other", action: "goodwill" }
  }
}

/** Reads the record behind a line (a transaction or a database) and gives its stage. */
export async function lineStage(
  reader: RowReader,
  line: InvoiceLineRow
): Promise<StageInfo> {
  switch (line.sourceType) {
    case "test":
      return stageOf(line, {
        kind: "test",
        item: await reader.find("labOrderItems", line.sourceId),
      })
    case "imaging":
      return stageOf(line, {
        kind: "imaging",
        order: await reader.find("imagingOrders", line.sourceId),
      })
    case "consult":
      return stageOf(line, {
        kind: "consult",
        appointment: await reader.find("appointments", line.sourceId),
      })
    case "rx-line":
      return stageOf(line, {
        kind: "rx-line",
        rxLine: await reader.find("rxLines", line.sourceId),
      })
    default:
      return stageOf(line, { kind: "other" })
  }
}

/**
 * The supervisor approval a cancellation needs, if any: after collection
 * (or once the scan is done) "cancel-after-collection"; otherwise a refund
 * above the cashier's own limit needs "refund". A blocked line needs no
 * approval: it cannot be cancelled at all.
 */
export function cancelApproval(
  rule: CancelRule | undefined,
  amountP: Poisha
): RefundApprovalKind | null {
  if (rule === "approval") return "cancel-after-collection"
  if (rule === "auto" && amountP > CASHIER_REFUND_LIMIT_P) return "refund"
  return null
}

/** The approval a refund without cancellation needs, if any. */
export function refundApproval(
  kind: "refund" | "goodwill",
  amountP: Poisha
): RefundApprovalKind | null {
  if (kind === "goodwill") return "goodwill"
  return amountP > CASHIER_REFUND_LIMIT_P ? "refund" : null
}

/** Authorities an approver must hold for a cancellation or refund. */
export function authoritiesFor(
  kind: RefundApprovalKind,
  amountP: Poisha
): string[] {
  const needed = [APPROVAL_AUTHORITY[kind]]
  // Approving a late cancellation also approves its refund.
  if (kind === "cancel-after-collection" && amountP > CASHIER_REFUND_LIMIT_P) {
    needed.push(APPROVAL_AUTHORITY.refund)
  }
  return needed
}

/** Whether a staff member's authorities cover one that a step needs. */
export function holds(authorities: readonly string[], needed: string): boolean {
  return authorities.includes("*") || authorities.includes(needed)
}

/* ------------------------------------------------------------------ *
 * Refund to the original tender
 * ------------------------------------------------------------------ */

export type RefundablePayment = {
  id: Id
  tender: Tender
  /** What the payment brought in */
  amountP: Poisha
  /** What was already refunded from it */
  refundedP: Poisha
}

export type TenderSlice = { paymentId: Id; tender: Tender; amountP: Poisha }

/**
 * Splits a refund over an invoice's payments in proportion to how the
 * invoice was paid (a bKash part goes back to bKash, a cash part out of the
 * drawer), each capped at what that payment has left to refund. Rounding
 * poisha go to the largest remainders, so the parts always add up exactly.
 * Returns fewer poisha than asked only when the payments cannot cover it.
 */
export function allocateRefund(
  amountP: Poisha,
  payments: readonly RefundablePayment[]
): TenderSlice[] {
  const pool = payments.filter((p) => p.amountP - p.refundedP > 0)
  const total = pool.reduce((sum, p) => sum + p.amountP, 0)
  if (amountP <= 0 || total <= 0) return []
  const shares = pool.map((p) => {
    const exact = (amountP * p.amountP) / total
    const room = p.amountP - p.refundedP
    return {
      payment: p,
      room,
      share: Math.min(Math.floor(exact), room),
      fraction: exact - Math.floor(exact),
    }
  })
  let left = amountP - shares.reduce((sum, s) => sum + s.share, 0)
  const order = [...shares].sort(
    (a, b) =>
      b.fraction - a.fraction ||
      b.payment.amountP - a.payment.amountP ||
      a.payment.id.localeCompare(b.payment.id)
  )
  // Rounding first (one poisha each, largest remainder first), then any
  // part a capped payment could not take goes to the others with room.
  for (const slot of order) {
    if (left <= 0) break
    if (slot.share < slot.room && slot.fraction > 0) {
      slot.share += 1
      left -= 1
    }
  }
  for (const slot of order) {
    if (left <= 0) break
    const take = Math.min(slot.room - slot.share, left)
    slot.share += take
    left -= take
  }
  return shares
    .filter((s) => s.share > 0)
    .map((s) => ({
      paymentId: s.payment.id,
      tender: s.payment.tender,
      amountP: s.share,
    }))
}

/** Refunds that leave the building (the rest go back to the drawer or an account). */
export function isExternalRefund(tender: Tender): boolean {
  return tender === "bkash" || tender === "nagad" || tender === "card"
}
