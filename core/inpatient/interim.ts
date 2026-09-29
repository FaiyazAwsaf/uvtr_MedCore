import { rules } from "@/config/rules.config"
import type { Ms, Poisha, WardRow } from "@/core/db/schema"

/**
 * The interim bill of an inpatient stay (plan §5.8: "derived from bed days on
 * the demo clock plus services"). Administrative billing only, never a
 * clinical record. Pure, so the bed board, the deposit desk, the deposit
 * sweeper (WS-J) and the seed all compute the same figures. Charges accrue
 * per started 24-hour period since admission (at least one), so moving the
 * demo clock forward a day adds a day's charges. After a bed transfer, each
 * day is charged at the ward the patient was in when that day began.
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

type Ward = Pick<WardRow, "kind" | "bedDayRateP">

/** The ward a stay was in from a moment on; the first starts at admission. */
export type WardSegment = { from: Ms; ward: Ward }

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
 * follow-up fee; less the deposits received. `segments` (after transfers)
 * give the ward of each part of the stay; without them the whole stay is in
 * `ward`. Days at different rates are separate lines.
 */
export function interimBill(opts: {
  admittedAt: Ms
  at: Ms
  ward: Ward
  segments?: readonly WardSegment[]
  consultantRoundP: Poisha
  depositsP: Poisha
}): InterimBill {
  const days = bedDays(opts.admittedAt, opts.at)
  const segments = [...(opts.segments?.length ? opts.segments : [{ from: opts.admittedAt, ward: opts.ward }])]
    .sort((a, b) => a.from - b.from)
  const wardOfDay = (day: number): Ward => {
    const start = opts.admittedAt + day * DAY_MS
    let ward = segments[0].ward
    for (const segment of segments) if (segment.from <= start) ward = segment.ward
    return ward
  }
  const lines: InterimLine[] = []
  const add = (kind: InterimLine["kind"], unitP: Poisha) => {
    if (unitP <= 0) return
    const same = lines.find((l) => l.kind === kind && l.unitP === unitP)
    if (same) {
      same.qty += 1
      same.amountP += unitP
    } else {
      lines.push({ kind, qty: 1, unitP, amountP: unitP })
    }
  }
  for (let day = 0; day < days; day++) {
    const ward = wardOfDay(day)
    add("bed", ward.bedDayRateP)
    add("nursing", NURSING_PER_DAY_P[ward.kind])
  }
  for (let day = 0; day < days; day++) add("consultant", opts.consultantRoundP)
  const order: InterimLine["kind"][] = ["bed", "nursing", "consultant"]
  lines.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
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
