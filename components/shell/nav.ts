import { NAV_ITEMS } from "@/core/rbac/registry"
import type { NavItem, Role } from "@/core/rbac/types"

export type NavGroup = { groupKey: string; items: NavItem[] }

/** A role's sidebar entries, in order (items sort by `order`). */
export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.role === role).sort(
    (a, b) => (a.order ?? 500) - (b.order ?? 500)
  )
}

/**
 * Entries grouped under their headings. Groups appear in the order of their
 * first (lowest-order) entry, so a module's `order` numbers also place its group.
 */
export function groupNav(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = []
  for (const item of items) {
    const group = groups.find((g) => g.groupKey === item.groupKey)
    if (group) group.items.push(item)
    else groups.push({ groupKey: item.groupKey, items: [item] })
  }
  return groups
}

function matches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The entry that owns a pathname: the longest matching href, so
 * /doctor/encounter/123 highlights "Worklist" (/doctor) and /doctor/inbox
 * highlights "Results inbox".
 */
export function activeHref(items: NavItem[], pathname: string): string | null {
  let best: string | null = null
  for (const item of items) {
    if (matches(pathname, item.href) && (!best || item.href.length > best.length)) {
      best = item.href
    }
  }
  return best
}
