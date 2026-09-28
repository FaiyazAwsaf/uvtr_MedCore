/**
 * Pharmacy rules as pure functions (PRD §9 Pharmacy, §10.5; plan §5.6). The
 * commands and the screens share them, so what the pharmacist sees is exactly
 * what the engine will accept.
 */

import { rules } from "@/config/rules.config"
import { addDaysISO, DAY } from "@/core/clock/dates"
import type {
  ISODate,
  Ms,
  PackSize,
  PharmacyQueueRow,
  RxLineRow,
  RxLineStatus,
} from "@/core/db/schema"

/** Lines that need nothing more from the pharmacy. */
export const FINAL_LINE_STATUSES: RxLineStatus[] = [
  "dispensed",
  "bought-elsewhere",
  "cancelled",
]

export function isFinalLine(line: Pick<RxLineRow, "status">): boolean {
  return FINAL_LINE_STATUSES.includes(line.status)
}

/** Units still owed on an Rx line. */
export function outstandingOf(line: Pick<RxLineRow, "qtyPrescribed" | "dispensedQty">): number {
  return Math.max(0, line.qtyPrescribed - line.dispensedQty)
}

/** A partial balance past its deadline (derived on read, plan §3.8). */
export function balanceExpired(
  line: Pick<RxLineRow, "status" | "balanceUntil">,
  now: Ms
): boolean {
  return line.status === "partial" && line.balanceUntil !== undefined && now > line.balanceUntil
}

/** Days left on an open balance, rounded up (0 or less once it has expired). */
export function balanceDaysLeft(balanceUntil: Ms, now: Ms): number {
  return Math.ceil((balanceUntil - now) / DAY)
}

/** When a partial dispense made now keeps its balance open until (rules.dispenseBalanceDays). */
export function balanceDeadline(now: Ms): Ms {
  return now + rules.dispenseBalanceDays * DAY
}

export type DispenseBlock =
  | "unpaid"
  | "no-brand"
  | "awaiting-prescriber"
  | "final"
  | "balance-expired"
  | "nothing-outstanding"

/**
 * Why a line cannot be dispensed right now, or null when it can. Payment is
 * the gate (INV-10): only paid lines are ever dispensed.
 */
export function dispenseBlock(
  line: Pick<
    RxLineRow,
    "status" | "paymentCleared" | "brandId" | "balanceUntil" | "qtyPrescribed" | "dispensedQty"
  >,
  now: Ms
): DispenseBlock | null {
  if (isFinalLine(line)) return "final"
  if (line.status === "awaiting-prescriber") return "awaiting-prescriber"
  if (!line.brandId) return "no-brand"
  if (balanceExpired(line, now)) return "balance-expired"
  if (outstandingOf(line) <= 0) return "nothing-outstanding"
  if (!line.paymentCleared) return "unpaid"
  return null
}

/**
 * The queue status after a change to an Rx's lines: done when every line is
 * settled, partial once something was dispensed but more is owed, in progress
 * when the pharmacy acted without dispensing yet (a substitution request, a
 * line bought elsewhere), waiting otherwise.
 */
export function queueStatusFor(
  lines: Pick<RxLineRow, "status" | "dispensedQty">[]
): PharmacyQueueRow["status"] {
  if (lines.length && lines.every(isFinalLine)) return "done"
  if (lines.some((l) => l.dispensedQty > 0)) return "partial"
  if (lines.some((l) => l.status !== "open")) return "in-progress"
  return "waiting"
}

/* ---------------- Pack rounding ---------------- */

/** Units per strip for solid forms sold by the strip; undefined otherwise. */
export function stripSizeOf(packSizes: PackSize[]): number | undefined {
  const size = packSizes.find((p) => p.stripSize)?.stripSize
  return size && size > 1 ? size : undefined
}

/** "28" as 2 whole strips and 8 loose units (strip size 10). */
export function packBreakdown(
  qty: number,
  stripSize: number | undefined
): { strips: number; loose: number } {
  if (!stripSize) return { strips: 0, loose: qty }
  return { strips: Math.floor(qty / stripSize), loose: qty % stripSize }
}

/**
 * Pack rounding (PRD §10.5): the nearest whole-strip quantity that stays
 * within `max` (what is owed and in stock), rounding up when a full strip
 * still fits and down otherwise. Below one strip the quantity is kept.
 */
export function roundToStrips(qty: number, stripSize: number | undefined, max: number): number {
  if (!stripSize || qty <= 0) return Math.min(qty, max)
  const up = Math.ceil(qty / stripSize) * stripSize
  if (up <= max) return up
  const down = Math.floor(Math.min(qty, max) / stripSize) * stripSize
  return down > 0 ? down : Math.min(qty, max)
}

/* ---------------- Course and expiry ---------------- */

/** Last day of the course if it starts today (duration 0 means "continue"). */
export function courseEndDate(today: ISODate, durationDays: number): ISODate | null {
  if (durationDays <= 0) return null
  return addDaysISO(today, durationDays - 1)
}

/** PRD §10.5: warn when a batch expires before the course ends. */
export function expiresBeforeCourseEnd(expiry: ISODate, courseEnd: ISODate | null): boolean {
  return courseEnd !== null && expiry < courseEnd
}

/* ---------------- Identity check (HAZ-01) ---------------- */

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯"

/** Latin digits only (Bangla digits converted), everything else dropped. */
export function digitsOnly(value: string): string {
  let out = ""
  for (const ch of value) {
    const bn = BANGLA_DIGITS.indexOf(ch)
    if (bn >= 0) out += String(bn)
    else if (ch >= "0" && ch <= "9") out += ch
  }
  return out
}

export type IdentityMatch = "dob" | "phone" | null

/**
 * The second identifier at dispensing (HAZ-01): the patient states their date
 * of birth (DD-MM-YYYY or YYYY-MM-DD, any separators) or their phone number
 * (in full, or at least its last 4 digits).
 */
export function matchIdentity(
  input: string,
  patient: { dob: ISODate; phone?: string }
): IdentityMatch {
  const typed = digitsOnly(input)
  if (typed.length < 4) return null
  const [y, m, d] = patient.dob.split("-")
  if (typed === `${d}${m}${y}` || typed === `${y}${m}${d}`) return "dob"
  // Unpadded dates such as 5-3-1964 or ৫/৩/১৯৬৪
  const parts = input
    .split(/[^0-9০-৯]+/)
    .map((part) => digitsOnly(part))
    .filter(Boolean)
    .map(Number)
  if (parts.length === 3) {
    const [yn, mn, dn] = [Number(y), Number(m), Number(d)]
    const [a, b, c] = parts
    if ((a === dn && b === mn && c === yn) || (a === yn && b === mn && c === dn)) return "dob"
  }
  const phone = digitsOnly(patient.phone ?? "")
  if (phone && (typed === phone || (typed.length < phone.length && phone.endsWith(typed)))) {
    return "phone"
  }
  return null
}
