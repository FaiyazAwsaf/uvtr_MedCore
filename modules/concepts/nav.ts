import { Network, Sparkles, TrendingUp, TriangleAlert } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module (Tier 3 concept screens, plan §11). */
export const conceptsNav: NavItem[] = [
  {
    role: "ceo",
    href: "/ceo/concepts/briefing",
    labelKey: "concepts.nav.briefing",
    icon: Sparkles,
    groupKey: "shell.navGroups.concepts",
    order: 20,
  },
  {
    role: "ceo",
    href: "/ceo/concepts/digital-twin",
    labelKey: "concepts.nav.digitalTwin",
    icon: Network,
    groupKey: "shell.navGroups.concepts",
    order: 21,
  },
  {
    role: "ceo",
    href: "/ceo/concepts/predictive-purchasing",
    labelKey: "concepts.nav.predictive",
    icon: TrendingUp,
    groupKey: "shell.navGroups.concepts",
    order: 22,
  },
  {
    role: "ceo",
    href: "/ceo/concepts/anomalies",
    labelKey: "concepts.nav.anomalies",
    icon: TriangleAlert,
    groupKey: "shell.navGroups.concepts",
    order: 23,
  },
]
