/**
 * The medicine library's read model: the whole dictionary (brands, generics,
 * companies, drug classes) loaded once per window and indexed in memory, so
 * the typeahead ranks on every keystroke without touching IndexedDB. Pure
 * functions, shared by the pages, the <MedicineSearch> picker and the tests.
 *
 * HAZ-04: every list here is relevance-ranked (search) or alphabetical
 * (browse, company, class and generic lists). Nothing is ever ordered by
 * stock, price, margin or offers.
 */

import type { MedcoreDb } from "@/core/db/database"
import type {
  BrandRow,
  DrugClassRow,
  GenericRow,
  PharmaCompanyRow,
} from "@/core/db/schema"
import {
  brandsOfGeneric,
  compareBrands,
  rankMedicines,
  type MedicineCatalog,
  type MedicineHit,
  type MedicineHitKind,
} from "@/core/search/medicines"
import { DRUG_CLASSES, classId } from "@/core/seed/content/medicines/classes"

/**
 * Extra search words per drug class (the abbreviations staff type: "ppi",
 * "nsaid", "ccb", "arb"). The class table stores names only, so the words
 * come from the dictionary content the classes were seeded from.
 */
export const CLASS_KEYS: Record<string, readonly string[]> = Object.fromEntries(
  DRUG_CLASSES.map((c) => [classId(c.key), c.keys])
)

/** Reads the whole dictionary (about 350 small rows). Use inside a liveQuery. */
export async function loadCatalog(db: MedcoreDb): Promise<MedicineCatalog> {
  const [brands, generics, companies, classes] = await Promise.all([
    db.brands.toArray(),
    db.generics.toArray(),
    db.pharmaCompanies.toArray(),
    db.drugClasses.toArray(),
  ])
  return { brands, generics, companies, classes, classKeys: CLASS_KEYS }
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)


export type LibraryIndex = {
  catalog: MedicineCatalog
  brandById: Map<string, BrandRow>
  genericById: Map<string, GenericRow>
  companyById: Map<string, PharmaCompanyRow>
  classById: Map<string, DrugClassRow>
  /** Alphabetical (brandsOfGeneric order) */
  brandsByGeneric: Map<string, BrandRow[]>
  /** Alphabetical */
  brandsByCompany: Map<string, BrandRow[]>
  /** Direct members only, alphabetical */
  genericsByClass: Map<string, GenericRow[]>
  /** Subclasses, alphabetical */
  childClasses: Map<string, DrugClassRow[]>
  /** Every brand, alphabetical */
  brands: BrandRow[]
  /** Every generic, alphabetical */
  generics: GenericRow[]
  /** Every company, alphabetical */
  companies: PharmaCompanyRow[]
  /** Top-level classes, alphabetical */
  rootClasses: DrugClassRow[]
}

function groupBy<T>(rows: T[], key: (row: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    if (k === undefined) continue
    const list = out.get(k)
    if (list) list.push(row)
    else out.set(k, [row])
  }
  return out
}

export function buildLibraryIndex(catalog: MedicineCatalog): LibraryIndex {
  const brands = [...catalog.brands].sort(compareBrands)
  const generics = [...catalog.generics].sort(byName)
  const companies = [...catalog.companies].sort(byName)
  const classes = [...catalog.classes].sort(byName)
  const brandsByGeneric = new Map<string, BrandRow[]>()
  for (const genericId of new Set(catalog.brands.map((b) => b.genericId))) {
    brandsByGeneric.set(genericId, brandsOfGeneric(genericId, catalog.brands))
  }
  return {
    catalog,
    brandById: new Map(catalog.brands.map((b) => [b.id, b])),
    genericById: new Map(catalog.generics.map((g) => [g.id, g])),
    companyById: new Map(catalog.companies.map((c) => [c.id, c])),
    classById: new Map(catalog.classes.map((c) => [c.id, c])),
    brandsByGeneric,
    brandsByCompany: groupBy(brands, (b) => b.companyId),
    genericsByClass: groupBy(generics, (g) => g.classId),
    childClasses: groupBy(classes, (c) => c.parentId),
    brands,
    generics,
    companies,
    rootClasses: classes.filter((c) => !c.parentId),
  }
}

/** A class and all its subclasses (ids), for class pages that list members. */
export function classFamily(index: LibraryIndex, id: string): string[] {
  const out = [id]
  for (const child of index.childClasses.get(id) ?? []) out.push(...classFamily(index, child.id))
  return out
}

/** Generics in a class or any of its subclasses, alphabetical. */
export function genericsInClass(index: LibraryIndex, id: string): GenericRow[] {
  return classFamily(index, id)
    .flatMap((classId) => index.genericsByClass.get(classId) ?? [])
    .sort(byName)
}

/** Brands in a class or any of its subclasses, alphabetical. */
export function brandsInClass(index: LibraryIndex, id: string): BrandRow[] {
  return genericsInClass(index, id)
    .flatMap((g) => index.brandsByGeneric.get(g.id) ?? [])
    .sort(compareBrands)
}

/** The generics a company makes (through its brands), alphabetical. */
export function genericsOfCompany(index: LibraryIndex, companyId: string): GenericRow[] {
  const ids = new Set((index.brandsByCompany.get(companyId) ?? []).map((b) => b.genericId))
  return [...ids]
    .map((id) => index.genericById.get(id))
    .filter((g): g is GenericRow => !!g)
    .sort(byName)
}

/** Brand count per company or generic, for "12 brands" captions. */
export function brandCount(index: LibraryIndex, hit: Pick<MedicineHit, "kind" | "id">): number {
  switch (hit.kind) {
    case "generic":
      return index.brandsByGeneric.get(hit.id)?.length ?? 0
    case "company":
      return index.brandsByCompany.get(hit.id)?.length ?? 0
    case "class":
      return brandsInClass(index, hit.id).length
    default:
      return 0
  }
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/** Group order on the library page: the few named entities first, then brands. */
export const RESULT_KINDS: MedicineHitKind[] = ["generic", "company", "class", "brand"]

export type HitGroups = Record<MedicineHitKind, MedicineHit[]>

/**
 * Every hit for the library page, grouped by kind. Each group keeps the
 * rankMedicines order (relevance, then alphabetical). One or two typed
 * letters keep only name matches, so "a" does not list every name that
 * merely contains an "a".
 */
export function searchLibrary(query: string, catalog: MedicineCatalog): HitGroups {
  const groups: HitGroups = { brand: [], generic: [], company: [], class: [] }
  const trimmed = query.trim()
  if (!trimmed) return groups
  const minScore = trimmed.length < 3 ? 50 : 1
  for (const hit of rankMedicines(trimmed, catalog, { limit: Number.POSITIVE_INFINITY })) {
    if (hit.score >= minScore) groups[hit.kind].push(hit)
  }
  return groups
}

/* ------------------------------------------------------------------ *
 * A to Z browse
 * ------------------------------------------------------------------ */

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

/** The browse letter for a name: A to Z, or "#" for anything else. */
export function letterOf(name: string): string {
  const first = name.trim().charAt(0).toUpperCase()
  return first >= "A" && first <= "Z" ? first : "#"
}

/** Items bucketed by the first letter of their name (input order kept). */
export function azBuckets<T>(items: T[], nameOf: (item: T) => string): Map<string, T[]> {
  return groupBy(items, (item) => letterOf(nameOf(item)))
}

/** One brand name with its strengths and forms, for the A to Z brand list. */
export type BrandFamily = {
  key: string
  name: string
  genericId: string
  companyId: string
  variants: BrandRow[]
}

/** Brands grouped by name and generic ("Napa": 500 mg tablet, suspension, ...), A to Z. */
export function brandFamilies(brands: BrandRow[]): BrandFamily[] {
  const families = new Map<string, BrandFamily>()
  for (const brand of [...brands].sort(compareBrands)) {
    const key = `${brand.name}|${brand.genericId}`
    const family = families.get(key)
    if (family) family.variants.push(brand)
    else
      families.set(key, {
        key,
        name: brand.name,
        genericId: brand.genericId,
        companyId: brand.companyId,
        variants: [brand],
      })
  }
  return [...families.values()]
}
