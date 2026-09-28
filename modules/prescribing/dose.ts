/**
 * Rx pad shortcuts (objective §3A, plan §7.1): typing "1+0+1 pc 5" fills the
 * dose pattern, meal timing and duration, and the line expands to Bangla dose
 * words ("১+০+১ (সকালে ও রাতে) খাবারের পরে, ৫ দিন") with the course quantity.
 * Pure functions, shared by the Rx pad, the commands and the tests.
 */

import type { MealTiming } from "@/core/db/schema"
import {
  courseQuantity,
  doseInstruction,
  findDosePattern,
  type DosePattern,
} from "@/core/seed/content"

/** "½+0+½", "1-0-1", "1 + 0 + 1" and "sos" all become codes the dictionary knows. */
export function normaliseDoseCode(raw: string): string {
  const compact = raw
    .trim()
    .replace(/½/g, "1/2")
    .replace(/¼/g, "1/4")
    .replace(/\s+/g, "")
    .replace(/[-–]/g, "+")
  if (/^sos$/i.test(compact)) return "SOS"
  return compact
}

/** A dose code is valid when it is a known pattern or plain numbers joined by "+". */
export function isDoseCode(code: string): boolean {
  if (findDosePattern(code)) return true
  return /^(\d+(\/\d+)?)(\+(\d+(\/\d+)?)){1,4}$/.test(code)
}

/** Units per day: the dictionary value, or the sum of the parts of a custom pattern. */
export function perDayOf(code: string): number {
  const known = findDosePattern(code)
  if (known) return known.perDay
  if (!isDoseCode(code)) return 0
  return code.split("+").reduce((sum, part) => {
    const [n, d] = part.split("/").map(Number)
    return sum + (d ? n / d : n)
  }, 0)
}

/** Units to supply for a course; 0 for "when needed" or "continue" (the doctor types it). */
export function quantityFor(code: string, durationDays: number): number {
  if (durationDays <= 0) return 0
  if (findDosePattern(code)) return courseQuantity(code, durationDays)
  return Math.ceil(perDayOf(code) * durationDays)
}

export type ParsedDose = {
  /** Normalised dose code, e.g. "1+0+1" (empty when none was typed) */
  code: string
  pattern?: DosePattern
  valid: boolean
  meal?: MealTiming
  /** Days; 0 means "continue" */
  durationDays?: number
}

const MEAL_WORDS: Record<string, MealTiming> = {
  ac: "before",
  bf: "before",
  before: "before",
  pc: "after",
  af: "after",
  after: "after",
  with: "with",
  wm: "with",
  any: "any",
}

/**
 * Reads a typed shortcut: a dose pattern, optionally followed by meal timing
 * (AC before meals, PC after meals, "with") and a duration ("5", "5d", "x5",
 * "2w", "1m", "cont").
 */
export function parseDoseShortcut(text: string): ParsedDose {
  const tokens = text
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
  let code = ""
  let meal: MealTiming | undefined
  let durationDays: number | undefined
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (!code && (/[+½-]/.test(token) || lower === "sos")) {
      code = normaliseDoseCode(token)
      continue
    }
    if (lower in MEAL_WORDS) {
      meal = MEAL_WORDS[lower]
      continue
    }
    if (lower === "cont" || lower === "continue") {
      durationDays = 0
      continue
    }
    const days = /^x?(\d{1,3})(d|day|days)?$/.exec(lower)
    if (days) {
      durationDays = Number(days[1])
      continue
    }
    const weeks = /^x?(\d{1,2})(w|wk|wks|week|weeks)$/.exec(lower)
    if (weeks) {
      durationDays = Number(weeks[1]) * 7
      continue
    }
    const months = /^x?(\d{1,2})(m|mo|month|months)$/.exec(lower)
    if (months) durationDays = Number(months[1]) * 30
  }
  return {
    code,
    pattern: code ? findDosePattern(code) : undefined,
    valid: !!code && isDoseCode(code),
    meal,
    durationDays,
  }
}

/** The EN and BN instruction lines for a dose (the BN line is what the printed Rx shows). */
export function instructionsFor(
  code: string,
  meal: MealTiming,
  durationDays: number
) {
  return doseInstruction(code, meal, durationDays)
}
