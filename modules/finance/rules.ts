import { rules } from "@/config/rules.config"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import type {
  FeeShareAccrualRow,
  FeeShareContractRow,
  GrnLineRow,
  Id,
  InvoiceLineRow,
  ISODate,
  MfsSettlementRow,
  PaymentRow,
  PoLineRow,
  Poisha,
  ThreeWayMatchRow,
  VendorInvoiceRow,
} from "@/core/db/schema"
import { priceOff } from "@/core/procurement/rules"
import { feeShareAmounts, feeShareRuleFor } from "@/modules/billing/pricing"

/**
 * Finance rules (plan §9 finance routes), kept pure so the commands, the
 * screens and the tests share one definition of every figure: MFS settlement
 * matching, mismatch resolutions and their payable amounts, payable aging,
 * fee-share reproduction and the corporate statement. Money is integer
 * poisha throughout.
 */

/* ------------------------------------------------------------------ *
 * Authorities and limits
 * ------------------------------------------------------------------ */

/**
 * The CFO's authority (plan §3.12 `prApproval`): the only persona holding it
 * approves purchase requests of any value, a mismatched vendor invoice paid
 * at the invoice price, and large corporate credit notes.
 */
export const CFO_AUTHORITY = "approve:pr:unlimited"

/**
 * A corporate credit note above this needs the CFO (PRD §10.10, CONFIRM:
 * HOSPITAL). Kept here until it moves to config/rules.config.ts.
 */
export const CORPORATE_CN_CFO_LIMIT_P: Poisha = 5_000_00

export function holdsCfo(authorities: readonly string[]): boolean {
  return authorities.includes("*") || authorities.includes(CFO_AUTHORITY)
}

/* ------------------------------------------------------------------ *
 * MFS settlement (PRD §9: bKash and Nagad settlement files)
 * ------------------------------------------------------------------ */

export type SettlementLine = MfsSettlementRow["lines"][number]
export type Provider = MfsSettlementRow["provider"]

export type MatchablePayment = Pick<
  PaymentRow,
  "id" | "tender" | "amountP" | "status" | "ref" | "requestedAt" | "confirmedAt"
>

/** Money that actually came in (confirmed, or confirmed and later refunded). */
export function moneyReceived(payment: Pick<PaymentRow, "status">): boolean {
  return payment.status === "confirmed" || payment.status === "refunded"
}

/** The Dhaka day a payment was received. */
export function paymentDay(payment: Pick<PaymentRow, "requestedAt" | "confirmedAt">): ISODate {
  return dhakaDate(payment.confirmedAt ?? payment.requestedAt)
}

/** Payments already matched by any settlement line (a payment matches once). */
export function matchedPaymentIds(
  settlements: readonly Pick<MfsSettlementRow, "id" | "lines">[],
  except?: { settlementId: Id; ref: string }
): Set<Id> {
  const taken = new Set<Id>()
  for (const settlement of settlements) {
    for (const line of settlement.lines) {
      if (except && settlement.id === except.settlementId && line.ref === except.ref) continue
      if (line.matchedPaymentId) taken.add(line.matchedPaymentId)
    }
  }
  return taken
}

/**
 * Import auto-match: each unmatched line is matched to a confirmed payment of
 * the same provider with exactly its transaction id and amount, that no other
 * line has matched. Lines matched already are kept as they are.
 */
export function autoMatchLines(
  provider: Provider,
  lines: readonly SettlementLine[],
  payments: readonly MatchablePayment[],
  taken: ReadonlySet<Id>
): { lines: SettlementLine[]; matched: number; unmatched: number } {
  const used = new Set(taken)
  let matched = 0
  const out = lines.map((line) => {
    if (line.matchedPaymentId) return line
    const payment = payments.find(
      (p) =>
        p.tender === provider &&
        moneyReceived(p) &&
        !!p.ref &&
        p.ref === line.ref &&
        p.amountP === line.amountP &&
        !used.has(p.id)
    )
    if (!payment) return line
    used.add(payment.id)
    matched += 1
    return { ...line, matchedPaymentId: payment.id, matchedBy: "auto" }
  })
  return { lines: out, matched, unmatched: out.filter((l) => !l.matchedPaymentId).length }
}

/** A file is reconciled once every line is matched. */
export function settlementStatus(
  lines: readonly SettlementLine[]
): "imported" | "reconciled" {
  return lines.every((line) => !!line.matchedPaymentId) ? "reconciled" : "imported"
}

export type CandidateKind = "mfs" | "cash"

/**
 * Why a payment cannot explain a settlement line, as a rule code, or null
 * when it can: money received on the settlement day, the same amount, not
 * matched already, and either the same provider or cash (the customer paid
 * by bKash but the counter recorded it as cash).
 */
export function candidateProblem(
  settlement: Pick<MfsSettlementRow, "provider" | "date">,
  line: Pick<SettlementLine, "amountP">,
  payment: MatchablePayment,
  taken: ReadonlySet<Id>
): string | null {
  if (!moneyReceived(payment)) return "MATCH_NOT_RECEIVED"
  if (payment.tender !== settlement.provider && payment.tender !== "cash") {
    return "MATCH_WRONG_TENDER"
  }
  if (payment.amountP !== line.amountP) return "MATCH_AMOUNT_DIFFERS"
  if (paymentDay(payment) !== settlement.date) return "MATCH_WRONG_DAY"
  if (taken.has(payment.id)) return "PAYMENT_ALREADY_MATCHED"
  return null
}

/** Candidates for matching an unmatched line by hand: the provider's own payments first. */
export function handMatchCandidates<P extends MatchablePayment>(
  settlement: Pick<MfsSettlementRow, "provider" | "date">,
  line: Pick<SettlementLine, "amountP">,
  payments: readonly P[],
  taken: ReadonlySet<Id>
): { payment: P; kind: CandidateKind }[] {
  return payments
    .filter((p) => candidateProblem(settlement, line, p, taken) === null)
    .map((payment) => ({
      payment,
      kind: (payment.tender === "cash" ? "cash" : "mfs") as CandidateKind,
    }))
    .sort(
      (a, b) =>
        (a.kind === "mfs" ? 0 : 1) - (b.kind === "mfs" ? 0 : 1) ||
        (a.payment.confirmedAt ?? a.payment.requestedAt) -
          (b.payment.confirmedAt ?? b.payment.requestedAt)
    )
}

/* ------------------------------------------------------------------ *
 * Three-way mismatch resolution (PRD §8.7)
 * ------------------------------------------------------------------ */

export type Resolution = NonNullable<ThreeWayMatchRow["resolution"]>
export const RESOLUTIONS: readonly Resolution[] = [
  "pay-po-price",
  "accept-invoice",
  "reject-invoice",
]

/** Quantity accepted on the match's goods receipts, by PO line. */
export function acceptedByPoLine(
  grnLines: readonly Pick<GrnLineRow, "grnId" | "poLineId" | "qtyAccepted">[],
  grnIds: readonly Id[]
): Record<Id, number> {
  const out: Record<Id, number> = {}
  for (const line of grnLines) {
    if (!grnIds.includes(line.grnId)) continue
    out[line.poLineId] = (out[line.poLineId] ?? 0) + line.qtyAccepted
  }
  return out
}

/**
 * "Pay at the PO price": for every invoice line, the quantity billed but no
 * more than was accepted into stock, at the price on the purchase order.
 */
export function payAtPoPriceP(
  invoiceLines: VendorInvoiceRow["lines"],
  poLines: readonly Pick<PoLineRow, "id" | "unitCostP">[],
  accepted: Readonly<Record<Id, number>>
): Poisha {
  const byId = new Map(poLines.map((line) => [line.id, line]))
  let total = 0
  for (const line of invoiceLines) {
    const po = byId.get(line.poLineId)
    if (!po) continue
    total += Math.min(line.qty, accepted[line.poLineId] ?? 0) * po.unitCostP
  }
  return total
}

/**
 * Accepting the invoice as billed pays outside the three-way tolerances
 * (quantity exact, price within ±2%) when any difference breaks them, which
 * needs the CFO.
 */
export function acceptNeedsCfo(
  diffs: ThreeWayMatchRow["diffs"],
  tolerance: { quantityTolerance: number; priceTolerancePct: number } = rules.threeWayMatch
): boolean {
  return diffs.some((diff) =>
    diff.field === "price"
      ? priceOff(diff.po, diff.invoice, tolerance.priceTolerancePct)
      : Math.abs(diff.invoice - diff.grn) > tolerance.quantityTolerance
  )
}

/** How far the invoice is from what it is compared with, in percent (null when undefined). */
export function diffPct(diff: ThreeWayMatchRow["diffs"][number]): number | null {
  const base = diff.field === "price" ? diff.po : diff.grn
  if (!base) return null
  return ((diff.invoice - base) * 100) / base
}

/** What the payable comes to for a resolution; null when no payable is created. */
export function resolutionAmountP(
  resolution: Resolution,
  opts: {
    vendorInvoice: Pick<VendorInvoiceRow, "amountP" | "lines">
    poLines: readonly Pick<PoLineRow, "id" | "unitCostP">[]
    accepted: Readonly<Record<Id, number>>
  }
): Poisha | null {
  if (resolution === "reject-invoice") return null
  if (resolution === "accept-invoice") return opts.vendorInvoice.amountP
  return payAtPoPriceP(opts.vendorInvoice.lines, opts.poLines, opts.accepted)
}

/* ------------------------------------------------------------------ *
 * Payables
 * ------------------------------------------------------------------ */

export type AgingBucket = "not-due" | "d1-30" | "d31-60" | "d60plus"
export const AGING_BUCKETS: readonly AgingBucket[] = ["not-due", "d1-30", "d31-60", "d60plus"]

/** Whole days a due date is behind today (0 or less: not overdue). */
export function daysOverdue(dueDate: ISODate, today: ISODate): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`)
  const day = Date.parse(`${today}T00:00:00Z`)
  return Math.round((day - due) / 86_400_000)
}

export function isOverdue(dueDate: ISODate, today: ISODate): boolean {
  return dueDate < today
}

export function agingBucket(dueDate: ISODate, today: ISODate): AgingBucket {
  const days = daysOverdue(dueDate, today)
  if (days <= 0) return "not-due"
  if (days <= 30) return "d1-30"
  if (days <= 60) return "d31-60"
  return "d60plus"
}

/** Day of the week of a calendar day, 0 Sunday to 6 Saturday. */
function weekday(day: ISODate): number {
  const days = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000)
  // 01-01-1970 was a Thursday.
  return (((days + 4) % 7) + 7) % 7
}

/** The next payment run: the coming Thursday (the weekly bank run), at least tomorrow. */
export function nextPaymentRun(today: ISODate): ISODate {
  for (let i = 1; i <= 7; i++) {
    const day = addDaysISO(today, i)
    if (weekday(day) === 4) return day
  }
  return addDaysISO(today, 1)
}

/** A stable 32-bit hash of a string (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/**
 * Reference of a simulated bank transfer (BEFTN) for a payable, derived from
 * its id so the command stays deterministic, e.g. "BEFTN-7Q2M9XKD".
 */
export function bankTransferRef(payableId: Id): string {
  let out = ""
  let h = hash(`beftn:${payableId}`)
  for (let i = 0; i < 8; i++) {
    if (i === 6) h = hash(`beftn:${payableId}:${i}`)
    out += REF_ALPHABET[h % REF_ALPHABET.length]
    h = Math.floor(h / REF_ALPHABET.length)
  }
  return `BEFTN-${out}`
}

/* ------------------------------------------------------------------ *
 * Fee-share statement (PRD §10.9)
 * ------------------------------------------------------------------ */

export type ReproduceIssue =
  | "line-missing"
  | "contract-missing"
  | "version-mismatch"
  | "no-rule"
  | "original-missing"
  | "amounts"

export type AccrualAmounts = Pick<
  FeeShareAccrualRow,
  "grossP" | "discountP" | "netP" | "shareP" | "whtP"
>

/**
 * Recompute one statement line from its invoice line and the contract version
 * it names, with the same fee-share maths billing used when it accrued
 * (`feeShareAmounts`). A reversal must be the exact negative of the line it
 * reverses, recomputed the same way.
 */
export function reproduceAccrual(
  accrual: FeeShareAccrualRow,
  ctx: {
    line?: Pick<InvoiceLineRow, "id" | "serviceType" | "amountP" | "discountP" | "netP">
    contract?: FeeShareContractRow
    original?: FeeShareAccrualRow
  }
): { ok: true; expected: AccrualAmounts } | { ok: false; issue: ReproduceIssue } {
  const { line, contract } = ctx
  if (!line) return { ok: false, issue: "line-missing" }
  if (!contract) return { ok: false, issue: "contract-missing" }
  if (contract.contractVersion !== accrual.contractVersion || contract.doctorId !== accrual.doctorId) {
    return { ok: false, issue: "version-mismatch" }
  }
  if (accrual.reversalOfId) {
    const original = ctx.original
    if (
      !original ||
      original.invoiceLineId !== accrual.invoiceLineId ||
      original.doctorId !== accrual.doctorId
    ) {
      return { ok: false, issue: "original-missing" }
    }
  }
  const rule = feeShareRuleFor(contract, line.serviceType)
  if (!rule) return { ok: false, issue: "no-rule" }
  const { shareP, whtP } = feeShareAmounts(rule, contract, line)
  const sign = accrual.reversalOfId ? -1 : 1
  const expected: AccrualAmounts = {
    grossP: sign * line.amountP,
    discountP: sign * line.discountP,
    netP: sign * line.netP,
    shareP: sign * shareP,
    whtP: sign * whtP,
  }
  const same =
    accrual.basis === rule.basis &&
    accrual.grossP === expected.grossP &&
    accrual.discountP === expected.discountP &&
    accrual.netP === expected.netP &&
    accrual.shareP === expected.shareP &&
    accrual.whtP === expected.whtP
  return same ? { ok: true, expected } : { ok: false, issue: "amounts" }
}

export type StatementTotals = AccrualAmounts & { payableP: Poisha; lines: number; reversals: number }

/** Statement totals: payable to the consultant is the share less withholding tax. */
export function statementTotals(accruals: readonly FeeShareAccrualRow[]): StatementTotals {
  const totals: StatementTotals = {
    grossP: 0,
    discountP: 0,
    netP: 0,
    shareP: 0,
    whtP: 0,
    payableP: 0,
    lines: accruals.length,
    reversals: 0,
  }
  for (const accrual of accruals) {
    totals.grossP += accrual.grossP
    totals.discountP += accrual.discountP
    totals.netP += accrual.netP
    totals.shareP += accrual.shareP
    totals.whtP += accrual.whtP
    if (accrual.reversalOfId) totals.reversals += 1
  }
  totals.payableP = totals.shareP - totals.whtP
  return totals
}

/** "2026-08" to the month before. */
export function previousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number)
  const prev = m === 1 ? { y: year - 1, m: 12 } : { y: year, m: m - 1 }
  return `${prev.y}-${String(prev.m).padStart(2, "0")}`
}

/* ------------------------------------------------------------------ *
 * Corporate statement (PRD §10.10)
 * ------------------------------------------------------------------ */

export type CorporateMoney = {
  /** Invoice total after the contract discount (the contract price) */
  totalP: Poisha
  /** What the patient paid at the counter (the co-pay and any self-pay lines), less refunds */
  coPayP: Poisha
  /** What the company's account was charged, less refunds back to it */
  companyShareP: Poisha
  /** Credit notes issued on a dispute */
  creditNotesP: Poisha
  /** What the company owes for this invoice */
  dueP: Poisha
}

/** One invoice's line on the company's statement. */
export function corporateMoney(opts: {
  totalP: Poisha
  payments: readonly Pick<PaymentRow, "tender" | "amountP" | "status">[]
  refunds: readonly { tender: string; amountP: Poisha; status: string }[]
  disputes: readonly { amountP: Poisha }[]
}): CorporateMoney {
  const received = opts.payments.filter(moneyReceived)
  const refunded = opts.refunds.filter((r) => r.status === "completed")
  const sum = (rows: readonly { amountP: Poisha }[]) => rows.reduce((s, r) => s + r.amountP, 0)
  const companyShareP =
    sum(received.filter((p) => p.tender === "corporate")) -
    sum(refunded.filter((r) => r.tender === "corporate"))
  const coPayP =
    sum(received.filter((p) => p.tender !== "corporate")) -
    sum(refunded.filter((r) => r.tender !== "corporate"))
  const creditNotesP = sum(opts.disputes)
  return {
    totalP: opts.totalP,
    coPayP,
    companyShareP,
    creditNotesP,
    dueP: companyShareP - creditNotesP,
  }
}

/** The most a new dispute credit note on an invoice may be: its company share not credited yet. */
export function creditNoteRoomP(money: Pick<CorporateMoney, "companyShareP" | "creditNotesP">): Poisha {
  return Math.max(0, money.companyShareP - money.creditNotesP)
}
