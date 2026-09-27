/**
 * Medicine search shared by the Rx pad, pharmacy and the medicine library.
 * HAZ-04: results are ranked by text relevance, then alphabetically. Never by
 * stock, margin or offers; offers appear only after a medicine is selected.
 */

import type {
  BrandRow,
  DrugClassRow,
  GenericRow,
  PharmaCompanyRow,
} from "@/core/db/schema"

export type MedicineHitKind = "brand" | "generic" | "company" | "class"

export type MedicineHit = {
  kind: MedicineHitKind
  id: string
  /** Main line, e.g. "Napa 500" or "Paracetamol" */
  label: string
  /** Second line, e.g. "Paracetamol 500 mg tablet · Beximco" */
  detail: string
  /** Set for brand hits (and for brands listed under a generic) */
  brandId?: string
  genericId?: string
  score: number
}

export type MedicineCatalog = {
  brands: BrandRow[]
  generics: GenericRow[]
  companies: PharmaCompanyRow[]
  classes: DrugClassRow[]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, " ").trim()

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
 * Rank the catalogue for a query. Brand hits cover brand names and search
 * keys; a generic match also surfaces that generic's brands (slightly lower),
 * so "paracetamol" lists Napa, Ace and the rest.
 */
export function rankMedicines(
  query: string,
  catalog: MedicineCatalog,
  { limit = 20, kinds }: { limit?: number; kinds?: MedicineHitKind[] } = {}
): MedicineHit[] {
  if (!norm(query)) return []
  const want = (kind: MedicineHitKind) => !kinds || kinds.includes(kind)
  const generics = new Map(catalog.generics.map((g) => [g.id, g]))
  const companies = new Map(catalog.companies.map((c) => [c.id, c]))
  const hits = new Map<string, MedicineHit>()
  const add = (hit: MedicineHit) => {
    const key = `${hit.kind}:${hit.id}`
    const existing = hits.get(key)
    if (!existing || existing.score < hit.score) hits.set(key, hit)
  }
  const brandDetail = (b: BrandRow) => {
    const generic = generics.get(b.genericId)?.name ?? ""
    const company = companies.get(b.companyId)?.shortName ?? ""
    return `${generic} ${b.strength} ${b.form} · ${company}`.trim()
  }

  if (want("brand")) {
    for (const brand of catalog.brands) {
      const label = `${brand.name} ${brand.strength}`.trim()
      const score = Math.max(
        textScore(query, brand.name),
        textScore(query, label),
        ...brand.searchKeys.map((k) => textScore(query, k) - 5)
      )
      if (score > 0) {
        add({
          kind: "brand",
          id: brand.id,
          brandId: brand.id,
          genericId: brand.genericId,
          label,
          detail: brandDetail(brand),
          score,
        })
      }
    }
  }
  for (const generic of catalog.generics) {
    const score = textScore(query, generic.name)
    if (score <= 0) continue
    if (want("generic")) {
      add({
        kind: "generic",
        id: generic.id,
        genericId: generic.id,
        label: generic.name,
        detail: generic.glossBn ?? "",
        score,
      })
    }
    if (want("brand")) {
      for (const brand of catalog.brands.filter((b) => b.genericId === generic.id)) {
        add({
          kind: "brand",
          id: brand.id,
          brandId: brand.id,
          genericId: brand.genericId,
          label: `${brand.name} ${brand.strength}`.trim(),
          detail: brandDetail(brand),
          score: score - 10,
        })
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
      const score = textScore(query, cls.name)
      if (score > 0) add({ kind: "class", id: cls.id, label: cls.name, detail: "", score })
    }
  }

  return [...hits.values()]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit)
}

/** All brands of a generic, alphabetical (the "See all brands" list and Rx alternatives). */
export function brandsOfGeneric(genericId: string, brands: BrandRow[]): BrandRow[] {
  return brands
    .filter((b) => b.genericId === genericId)
    .sort((a, b) => a.name.localeCompare(b.name) || a.strength.localeCompare(b.strength))
}
