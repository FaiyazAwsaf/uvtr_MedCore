import { LayoutDashboard, Radar } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const dashboardsNav: NavItem[] = [
  {
    role: "ceo",
    href: "/ceo",
    labelKey: "dashboards.nav.dashboard",
    icon: LayoutDashboard,
    groupKey: "shell.navGroups.executive",
    order: 10,
  },
  {
    role: "ceo",
    href: "/ceo/command-centre",
    labelKey: "dashboards.nav.commandCentre",
    icon: Radar,
    groupKey: "shell.navGroups.executive",
    order: 11,
  },
]
