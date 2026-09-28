import type { MedicineHit, MedicineHitKind } from "@/core/search/medicines"

/** Routes of the medicine library (plan §9). */
export const libraryPaths = {
  home: "/library",
  brand: (id: string) => `/library/brand/${encodeURIComponent(id)}`,
  generic: (id: string) => `/library/generic/${encodeURIComponent(id)}`,
  company: (id: string) => `/library/company/${encodeURIComponent(id)}`,
  class: (id: string) => `/library/class/${encodeURIComponent(id)}`,
} as const

export function pathFor(kind: MedicineHitKind, id: string): string {
  return libraryPaths[kind](id)
}

/** The page a search hit opens. */
export function hitPath(hit: Pick<MedicineHit, "kind" | "id">): string {
  return pathFor(hit.kind, hit.id)
}

/**
 * Rx-pad mode (WS-B): the library opened with `?from=rx&encounter=<id>`.
 * Library links carry these params along so the doctor can browse and still
 * add the brand they end on.
 */
export function withRxParams(path: string, encounterId: string | null | undefined): string {
  if (!encounterId) return path
  const params = new URLSearchParams({ from: "rx", encounter: encounterId })
  return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`
}

/** The consultation screen, adding a brand to the prescription (WS-B reads `addBrand`). */
export function addToRxPath(encounterId: string, brandId: string): string {
  return `/doctor/encounter/${encodeURIComponent(encounterId)}?addBrand=${encodeURIComponent(brandId)}`
}

/** The consultation screen without adding anything. */
export function encounterPath(encounterId: string): string {
  return `/doctor/encounter/${encodeURIComponent(encounterId)}`
}

/** A route segment as an id: decoded when it arrives percent-encoded. */
export function routeId(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
