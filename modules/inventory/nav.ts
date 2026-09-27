import { ArrowLeftRight, Truck, Warehouse } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const inventoryNav: NavItem[] = [
  {
    role: "pharmacist",
    href: "/pharmacy/transfers",
    labelKey: "inventory.nav.transfers",
    icon: ArrowLeftRight,
    groupKey: "shell.navGroups.stock",
    order: 20,
  },
  {
    role: "store",
    href: "/store",
    labelKey: "inventory.nav.stock",
    icon: Warehouse,
    groupKey: "shell.navGroups.inventory",
    order: 10,
  },
  {
    role: "store",
    href: "/store/transfers",
    labelKey: "inventory.nav.transfers",
    icon: Truck,
    groupKey: "shell.navGroups.inventory",
    order: 11,
  },
]
