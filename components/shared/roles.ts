import type { Role } from "@/core/rbac/types"
import type { Locale } from "@/lib/i18n/config"
import { intlLocale } from "@/lib/i18n/format"

type Tk = (key: string, params?: Record<string, string | number>) => string

/** A role's display name, e.g. "Pharmacist" / "ফার্মাসিস্ট". */
export function roleLabel(role: Role | string, tk: Tk): string {
  const label = tk(`shell.roles.${role}`)
  return label.startsWith("shell.") ? role : label
}

/** "Doctor, Receptionist or CEO" in the window's language. */
export function rolesList(roles: readonly string[], tk: Tk, locale: Locale): string {
  const labels = roles.map((role) => roleLabel(role, tk))
  try {
    return new Intl.ListFormat(intlLocale(locale), { type: "disjunction" }).format(
      labels
    )
  } catch {
    return labels.join(", ")
  }
}
