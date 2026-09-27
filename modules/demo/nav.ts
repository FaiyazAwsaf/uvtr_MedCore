import { ScrollText } from "lucide-react"

import { ROLES } from "@/core/rbac/types"
import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module: the audit log is open to every staff role. */
export const demoNav: NavItem[] = ROLES.filter((role) => role !== "patient").map(
  (role) => ({
    role,
    href: "/audit",
    labelKey: "demo.nav.audit",
    icon: ScrollText,
    groupKey: "shell.navGroups.shared",
    order: 910,
  })
)
