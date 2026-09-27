import { Banknote, Receipt, Undo2 } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const billingNav: NavItem[] = [
  {
    role: "cashier",
    href: "/cashier",
    labelKey: "billing.nav.basket",
    icon: Receipt,
    groupKey: "shell.navGroups.billing",
    order: 10,
  },
  {
    role: "cashier",
    href: "/cashier/refunds",
    labelKey: "billing.nav.refunds",
    icon: Undo2,
    groupKey: "shell.navGroups.billing",
    order: 11,
  },
  {
    role: "cashier",
    href: "/cashier/shift",
    labelKey: "billing.nav.shift",
    icon: Banknote,
    groupKey: "shell.navGroups.cash",
    order: 20,
  },
]
