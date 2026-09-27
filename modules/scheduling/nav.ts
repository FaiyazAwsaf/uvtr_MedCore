import { CalendarPlus, Hourglass } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const schedulingNav: NavItem[] = [
  {
    role: "receptionist",
    href: "/reception/book",
    labelKey: "scheduling.nav.book",
    icon: CalendarPlus,
    groupKey: "shell.navGroups.frontDesk",
    order: 11,
  },
  {
    role: "receptionist",
    href: "/reception/delays",
    labelKey: "scheduling.nav.delays",
    icon: Hourglass,
    groupKey: "shell.navGroups.frontDesk",
    order: 13,
  },
]
