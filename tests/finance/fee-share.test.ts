import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { HERO } from "@/core/seed/content"
import { feeShareDoctors, feeShareStatement } from "@/modules/finance/queries"
import { previousMonth, reproduceAccrual, statementTotals } from "@/modules/finance/rules"

import { dropDb, seededDb, today } from "./fixtures"

let db: MedcoreDb
const lastMonth = () => previousMonth(today().slice(0, 7))

beforeAll(async () => {
  db = await seededDb("finance-fee-share")
})
afterAll(async () => {
  await dropDb(db)
})

describe("Dr. Kamal Hossain's fee-share statement for last month", () => {
  it("has about 120 lines with one refund reversal, and every line reproduces", async () => {
    const statement = await feeShareStatement(db, HERO.doctor.kamal, lastMonth())
    expect(statement.lines.length).toBeGreaterThanOrEqual(110)
    expect(statement.lines.length).toBeLessThanOrEqual(130)
    const reversals = statement.lines.filter((l) => l.accrual.reversalOfId)
    expect(reversals).toHaveLength(1)
    expect(statement.totals.reversals).toBe(1)
    expect(statement.failed).toEqual([])
    expect(statement.reproduced).toBe(statement.lines.length)
    expect(statement.bmdcNo).toMatch(/^A-\d+$/)
    expect(statement.versions.length).toBeGreaterThanOrEqual(1)
    expect(statement.whtPct).toBe(10)

    // The reversal points at the line it reverses and cancels it exactly.
    const reversal = reversals[0]
    const original = statement.lines.find((l) => l.accrual.id === reversal.accrual.reversalOfId)
    expect(original).toBeDefined()
    expect(reversal.accrual.shareP).toBe(-original!.accrual.shareP)
    expect(reversal.accrual.whtP).toBe(-original!.accrual.whtP)
    expect(reversal.reverses?.invoiceNo).toBe(original!.invoice?.invoiceNo)
  })

  it("the totals add up: payable is the share less withholding tax", async () => {
    const statement = await feeShareStatement(db, HERO.doctor.kamal, lastMonth())
    const sum = (pick: (l: (typeof statement.lines)[number]) => number) =>
      statement.lines.reduce((s, l) => s + pick(l), 0)
    expect(statement.totals.shareP).toBe(sum((l) => l.accrual.shareP))
    expect(statement.totals.whtP).toBe(sum((l) => l.accrual.whtP))
    expect(statement.totals.netP).toBe(sum((l) => l.accrual.netP))
    expect(statement.totals.grossP - statement.totals.discountP).toBe(statement.totals.netP)
    expect(statement.totals.payableP).toBe(statement.totals.shareP - statement.totals.whtP)
    expect(statement.totals.shareP).toBeGreaterThan(0)
    // 10% withholding on each line, rounded per line.
    for (const line of statement.lines) {
      expect(line.accrual.whtP).toBe(Math.round((line.accrual.shareP * 10) / 100))
    }
  })

  it("the doctor picker lists Dr. Kamal with last month among his months", async () => {
    const doctors = await feeShareDoctors(db)
    const kamal = doctors.find((d) => d.doctorId === HERO.doctor.kamal)!
    expect(kamal.names.en).toContain("Kamal Hossain")
    expect(kamal.months).toContain(lastMonth())
  })

  it("a line whose amounts were changed after the fact does not reproduce", async () => {
    const statement = await feeShareStatement(db, HERO.doctor.kamal, lastMonth())
    const target = statement.lines.find((l) => !l.accrual.reversalOfId)!.accrual
    await db.feeShareAccruals.update(target.id, { shareP: target.shareP + 100 })
    const after = await feeShareStatement(db, HERO.doctor.kamal, lastMonth())
    expect(after.failed.map((l) => [l.accrual.id, l.reproduce])).toEqual([
      [target.id, { ok: false, issue: "amounts" }],
    ])
    await db.feeShareAccruals.update(target.id, { shareP: target.shareP })
  })
})

describe("fee-share reproduction (pure)", () => {
  const contract = {
    id: "c2",
    doctorId: "d",
    contractVersion: 2,
    effectiveFrom: "2026-01-01",
    rules: [{ serviceType: "consultation" as const, basis: "pct-net" as const, value: 70, trigger: "collection" as const }],
    whtPct: 10,
    discountBearer: "pro-rata" as const,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "system",
    updatedBy: "system",
    origin: "central" as const,
  }
  const line = { id: "l", serviceType: "consultation" as const, amountP: 1_000_00, discountP: 50_00, netP: 950_00 }
  const accrual = {
    id: "a",
    doctorId: "d",
    invoiceId: "i",
    invoiceLineId: "l",
    contractId: "c2",
    contractVersion: 2,
    serviceType: "consultation" as const,
    month: "2026-08",
    grossP: 1_000_00,
    discountP: 50_00,
    netP: 950_00,
    basis: "pct-net" as const,
    shareP: 665_00,
    whtP: 66_50,
    at: 0,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "system",
    updatedBy: "system",
    origin: "central" as const,
  }

  it("recomputes a line from the contract version it names", () => {
    expect(reproduceAccrual(accrual, { line, contract })).toMatchObject({ ok: true })
    expect(reproduceAccrual({ ...accrual, contractVersion: 1 }, { line, contract })).toEqual({
      ok: false,
      issue: "version-mismatch",
    })
    expect(reproduceAccrual(accrual, { contract })).toEqual({ ok: false, issue: "line-missing" })
    expect(reproduceAccrual(accrual, { line })).toEqual({ ok: false, issue: "contract-missing" })
    expect(
      reproduceAccrual(accrual, { line: { ...line, serviceType: "lab" }, contract })
    ).toEqual({ ok: false, issue: "no-rule" })
  })

  it("a reversal must be the exact negative of the line it reverses", () => {
    const reversal = {
      ...accrual,
      id: "r",
      reversalOfId: "a",
      grossP: -1_000_00,
      discountP: -50_00,
      netP: -950_00,
      shareP: -665_00,
      whtP: -66_50,
    }
    expect(reproduceAccrual(reversal, { line, contract, original: accrual })).toMatchObject({ ok: true })
    expect(reproduceAccrual(reversal, { line, contract })).toEqual({ ok: false, issue: "original-missing" })
    expect(reproduceAccrual({ ...reversal, shareP: -600_00 }, { line, contract, original: accrual })).toEqual({
      ok: false,
      issue: "amounts",
    })
    const totals = statementTotals([accrual, reversal])
    expect(totals).toMatchObject({ shareP: 0, whtP: 0, payableP: 0, lines: 2, reversals: 1 })
  })

  it("the month before January is last December", () => {
    expect(previousMonth("2026-01")).toBe("2025-12")
    expect(previousMonth("2026-09")).toBe("2026-08")
  })
})
