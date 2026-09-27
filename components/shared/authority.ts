import { PERSONAS, type PersonaSeed } from "@/core/seed/content/personas"

/**
 * Whether a set of staff authorities covers the one a step needs. Exact
 * strings match (`approve:variance`, `merge:patients`); numeric limits cover
 * anything up to them (`discount:15` covers `discount:12`,
 * `approve:pr:500000` covers `approve:pr:300000`); `unlimited` and `*` cover
 * everything in their family.
 */
export function holdsAuthority(held: readonly string[], needed: string): boolean {
  if (held.includes("*") || held.includes(needed)) return true
  const cut = needed.lastIndexOf(":")
  if (cut < 0) return false
  const family = needed.slice(0, cut)
  const amount = Number(needed.slice(cut + 1))
  if (!Number.isFinite(amount)) return false
  return held.some((authority) => {
    if (!authority.startsWith(`${family}:`)) return false
    const tail = authority.slice(family.length + 1)
    if (tail === "unlimited") return true
    const limit = Number(tail)
    return Number.isFinite(limit) && limit >= amount
  })
}

/**
 * Personas whose staff member holds `authority`, nearest first: the same
 * branch, then network HQ, then other branches. The requester is left out
 * (an override is always a second person).
 */
export function approversFor(
  authority: string,
  opts: { excludeStaffId?: string; branchId?: string | null } = {}
): PersonaSeed[] {
  const rank = (persona: PersonaSeed) =>
    persona.branchId === (opts.branchId ?? undefined)
      ? 0
      : persona.branchId === null
        ? 1
        : 2
  return PERSONAS.filter(
    (persona) =>
      persona.staff &&
      persona.staff.id !== opts.excludeStaffId &&
      holdsAuthority(persona.staff.authorities, authority)
  ).sort((a, b) => rank(a) - rank(b) || a.order - b.order)
}
