import type { HHMM, ISODate, Ms } from "@/core/db/schema"

/**
 * Dhaka calendar helpers. Bangladesh is UTC+6 with no daylight saving, so
 * shifting by a fixed offset is exact.
 */
export const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** YYYY-MM-DD in Dhaka for a moment. */
export function dhakaDate(ms: Ms): ISODate {
  return new Date(ms + DHAKA_OFFSET_MS).toISOString().slice(0, 10)
}

/** HH:MM in Dhaka for a moment. */
export function dhakaTime(ms: Ms): HHMM {
  return new Date(ms + DHAKA_OFFSET_MS).toISOString().slice(11, 16)
}

/** The moment a Dhaka calendar day starts (00:00 Dhaka). */
export function startOfDhakaDay(date: ISODate): Ms {
  return Date.parse(`${date}T00:00:00.000Z`) - DHAKA_OFFSET_MS
}

/** The moment of a Dhaka wall-clock time on a Dhaka day. */
export function atDhaka(date: ISODate, time: HHMM): Ms {
  const [h, m] = time.split(":").map(Number)
  return startOfDhakaDay(date) + h * HOUR + m * MINUTE
}

/** Add whole days to a calendar day. */
export function addDaysISO(date: ISODate, days: number): ISODate {
  return dhakaDate(startOfDhakaDay(date) + days * DAY + HOUR)
}

/** Age in whole years on a given day. */
export function ageOn(dob: ISODate, on: ISODate): number {
  const [by, bm, bd] = dob.split("-").map(Number)
  const [y, m, d] = on.split("-").map(Number)
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age -= 1
  return age
}
