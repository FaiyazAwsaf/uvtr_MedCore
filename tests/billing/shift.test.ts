import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { now } from "@/core/clock/clock"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { checkout, openShift } from "@/modules/billing/commands"
import { openShiftFor, shiftSummary, todayKpisAt } from "@/modules/billing/queries"

import { heroBasket, NASRIN, RAFIQ, resetClock, seededDb } from "./fixtures"
import { dhakaDate } from "@/core/clock/dates"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("billing-shift")
})
afterAll(async () => {
  resetClock()
  await db.delete()
})

describe("cash shift", () => {
  it("payments need an open shift; opening one twice is refused", async () => {
    const basket = await heroBasket(db, "pat_0041", { viaBooking: false })
    const input = {
      patientId: basket.patientId,
      basketLineIds: basket.lineIds,
      tenders: [{ tender: "cash" as const, amountP: basket.totalP }],
      idempotencyKey: "nasrin-no-shift-0001",
    }
    await expect(commit(checkout, input, { db, actor: NASRIN })).rejects.toMatchObject({
      code: "NO_OPEN_SHIFT",
    })

    const { result } = await commit(openShift, { floatP: 2_000_00 }, { db, actor: NASRIN })
    const shift = (await db.shifts.get(result.shiftId))!
    expect(shift).toMatchObject({
      cashierId: NASRIN.staffId,
      branchId: "B1",
      floatP: 2_000_00,
      status: "open",
      date: dhakaDate(now()),
    })
    await expect(
      commit(openShift, { floatP: 1_000_00 }, { db, actor: NASRIN })
    ).rejects.toMatchObject({ code: "SHIFT_ALREADY_OPEN" })

    const paid = await commit(checkout, { ...input, idempotencyKey: "nasrin-shift-0002" }, { db, actor: NASRIN })
    expect((await db.invoices.get(paid.result.invoiceId))!.shiftId).toBe(result.shiftId)
  })

  it("expected cash is the float plus cash taken on the shift, and the KPI row counts today's money", async () => {
    const shift = (await openShiftFor(db, RAFIQ.staffId, "B1"))!
    const before = await shiftSummary(db, shift)
    expect(before.expectedCashP).toBe(shift.floatP + before.cashInP - before.cashRefundsP)
    const kpisBefore = await todayKpisAt(db, "B1", dhakaDate(now()))

    const basket = await heroBasket(db, "pat_0042", { viaBooking: false })
    const cardP = 500_00
    await commit(
      checkout,
      {
        patientId: basket.patientId,
        basketLineIds: basket.lineIds,
        tenders: [
          { tender: "card", amountP: cardP, ref: "POS-555555" },
          { tender: "cash", amountP: basket.totalP - cardP },
        ],
        idempotencyKey: "rafiq-shift-0001",
      },
      { db, actor: RAFIQ }
    )
    const after = await shiftSummary(db, shift)
    expect(after.cashInP - before.cashInP).toBe(basket.totalP - cardP)
    expect(after.expectedCashP - before.expectedCashP).toBe(basket.totalP - cardP)
    expect(after.byTender.card - before.byTender.card).toBe(cardP)

    const kpis = await todayKpisAt(db, "B1", dhakaDate(now()))
    expect(kpis.collectedP - kpisBefore.collectedP).toBe(basket.totalP)
    expect(kpis.invoices - kpisBefore.invoices).toBe(1)
  })
})
