import { rules } from "@/config/rules.config"
import type { Ms, Poisha, WardRow } from "@/core/db/schema"

/**
 * The interim bill of an inpatient stay (plan §5.8: "derived from bed days on
 * the demo clock plus services"). Administrative billing only, never a
 * clinical record. Pure, so the bed board, the deposit desk, the deposit
 * sweeper (WS-J) and the seed all compute the same figures. Charges accrue
 * per started 24-hour period since admission (at least one), so moving the
 * demo clock forward a day adds a day's charges.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Daily nursing and ward services by ward kind (CONFIRM: HOSPITAL tariff). */
export const NURSING_PER_DAY_P: Record<WardRow["kind"], Poisha> = {
  general: 500_00,
  "semi-private": 800_00,
  cabin: 1_200_00,
  paediatric: 600_00,
}

/** Started 24-hour periods from admission to `at`, at least 1. */
export function bedDays(admittedAt: Ms, at: Ms): number {
  return Math.max(1, Math.ceil((at - admittedAt) / DAY_MS))
}

export type InterimLine = {
  kind: "bed" | "nursing" | "consultant"
  qty: number
  unitP: Poisha
  amountP: Poisha
}

export type InterimBill = {
  days: number
  lines: InterimLine[]
  chargesP: Poisha
  depositsP: Poisha
  /** Deposit left after the charges so far (negative when the stay owes money) */
  balanceP: Poisha
  /** Deposit left is below rules.depositThresholdP (PRD §8.8) */
  low: boolean
}

/**
 * Charges to date for a stay: bed days at the ward's rate, the ward's daily
 * nursing and services, and one consultant round a day at the consultant's
 * follow-up fee; less the deposits received.
 */
export function interimBill(opts: {
  admittedAt: Ms
  at: Ms
  ward: Pick<WardRow, "kind" | "bedDayRateP">
  consultantRoundP: Poisha
  depositsP: Poisha
}): InterimBill {
  const days = bedDays(opts.admittedAt, opts.at)
  const line = (kind: InterimLine["kind"], unitP: Poisha): InterimLine => ({
    kind,
    qty: days,
    unitP,
    amountP: unitP * days,
  })
  const lines = [
    line("bed", opts.ward.bedDayRateP),
    line("nursing", NURSING_PER_DAY_P[opts.ward.kind]),
    line("consultant", opts.consultantRoundP),
  ].filter((l) => l.unitP > 0)
  const chargesP = lines.reduce((sum, l) => sum + l.amountP, 0)
  const balanceP = opts.depositsP - chargesP
  return {
    days,
    lines,
    chargesP,
    depositsP: opts.depositsP,
    balanceP,
    low: balanceP < rules.depositThresholdP,
  }
}

/** A day's charges for a ward and consultant (deposit planning). */
export function dailyChargeP(
  ward: Pick<WardRow, "kind" | "bedDayRateP">,
  consultantRoundP: Poisha
): Poisha {
  return ward.bedDayRateP + NURSING_PER_DAY_P[ward.kind] + consultantRoundP
}
