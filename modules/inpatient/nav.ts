import { BedDouble, Wallet } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module ("Inpatient billing and beds"). */
export const inpatientNav: NavItem[] = [
  {
    role: "receptionist",
    href: "/reception/inpatient",
    labelKey: "inpatient.nav.beds",
    icon: BedDouble,
    groupKey: "shell.navGroups.inpatient",
    order: 20,
  },
  {
    role: "cashier",
    href: "/cashier/deposits",
    labelKey: "inpatient.nav.deposits",
    icon: Wallet,
    groupKey: "shell.navGroups.billing",
    order: 12,
  },
]
