import type {
  Id,
  Ms,
  PaymentRow,
  Poisha,
  RefundRow,
  ShiftRow,
} from "@/core/db/schema"

/**
 * Cash-shift arithmetic (plan §9, PRD §9), shared by `billing.closeShift`
 * and the shift screen so the figure the cashier sees is the one the
 * command checks.
 */

/** Bangladeshi taka notes and coins counted at close, largest first. */
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const
export type Denomination = (typeof DENOMINATIONS)[number]

/** ৳5 and ৳2 come as notes and coins, ৳1 as a coin: counted together. */
export const SMALL_DENOMINATIONS: readonly Denomination[] = [5, 2, 1]

/** Counted cash in poisha from a denomination count ("1000" → number of notes). */
export function countedFrom(denominations: Record<string, number>): Poisha {
  let total = 0
  for (const value of DENOMINATIONS) {
    const count = denominations[String(value)] ?? 0
    total += value * 100 * Math.max(0, Math.floor(count))
  }
  return total
}

/** A whole-taka count that makes up an amount, largest notes first (setup and tests). */
export function denominationsFor(poisha: Poisha): Record<string, number> {
  let taka = Math.floor(Math.max(0, poisha) / 100)
  const out: Record<string, number> = {}
  for (const value of DENOMINATIONS) {
    const count = Math.floor(taka / value)
    if (count > 0) out[String(value)] = count
    taka -= count * value
  }
  return out
}

export type ShiftCash = {
  /** Confirmed cash taken on the shift */
  cashInP: Poisha
  /** Cash the cashier paid out as refunds while the shift was open */
  cashRefundsP: Poisha
  /** Float plus cash taken minus cash refunded */
  expectedP: Poisha
}

/**
 * What the drawer should hold: the opening float, plus confirmed cash taken
 * on this shift, minus cash refunds this cashier paid out while it was open
 * (refunds are not tied to a shift row, so they count by who and when).
 */
export function shiftCash(
  shift: Pick<
    ShiftRow,
    "id" | "floatP" | "cashierId" | "openedAt" | "closedAt"
  >,
  payments: readonly Pick<
    PaymentRow,
    "shiftId" | "tender" | "status" | "amountP"
  >[],
  refunds: readonly Pick<
    RefundRow,
    "tender" | "status" | "createdBy" | "createdAt" | "amountP"
  >[]
): ShiftCash {
  const cashInP = payments
    .filter(
      (p) =>
        p.shiftId === shift.id &&
        p.tender === "cash" &&
        (p.status === "confirmed" || p.status === "refunded")
    )
    .reduce((sum, p) => sum + p.amountP, 0)
  // An open shift takes every refund since it opened; a closed one stops at its close.
  const until = shift.closedAt ?? Number.POSITIVE_INFINITY
  const cashRefundsP = refunds
    .filter((r) => isShiftCashRefund(r, shift.cashierId, shift.openedAt, until))
    .reduce((sum, r) => sum + r.amountP, 0)
  return {
    cashInP,
    cashRefundsP,
    expectedP: shift.floatP + cashInP - cashRefundsP,
  }
}

/** A completed cash refund paid out by this cashier between two times. */
export function isShiftCashRefund(
  refund: Pick<RefundRow, "tender" | "status" | "createdBy" | "createdAt">,
  cashierId: Id,
  from: Ms,
  until: Ms
): boolean {
  return (
    refund.tender === "cash" &&
    refund.status === "completed" &&
    refund.createdBy === cashierId &&
    refund.createdAt >= from &&
    refund.createdAt <= until
  )
}
