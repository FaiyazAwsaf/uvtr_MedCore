import { describe, expect, it } from "vitest"

import {
  DUPLICATE_THRESHOLD,
  nameKeys,
  nameSimilarity,
  normalizeName,
  scoreDuplicate,
} from "@/core/search/fuzzy"
import { nameSearchKeys } from "@/core/seed/generators/search-keys"

describe("name normalisation", () => {
  it("collapses common Bangladeshi spelling variants", () => {
    expect(normalizeName("Md. Rafiqul Islam")).toEqual(normalizeName("Mohammad Rafiqul Islam"))
    expect(normalizeName("Rokeya Begom")).toEqual(normalizeName("Rokeya Begum"))
    expect(normalizeName("Salma Akhter")).toEqual(normalizeName("Salma Akter"))
  })

  it("folds Bangla honorific abbreviations", () => {
    expect(normalizeName("মোঃ রফিকুল ইসলাম")[0]).toBe(normalizeName("মোহাম্মদ রফিকুল ইসলাম")[0])
  })

  it("is the same function the seed indexes with", () => {
    expect(nameSearchKeys("Md. Rafiqul Islam", "মোঃ রফিকুল ইসলাম")).toEqual(
      nameKeys("Md. Rafiqul Islam", "মোঃ রফিকুল ইসলাম")
    )
  })
})

describe("duplicate scoring", () => {
  const existing = { nameEn: "Md. Rafiqul Islam", dob: "1978-03-12", phone: "01819-000001" }

  it("flags a spelling variant with the same date of birth", () => {
    expect(nameSimilarity("Mohammad Rafiqul Islam", existing.nameEn)).toBe(1)
    const { score, reasons } = scoreDuplicate({ nameEn: "Mohammad Rafiqul Islam", dob: "1978-03-12" }, existing)
    expect(score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD)
    expect(reasons).toEqual(["name", "dob"])
  })

  it("treats an exact NID as certain and a different person as no match", () => {
    expect(scoreDuplicate({ nameEn: "X", nid: "123" }, { ...existing, nid: "123" }).score).toBe(1)
    expect(scoreDuplicate({ nameEn: "Salma Khatun", dob: "1990-01-01" }, existing).score).toBeLessThan(DUPLICATE_THRESHOLD)
  })
})
