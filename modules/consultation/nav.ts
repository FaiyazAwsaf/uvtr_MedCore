import { Inbox, Stethoscope, Video } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/**
 * Sidebar entries owned by this module. The encounter screen
 * (/doctor/encounter/[id]) is opened from the worklist, which it highlights.
 */
export const consultationNav: NavItem[] = [
  {
    role: "doctor",
    href: "/doctor",
    labelKey: "consultation.nav.worklist",
    icon: Stethoscope,
    groupKey: "shell.navGroups.clinic",
    order: 10,
  },
  {
    role: "doctor",
    href: "/doctor/inbox",
    labelKey: "consultation.nav.inbox",
    icon: Inbox,
    groupKey: "shell.navGroups.clinic",
    order: 11,
  },
  {
    role: "doctor",
    href: "/doctor/telemedicine",
    labelKey: "consultation.nav.telemedicine",
    icon: Video,
    groupKey: "shell.navGroups.clinic",
    order: 12,
  },
]
