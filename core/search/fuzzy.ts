/**
 * Bangla-tolerant name matching and duplicate scoring (PRD §9 Identity, HAZ-02).
 * Used by registration (ranked duplicate warning), patient search and offline
 * replay (possible duplicates go to the review queue, never auto-merged).
 */

import type { PatientRow } from "@/core/db/schema"

/** Common spelling variants in Bangladeshi names, mapped to one key. */
const VARIANTS: Record<string, string> = {
  md: "mohammad",
  mohd: "mohammad",
  mohammed: "mohammad",
  muhammad: "mohammad",
  mohamed: "mohammad",
  muhammed: "mohammad",
  mohammod: "mohammad",
  begom: "begum",
  begam: "begum",
  khatoon: "khatun",
  khaton: "khatun",
  hossen: "hossain",
  hosen: "hossain",
  hussain: "hossain",
  hosain: "hossain",
  rahaman: "rahman",
  rehman: "rahman",
  chowdhuri: "chowdhury",
  choudhury: "chowdhury",
  chowdhary: "chowdhury",
  akhter: "akter",
  akhtar: "akter",
  aktar: "akter",
  "মোঃ": "মোহাম্মদ",
  "মো": "মোহাম্মদ",
  "মুহাম্মদ": "মোহাম্মদ",
  "মোহাম্মাদ": "মোহাম্মদ",
}

/** Lowercase, strip punctuation, split, and map spelling variants. */
export function normalizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,'`"()\-_/]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => VARIANTS[token] ?? token)
}

/** Search keys for a patient: normalised tokens of both scripts, deduplicated. */
export function nameKeys(nameEn: string, nameBn?: string): string[] {
  return [...new Set([...normalizeName(nameEn), ...normalizeName(nameBn ?? "")])]
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = curr
  }
  return prev[b.length]
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && levenshtein(a, b) <= 1) return true
  return false
}

/** Share of tokens that match between two names (0 to 1). */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeName(a)
  const tb = normalizeName(b)
  if (!ta.length || !tb.length) return 0
  const matched = ta.filter((x) => tb.some((y) => tokensMatch(x, y))).length
  return matched / Math.max(ta.length, tb.length)
}

export type DuplicateReason = "nid" | "brn" | "name" | "dob" | "phone"

export type DuplicateCandidate = {
  patientId: string
  score: number
  reasons: DuplicateReason[]
}

export type IdentityInput = {
  nameEn: string
  dob?: string
  phone?: string
  nid?: string
  brn?: string
}

/** Score at or above which registration shows the ranked duplicate warning. */
export const DUPLICATE_THRESHOLD = 0.6

/**
 * Likelihood that `input` is the same person as `existing` (0 to 1). An exact
 * NID or BRN match is certain; otherwise name, date of birth and phone count.
 */
export function scoreDuplicate(
  input: IdentityInput,
  existing: Pick<PatientRow, "nameEn" | "dob" | "phone" | "nid" | "brn">
): { score: number; reasons: DuplicateReason[] } {
  if (input.nid && existing.nid && input.nid === existing.nid) {
    return { score: 1, reasons: ["nid"] }
  }
  if (input.brn && existing.brn && input.brn === existing.brn) {
    return { score: 1, reasons: ["brn"] }
  }
  const reasons: DuplicateReason[] = []
  const name = nameSimilarity(input.nameEn, existing.nameEn)
  let score = name * 0.5
  if (name >= 0.6) reasons.push("name")
  if (input.dob && input.dob === existing.dob) {
    score += 0.3
    reasons.push("dob")
  }
  const digits = (s?: string) => (s ?? "").replace(/\D/g, "")
  if (input.phone && digits(input.phone) && digits(input.phone) === digits(existing.phone)) {
    score += 0.2
    reasons.push("phone")
  }
  return { score: Math.min(1, Math.round(score * 100) / 100), reasons }
}

/** Ranked likely duplicates among active patients (highest score first). */
export function findLikelyDuplicates(
  input: IdentityInput,
  patients: PatientRow[],
  { limit = 5, excludeId }: { limit?: number; excludeId?: string } = {}
): DuplicateCandidate[] {
  return patients
    .filter((p) => p.identityStatus === "active" && p.id !== excludeId)
    .map((p) => ({ patientId: p.id, ...scoreDuplicate(input, p) }))
    .filter((c) => c.score >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
