/**
 * Medicine dictionary (plan §7.1): manufacturers, drug classes, generics with
 * our own monographs, and 200 brands with mock DAR numbers, packs and prices
 * (unit price never above MRP). Search keys cover brand, generic, company and
 * class, including abbreviations such as "ppi" and "nsaid".
 */

import type { Bilingual } from "@/config/brand.config"
import type { BrandRow, DosageForm, GenericRow } from "@/core/db/schema"

import type { SeedCtx } from "../context"
import { BRANDS, brandId } from "../content/medicines/brands"
import { DRUG_CLASSES, classId } from "../content/medicines/classes"
import { PHARMA_COMPANIES, companyId } from "../content/medicines/companies"
import {
  GENERICS,
  INTERACTIONS_NOTE,
  genericId,
} from "../content/medicines/generics"
import { DAY } from "../time"
import { wordKeys } from "./search-keys"

const UNIT_LABEL: Record<DosageForm, Bilingual> = {
  tablet: { en: "tablet", bn: "ট্যাবলেট" },
  capsule: { en: "capsule", bn: "ক্যাপসুল" },
  syrup: { en: "bottle", bn: "বোতল" },
  suspension: { en: "bottle", bn: "বোতল" },
  drops: { en: "bottle", bn: "বোতল" },
  injection: { en: "ampoule", bn: "অ্যাম্পুল" },
  cream: { en: "tube", bn: "টিউব" },
  inhaler: { en: "inhaler", bn: "ইনহেলার" },
  suppository: { en: "suppository", bn: "সাপোজিটরি" },
  sachet: { en: "sachet", bn: "স্যাশে" },
}

export type BrandInfo = BrandRow & {
  companyKey: string
  genericKey: string
}

export function seedMedicines(ctx: SeedCtx): BrandInfo[] {
  const { bag } = ctx
  const rng = ctx.rng("medicines")
  const at = ctx.now - 2 * 365 * DAY

  for (const c of PHARMA_COMPANIES) {
    bag.put("pharmaCompanies", companyId(c.key), at, {
      name: c.name,
      shortName: c.shortName,
      about: c.about,
    })
  }

  const classKeys = new Map<string, string[]>()
  for (const c of DRUG_CLASSES) {
    bag.put("drugClasses", classId(c.key), at, {
      name: c.name,
      parentId: c.parent ? classId(c.parent) : undefined,
    })
    const parent = c.parent
      ? DRUG_CLASSES.find((p) => p.key === c.parent)
      : undefined
    classKeys.set(c.key, [
      ...c.keys,
      ...wordKeys(c.name),
      ...(parent?.keys ?? []),
    ])
  }

  const generics = new Map<string, GenericRow>()
  for (const g of GENERICS) {
    const row = bag.put("generics", genericId(g.key), at, {
      name: g.name,
      classId: classId(g.cls),
      glossBn: g.glossBn,
      indications: g.ind,
      dosage: g.dose,
      contraindications: g.ci,
      sideEffects: g.se,
      pregnancyCategory: g.preg,
      interactionsNote: INTERACTIONS_NOTE,
      isAntibiotic: g.antibiotic ?? false,
      controlledClass: g.controlled,
      allergyClass: g.allergyClass,
    })
    generics.set(g.key, row)
  }

  const companyIndex = new Map(PHARMA_COMPANIES.map((c, i) => [c.key, i]))
  const brands: BrandInfo[] = []
  BRANDS.forEach(
    ([name, genericKey, companyKey, strength, form, mrpTaka, pack], i) => {
      const g = GENERICS.find((x) => x.key === genericKey)
      const company = PHARMA_COMPANIES.find((c) => c.key === companyKey)
      if (!g || !company) throw new Error(`seed: bad brand ${name}`)
      const id = brandId(name, strength, form)
      const mrpP = Math.round(mrpTaka * 100)
      // Hospital pharmacy price: usually the MRP, sometimes a little below; never above.
      const unitPriceP = rng.bool(0.15) ? Math.floor(mrpP * 0.95) : mrpP
      const category: BrandRow["category"] = g.controlled
        ? "controlled"
        : g.otc
          ? "otc"
          : "rx"
      const compact = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "")
      const digits = strength.match(/^[\d.]+/)?.[0]?.replace(".", "") ?? ""
      const keys = new Set<string>([
        ...wordKeys(name),
        compact(name),
        `${compact(name)}${digits}`,
        ...wordKeys(g.name),
        compact(g.name),
        g.key,
        ...wordKeys(company.shortName),
        compact(company.shortName),
        company.key,
        ...(classKeys.get(g.cls) ?? []),
      ])
      const cIdx = companyIndex.get(companyKey) ?? 0
      const unitLabel =
        form === "injection" && pack.label.includes("vial")
          ? { en: "vial", bn: "ভায়াল" }
          : UNIT_LABEL[form]
      const row = bag.put("brands", id, at + rng.int(0, 300) * DAY, {
        name,
        genericId: genericId(genericKey),
        companyId: companyId(companyKey),
        strength,
        form,
        darNo: `${String(101 + cIdx * 7).padStart(3, "0")}-${String(((i + 1) * 37) % 10000).padStart(4, "0")}-${String(((i + 3) * 13) % 1000).padStart(3, "0")}`,
        packSizes: [pack],
        unitPriceP,
        mrpP,
        category,
        isAntibiotic: g.antibiotic ?? false,
        searchKeys: [...keys].filter(Boolean),
        unitLabel,
      })
      brands.push({ ...row, companyKey, genericKey })
    }
  )
  return brands
}
