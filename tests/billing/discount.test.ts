import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { HERO } from "@/core/seed/content"
import { checkout, openShift } from "@/modules/billing/commands"
import { priceLines } from "@/modules/billing/pricing"

import {
  expectBalanced,
  heroBasket,
  NASRIN,
  RAFIQ,
  RECEPTION,
  resetClock,
  seededDb,
} from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("billing-discount")
})
afterAll(async () => {
  resetClock()
  await db.delete()
})

let patientSeq = 20
async function freshBasket() {
  patientSeq += 1
  return heroBasket(db, `pat_${String(patientSeq).padStart(4, "0")}`, { viaBooking: false })
}

async function payWithDiscount(
  pct: number,
  approval?: { approverStaffId: string; reason: string; pinVerified: true },
  key = `disc-${pct}-${Math.random()}`
) {
  const basket = await freshBasket()
  const lines = (await db.basketLines.bulkGet(basket.lineIds)).map((line) => line!)
  const { totalP } = priceLines(lines, pct)
  return {
    basket,
    run: () =>
      commit(
        checkout,
        {
          patientId: basket.patientId,
          basketLineIds: basket.lineIds,
          discountPct: pct,
          discountApproval: approval,
          tenders: [{ tender: "cash", amountP: totalP }],
          idempotencyKey: key,
        },
        { db, actor: RAFIQ }
      ),
  }
}

describe("discount authority (INV-16)", () => {
  it("a cashier gives up to 5% alone, spread pro rata over balanced lines", async () => {
    const { run } = await payWithDiscount(5)
    const { result } = await run()
    const invoice = (await db.invoices.get(result.invoiceId))!
    expect(invoice.discountPct).toBe(5)
    expect(invoice.discountApprovalId).toBeUndefined()
    expect(invoice.discountP).toBe(Math.round((invoice.subtotalP * 5) / 100))
    await expectBalanced(db, result.invoiceId)

    // The consultant's share is taken from the discounted net (pro rata).
    const accrual = (await db.feeShareAccruals.where("invoiceId").equals(result.invoiceId).first())!
    const line = (await db.invoiceLines.get(accrual.invoiceLineId))!
    expect(line.discountP).toBeGreaterThan(0)
    expect(accrual.shareP).toBe(Math.round(line.netP * 0.7))
    expect(accrual.whtP).toBe(Math.round(accrual.shareP * 0.1))
  })

  it("above 5% the commit is refused without a supervisor's approval", async () => {
    const { run, basket } = await payWithDiscount(10)
    await expect(run()).rejects.toMatchObject({ code: "DISCOUNT_APPROVAL_REQUIRED" })
    const lines = await db.basketLines.bulkGet(basket.lineIds)
    expect(lines.every((line) => line!.status === "open")).toBe(true)
  })

  it("with Nasrin's approval the discount, the approval row and the audit trail commit together", async () => {
    const { run } = await payWithDiscount(10, {
      approverStaffId: NASRIN.staffId,
      reason: "Hardship case, patient known to the hospital",
      pinVerified: true,
    })
    const { result, commitId } = await run()
    const invoice = (await db.invoices.get(result.invoiceId))!
    expect(invoice.discountPct).toBe(10)
    expect(invoice.discountApprovalId).toBeDefined()
    const approval = (await db.approvals.get(invoice.discountApprovalId!))!
    expect(approval).toMatchObject({
      kind: "discount",
      approverId: NASRIN.staffId,
      requestedBy: RAFIQ.staffId,
      status: "approved",
      pinVerified: true,
      amountP: invoice.discountP,
      refs: { invoiceId: invoice.id, patientId: invoice.patientId },
    })
    await expectBalanced(db, result.invoiceId)
    const audit = await db.audit.where("commitId").equals(commitId).toArray()
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.every((row) => row.approvedBy === NASRIN.staffId)).toBe(true)
    const event = (await db.events.where("commitId").equals(commitId).toArray()).find(
      (e) => e.type === "DiscountApproved"
    )
    expect(event?.params).toMatchObject({ pct: 10, approver: "Nasrin Jahan" })
  })

  it("the approver must be someone else who holds the authority", async () => {
    const self = await payWithDiscount(10, {
      approverStaffId: RAFIQ.staffId,
      reason: "Self approval",
      pinVerified: true,
    })
    await expect(self.run()).rejects.toMatchObject({ code: "APPROVER_SAME_PERSON" })

    const noAuthority = await payWithDiscount(10, {
      approverStaffId: RECEPTION.staffId,
      reason: "Front desk says yes",
      pinVerified: true,
    })
    await expect(noAuthority.run()).rejects.toMatchObject({ code: "APPROVER_LACKS_AUTHORITY" })

    const tooHigh = await payWithDiscount(20, {
      approverStaffId: NASRIN.staffId,
      reason: "Above the supervisor limit",
      pinVerified: true,
    })
    await expect(tooHigh.run()).rejects.toMatchObject({
      code: "APPROVER_LACKS_AUTHORITY",
      params: { limit: 15 },
    })
  })

  it("a supervisor gives up to her own 15% without a second approval", async () => {
    const basket = await heroBasket(db, HERO.patient.rokeyaBegum, { viaBooking: false })
    await commit(openShift, { floatP: 3_000_00 }, { db, actor: NASRIN })
    const lines = (await db.basketLines.bulkGet(basket.lineIds)).map((line) => line!)
    const { totalP } = priceLines(lines, 15)
    const { result } = await commit(
      checkout,
      {
        patientId: basket.patientId,
        basketLineIds: basket.lineIds,
        discountPct: 15,
        tenders: [{ tender: "cash", amountP: totalP }],
        idempotencyKey: "nasrin-15-0001",
      },
      { db, actor: NASRIN }
    )
    const invoice = (await db.invoices.get(result.invoiceId))!
    expect(invoice.discountPct).toBe(15)
    expect(invoice.discountApprovalId).toBeUndefined()
    expect(invoice.cashierId).toBe(NASRIN.staffId)
    await expectBalanced(db, result.invoiceId)
  })
})
