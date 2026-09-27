/**
 * Calendar helpers for the seed. Everything is anchored to the seed's `today`
 * (a Dhaka calendar day) and `now`; nothing reads the wall clock. Dhaka is
 * UTC+6 all year (no daylight saving), so a Dhaka wall time converts to epoch
 * milliseconds with a fixed offset.
 */

import { fiscalYearTag } from "@/config/brand.config"
import type { HHMM, ISODate, Ms } from "@/core/db/schema"

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
const DHAKA_OFFSET_MS = 6 * HOUR

function parts(iso: ISODate): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number)
  return [y, m, d]
}

const pad2 = (n: number) => String(n).padStart(2, "0")

function fromUtcDay(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isoAddDays(iso: ISODate, days: number): ISODate {
  const [y, m, d] = parts(iso)
  return fromUtcDay(Date.UTC(y, m - 1, d) + days * DAY)
}

/** Same day and month, `years` later (29 Feb falls back to 28 Feb). */
export function isoAddYears(iso: ISODate, years: number): ISODate {
  const [y, m, d] = parts(iso)
  const day = m === 2 && d === 29 ? 28 : d
  return `${y + years}-${pad2(m)}-${pad2(day)}`
}

/** 0 = Sunday ... 5 = Friday (the Bangladesh weekend) ... 6 = Saturday */
export function isoWeekday(iso: ISODate): number {
  const [y, m, d] = parts(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Epoch ms of a Dhaka wall time on a calendar day. */
export function dhakaAt(iso: ISODate, hhmm: HHMM): Ms {
  const [y, m, d] = parts(iso)
  const [hh, mm] = hhmm.split(":").map(Number)
  return Date.UTC(y, m - 1, d, hh, mm) - DHAKA_OFFSET_MS
}

/** Dhaka calendar day of an epoch ms. */
export function dhakaDate(ms: Ms): ISODate {
  return fromUtcDay(ms + DHAKA_OFFSET_MS)
}

/** Dhaka wall time (HH:MM) of an epoch ms. */
export function dhakaHHMM(ms: Ms): HHMM {
  return new Date(ms + DHAKA_OFFSET_MS).toISOString().slice(11, 16)
}

export function hhmmToMin(hhmm: HHMM): number {
  const [hh, mm] = hhmm.split(":").map(Number)
  return hh * 60 + mm
}

export function minToHHMM(min: number): HHMM {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`
}

/** YYYY-MM of a day. */
export function monthOf(iso: ISODate): string {
  return iso.slice(0, 7)
}

/** First day of the month containing `iso`. */
export function firstOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`
}

/** Every day of the calendar month before the one containing `iso`. */
export function previousMonthDays(iso: ISODate): ISODate[] {
  const lastDay = isoAddDays(firstOfMonth(iso), -1)
  const days: ISODate[] = []
  for (let d = firstOfMonth(lastDay); d <= lastDay; d = isoAddDays(d, 1)) {
    days.push(d)
  }
  return days
}

/** Whole years between a date of birth and a day. */
export function ageOn(dob: ISODate, iso: ISODate): number {
  const [by, bm, bd] = parts(dob)
  const [y, m, d] = parts(iso)
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age -= 1
  return age
}

/** Fiscal year tag used in invoice numbers ("2627" = FY 2026-27). */
export function fyTagOf(iso: ISODate): string {
  const [y, m] = parts(iso)
  // Local-time Date on purpose: fiscalYearTag reads getFullYear/getMonth.
  return fiscalYearTag(new Date(y, m - 1, 15))
}
