"use client"

import * as React from "react"

import { updateSession, useSession } from "@/core/session/session"

import { type Locale } from "./config"
import { dictionaries, interpolate, lookup, type TranslationKey } from "./index"
import {
  formatCompact,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatDmy,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
  formatUhid,
  localizeDigits,
} from "./format"

type TranslateParams = Record<string, string | number>

type LocaleContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  toggleLocale: () => void
  isBangla: boolean
  t: (key: TranslationKey, params?: TranslateParams) => string
  /** Untyped escape hatch for keys assembled at runtime (e.g. `crm.stages.${id}`) */
  tk: (key: string, params?: TranslateParams) => string
  num: (value: number, options?: Intl.NumberFormatOptions) => string
  dec: (value: number, digits?: number) => string
  pct: (value: number, digits?: number) => string
  compact: (value: number) => string
  date: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions
  ) => string
  time: (value: Date | string | number) => string
  dateTime: (value: Date | string | number) => string
  relative: (value: Date | string | number) => string
  duration: (seconds: number) => string
  digits: (value: string) => string
  /** Money from integer poisha: ৳ with lakh/crore grouping */
  money: (poisha: number) => string
  /** DD-MM-YYYY in Dhaka */
  dmy: (value: Date | string | number) => string
  /** Grouped UHID, always Latin digits */
  uhid: (value: string) => string
}

const LocaleContext = React.createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Language is per window (plan §3.9): it lives in this window's session.
  const { lang: locale } = useSession()

  React.useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = React.useCallback((next: Locale) => {
    updateSession({ lang: next })
  }, [])

  const value = React.useMemo<LocaleContextValue>(() => {
    const dict = dictionaries[locale]
    const tk = (key: string, params?: TranslateParams) =>
      interpolate(lookup(dict, key), params)

    return {
      locale,
      setLocale,
      toggleLocale: () => setLocale(locale === "en" ? "bn" : "en"),
      isBangla: locale === "bn",
      t: tk as LocaleContextValue["t"],
      tk,
      num: (v, options) => formatNumber(v, locale, options),
      dec: (v, digits) => formatDecimal(v, locale, digits),
      pct: (v, digits) => formatPercent(v, locale, digits),
      compact: (v) => formatCompact(v, locale),
      date: (v, options) => formatDate(v, locale, options),
      time: (v) => formatTime(v, locale),
      dateTime: (v) => formatDateTime(v, locale),
      relative: (v) => formatRelative(v, locale),
      duration: (s) => formatDuration(s, locale),
      digits: (v) => localizeDigits(v, locale),
      money: (p) => formatMoney(p, locale),
      dmy: (v) => formatDmy(v, locale),
      uhid: (v) => formatUhid(v),
    }
  }, [locale, setLocale])

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  )
}

export function useLocale() {
  const context = React.useContext(LocaleContext)
  if (!context) {
    throw new Error("useLocale must be used inside <LocaleProvider>")
  }
  return context
}

/** Convenience for the common case: `const t = useT()` */
export function useT() {
  return useLocale().t
}
