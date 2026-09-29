import type { PatientRow, ReviewItemRow } from "@/core/db/schema"
import type { DuplicateReason } from "@/core/search/fuzzy"

/**
 * The data steward's review queue (plan §3.7, HAZ-08): helpers shared by the
 * `identity.resolveReview` command and the `/reception/review` screen.
 */

export type CandidateMatch = { score: number; reasons: DuplicateReason[] }

const REASONS: readonly DuplicateReason[] = [
  "nid",
  "brn",
  "name",
  "dob",
  "phone",
]

/**
 * Scores and reasons the replay recorded for a sync duplicate. The replay
 * writes `detail` as space-separated `patientId:score:reason+reason` entries.
 */
export function parseReviewDetail(
  detail: string | undefined
): Map<string, CandidateMatch> {
  const out = new Map<string, CandidateMatch>()
  for (const entry of (detail ?? "").split(/\s+/)) {
    const [id, score, reasons] = entry.split(":")
    if (!id || score === undefined) continue
    const value = Number(score)
    if (!Number.isFinite(value)) continue
    out.set(id, {
      score: value,
      reasons: (reasons ?? "")
        .split("+")
        .filter((r): r is DuplicateReason =>
          (REASONS as readonly string[]).includes(r)
        ),
    })
  }
  return out
}

/**
 * The two sides of a sync duplicate: the record that arrived from the branch
 * (held "under review") and the central records it may be the same as.
 */
export function splitDuplicate(
  item: Pick<ReviewItemRow, "patientIds">,
  patients: Map<string, PatientRow>
): { incoming?: PatientRow; candidates: PatientRow[] } {
  const rows = item.patientIds
    .map((id) => patients.get(id))
    .filter((p): p is PatientRow => !!p)
  const incoming = rows.find((p) => p.id === item.patientIds[0])
  return { incoming, candidates: rows.filter((p) => p !== incoming) }
}

/** The offline (provisional) UHID a record was first registered with, if any. */
export function provisionalUhidOf(
  patient: Pick<PatientRow, "provisionalUhid" | "aliases" | "uhid">
): string | undefined {
  if (patient.uhid.startsWith("P-")) return patient.uhid
  return (
    patient.provisionalUhid ?? patient.aliases.find((a) => a.startsWith("P-"))
  )
}

/** Identity fields a branch and central can disagree on (plan §3.7). */
export const IDENTITY_FIELDS = [
  "nameEn",
  "nameBn",
  "dob",
  "sex",
  "nid",
  "brn",
] as const
export type IdentityField = (typeof IDENTITY_FIELDS)[number]

export function isIdentityField(field: string): field is IdentityField {
  return (IDENTITY_FIELDS as readonly string[]).includes(field)
}

/** A readable form of a stored identity value (dates as DD-MM-YYYY). */
export function fieldText(field: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return ""
  if (
    field === "dob" &&
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return value.split("-").reverse().join("-")
  }
  return String(value)
}
