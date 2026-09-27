import { BadgeCheck, ClipboardList, FileText, PackageOpen } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const procurementNav: NavItem[] = [
  {
    role: "store",
    href: "/store/requests",
    labelKey: "procurement.nav.requests",
    icon: ClipboardList,
    groupKey: "shell.navGroups.procurement",
    order: 20,
  },
  {
    role: "store",
    href: "/store/approvals",
    labelKey: "procurement.nav.approvals",
    icon: BadgeCheck,
    groupKey: "shell.navGroups.procurement",
    order: 21,
  },
  {
    role: "store",
    href: "/store/po",
    labelKey: "procurement.nav.orders",
    icon: FileText,
    groupKey: "shell.navGroups.procurement",
    order: 22,
  },
  {
    role: "store",
    href: "/store/grn",
    labelKey: "procurement.nav.grn",
    icon: PackageOpen,
    groupKey: "shell.navGroups.procurement",
    order: 23,
  },
]
