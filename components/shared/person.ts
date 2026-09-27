import { ageOn, dhakaDate } from "@/core/clock/dates"
import type { Locale } from "@/lib/i18n/config"

/** A person's name in the window's language (Bangla falls back to English). */
export function nameIn(
  person: { nameEn: string; nameBn?: string },
  locale: Locale
): string {
  return locale === "bn" && person.nameBn ? person.nameBn : person.nameEn
}

/** The name in the other script, for a secondary line (or undefined). */
export function otherName(
  person: { nameEn: string; nameBn?: string },
  locale: Locale
): string | undefined {
  return locale === "bn" ? person.nameEn : person.nameBn
}

/**
 * "Dr. Kamal Hossain" to "Dr. Kamal", "Farhana Akter" to "Farhana": a title
 * that ends in a dot (Dr., ডা.) stays with the first name.
 */
export function firstNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length > 1 && parts[0].endsWith(".")) return `${parts[0]} ${parts[1]}`
  return parts[0] ?? fullName
}

/** Whole months between a date of birth and a Dhaka calendar day. */
function monthsBetween(dob: string, on: string): number {
  const [by, bm, bd] = dob.split("-").map(Number)
  const [y, m, d] = on.split("-").map(Number)
  let months = (y - by) * 12 + (m - bm)
  if (d < bd) months -= 1
  return Math.max(0, months)
}

/**
 * Age on the demo clock: whole years, or months under two years.
 * Returns the numbers so callers format them with the locale.
 */
export function ageOf(
  dob: string,
  nowMs: number
): { unit: "years" | "months"; value: number } {
  const today = dhakaDate(nowMs)
  const years = ageOn(dob, today)
  if (years < 2) return { unit: "months", value: monthsBetween(dob, today) }
  return { unit: "years", value: years }
}
