import { describe, expect, it } from "vitest"

import type { FeeShareContractRow } from "@/core/db/schema"
import {
  computeBill,
  contractInForce,
  corporateSplit,
  discountLimit,
  feeShareAmounts,
  feeShareRuleFor,
  parseTaka,
  priceLines,
  spreadDiscount,
  takaText,
} from "@/modules/billing/pricing"

describe("discount spread (INV-03)", () => {
  it("adds up exactly and keeps every line between zero and its amount", () => {
    // Deterministic pseudo-random baskets, including tiny medicine lines.
    let seed = 7
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    for (let run = 0; run < 400; run++) {
      const amounts = Array.from({ length: 1 + Math.floor(rand() * 8) }, () =>
        Math.floor(rand() * 5) === 0 ? Math.floor(rand() * 300) : Math.floor(rand() * 250_000)
      )
      const pct = Math.floor(rand() * 101)
      const subtotal = amounts.reduce((s, a) => s + a, 0)
      const discount = Math.round((subtotal * pct) / 100)
      const shares = spreadDiscount(amounts, discount)
      expect(shares.reduce((s, a) => s + a, 0)).toBe(Math.min(discount, subtotal))
      shares.forEach((share, i) => {
        expect(share).toBeGreaterThanOrEqual(0)
        expect(share).toBeLessThanOrEqual(amounts[i])
        expect(Number.isInteger(share)).toBe(true)
      })
    }
  })

  it("prices lines so amount = qty x unit price and net = amount - discount", () => {
    const priced = priceLines(
      [
        { qty: 1, unitPriceP: 100_000 },
        { qty: 7, unitPriceP: 900 },
        { qty: 9, unitPriceP: 120 },
      ],
      10
    )
    expect(priced.subtotalP).toBe(100_000 + 6_300 + 1_080)
    expect(priced.discountP).toBe(10_738)
    expect(priced.totalP).toBe(priced.subtotalP - priced.discountP)
    for (const line of priced.lines) {
      expect(line.amountP).toBe(line.qty * line.unitPriceP)
      expect(line.netP).toBe(line.amountP - line.discountP)
    }
    expect(priced.lines.reduce((s, l) => s + l.netP, 0)).toBe(priced.totalP)
  })
})

describe("authority and money input", () => {
  it("reads the discount limit from authorities", () => {
    expect(discountLimit([])).toBe(0)
    expect(discountLimit(["discount:5"])).toBe(5)
    expect(discountLimit(["approve:refund", "discount:15", "discount:5"])).toBe(15)
    expect(discountLimit(["*"])).toBe(100)
  })

  it("parses taka typed in English or Bangla digits", () => {
    expect(parseTaka("1,500")).toBe(150_000)
    expect(parseTaka("10.8")).toBe(1_080)
    expect(parseTaka("১৫০০")).toBe(150_000)
    expect(parseTaka("৳ 250.50")).toBe(25_050)
    expect(parseTaka("12.345")).toBeNull()
    expect(parseTaka("abc")).toBeNull()
    expect(takaText(150_000)).toBe("1500")
    expect(takaText(1_080)).toBe("10.8")
    expect(takaText(1_005)).toBe("10.05")
  })
})

describe("corporate split", () => {
  it("takes the co-pay from the company's lines and caps at the limit", () => {
    expect(
      corporateSplit({ corporateNetP: 100_000, totalP: 120_000, coPayPct: 20, remainingLimitP: Infinity })
    ).toEqual({ corporateShareP: 80_000, patientDueP: 40_000 })
    expect(
      corporateSplit({ corporateNetP: 100_000, totalP: 100_000, coPayPct: 20, remainingLimitP: 5_000 })
    ).toEqual({ corporateShareP: 5_000, patientDueP: 95_000 })
  })

  it("bills only covered services of the right client to the company", () => {
    const cover = { clientId: "corp_a", coPayPct: 20, coveredServices: ["lab" as const], remainingLimitP: 1e9 }
    const bill = computeBill(
      [
        { qty: 1, unitPriceP: 40_000, serviceType: "lab", payerType: "corporate", corporateClientId: "corp_a" },
        { qty: 1, unitPriceP: 60_000, serviceType: "imaging", payerType: "corporate", corporateClientId: "corp_a" },
        { qty: 1, unitPriceP: 10_000, serviceType: "lab", payerType: "corporate", corporateClientId: "corp_b" },
        { qty: 1, unitPriceP: 5_000, serviceType: "lab", payerType: "self" },
      ],
      0,
      cover
    )
    expect(bill.corporateNetP).toBe(40_000)
    expect(bill.corporateShareP).toBe(32_000)
    expect(bill.patientDueP).toBe(115_000 - 32_000)
    expect(bill.uncoveredCorporate).toBe(2)
    expect(bill.payerType).toBe("corporate")
    expect(computeBill([{ qty: 1, unitPriceP: 1, serviceType: "lab", payerType: "corporate" }], 0, null)).toMatchObject({
      corporateShareP: 0,
      payerType: "self",
    })
  })
})

describe("fee share maths (PRD §10.9)", () => {
  const contract = (over: Partial<FeeShareContractRow> = {}): FeeShareContractRow => ({
    id: "fsc",
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "system",
    updatedBy: "system",
    origin: "central",
    doctorId: "doc",
    contractVersion: 1,
    effectiveFrom: "2026-01-01",
    rules: [
      { serviceType: "consultation", basis: "pct-net", value: 70, trigger: "collection" },
      { serviceType: "imaging-reporting", basis: "pct-net", value: 30, trigger: "collection" },
    ],
    whtPct: 10,
    discountBearer: "pro-rata",
    ...over,
  })

  it("70% of the net with 10% withholding tax, discount shared pro rata", () => {
    const rule = feeShareRuleFor(contract(), "consultation")!
    expect(feeShareAmounts(rule, contract(), { amountP: 100_000, discountP: 10_000, netP: 90_000 })).toEqual({
      shareP: 63_000,
      whtP: 6_300,
    })
    // The hospital bears the discount: the share is on the gross.
    expect(
      feeShareAmounts(rule, contract({ discountBearer: "hospital" }), {
        amountP: 100_000,
        discountP: 10_000,
        netP: 90_000,
      }).shareP
    ).toBe(70_000)
    // The consultant bears it all.
    expect(
      feeShareAmounts(rule, contract({ discountBearer: "consultant" }), {
        amountP: 100_000,
        discountP: 10_000,
        netP: 90_000,
      }).shareP
    ).toBe(60_000)
  })

  it("a reporting doctor's rule applies to diagnostic lines; no rule, no share", () => {
    expect(feeShareRuleFor(contract(), "imaging")?.value).toBe(30)
    expect(feeShareRuleFor(contract(), "medicine")).toBeUndefined()
  })

  it("picks the latest contract version already in force", () => {
    const v1 = contract({ id: "v1", contractVersion: 1, effectiveFrom: "2024-01-01" })
    const v2 = contract({ id: "v2", contractVersion: 2, effectiveFrom: "2026-06-01" })
    const v3 = contract({ id: "v3", contractVersion: 3, effectiveFrom: "2027-01-01" })
    expect(contractInForce([v1, v2, v3], "2026-09-28")?.id).toBe("v2")
    expect(contractInForce([v1, v2, v3], "2025-01-01")?.id).toBe("v1")
  })
})
