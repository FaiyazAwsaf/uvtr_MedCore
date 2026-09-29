import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { z } from "zod"

import { rules } from "@/config/rules.config"
import { applyClockOffset, getClockOffset, now } from "@/core/clock/clock"
import { DAY } from "@/core/clock/dates"
import { sweepOnce } from "@/core/clock/sweeper"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { SEED_REFS } from "@/core/seed/content"
import { dispense } from "@/modules/pharmacy/commands"
import { pharmacyJobs } from "@/modules/pharmacy/jobs"

import { dropDb, seededDb, shirin, signedRx, usableAt } from "./fixtures"

const B = SEED_REFS.brand

let db: MedcoreDb
beforeAll(async () => {
  db = await seededDb("pharmacy-dispense-test")
})
afterAll(async () => {
  await dropDb(db)
})

const run = (input: z.input<typeof dispense.input>) =>
  commit(dispense, input, { db, actor: shirin })

describe("pharmacy.dispense", () => {
  it("dispenses from the earliest-expiry batch, moves stock and records the council number", async () => {
    const [first] = await usableAt(db, "B1", B.fexo120)
    const { rxId, lineIds } = await signedRx(db, [
      { brandId: B.fexo120, dosePattern: "0+0+1", days: 7 },
    ])
    const { result, events } = await run({
      rxId,
      lines: [{ rxLineId: lineIds[0], qty: 7 }],
      verifiedBy: "dob",
    })

    const rows = await db.dispenses.where("rxId").equals(rxId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      batchId: first.batch.id,
      qty: 7,
      saleType: "rx",
      pharmacistId: "stf_shirin_sultana",
      pharmacyCouncilNo: "PCB-B-10234",
      outstandingQty: 0,
      labelPrinted: true,
    })
    expect(rows[0].unitPriceP).toBeLessThanOrEqual(first.batch.mrpP)

    const level = await db.stockLevels.get(first.level.id)
    expect(level?.qty).toBe(first.level.qty - 7)
    const movements = await db.stockMovements.where("batchId").equals(first.batch.id).toArray()
    expect(movements.find((m) => m.refs.dispenseId === rows[0].id)).toMatchObject({
      type: "dispense",
      qty: -7,
      branchId: "B1",
    })

    const line = await db.rxLines.get(lineIds[0])
    expect(line).toMatchObject({ status: "dispensed", dispensedQty: 7 })
    const queue = await db.pharmacyQueue.where("rxId").equals(rxId).first()
    expect(queue?.status).toBe("done")
    expect(result.status).toBe("done")
    expect(events.map((e) => e.type)).toContain("DispenseCompleted")
    const audit = await db.audit.where("entity").equals("dispenses").last()
    expect(audit?.reason).toMatch(/date of birth/)
  })

  it("dispenses the 14 Seclo 20 in stock and keeps a 7-day balance for the rest", async () => {
    const stock = await usableAt(db, "B1", B.seclo20)
    expect(stock.reduce((sum, s) => sum + s.level.qty, 0)).toBe(14)
    const { rxId, lineIds } = await signedRx(db, [
      { brandId: B.seclo20, dosePattern: "1+0+1", meal: "before", days: 14 },
    ])
    const line = await db.rxLines.get(lineIds[0])
    expect(line?.qtyPrescribed).toBe(28)

    // More than the shelf holds is refused and nothing is written.
    await expect(
      run({ rxId, lines: [{ rxLineId: lineIds[0], qty: 28 }], verifiedBy: "phone" })
    ).rejects.toMatchObject({ code: "STOCK_NEGATIVE" })
    expect(await db.dispenses.where("rxId").equals(rxId).count()).toBe(0)

    const at = now()
    const { events } = await run({
      rxId,
      lines: [{ rxLineId: lineIds[0], qty: 14 }],
      verifiedBy: "phone",
    })
    const after = await db.rxLines.get(lineIds[0])
    expect(after).toMatchObject({ status: "partial", dispensedQty: 14 })
    expect(after!.balanceUntil! - at).toBeGreaterThanOrEqual(rules.dispenseBalanceDays * DAY - 5_000)
    expect(after!.balanceUntil! - at).toBeLessThanOrEqual(rules.dispenseBalanceDays * DAY + 5_000)

    const rows = await db.dispenses.where("rxId").equals(rxId).toArray()
    expect(rows.reduce((sum, r) => sum + r.qty, 0)).toBe(14)
    expect(rows.every((r) => r.outstandingQty === 14)).toBe(true)
    expect((await usableAt(db, "B1", B.seclo20)).length).toBe(0)

    const queue = await db.pharmacyQueue.where("rxId").equals(rxId).first()
    expect(queue?.status).toBe("partial")
    const partial = events.find((e) => e.type === "DispensePartial")
    expect(partial?.params).toMatchObject({ units: 14, outstanding: 14 })
    const notices = await db.notifications.where("patientId").equals(after!.patientId).toArray()
    expect(
      notices.some((n) => n.titleKey === "pharmacy.notify.balanceOpen" && n.refs.rxId === rxId)
    ).toBe(true)

    // The seeded reorder level (300) is above 14, so the low-stock event does not repeat.
    expect(events.map((e) => e.type)).not.toContain("StockBelowReorder")
  })

  it("closes the queue entry once the balance deadline passes (sweeper)", async () => {
    const { rxId, lineIds } = await signedRx(db, [
      { brandId: B.fexo120, dosePattern: "0+0+1", days: 30 },
    ])
    await run({ rxId, lines: [{ rxLineId: lineIds[0], qty: 10 }], verifiedBy: "dob" })
    expect((await db.pharmacyQueue.where("rxId").equals(rxId).first())?.status).toBe("partial")

    const offset = getClockOffset()
    await sweepOnce([db], pharmacyJobs)
    expect((await db.pharmacyQueue.where("rxId").equals(rxId).first())?.status).toBe("partial")
    applyClockOffset(offset + (rules.dispenseBalanceDays + 1) * DAY)
    try {
      await expect(
        run({ rxId, lines: [{ rxLineId: lineIds[0], qty: 5 }], verifiedBy: "dob" })
      ).rejects.toMatchObject({ code: "BALANCE_EXPIRED" })
      await sweepOnce([db], pharmacyJobs)
    } finally {
      applyClockOffset(offset)
    }
    expect((await db.pharmacyQueue.where("rxId").equals(rxId).first())?.status).toBe("done")
    const expired = await db.events.where("type").equals("BalanceExpired").toArray()
    expect(expired.some((e) => e.refs.rxId === rxId)).toBe(true)
  })

  it("only dispenses paid lines, and the patient chooses which lines to take", async () => {
    const { rxId, lineIds } = await signedRx(db, [
      { brandId: B.alatrol10, dosePattern: "0+0+1", days: 5 },
      { brandId: B.ace500, dosePattern: "1+1+1", days: 3, paid: false },
    ])
    await expect(
      run({ rxId, lines: [{ rxLineId: lineIds[1], qty: 9 }], verifiedBy: "dob" })
    ).rejects.toMatchObject({ code: "PAYMENT_GATE" })

    // Only the paid line is taken; the unpaid one stays open.
    await run({ rxId, lines: [{ rxLineId: lineIds[0], qty: 5 }], verifiedBy: "dob" })
    expect((await db.rxLines.get(lineIds[0]))?.status).toBe("dispensed")
    expect((await db.rxLines.get(lineIds[1]))?.status).toBe("open")
    expect((await db.pharmacyQueue.where("rxId").equals(rxId).first())?.status).toBe("partial")

    await expect(
      run({ rxId, lines: [{ rxLineId: lineIds[0], qty: 1 }], verifiedBy: "dob" })
    ).rejects.toMatchObject({ code: "LINE_NOT_DISPENSABLE" })
  })

  it("never uses the expired Ace 500 batch", async () => {
    const { rxId, lineIds } = await signedRx(db, [
      { brandId: B.ace500, dosePattern: "1+1+1", days: 3 },
    ])
    await run({ rxId, lines: [{ rxLineId: lineIds[0], qty: 9 }], verifiedBy: "dob" })
    const rows = await db.dispenses.where("rxId").equals(rxId).toArray()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.batchId === SEED_REFS.batch.expiredAce500)).toBe(false)
    const expired = await db.stockLevels
      .where("[branchId+batchId]")
      .equals(["B1", SEED_REFS.batch.expiredAce500])
      .first()
    expect(expired?.qty).toBe(30)
  })

  it("writes a controlled drug register row with the running balance (INV-07)", async () => {
    const brandId = "brd_sedil_5mg"
    const before = await db.stockLevels.where("[branchId+brandId]").equals(["B1", brandId]).toArray()
    const custody = before.reduce((sum, l) => sum + l.qty + l.quarantinedQty, 0)
    const { rxId, lineIds } = await signedRx(db, [
      { brandId, dosePattern: "0+0+1", days: 5 },
    ])
    await run({ rxId, lines: [{ rxLineId: lineIds[0], qty: 5 }], verifiedBy: "dob" })
    const [row] = await db.dispenses.where("rxId").equals(rxId).toArray()
    const register = await db.controlledRegister.where("dispenseId").equals(row.id).toArray()
    expect(register).toHaveLength(1)
    expect(register[0]).toMatchObject({
      brandId,
      qty: 5,
      rxId,
      branchId: "B1",
      runningBalance: custody - 5,
    })
  })
})
