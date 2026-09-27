import { describe, expect, it } from "vitest"

import {
  branches,
  companies,
  fiscalYearTag,
  getCompany,
} from "@/config/brand.config"
import { rules } from "@/config/rules.config"

describe("brand config", () => {
  it("has 3 companies and 5 branches, each owned by a known company", () => {
    expect(companies).toHaveLength(3)
    expect(branches).toHaveLength(5)
    for (const branch of branches) {
      expect(getCompany(branch.company).code).toBe(branch.company)
    }
  })

  it("tags the Bangladesh fiscal year (July to June)", () => {
    expect(fiscalYearTag(new Date(2026, 8, 28))).toBe("2627")
    expect(fiscalYearTag(new Date(2026, 5, 30))).toBe("2526")
    expect(fiscalYearTag(new Date(2026, 6, 1))).toBe("2627")
  })
})

describe("rules config", () => {
  it("orders purchase approval tiers by rising value", () => {
    const limits = rules.prApproval.map((tier) => tier.maxP)
    expect([...limits].sort((a, b) => a - b)).toEqual(limits)
  })

  it("keeps the PRD defaults", () => {
    expect(rules.criticalEscalationMin).toBe(30)
    expect(rules.dispenseBalanceDays).toBe(7)
    expect(rules.walkInInterleave).toEqual({ booked: 2, walkIn: 1 })
  })
})
