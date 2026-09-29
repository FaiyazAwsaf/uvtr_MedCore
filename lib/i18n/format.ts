import { now } from "@/core/clock/clock"
import { groupUhid } from "@/core/db/numbering"
import type { Locale } from "./config"

const INTL: Record<Locale, string> = {
  // en-IN: Bangladesh uses lakh/crore grouping (1,23,456) in English too.
  en: "en-IN",
  // -u-nu-beng switches the numbering system to Bengali numerals (১২৩৪)
  bn: "bn-BD-u-nu-beng",
}

export const TIME_ZONE = "Asia/Dhaka"

export const CURRENCY_SYMBOL: Record<string, string> = { BDT: "৳", USD: "$" }

export function intlLocale(locale: Locale) {
  return INTL[locale]
}

export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {}
) {
  // The default of 0 fraction digits would conflict with a caller that only
  // passes minimumFractionDigits, so raise the ceiling to match.
  const minimum = options.minimumFractionDigits
  const maximum =
    options.maximumFractionDigits ?? (minimum !== undefined ? minimum : 0)

  return new Intl.NumberFormat(INTL[locale], {
    ...options,
    maximumFractionDigits: Math.max(maximum, minimum ?? 0),
  }).format(value)
}

export function formatDecimal(value: number, locale: Locale, digits = 1) {
  return formatNumber(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatPercent(value: number, locale: Locale, digits = 1) {
  return new Intl.NumberFormat(INTL[locale], {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100)
}

export function formatCurrency(
  value: number,
  locale: Locale,
  currency: string,
  options: Intl.NumberFormatOptions = {}
) {
  // en-US renders BDT as the ISO code rather than ৳, so the symbol is applied
  // by hand for both currencies to keep every figure consistent.
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `
  const negative = value < 0
  const formatted = new Intl.NumberFormat(INTL[locale], {
    maximumFractionDigits: 0,
    ...options,
  }).format(Math.abs(value))
  return `${negative ? "-" : ""}${symbol}${formatted}`
}

/**
 * Short money for dense cells and chart axes: ৳১২.৫ লা / $12.5K.
 * Intl renders BDT as the literal code "BDT" in compact notation, which reads
 * badly in a dense cell, so the symbol is applied by hand.
 */
export function formatCompactCurrency(
  value: number,
  locale: Locale,
  currency: string
) {
  const symbol = CURRENCY_SYMBOL[currency] ?? currency
  const negative = value < 0
  const compact = new Intl.NumberFormat(INTL[locale], {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.abs(value))
  return `${negative ? "-" : ""}${symbol}${compact}`
}

export function formatCompact(value: number, locale: Locale) {
  return new Intl.NumberFormat(INTL[locale], {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatDate(
  date: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
) {
  return new Intl.DateTimeFormat(INTL[locale], { timeZone: TIME_ZONE, ...options }).format(
    new Date(date)
  )
}

/**
 * Bangla clock time with the day period in words and first, as it is said:
 * "সকাল ১১:৩০", "বিকাল ৫:৩০" (Intl's plain bn format prints a Latin "AM").
 */
function bnTime(date: Date, withDate: boolean): string {
  const parts = new Intl.DateTimeFormat(INTL.bn, {
    timeZone: TIME_ZONE,
    ...(withDate ? { day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
    dayPeriod: "short",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  const time = `${get("dayPeriod")} ${get("hour")}:${get("minute")}`.trim()
  return withDate ? `${get("day")} ${get("month")}, ${time}` : time
}

export function formatTime(date: Date | string | number, locale: Locale) {
  if (locale === "bn") return bnTime(new Date(date), false)
  return new Intl.DateTimeFormat(INTL[locale], {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date))
}

export function formatDateTime(date: Date | string | number, locale: Locale) {
  if (locale === "bn") return bnTime(new Date(date), true)
  return new Intl.DateTimeFormat(INTL[locale], {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date))
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
]

/**
 * Bangla relative time is written by hand rather than delegated to ICU: Node
 * and Chrome ship different spellings for some units (ঘন্টা vs ঘণ্টা), which
 * produces a hydration mismatch on every server-rendered timestamp.
 */
const BN_UNITS: Record<string, string> = {
  year: "বছর",
  month: "মাস",
  week: "সপ্তাহ",
  day: "দিন",
  hour: "ঘণ্টা",
  minute: "মিনিট",
  second: "সেকেন্ড",
}

function formatRelativeBangla(
  value: number,
  unit: Intl.RelativeTimeFormatUnit
) {
  const amount = Math.abs(value)
  const past = value < 0

  if (unit === "day" && amount === 1) return past ? "গতকাল" : "আগামীকাল"
  if (unit === "second" && amount < 10) return past ? "এইমাত্র" : "এখনই"

  const count = formatNumber(amount, "bn")
  return `${count} ${BN_UNITS[unit]} ${past ? "আগে" : "পরে"}`
}

export function formatRelative(date: Date | string | number, locale: Locale) {
  // Measured from the shared demo clock, so fast-forwarding moves every
  // "5 minutes ago" in every window.
  const seconds = (new Date(date).getTime() - now()) / 1000

  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= secondsInUnit || unit === "second") {
      const value = Math.round(seconds / secondsInUnit)
      return locale === "bn"
        ? formatRelativeBangla(value, unit)
        : new Intl.RelativeTimeFormat(INTL[locale], { numeric: "auto" }).format(
            value,
            unit
          )
    }
  }

  return locale === "bn" ? "এইমাত্র" : "just now"
}

/** "12:04" / "১২:০৪", for SLA timers and call durations */
export function formatDuration(seconds: number, locale: Locale) {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const plain = (v: number, pad = false) =>
    formatNumber(v, locale, {
      useGrouping: false,
      minimumIntegerDigits: pad ? 2 : 1,
    })
  return h > 0
    ? `${plain(h)}:${plain(m, true)}:${plain(s, true)}`
    : `${plain(m)}:${plain(s, true)}`
}

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"]

/**
 * Converts ASCII digits embedded in free text (room numbers, IDs, transcripts)
 * so mixed strings read natively in Bangla.
 */
export function localizeDigits(input: string, locale: Locale) {
  if (locale !== "bn") return input
  return input.replace(/\d/g, (d) => BENGALI_DIGITS[Number(d)])
}

/**
 * Money from integer poisha: ৳ with lakh/crore grouping and Bengali numerals in
 * Bangla. Whole taka show no decimals; fractional amounts show two.
 */
export function formatMoney(poisha: number, locale: Locale) {
  const taka = poisha / 100
  const fractional = poisha % 100 !== 0
  const formatted = new Intl.NumberFormat(INTL[locale], {
    minimumFractionDigits: fractional ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(taka))
  return `${taka < 0 ? "-" : ""}৳${formatted}`
}

/** DD-MM-YYYY in Dhaka (Bengali digits in Bangla). */
export function formatDmy(date: Date | string | number, locale: Locale) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(date))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return localizeDigits(`${get("day")}-${get("month")}-${get("year")}`, locale)
}

/** UHID grouped for display. Identifiers always stay in Latin digits (D13). */
export function formatUhid(uhid: string) {
  return groupUhid(uhid)
}
