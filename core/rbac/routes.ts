import type { Role } from "./types"

type Access = readonly Role[] | "all-staff" | "public"

/**
 * Which roles may open which routes (plan §9). The first matching prefix wins,
 * so more specific prefixes come first. Unlisted routes are public.
 */
export const ROUTE_ACCESS: { prefix: string; access: Access }[] = [
  { prefix: "/reception", access: ["receptionist"] },
  { prefix: "/doctor", access: ["doctor"] },
  { prefix: "/lab", access: ["labtech"] },
  { prefix: "/pathology", access: ["pathologist"] },
  { prefix: "/pharmacy", access: ["pharmacist"] },
  { prefix: "/cashier", access: ["cashier"] },
  { prefix: "/store", access: ["store"] },
  { prefix: "/finance", access: ["finance"] },
  { prefix: "/ceo", access: ["ceo"] },
  { prefix: "/patient-360", access: ["doctor", "receptionist", "ceo"] },
  { prefix: "/library", access: "all-staff" },
  { prefix: "/audit", access: "all-staff" },
  { prefix: "/app", access: ["patient"] },
  { prefix: "/display", access: "public" },
  { prefix: "/verify", access: "public" },
  { prefix: "/wall", access: "public" },
]

/** Landing route for each role (the launcher opens windows here). */
export const HOME_ROUTE: Record<Role, string> = {
  receptionist: "/reception",
  doctor: "/doctor",
  labtech: "/lab",
  pathologist: "/pathology",
  pharmacist: "/pharmacy",
  cashier: "/cashier",
  store: "/store",
  finance: "/finance",
  ceo: "/ceo",
  patient: "/app",
}

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function accessFor(pathname: string): Access {
  return ROUTE_ACCESS.find((r) => matches(pathname, r.prefix))?.access ?? "public"
}

/** Whether a role (or no persona yet) may open a route. */
export function canAccess(role: Role | null, pathname: string): boolean {
  const access = accessFor(pathname)
  if (access === "public") return true
  if (!role) return false
  if (access === "all-staff") return role !== "patient"
  return access.includes(role)
}
