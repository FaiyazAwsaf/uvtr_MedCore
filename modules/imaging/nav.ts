import { FileImage } from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const imagingNav: NavItem[] = [
  {
    role: "labtech",
    href: "/lab/imaging",
    labelKey: "imaging.nav.reports",
    icon: FileImage,
    groupKey: "shell.navGroups.imaging",
    order: 20,
  },
]
