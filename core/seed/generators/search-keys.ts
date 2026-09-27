/**
 * Search-key normalisation for names (plan §5.2: phonetic, Bangla-tolerant).
 * Common spelling variants of Bangladeshi names collapse to one key, so
 * "Md.", "Mohammad" and "Muhammed" all index as "md", and "Begom" matches
 * "Begum". Bangla words are indexed as typed (minus punctuation), with the
 * usual honorific abbreviations folded the same way. Search code must run a
 * query through `nameKeyFor` before looking it up in `nameSearchKeys`.
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

/** Every normalised token of an English and a Bangla name, deduplicated. */
export function nameSearchKeys(nameEn: string, nameBn: string): string[] {
  const words = [...nameEn.split(/[\s.\-]+/), ...nameBn.split(/[\s.\-]+/)]
  const keys = new Set<string>()
  for (const w of words) {
    const key = nameKeyFor(w)
    if (key) keys.add(key)
  }
  return [...keys]
}

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
