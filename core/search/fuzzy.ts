/**
 * Bangla-tolerant name matching and duplicate scoring (PRD §9 Identity, HAZ-02).
 * Used by registration (ranked duplicate warning), patient search and offline
 * replay (possible duplicates go to the review queue, never auto-merged).
 */

import type { PatientRow } from "@/core/db/schema"

/*
 * Name normalisation: common spelling variants of Bangladeshi names collapse
 * to one key ("Md.", "Mohammad" and "Muhammed" all become "md"; "Begom"
 * becomes "begum"), Bangla honorific abbreviations fold the same way, and a
 * light phonetic fold covers the rest. The seed indexes `nameSearchKeys` with
 * these keys, so every search must run its query through the same functions.
 */

const LATIN_ALIASES: Record<string, string> = {
  md: "md",
  mohammad: "md",
  mohammed: "md",
  muhammad: "md",
  muhammed: "md",
  mohamed: "md",
  mohamad: "md",
  mohd: "md",
  mst: "mst",
  most: "mst",
  mosammat: "mst",
  mosammot: "mst",
  mossammat: "mst",
  musammat: "mst",
  mosamat: "mst",
  begum: "begum",
  begom: "begum",
  begam: "begum",
  akter: "akter",
  akhter: "akter",
  aktar: "akter",
  akhtar: "akter",
  khatun: "khatun",
  khatoon: "khatun",
  katun: "khatun",
  chowdhury: "chowdhury",
  chowdhuri: "chowdhury",
  choudhury: "chowdhury",
  chaudhuri: "chowdhury",
  chowdhary: "chowdhury",
  rahman: "rahman",
  rahaman: "rahman",
  rehman: "rahman",
  hossain: "hossain",
  hossen: "hossain",
  hosen: "hossain",
  hussain: "hossain",
  husain: "hossain",
  hossein: "hossain",
  haque: "haque",
  hoque: "haque",
  huq: "haque",
  hoq: "haque",
  uddin: "uddin",
  uddeen: "uddin",
  islam: "islam",
  eslam: "islam",
  abdul: "abdul",
  abdool: "abdul",
  abdur: "abdur",
  abdus: "abdus",
  mia: "mia",
  miah: "mia",
  miya: "mia",
  sultana: "sultana",
  sultna: "sultana",
  nurjahan: "nurjahan",
  nurjohan: "nurjahan",
  noorjahan: "nurjahan",
  parvin: "parvin",
  parveen: "parvin",
  yasmin: "yasmin",
  yeasmin: "yasmin",
  jasmin: "yasmin",
  jesmin: "jesmin",
  jasmine: "jesmin",
}

const BANGLA_ALIASES: Record<string, string> = {
  মো: "মো",
  মোঃ: "মো",
  মোহাম্মদ: "মো",
  মুহাম্মদ: "মো",
  মোহাম্মাদ: "মো",
  মোছা: "মোছা",
  মোছাঃ: "মোছা",
  মোসা: "মোছা",
  মোসাম্মৎ: "মোছা",
  মোছাম্মৎ: "মোছা",
  বেগম: "বেগম",
  বেগাম: "বেগম",
  আক্তার: "আক্তার",
  আখতার: "আক্তার",
  আকতার: "আক্তার",
  খাতুন: "খাতুন",
  খাতূন: "খাতুন",
  নুরজাহান: "নুরজাহান",
  নূরজাহান: "নুরজাহান",
  হোসেন: "হোসেন",
  হোসাইন: "হোসেন",
  হুসাইন: "হোসেন",
}

/** Light phonetic folding for Latin spellings not covered by the alias list. */
function foldLatin(token: string): string {
  return token
    .replace(/ph/g, "f")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/oo/g, "u")
    .replace(/ee/g, "i")
    .replace(/(.)\1+/g, "$1")
}

const BANGLA_CHARS = /[ঀ-৿]/

/** Normalised key for one typed word (Latin or Bangla). Empty when nothing is left. */
export function nameKeyFor(word: string): string {
  if (BANGLA_CHARS.test(word)) {
    const cleaned = word.replace(/[^ঀ-৿]/g, "")
    const trimmed = cleaned.replace(/[ঃ]$/, "")
    return BANGLA_ALIASES[cleaned] ?? BANGLA_ALIASES[trimmed] ?? trimmed
  }
  const letters = word.toLowerCase().replace(/[^a-z]/g, "")
  if (!letters) return ""
  return LATIN_ALIASES[letters] ?? foldLatin(letters)
}

/** Normalised tokens of a name (Latin or Bangla), empty tokens dropped. */
export function normalizeName(name: string): string[] {
  return name
    .split(/[\s.\-,'`"()_/]+/)
    .map(nameKeyFor)
    .filter(Boolean)
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
