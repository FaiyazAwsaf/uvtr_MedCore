import { CalendarClock, Lock, Pill, ShoppingCart, Undo2 } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/**
 * Sidebar entries owned by this module. The dispense screen
 * (/pharmacy/dispense/[rxId]) is opened from the queue, which it highlights.
 */
export const pharmacyNav: NavItem[] = [
  {
    role: "pharmacist",
    href: "/pharmacy",
    labelKey: "pharmacy.nav.queue",
    icon: Pill,
    groupKey: "shell.navGroups.pharmacy",
    order: 10,
  },
  {
    role: "pharmacist",
    href: "/pharmacy/counter",
    labelKey: "pharmacy.nav.counter",
    icon: ShoppingCart,
    groupKey: "shell.navGroups.pharmacy",
    order: 11,
  },
  {
    role: "pharmacist",
    href: "/pharmacy/balances",
    labelKey: "pharmacy.nav.balances",
    icon: CalendarClock,
    groupKey: "shell.navGroups.pharmacy",
    order: 12,
  },
  {
    role: "pharmacist",
    href: "/pharmacy/controlled",
    labelKey: "pharmacy.nav.controlled",
    icon: Lock,
    groupKey: "shell.navGroups.pharmacy",
    order: 13,
  },
  {
    role: "pharmacist",
    href: "/pharmacy/returns",
    labelKey: "pharmacy.nav.returns",
    icon: Undo2,
    groupKey: "shell.navGroups.stock",
    order: 21,
  },
]
