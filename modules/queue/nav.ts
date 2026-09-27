import { ListOrdered } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const queueNav: NavItem[] = [
  {
    role: "receptionist",
    href: "/reception/queue",
    labelKey: "queue.nav.queue",
    icon: ListOrdered,
    groupKey: "shell.navGroups.frontDesk",
    order: 12,
  },
]
