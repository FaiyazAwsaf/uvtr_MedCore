import {
  BadgeCheck,
  Building2,
  CheckCheck,
  Download,
  HandCoins,
  Landmark,
  Percent,
  Smartphone,
} from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const financeNav: NavItem[] = [
  {
    role: "finance",
    href: "/finance",
    labelKey: "finance.nav.cash",
    icon: Landmark,
    groupKey: "shell.navGroups.reconcile",
    order: 10,
  },
  {
    role: "finance",
    href: "/finance/mfs",
    labelKey: "finance.nav.mfs",
    icon: Smartphone,
    groupKey: "shell.navGroups.reconcile",
    order: 11,
  },
  {
    role: "finance",
    href: "/finance/match",
    labelKey: "finance.nav.match",
    icon: CheckCheck,
    groupKey: "shell.navGroups.reconcile",
    order: 12,
  },
  {
    role: "finance",
    href: "/finance/payables",
    labelKey: "finance.nav.payables",
    icon: HandCoins,
    groupKey: "shell.navGroups.accounts",
    order: 20,
  },
  {
    role: "finance",
    href: "/finance/fee-share",
    labelKey: "finance.nav.feeShare",
    icon: Percent,
    groupKey: "shell.navGroups.accounts",
    order: 21,
  },
  {
    role: "finance",
    href: "/finance/corporate",
    labelKey: "finance.nav.corporate",
    icon: Building2,
    groupKey: "shell.navGroups.accounts",
    order: 22,
  },
  {
    role: "finance",
    href: "/finance/export",
    labelKey: "finance.nav.export",
    icon: Download,
    groupKey: "shell.navGroups.accounts",
    order: 23,
  },
  {
    role: "finance",
    href: "/finance/approvals",
    labelKey: "finance.nav.approvals",
    icon: BadgeCheck,
    groupKey: "shell.navGroups.accounts",
    order: 24,
  },
]
