import { describe, expect, it } from "vitest"

import { rules } from "@/config/rules.config"
import { bedDays, interimBill, NURSING_PER_DAY_P } from "@/core/inpatient/interim"
import {
  approvalTierFor,
  mayApprovePr,
  prApprovalLimitP,
  threeWayMatch,
  valueTier,
} from "@/core/procurement/rules"
import { shiftCash } from "@/modules/billing/shift"

const taka = (n: number) => n * 100
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const HABIBUR = { id: "stf_habibur_rahman", authorities: ["approve:pr:50000"] }
const TARIQ = { id: "stf_tariq_aziz", authorities: ["approve:pr:500000"] }
const SABRINA = {
  id: "stf_sabrina_chowdhury",
  authorities: ["approve:pr:unlimited", "approve:refund"],
}

describe("purchase request approval (PRD §11)", () => {
  it("puts a value in its tier", () => {
    expect(valueTier(taka(9_120))).toBe("store-manager")
    expect(valueTier(taka(49_999))).toBe("store-manager")
    expect(valueTier(taka(50_000))).toBe("procurement-head")
    expect(valueTier(taka(4_99_999))).toBe("procurement-head")
    expect(valueTier(taka(5_28_580))).toBe("cfo")
  })

  it("reads approval limits from authorities", () => {
    expect(prApprovalLimitP(HABIBUR.authorities)).toBe(taka(50_000))
    expect(prApprovalLimitP(TARIQ.authorities)).toBe(taka(5_00_000))
    expect(prApprovalLimitP(SABRINA.authorities)).toBe(Number.POSITIVE_INFINITY)
    expect(prApprovalLimitP(["*"])).toBe(Number.POSITIVE_INFINITY)
    expect(prApprovalLimitP(["discount:5"])).toBe(0)
  })

  it("never lets the requester approve: a store manager's own small request goes one tier up", () => {
    expect(approvalTierFor(taka(9_120), HABIBUR.authorities)).toBe("procurement-head")
    expect(approvalTierFor(taka(9_120), [])).toBe("store-manager")
    expect(approvalTierFor(taka(1_18_940), HABIBUR.authorities)).toBe("procurement-head")
    expect(approvalTierFor(taka(5_28_580), HABIBUR.authorities)).toBe("cfo")
    expect(approvalTierFor(taka(1_000), TARIQ.authorities)).toBe("cfo")
  })

  it("lets only a second person with the tier's authority decide", () => {
    const own = { approvalTier: "procurement-head" as const, totalP: taka(9_120), requestedBy: HABIBUR.id }
    expect(mayApprovePr(TARIQ, own)).toBe(true)
    expect(mayApprovePr(SABRINA, own)).toBe(true)
    expect(mayApprovePr(HABIBUR, own)).toBe(false)
    const pharmacist = { approvalTier: "store-manager" as const, totalP: taka(9_120), requestedBy: "stf_x" }
    expect(mayApprovePr(HABIBUR, pharmacist)).toBe(true)
    const big = { approvalTier: "cfo" as const, totalP: taka(5_28_580), requestedBy: "stf_b2_anisur" }
    expect(mayApprovePr(TARIQ, big)).toBe(false)
    expect(mayApprovePr(SABRINA, big)).toBe(true)
    expect(mayApprovePr(SABRINA, { ...big, requestedBy: SABRINA.id })).toBe(false)
  })
})

describe("three-way match (PRD §8.7)", () => {
  const po = [
    { id: "pol_1", qtyOrdered: 100, unitCostP: 91_20 },
    { id: "pol_2", qtyOrdered: 50, unitCostP: 2_000_00 },
  ]

  it("matches when invoiced quantity equals what was accepted and prices are within 2%", () => {
    const out = threeWayMatch(po, { pol_1: 80, pol_2: 50 }, [
      { poLineId: "pol_1", qty: 80, unitCostP: 91_20 },
      { poLineId: "pol_2", qty: 50, unitCostP: 2_039_00 },
    ])
    expect(out).toEqual({ status: "matched", diffs: [] })
    expect(rules.threeWayMatch.priceTolerancePct).toBe(2)
  })

  it("flags a quantity billed beyond the accepted goods", () => {
    const out = threeWayMatch(po, { pol_1: 80 }, [{ poLineId: "pol_1", qty: 85, unitCostP: 91_20 }])
    expect(out.status).toBe("mismatch")
    expect(out.diffs).toEqual([{ poLineId: "pol_1", field: "qty", po: 100, grn: 80, invoice: 85 }])
  })

  it("flags a price above the tolerance", () => {
    const out = threeWayMatch(po, { pol_2: 50 }, [{ poLineId: "pol_2", qty: 50, unitCostP: 2_120_00 }])
    expect(out.diffs).toEqual([
      { poLineId: "pol_2", field: "price", po: 2_000_00, grn: 2_000_00, invoice: 2_120_00 },
    ])
  })

  it("flags a line that is not on the order", () => {
    const out = threeWayMatch(po, {}, [{ poLineId: "pol_9", qty: 3, unitCostP: 100 }])
    expect(out.status).toBe("mismatch")
    expect(out.diffs[0]).toMatchObject({ poLineId: "pol_9", field: "qty", po: 0, invoice: 3 })
  })
})

describe("interim bill (plan §5.8)", () => {
  const ward = { kind: "cabin" as const, bedDayRateP: taka(6_000) }

  it("counts started 24-hour periods, at least one", () => {
    const t0 = Date.UTC(2026, 8, 28, 5, 30)
    expect(bedDays(t0, t0)).toBe(1)
    expect(bedDays(t0, t0 + 3 * HOUR)).toBe(1)
    expect(bedDays(t0, t0 + DAY)).toBe(1)
    expect(bedDays(t0, t0 + DAY + 1)).toBe(2)
  })

  it("charges bed, nursing and a daily consultant round against the deposits", () => {
    const t0 = Date.UTC(2026, 8, 24, 5, 30)
    const bill = interimBill({
      admittedAt: t0,
      at: t0 + 4 * DAY + 2 * HOUR,
      ward,
      consultantRoundP: taka(600),
      depositsP: taka(45_000),
    })
    expect(bill.days).toBe(5)
    expect(bill.lines.map((l) => [l.kind, l.qty, l.unitP])).toEqual([
      ["bed", 5, taka(6_000)],
      ["nursing", 5, NURSING_PER_DAY_P.cabin],
      ["consultant", 5, taka(600)],
    ])
    expect(bill.chargesP).toBe(5 * (taka(6_000) + taka(1_200) + taka(600)))
    expect(bill.balanceP).toBe(taka(6_000))
    expect(bill.low).toBe(true)
    const topped = interimBill({
      admittedAt: t0,
      at: t0 + 4 * DAY + 2 * HOUR,
      ward,
      consultantRoundP: taka(600),
      depositsP: taka(60_000),
    })
    expect(topped.balanceP).toBe(taka(21_000))
    expect(topped.low).toBe(false)
  })
})

describe("cash shift with inpatient deposits", () => {
  it("counts cash deposits taken on the shift in the drawer, and nothing else", () => {
    const shift = { id: "shf_1", floatP: taka(5_000), cashierId: "stf_rafiq_ahmed", openedAt: 0 }
    const payments = [{ shiftId: "shf_1", tender: "cash" as const, status: "confirmed" as const, amountP: taka(2_000) }]
    const deposits = [
      { shiftId: "shf_1", tender: "cash" as const, amountP: taka(20_000) },
      { shiftId: "shf_1", tender: "bkash" as const, amountP: taka(10_000) },
      { shiftId: "shf_other", tender: "cash" as const, amountP: taka(7_000) },
      { shiftId: undefined, tender: "cash" as const, amountP: taka(3_000) },
    ]
    const cash = shiftCash(shift, payments, [], deposits)
    expect(cash.cashDepositsP).toBe(taka(20_000))
    expect(cash.expectedP).toBe(taka(5_000 + 2_000 + 20_000))
    expect(shiftCash(shift, payments, []).expectedP).toBe(taka(7_000))
  })
})
