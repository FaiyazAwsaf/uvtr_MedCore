import {
  ClipboardCheck,
  FlaskConical,
  Microscope,
  ScanLine,
  TestTube,
} from "lucide-react"

import type { NavItem } from "@/core/rbac/types"

/** Sidebar entries owned by this module. */
export const labNav: NavItem[] = [
  {
    role: "labtech",
    href: "/lab",
    labelKey: "lab.nav.collection",
    icon: TestTube,
    groupKey: "shell.navGroups.laboratory",
    order: 10,
  },
  {
    role: "labtech",
    href: "/lab/reception",
    labelKey: "lab.nav.reception",
    icon: ScanLine,
    groupKey: "shell.navGroups.laboratory",
    order: 11,
  },
  {
    role: "labtech",
    href: "/lab/analyser",
    labelKey: "lab.nav.analyser",
    icon: FlaskConical,
    groupKey: "shell.navGroups.laboratory",
    order: 12,
  },
  {
    role: "labtech",
    href: "/lab/validation",
    labelKey: "lab.nav.validation",
    icon: ClipboardCheck,
    groupKey: "shell.navGroups.laboratory",
    order: 13,
  },
  {
    role: "pathologist",
    href: "/pathology",
    labelKey: "lab.nav.signoff",
    icon: Microscope,
    groupKey: "shell.navGroups.pathology",
    order: 10,
  },
]
