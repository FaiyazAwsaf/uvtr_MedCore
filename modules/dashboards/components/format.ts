"use client"

import * as React from "react"

import { getBranch, type BranchCode } from "@/config/brand.config"
import { atDhaka } from "@/core/clock/dates"
import type { ISODate } from "@/core/db/schema"
import { formatCompactCurrency } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/provider"

import { splitMinutes, type Dept } from "../metrics"
import type { SpecialtyNames } from "../queries"

/**
 * The dashboard's formatters in the window's language: money in full or
 * compact (lakh / crore), minutes as "2 h 23 min", ages, branch, department
 * and service names. Specialty names come from the specialties table.
 */
export function useDashFormat(specialties?: SpecialtyNames) {
  const locale = useLocale()
  const { t, tk, money, dmy, digits } = locale
  return React.useMemo(() => {
    const minutes = (value: number | null | undefined): string => {
      if (value === null || value === undefined) return "-"
      const { h, m } = splitMinutes(value)
      return h > 0
        ? t("dashboards.units.hoursMinutes", { h: digits(String(h)), m: digits(String(m)) })
        : t("dashboards.units.minutes", { value: digits(String(m)) })
    }
    return {
      ...locale,
      /** ৳ with lakh grouping, whole taka */
      moneyFull: (poisha: number) => money(Math.round(poisha / 100) * 100),
      /** ৳12.3L / ৳১২.৩ লা for big figures */
      moneyCompact: (poisha: number) =>
        formatCompactCurrency(poisha / 100, locale.locale, "BDT"),
      minutes,
      /** How long something has been open: minutes, hours, days */
      age: (ms: number): string => {
        const totalMin = Math.max(0, Math.floor(ms / 60_000))
        if (totalMin < 60) return t("dashboards.units.minutes", { value: digits(String(totalMin)) })
        const days = Math.floor(totalMin / 1440)
        if (days >= 1) {
          const hours = Math.floor((totalMin % 1440) / 60)
          return t("dashboards.units.daysHours", {
            d: digits(String(days)),
            h: digits(String(hours)),
          })
        }
        return minutes(totalMin)
      },
      branchName: (code: BranchCode) => getBranch(code).name[locale.locale],
      branchLabel: (code: BranchCode) =>
        `${getBranch(code).name[locale.locale]} (${code})`,
      deptLabel: (dept: Dept) => tk(`dashboards.depts.${dept}`),
      unitLabel: (dept: Dept) => tk(`dashboards.visitUnits.${dept}`),
      serviceLabel: (dept: Dept, key: string): string => {
        if (key === "other") return t("dashboards.services.other")
        if (key === "procedure") return t("dashboards.services.procedure")
        if (dept === "opd") return specialties?.get(key)?.[locale.locale] ?? key
        const label = tk(`dashboards.services.${dept}.${key}`)
        return label.startsWith("dashboards.") ? key : label
      },
      /** DD-MM for chart axes (Bangla digits in Bangla) */
      dayMonth: (date: ISODate) => digits(`${date.slice(8, 10)}-${date.slice(5, 7)}`),
      /** DD-MM-YYYY for a calendar day */
      day: (date: ISODate) => dmy(atDhaka(date, "12:00")),
    }
  }, [locale, t, tk, money, dmy, digits, specialties])
}

export type DashFormat = ReturnType<typeof useDashFormat>
