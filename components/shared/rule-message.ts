import { branches } from "@/config/brand.config"
import type { Locale } from "@/lib/i18n/config"
import { en } from "@/lib/i18n/en"

type Formatters = {
  locale: Locale
  tk: (key: string, params?: Record<string, string | number>) => string
  num: (value: number) => string
  money: (poisha: number) => string
  dmy: (value: string | number | Date) => string
  uhid: (value: string) => string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Module namespaces that carry their own `<module>.rules.<CODE>` messages. */
const RULE_NAMESPACES = Object.entries(en)
  .filter(
    ([, value]) =>
      typeof value === "object" && value !== null && "rules" in value
  )
  .map(([namespace]) => namespace)
  .filter((namespace) => namespace !== "rules")

/**
 * The message for a rule code (RuleViolation.code) in the window's language,
 * with its params formatted: money for
 * `...P` amounts, grouped UHIDs, DD-MM-YYYY dates, branch names and numbers in
 * the active numerals. Lookup order: the refusing command's module
 * (`billing.checkout` looks in `billing.rules`), then the engine's shared
 * `rules`, then every other module's `rules`, so a module code reads the same
 * on any screen. Unknown codes fall back to "blocked by rule <code>".
 */
export function ruleMessage(
  code: string,
  params: Record<string, string | number>,
  f: Formatters,
  command?: string
): string {
  const formatted: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "number") {
      formatted[key] = key.endsWith("P") ? f.money(value) : f.num(value)
    } else if (key === "uhid") {
      formatted[key] = f.uhid(value)
    } else if (key === "branch") {
      const branch = branches.find((b) => b.code === value)
      formatted[key] = branch
        ? `${branch.name[f.locale]} (${branch.code})`
        : value
    } else if (key === "step") {
      const step = f.tk(`shell.feedback.steps.${value}`)
      formatted[key] = step.startsWith("shell.") ? value : step
    } else if (ISO_DAY.test(value)) {
      formatted[key] = f.dmy(value)
    } else {
      formatted[key] = value
    }
  }
  const own = command?.split(".")[0]
  const keys = [
    ...(own && RULE_NAMESPACES.includes(own) ? [`${own}.rules.${code}`] : []),
    `rules.${code}`,
    ...RULE_NAMESPACES.filter((namespace) => namespace !== own).map(
      (namespace) => `${namespace}.rules.${code}`
    ),
  ]
  for (const key of keys) {
    const message = f.tk(key, formatted)
    if (message !== key) return message
  }
  return f.tk("shell.feedback.unknownRule", { code })
}
