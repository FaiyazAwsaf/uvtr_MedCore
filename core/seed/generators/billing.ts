/**
 * Billing building blocks used by the history and today generators: basket
 * lines, invoices with lines, confirmed payments, receipts, fee-share
 * accruals (trigger: collection, PRD §10.9), refunds with credit notes and
 * fee-share reversals. Every invoice balances (INV-03): lines minus discount
 * equals the total, and confirmed payments equal the total.
 */

import { getBranch, type BranchCode } from "@/config/brand.config"
import { counterKey, docNo } from "@/core/db/numbering"
import type {
  BasketLineRow,
  CreditNoteRow,
  FeeShareAccrualRow,
  Id,
  InvoiceLineRow,
  InvoiceRow,
  Ms,
  PayerType,
  PaymentRow,
  ReceiptRow,
  RefundRow,
  ServiceType,
  Tender,
} from "@/core/db/schema"
import type { Rng } from "@/lib/mock/rng"

import type { SeedCtx } from "../context"
import { dhakaDate, fyTagOf, MINUTE, monthOf } from "../time"
import { contractFor } from "./org"

export type LineInput = {
  sourceType: BasketLineRow["sourceType"]
  sourceId: Id
  serviceType: ServiceType
  description: string
  descriptionBn?: string
  doctorId?: Id
  qty: number
  unitPriceP: number
  mrpP?: number
}

export type TenderSplit = { tender: Tender; amountP?: number }

export type InvoiceInput = {
  patientId: Id
  branch: BranchCode
  at: Ms
  cashierId: Id
  shiftId?: Id
  lines: LineInput[]
  discountPct?: number
  discountApprovalId?: Id
  payerType?: PayerType
  corporateClientId?: Id
  /** Defaults to one cash payment for the total; the last split takes the remainder */
  tenders?: TenderSplit[]
  offline?: boolean
  /** Basket lines created earlier (booked consult fee, Rx lines) to invoice */
  basketLines?: BasketLineRow[]
}

export type InvoiceOut = {
  invoice: InvoiceRow
  lines: InvoiceLineRow[]
  basketLines: BasketLineRow[]
  payments: PaymentRow[]
  receipt: ReceiptRow
  accruals: FeeShareAccrualRow[]
}

const MFS: Tender[] = ["bkash", "nagad"]

function tenderRef(rng: Rng, tender: Tender): string | undefined {
  const alnum = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return Array.from(
      { length: 8 },
      () => chars[rng.int(0, chars.length - 1)]
    ).join("")
  }
  if (tender === "bkash") return `BK${alnum()}`
  if (tender === "nagad") return `NG${alnum()}`
  if (tender === "card") return `POS-${rng.int(100000, 999999)}`
  return undefined
}

/** An open basket line: billed later at the counter. */
export function openBasketLine(
  ctx: SeedCtx,
  patientId: Id,
  branch: BranchCode,
  at: Ms,
  line: LineInput,
  payerType: PayerType = "self",
  corporateClientId?: Id
): BasketLineRow {
  return ctx.bag.put("basketLines", ctx.seq("bl"), at, {
    patientId,
    branchId: branch,
    sourceType: line.sourceType,
    sourceId: line.sourceId,
    serviceType: line.serviceType,
    description: line.description,
    descriptionBn: line.descriptionBn,
    doctorId: line.doctorId,
    qty: line.qty,
    unitPriceP: line.unitPriceP,
    mrpP: line.mrpP,
    status: "open",
    payerType,
    corporateClientId,
  })
}

/** A fully paid invoice with its lines, payments, receipt and fee-share accruals. */
export function createPaidInvoice(
  ctx: SeedCtx,
  input: InvoiceInput
): InvoiceOut {
  const { bag } = ctx
  const rng = ctx.rng(`invoice:${input.patientId}:${input.at}`)
  const branch = getBranch(input.branch)
  const payerType = input.payerType ?? "self"

  const basket =
    input.basketLines ??
    input.lines.map((l) =>
      openBasketLine(
        ctx,
        input.patientId,
        input.branch,
        input.at - 4 * MINUTE,
        l,
        payerType,
        input.corporateClientId
      )
    )
  const subtotalP = input.lines.reduce((s, l) => s + l.qty * l.unitPriceP, 0)
  const discountPct = input.discountPct ?? 0
  const discountP = Math.round((subtotalP * discountPct) / 100)
  const totalP = subtotalP - discountP

  const invoice = bag.put("invoices", ctx.seq("inv"), input.at, {
    invoiceNo: "",
    companyId: branch.company,
    branchId: input.branch,
    patientId: input.patientId,
    date: dhakaDate(input.at),
    payerType,
    corporateClientId: input.corporateClientId,
    subtotalP,
    discountP,
    discountPct,
    discountApprovalId: input.discountApprovalId,
    taxP: 0,
    totalP,
    paidP: totalP,
    refundedP: 0,
    status: "paid",
    offline: input.offline,
    shiftId: input.shiftId,
    cashierId: input.cashierId,
  })
  const fy = fyTagOf(invoice.date)
  if (input.offline) {
    ctx.numbers.request(
      counterKey.offlineInvoice(branch.company, input.branch, fy),
      input.at,
      (n) => {
        invoice.invoiceNo = docNo.offlineInvoice(
          branch.company,
          input.branch,
          fy,
          n
        )
      }
    )
  } else {
    ctx.numbers.request(
      counterKey.invoice(branch.company, input.branch, fy),
      input.at,
      (n) => {
        invoice.invoiceNo = docNo.invoice(branch.company, input.branch, fy, n)
      }
    )
  }

  // Discount spread pro rata over the lines; the last line takes the rounding.
  let discountLeft = discountP
  const lines = input.lines.map((l, i) => {
    const amountP = l.qty * l.unitPriceP
    const lineDiscount =
      i === input.lines.length - 1
        ? discountLeft
        : Math.round((discountP * amountP) / Math.max(1, subtotalP))
    discountLeft -= lineDiscount
    const b = basket[i]
    b.status = "invoiced"
    b.updatedAt = input.at
    return bag.put("invoiceLines", ctx.seq("il"), input.at, {
      invoiceId: invoice.id,
      basketLineId: b.id,
      sourceType: l.sourceType,
      sourceId: l.sourceId,
      serviceType: l.serviceType,
      description: l.description,
      doctorId: l.doctorId,
      qty: l.qty,
      unitPriceP: l.unitPriceP,
      amountP,
      discountP: lineDiscount,
      netP: amountP - lineDiscount,
      status: "active",
    })
  })

  const splits = input.tenders ?? [{ tender: "cash" as Tender }]
  let left = totalP
  const payments = splits.map((s, i) => {
    const amountP =
      i === splits.length - 1 ? left : Math.min(left, s.amountP ?? 0)
    left -= amountP
    const id = ctx.seq("pay")
    const confirmedAt = input.at + (MFS.includes(s.tender) ? 45_000 : 5_000)
    return bag.put("payments", id, input.at, {
      invoiceId: invoice.id,
      patientId: input.patientId,
      branchId: input.branch,
      tender: s.tender,
      amountP,
      status: "confirmed",
      ref: tenderRef(rng, s.tender),
      idempotencyKey: `seed:${id}`,
      shiftId: input.shiftId,
      requestedAt: input.at,
      confirmedAt,
    })
  })

  const receipt = bag.put("receipts", ctx.seq("rcp"), input.at + 60_000, {
    receiptNo: "",
    invoiceId: invoice.id,
    paymentIds: payments.map((p) => p.id),
    patientId: input.patientId,
    branchId: input.branch,
    amountP: totalP,
    at: input.at + 60_000,
  })
  ctx.numbers.request(counterKey.receipt(input.branch), input.at, (n) => {
    receipt.receiptNo = docNo.receipt(input.branch, n)
  })

  const accruals: FeeShareAccrualRow[] = []
  const collectedAt = Math.max(
    ...payments.map((p) => p.confirmedAt ?? input.at)
  )
  lines.forEach((line) => {
    const a = accrueFeeShare(ctx, invoice, line, collectedAt)
    if (a) accruals.push(a)
  })

  return { invoice, lines, basketLines: basket, payments, receipt, accruals }
}

/** Fee-share accrual for a consultant's line, at collection (PRD §10.9). */
export function accrueFeeShare(
  ctx: SeedCtx,
  invoice: InvoiceRow,
  line: InvoiceLineRow,
  at: Ms
): FeeShareAccrualRow | undefined {
  if (!line.doctorId) return undefined
  const contract = contractFor(ctx, line.doctorId)
  if (!contract) return undefined
  const row = ctx.bag.get("feeShareContracts", contract.id)
  const rule = row.rules.find((r) => r.serviceType === line.serviceType)
  if (!rule) return undefined
  const shareP =
    rule.basis === "fixed"
      ? rule.value
      : Math.round((line.netP * rule.value) / 100)
  const whtP = Math.round((shareP * row.whtPct) / 100)
  const accrual = ctx.bag.put("feeShareAccruals", ctx.seq("fsa"), at, {
    doctorId: line.doctorId,
    invoiceId: invoice.id,
    invoiceLineId: line.id,
    contractId: contract.id,
    contractVersion: contract.version,
    serviceType: line.serviceType,
    month: monthOf(dhakaDate(at)),
    grossP: line.amountP,
    discountP: line.discountP,
    netP: line.netP,
    basis: rule.basis,
    shareP,
    whtP,
    at,
  })
  const patient = ctx.bag.get("patients", invoice.patientId)
  ctx.numbers.afterAssigned(() => {
    accrual.patientUhid = patient.uhid
  })
  return accrual
}

export type RefundOut = {
  refund: RefundRow
  creditNote: CreditNoteRow
  reversals: FeeShareAccrualRow[]
}

/**
 * Refund some lines of a paid invoice to the original tender, with a credit
 * note and a fee-share reversal line for each reversed accrual.
 */
export function refundInvoiceLines(
  ctx: SeedCtx,
  out: InvoiceOut,
  lineIds: Id[],
  at: Ms,
  reason: string,
  opts: { approvalId?: Id }
): RefundOut {
  const { bag } = ctx
  const { invoice } = out
  const lines = out.lines.filter((l) => lineIds.includes(l.id))
  const amountP = lines.reduce((s, l) => s + l.netP, 0)
  const payment = out.payments[0]

  const creditNote = bag.put("creditNotes", ctx.seq("cn"), at, {
    creditNoteNo: "",
    invoiceId: invoice.id,
    amountP,
    reason,
    lines: lines.map((l) => ({ invoiceLineId: l.id, amountP: l.netP })),
  })
  ctx.numbers.request(counterKey.creditNote(invoice.branchId), at, (n) => {
    creditNote.creditNoteNo = docNo.creditNote(invoice.branchId, n)
  })
  const refund = bag.put("refunds", ctx.seq("rf"), at, {
    refundNo: "",
    invoiceId: invoice.id,
    invoiceLineIds: lines.map((l) => l.id),
    paymentId: payment.id,
    tender: payment.tender,
    amountP,
    reason,
    approvalId: opts.approvalId,
    status: "completed",
    completedAt: at + 2 * MINUTE,
    creditNoteId: creditNote.id,
  })
  ctx.numbers.request(counterKey.refund(invoice.branchId), at, (n) => {
    refund.refundNo = docNo.refund(invoice.branchId, n)
  })
  for (const l of lines) {
    l.status = "refunded"
    l.updatedAt = at
  }
  invoice.refundedP += amountP
  invoice.status = invoice.refundedP >= invoice.totalP ? "refunded" : "paid"
  invoice.updatedAt = at
  if (invoice.status === "refunded") {
    for (const p of out.payments) {
      p.status = "refunded"
      p.updatedAt = at
    }
  }

  const reversals: FeeShareAccrualRow[] = []
  for (const original of out.accruals.filter((a) =>
    lineIds.includes(a.invoiceLineId)
  )) {
    const reversal = bag.put("feeShareAccruals", ctx.seq("fsa"), at, {
      doctorId: original.doctorId,
      invoiceId: original.invoiceId,
      invoiceLineId: original.invoiceLineId,
      contractId: original.contractId,
      contractVersion: original.contractVersion,
      serviceType: original.serviceType,
      month: monthOf(dhakaDate(at)),
      grossP: -original.grossP,
      discountP: -original.discountP,
      netP: -original.netP,
      basis: original.basis,
      shareP: -original.shareP,
      whtP: -original.whtP,
      reversalOfId: original.id,
      at,
    })
    ctx.numbers.afterAssigned(() => {
      reversal.patientUhid = original.patientUhid
    })
    reversals.push(reversal)
  }
  return { refund, creditNote, reversals }
}

/** Consult-fee line for an appointment. */
export function consultLine(
  appointmentId: Id,
  doctor: { id: Id; nameEn: string; nameBn: string },
  followUp: boolean,
  feeP: number
): LineInput {
  return {
    sourceType: "consult",
    sourceId: appointmentId,
    serviceType: followUp ? "follow-up" : "consultation",
    description: `${followUp ? "Follow-up" : "Consultation"}: ${doctor.nameEn}`,
    descriptionBn: `${followUp ? "ফলো-আপ" : "পরামর্শ"}: ${doctor.nameBn}`,
    doctorId: doctor.id,
    qty: 1,
    unitPriceP: feeP,
  }
}

/** Weighted tender mix for counter payments. */
export function pickTenders(rng: Rng, totalP: number): TenderSplit[] {
  const t = rng.weighted<Tender>([
    ["cash", 58],
    ["bkash", 22],
    ["card", 14],
    ["nagad", 6],
  ])
  if (t === "cash" && totalP > 150_000 && rng.bool(0.2)) {
    // Occasional mixed payment: part bKash, rest cash.
    return [
      { tender: "bkash", amountP: Math.round(totalP / 2 / 100) * 100 },
      { tender: "cash" },
    ]
  }
  return [{ tender: t }]
}
