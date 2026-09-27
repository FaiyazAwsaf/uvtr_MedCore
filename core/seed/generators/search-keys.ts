/**
 * Search-key normalisation for names (plan §5.2: phonetic, Bangla-tolerant).
 * The implementation lives in core/search/fuzzy.ts so registration, search,
 * offline replay and the seed all use exactly the same keys.
 * Common spelling variants of Bangladeshi names collapse to one key, so
 * "Md.", "Mohammad" and "Muhammed" all index as "md", and "Begom" matches
 * "Begum". Bangla words are indexed as typed (minus punctuation), with the
 * usual honorific abbreviations folded the same way. Search code must run a
 * query through `nameKeyFor` before looking it up in `nameSearchKeys`.
 */

export { nameKeyFor, nameKeys as nameSearchKeys } from "@/core/search/fuzzy"

/** Lowercase words of a free phrase, for medicine and class typeahead. */
export function wordKeys(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+-]+/)
    .map((w) => w.replace(/^[+-]+|[+-]+$/g, ""))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

const STOP_WORDS = new Set([
  "and",
  "of",
  "the",
  "with",
  "for",
  "mg",
  "ml",
  "mcg",
  "iu",
  "g",
])
