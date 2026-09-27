import { UserSearch, UsersRound } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const identityNav: NavItem[] = [
  {
    role: "receptionist",
    href: "/reception",
    labelKey: "identity.nav.patients",
    icon: UsersRound,
    groupKey: "shell.navGroups.frontDesk",
    order: 10,
  },
  {
    role: "receptionist",
    href: "/reception/review",
    labelKey: "identity.nav.review",
    icon: UserSearch,
    groupKey: "shell.navGroups.frontDesk",
    order: 14,
  },
]
