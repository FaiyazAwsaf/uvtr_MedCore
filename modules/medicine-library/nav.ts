import { BookOpen } from "lucide-react"

import { ROLES } from "@/core/rbac/types"
import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module: the library is open to every staff role. */
export const libraryNav: NavItem[] = ROLES.filter(
  (role) => role !== "patient"
).map((role) => ({
  role,
  href: "/library",
  labelKey: "library.nav.library",
  icon: BookOpen,
  groupKey: "shell.navGroups.shared",
  order: 900,
}))
