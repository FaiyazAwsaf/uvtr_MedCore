/**
 * Medicine search shared by the Rx pad, pharmacy, procurement and the medicine
 * library.
 * HAZ-04: results are ranked by text relevance, then alphabetically. Never by
 * stock, margin or offers; offers appear only after a medicine is selected.
 */

import type {
  BrandRow,
  DosageForm,
  DrugClassRow,
  GenericRow,
  PharmaCompanyRow,
} from "@/core/db/schema"

export type MedicineHitKind = "brand" | "generic" | "company" | "class"

export type MedicineHit = {
  kind: MedicineHitKind
  id: string
  /** Main line, e.g. "Napa 500 mg" or "Paracetamol" */
  label: string
  /** Second line, e.g. "Paracetamol 500 mg tablet · Beximco" */
  detail: string
  /** Set for brand hits (and for brands listed under a generic) */
  brandId?: string
  genericId?: string
  /** Brand hits: the parts of the second line, for structured display */
  strength?: string
  form?: DosageForm
  category?: BrandRow["category"]
  /** Brand and generic hits */
  isAntibiotic?: boolean
  /** Brand hits: the generic's name */
  genericName?: string
  /** Brand hits: the manufacturer's id and short name */
  companyId?: string
  companyName?: string
  /** Generic hits: the generic's drug class */
  classId?: string
  className?: string
  score: number
}

export type MedicineCatalog = {
  brands: BrandRow[]
  generics: GenericRow[]
  companies: PharmaCompanyRow[]
  classes: DrugClassRow[]
  /**
   * Extra search words per drug class id: the abbreviations staff type, such
   * as "ppi", "nsaid" or "ccb". Optional; without them a class matches by its
   * name only.
   */
  classKeys?: Record<string, readonly string[]>
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, " ").trim()

/** Normalised words of a text: "Napa 500 mg" gives ["napa", "500", "mg"]. */
const wordsOf = (s: string) => {
  const n = norm(s)
  return n ? n.split(" ") : []
}

/** 100 exact, 80 starts with, 60 a word starts with, 30 contains, 0 no match. */
export function textScore(query: string, text: string): number {
  const q = norm(query)
  const t = norm(text)
  if (!q || !t) return 0
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (t.split(" ").some((word) => word.startsWith(q))) return 60
  if (t.includes(q)) return 30
  return 0
}

/**
 * A query of several words ("omeprazole 20", "napa susp", "seclo 40mg")
 * matches a brand when every word starts one of the brand's words: name,
 * strength, dosage form, generic, manufacturer and search keys. Ranked below
 * a whole-phrase match on a name.
 */
const WORDS_SCORE = 50

function brandWords(
  brand: BrandRow,
  generic: GenericRow | undefined,
  company: PharmaCompanyRow | undefined
): string[] {
  return [
    ...wordsOf(brand.name),
    ...wordsOf(brand.strength),
    // "500mg" as typed without a space
    brand.strength.toLowerCase().replace(/\s+/g, ""),
    brand.form,
    ...wordsOf(generic?.name ?? ""),
    ...wordsOf(company?.shortName ?? ""),
    ...wordsOf(company?.name ?? ""),
    ...brand.searchKeys.flatMap(wordsOf),
  ]
}

/**
 * Rank the catalogue for a query. Brand hits cover brand names and search
 * keys; a generic match also surfaces that generic's brands (slightly lower),
 * so "paracetamol" lists Napa, Ace and the rest. Ties are alphabetical.
 */
export function rankMedicines(
  query: string,
  catalog: MedicineCatalog,
  { limit = 20, kinds }: { limit?: number; kinds?: MedicineHitKind[] } = {}
): MedicineHit[] {
  const q = norm(query)
  if (!q) return []
  const queryWords = q.split(" ")
  const multiWord = queryWords.length > 1
  const want = (kind: MedicineHitKind) => !kinds || kinds.includes(kind)
  const generics = new Map(catalog.generics.map((g) => [g.id, g]))
  const companies = new Map(catalog.companies.map((c) => [c.id, c]))
  const classes = new Map(catalog.classes.map((c) => [c.id, c]))
  const hits = new Map<string, MedicineHit>()
  const add = (hit: MedicineHit) => {
    const key = `${hit.kind}:${hit.id}`
    const existing = hits.get(key)
    if (!existing || existing.score < hit.score) hits.set(key, hit)
  }
  const brandHit = (b: BrandRow, score: number): MedicineHit => {
    const generic = generics.get(b.genericId)
    const company = companies.get(b.companyId)
    return {
      kind: "brand",
      id: b.id,
      brandId: b.id,
      genericId: b.genericId,
      label: `${b.name} ${b.strength}`.trim(),
      detail: `${generic?.name ?? ""} ${b.strength} ${b.form} · ${company?.shortName ?? ""}`.trim(),
      strength: b.strength,
      form: b.form,
      category: b.category,
      isAntibiotic: b.isAntibiotic,
      genericName: generic?.name,
      companyId: b.companyId,
      companyName: company?.shortName,
      score,
    }
  }

  if (want("brand")) {
    for (const brand of catalog.brands) {
      const label = `${brand.name} ${brand.strength}`.trim()
      let score = Math.max(
        textScore(query, brand.name),
        textScore(query, label),
        ...brand.searchKeys.map((k) => textScore(query, k) - 5)
      )
      if (multiWord && score < WORDS_SCORE) {
        const words = brandWords(
          brand,
          generics.get(brand.genericId),
          companies.get(brand.companyId)
        )
        if (queryWords.every((w) => words.some((word) => word.startsWith(w))))
          score = WORDS_SCORE
      }
      if (score > 0) add(brandHit(brand, score))
    }
  }
  for (const generic of catalog.generics) {
    const score = textScore(query, generic.name)
    if (score <= 0) continue
    if (want("generic")) {
      const cls = classes.get(generic.classId)
      add({
        kind: "generic",
        id: generic.id,
        genericId: generic.id,
        label: generic.name,
        detail: generic.glossBn ?? "",
        isAntibiotic: generic.isAntibiotic,
        classId: generic.classId,
        className: cls?.name,
        score,
      })
    }
    if (want("brand")) {
      for (const brand of catalog.brands) {
        if (brand.genericId === generic.id) add(brandHit(brand, score - 10))
      }
    }
  }
  if (want("company")) {
    for (const company of catalog.companies) {
      const score = Math.max(textScore(query, company.name), textScore(query, company.shortName))
      if (score > 0) {
        add({ kind: "company", id: company.id, label: company.name, detail: company.shortName, score })
      }
    }
  }
  if (want("class")) {
    for (const cls of catalog.classes) {
      const keys = catalog.classKeys?.[cls.id] ?? []
      const score = Math.max(
        textScore(query, cls.name),
        ...keys.map((k) => textScore(query, k) - 5)
      )
      if (score > 0) {
        const parent = cls.parentId ? classes.get(cls.parentId) : undefined
        add({ kind: "class", id: cls.id, label: cls.name, detail: parent?.name ?? "", score })
      }
    }
  }

  return [...hits.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.label.localeCompare(b.label) ||
        // Same name and strength in two forms (tablet, injection): stable, input-order free
        (a.form ?? "").localeCompare(b.form ?? "") ||
        a.id.localeCompare(b.id)
    )
    .slice(0, limit)
}

/** All brands of a generic, alphabetical (the "See all brands" list and Rx alternatives). */
export function brandsOfGeneric(genericId: string, brands: BrandRow[]): BrandRow[] {
  return brands.filter((b) => b.genericId === genericId).sort(compareBrands)
}

/** Brands A to Z: name, then strength, then dosage form (ties never depend on input order). */
export function compareBrands(a: BrandRow, b: BrandRow): number {
  return (
    a.name.localeCompare(b.name) ||
    a.strength.localeCompare(b.strength) ||
    a.form.localeCompare(b.form) ||
    a.id.localeCompare(b.id)
  )
}
