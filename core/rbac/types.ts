import type { LucideIcon } from "lucide-react"

/** Staff and patient roles (plan §3.10). */
export const ROLES = [
  "receptionist",
  "doctor",
  "labtech",
  "pathologist",
  "pharmacist",
  "cashier",
  "store",
  "finance",
  "ceo",
  "patient",
] as const

export type Role = (typeof ROLES)[number]

/** One sidebar entry. Each module declares its own in modules/<m>/nav.ts. */
export type NavItem = {
  role: Role
  href: string
  /** i18n key, resolved with `tk()` */
  labelKey: string
  icon: LucideIcon
  /** i18n key of the sidebar group heading */
  groupKey: string
  /** Sort order inside the group (lower first) */
  order?: number
}
