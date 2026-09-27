import {
  Banknote,
  ChartLine,
  ConciergeBell,
  FlaskConical,
  Landmark,
  Microscope,
  Package,
  Pill,
  Smartphone,
  Stethoscope,
  type LucideIcon,
} from "lucide-react"

import type { Role } from "@/core/rbac/types"

/** One icon per role, used on the launcher cards and Demo Wall panes. */
export const ROLE_ICONS: Record<Role, LucideIcon> = {
  receptionist: ConciergeBell,
  doctor: Stethoscope,
  labtech: FlaskConical,
  pathologist: Microscope,
  pharmacist: Pill,
  cashier: Banknote,
  store: Package,
  finance: Landmark,
  ceo: ChartLine,
  patient: Smartphone,
}
