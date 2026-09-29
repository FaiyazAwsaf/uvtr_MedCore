import { describe, expect, it } from "vitest"

import type { BrandRow } from "@/core/db/schema"
import { buildSeed } from "@/core/seed"
import { SEED_REFS } from "@/core/seed/content/seed-refs"
import {
  brandsOfGeneric,
  rankMedicines,
  type MedicineCatalog,
  type MedicineHit,
} from "@/core/search/medicines"
import {
  CLASS_KEYS,
  azBuckets,
  brandFamilies,
  brandsInClass,
  buildLibraryIndex,
  genericsInClass,
  genericsOfCompany,
  letterOf,
  searchLibrary,
} from "@/modules/medicine-library/catalog"
import { addToRxPath, hitPath, routeId, withRxParams } from "@/modules/medicine-library/paths"

/** 28-09-2026, 11:30 in Dhaka (UTC+6). */
const OPTS = { now: Date.UTC(2026, 8, 28, 5, 30), today: "2026-09-28" }

const { bag } = buildSeed(OPTS)
const catalog: MedicineCatalog = {
  brands: bag.all("brands"),
  generics: bag.all("generics"),
  companies: bag.all("pharmaCompanies"),
  classes: bag.all("drugClasses"),
  classKeys: CLASS_KEYS,
}
const index = buildLibraryIndex(catalog)
const brandById = new Map(catalog.brands.map((b) => [b.id, b]))
const genericOf = (hit: MedicineHit) => brandById.get(hit.id)?.genericId

/** HAZ-04: inside one relevance score, hits are alphabetical by label. */
function expectRelevanceThenAlphabetical(hits: MedicineHit[]) {
  for (let i = 1; i < hits.length; i++) {
    const [a, b] = [hits[i - 1], hits[i]]
    expect(a.score).toBeGreaterThanOrEqual(b.score)
    if (a.score === b.score) expect(a.label.localeCompare(b.label)).toBeLessThanOrEqual(0)
  }
}

describe("library search: the demo's four searches", () => {
  it('"napa" lists the Napa brands first', () => {
    const hits = rankMedicines("napa", catalog)
    const top = hits.filter((h) => h.score === 100)
    expect(top.length).toBeGreaterThanOrEqual(4)
    expect(top.every((h) => h.kind === "brand" && h.label.startsWith("Napa "))).toBe(true)
    expect(top.map((h) => h.id)).toContain(SEED_REFS.brand.napa500)
    expect(hits.slice(0, 7).every((h) => h.label.startsWith("Napa"))).toBe(true)
    expectRelevanceThenAlphabetical(hits)
  })

  it('"paracetamol" finds the generic, then every paracetamol brand alphabetically', () => {
    const hits = rankMedicines("paracetamol", catalog, { limit: 100 })
    expect(hits[0]).toMatchObject({ kind: "generic", id: SEED_REFS.generic.paracetamol })
    const brandIds = hits.filter((h) => h.kind === "brand").map((h) => h.id)
    for (const brand of brandsOfGeneric(SEED_REFS.generic.paracetamol, catalog.brands)) {
      expect(brandIds).toContain(brand.id)
    }
    expectRelevanceThenAlphabetical(hits)
  })

  it('"Beximco" finds the company and its brands', () => {
    const hits = rankMedicines("Beximco", catalog, { limit: 200 })
    expect(hits[0]).toMatchObject({ kind: "company", id: "pc_beximco" })
    const brands = hits.filter((h) => h.kind === "brand")
    expect(brands.length).toBe(index.brandsByCompany.get("pc_beximco")?.length)
    expect(brands.every((h) => h.companyId === "pc_beximco")).toBe(true)
  })

  it('"PPI" finds the drug class and every proton pump inhibitor brand', () => {
    const groups = searchLibrary("PPI", catalog)
    expect(groups.class.map((h) => h.id)).toContain("cls_ppi")
    const ppiBrands = brandsInClass(index, "cls_ppi").map((b) => b.id).sort()
    expect(groups.brand.map((h) => h.id).sort()).toEqual(ppiBrands)
    expect(ppiBrands).toContain(SEED_REFS.brand.seclo20)
  })

  it("groups keep every hit of a kind, however many there are", () => {
    const groups = searchLibrary("PPI", catalog)
    expect(groups.brand.length).toBeGreaterThan(20)
    expect(groups.class.length).toBeGreaterThanOrEqual(1)
  })
})

describe("library search: typing variations", () => {
  it("matches a brand with its strength, with or without a space", () => {
    expect(rankMedicines("napa 500", catalog)[0].id).toBe(SEED_REFS.brand.napa500)
    expect(rankMedicines("Napa 500mg", catalog)[0].id).toBe(SEED_REFS.brand.napa500)
  })

  it("matches several words against name, strength, form, generic and company", () => {
    const hits = rankMedicines("omeprazole 20", catalog, { limit: 50 })
    expect(hits.map((h) => h.id)).toContain(SEED_REFS.brand.seclo20)
    for (const hit of hits) {
      expect(genericOf(hit)).toBe(SEED_REFS.generic.omeprazole)
      expect(hit.strength).toBe("20 mg")
    }
    const suspensions = rankMedicines("napa susp", catalog)
    expect(suspensions).toHaveLength(1)
    expect(suspensions[0]).toMatchObject({ form: "suspension", label: "Napa 120 mg/5 ml" })
  })

  it("finds classes by their abbreviations", () => {
    expect(rankMedicines("ccb", catalog, { kinds: ["class"] })[0]).toMatchObject({ id: "cls_ccb" })
    expect(rankMedicines("nsaid", catalog, { kinds: ["class"] })[0]).toMatchObject({ id: "cls_nsaid" })
    expect(rankMedicines("arb", catalog, { kinds: ["class"] })[0]).toMatchObject({ id: "cls_arb" })
  })

  it("carries structured brand fields for the picker", () => {
    const [hit] = rankMedicines("napa 500", catalog)
    expect(hit).toMatchObject({
      brandId: SEED_REFS.brand.napa500,
      genericId: SEED_REFS.generic.paracetamol,
      genericName: "Paracetamol",
      strength: "500 mg",
      form: "tablet",
      category: "otc",
      companyName: "Beximco",
      companyId: "pc_beximco",
    })
  })

  it("one or two letters keep only name matches on the library page", () => {
    const groups = searchLibrary("a", catalog)
    const all = [...groups.brand, ...groups.generic, ...groups.company, ...groups.class]
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((h) => h.score >= 50)).toBe(true)
    expect(searchLibrary("   ", catalog).brand).toHaveLength(0)
  })

  it("respects the kinds filter", () => {
    const hits = rankMedicines("paracetamol", catalog, { kinds: ["brand"], limit: 50 })
    expect(hits.length).toBeGreaterThan(5)
    expect(hits.every((h) => h.kind === "brand")).toBe(true)
  })
})

describe("HAZ-04: order never depends on stock, price or offers", () => {
  it("ranks the same when prices change and the catalogue is shuffled", () => {
    const queries = ["napa", "paracetamol", "beximco", "ppi", "omeprazole 20", "ace", "zimax"]
    const repriced: MedicineCatalog = {
      ...catalog,
      brands: [...catalog.brands]
        .reverse()
        .map((b, i): BrandRow => ({ ...b, unitPriceP: (i * 7919) % 5000, mrpP: 99_999 })),
      generics: [...catalog.generics].reverse(),
      companies: [...catalog.companies].reverse(),
    }
    for (const query of queries) {
      const ids = (c: MedicineCatalog) => rankMedicines(query, c, { limit: 500 }).map((h) => h.id)
      expect(ids(repriced), query).toEqual(ids(catalog))
    }
  })

  it("keeps brandsOfGeneric alphabetical, whatever order the rows arrive in", () => {
    for (const genericId of [SEED_REFS.generic.paracetamol, SEED_REFS.generic.omeprazole, "gen_esomeprazole"]) {
      const brands = brandsOfGeneric(genericId, catalog.brands)
      const names = brands.map((b) => `${b.name}|${b.strength}`)
      expect(names).toEqual(
        [...brands]
          .sort((a, b) => a.name.localeCompare(b.name) || a.strength.localeCompare(b.strength))
          .map((b) => `${b.name}|${b.strength}`)
      )
      const reversed = brandsOfGeneric(genericId, [...catalog.brands].reverse())
      expect(reversed.map((b) => b.id)).toEqual(brands.map((b) => b.id))
    }
  })
})

describe("library search: speed (typeahead under 100 ms)", () => {
  it("ranks the full dictionary in a few milliseconds per keystroke", () => {
    const keystrokes = ["n", "na", "nap", "napa", "p", "pa", "par", "para", "parac", "paracetamol", "b", "be", "bex", "beximco", "p", "pp", "ppi", "omeprazole 2", "omeprazole 20"]
    const started = performance.now()
    for (const q of keystrokes) searchLibrary(q, catalog)
    const perKeystroke = (performance.now() - started) / keystrokes.length
    expect(perKeystroke).toBeLessThan(50)
  })
})

describe("library index and browse", () => {
  it("indexes the whole dictionary", () => {
    expect(index.brands).toHaveLength(200)
    expect(index.generics.length).toBeGreaterThanOrEqual(60)
    expect(index.companies.length).toBeGreaterThanOrEqual(20)
    expect(index.brands.map((b) => b.name)).toEqual(
      [...index.brands].map((b) => b.name).sort((a, b) => a.localeCompare(b))
    )
  })

  it("lists a class with its subclasses, and a company's generics, alphabetically", () => {
    const gastro = genericsInClass(index, "cls_gastro").map((g) => g.id)
    expect(gastro).toContain(SEED_REFS.generic.omeprazole)
    const names = genericsInClass(index, "cls_gastro").map((g) => g.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(genericsOfCompany(index, "pc_beximco").map((g) => g.id)).toContain(
      SEED_REFS.generic.paracetamol
    )
  })

  it("buckets names by letter and groups brand strengths", () => {
    expect(letterOf("Napa")).toBe("N")
    expect(letterOf("3-in-1")).toBe("#")
    const buckets = azBuckets(index.generics, (g) => g.name)
    expect(buckets.get("P")?.map((g) => g.id)).toContain(SEED_REFS.generic.paracetamol)
    const napa = brandFamilies(index.brands).find((f) => f.name === "Napa")
    expect(napa?.variants.map((v) => v.id)).toContain(SEED_REFS.brand.napa500)
    expect(napa?.variants.length).toBe(4)
  })

  it("builds library and Rx-pad links", () => {
    expect(hitPath({ kind: "brand", id: "brd_napa_500mg" })).toBe("/library/brand/brd_napa_500mg")
    expect(withRxParams("/library/brand/b1", "enc_1")).toBe("/library/brand/b1?from=rx&encounter=enc_1")
    expect(withRxParams("/library?browse=classes", "enc_1")).toBe(
      "/library?browse=classes&from=rx&encounter=enc_1"
    )
    expect(withRxParams("/library", null)).toBe("/library")
    expect(addToRxPath("enc_1", "brd_napa_500mg")).toBe(
      "/doctor/encounter/enc_1?addBrand=brd_napa_500mg"
    )
    expect(routeId("brd%5Fnapa")).toBe("brd_napa")
    expect(routeId("100%")).toBe("100%")
  })
})
