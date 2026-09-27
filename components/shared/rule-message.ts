import { branches } from "@/config/brand.config"
import type { Locale } from "@/lib/i18n/config"

type Formatters = {
  locale: Locale
  tk: (key: string, params?: Record<string, string | number>) => string
  num: (value: number) => string
  money: (poisha: number) => string
  dmy: (value: string | number | Date) => string
  uhid: (value: string) => string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The message for a rule code (RuleViolation.code) in the window's language,
 * from the `rules.<CODE>` namespace, with its params formatted: money for
 * `...P` amounts, grouped UHIDs, DD-MM-YYYY dates, branch names and numbers in
 * the active numerals. Unknown codes fall back to "blocked by rule <code>".
 */
export function ruleMessage(
  code: string,
  params: Record<string, string | number>,
  f: Formatters
): string {
  const formatted: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "number") {
      formatted[key] = key.endsWith("P") ? f.money(value) : f.num(value)
    } else if (key === "uhid") {
      formatted[key] = f.uhid(value)
    } else if (key === "branch") {
      const branch = branches.find((b) => b.code === value)
      formatted[key] = branch ? `${branch.name[f.locale]} (${branch.code})` : value
    } else if (key === "step") {
      const step = f.tk(`shell.feedback.steps.${value}`)
      formatted[key] = step.startsWith("shell.") ? value : step
    } else if (ISO_DAY.test(value)) {
      formatted[key] = f.dmy(value)
    } else {
      formatted[key] = value
    }
  }
  const key = `rules.${code}`
  const message = f.tk(key, formatted)
  return message === key ? f.tk("shell.feedback.unknownRule", { code }) : message
}
