import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addDaysISO } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { ConflictError } from "@/core/engine/errors"
import { payPayable, schedulePayable } from "@/modules/finance/commands"
import { payablesView } from "@/modules/finance/queries"
import {
  agingBucket,
  bankTransferRef,
  daysOverdue,
  isOverdue,
  nextPaymentRun,
} from "@/modules/finance/rules"

import { dropDb, expectRule, IMRAN, key, SABRINA, seededDb, today } from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("finance-payables")
})
afterAll(async () => {
  await dropDb(db)
})

async function openPayable() {
  return (await db.payables.where("status").equals("open").first())!
}

describe("payable rules (pure)", () => {
  it("ages unpaid payables by days past the due date", () => {
    expect(daysOverdue("2026-09-20", "2026-09-29")).toBe(9)
    expect(isOverdue("2026-09-29", "2026-09-29")).toBe(false)
    expect(isOverdue("2026-09-28", "2026-09-29")).toBe(true)
    expect(agingBucket("2026-10-05", "2026-09-29")).toBe("not-due")
    expect(agingBucket("2026-09-29", "2026-09-29")).toBe("not-due")
    expect(agingBucket("2026-09-28", "2026-09-29")).toBe("d1-30")
    expect(agingBucket("2026-08-30", "2026-09-29")).toBe("d1-30")
    expect(agingBucket("2026-08-29", "2026-09-29")).toBe("d31-60")
    expect(agingBucket("2026-07-31", "2026-09-29")).toBe("d31-60")
    expect(agingBucket("2026-07-30", "2026-09-29")).toBe("d60plus")
  })

  it("the next payment run is the coming Thursday, and bank references are stable", () => {
    // 29-09-2026 is a Tuesday.
    expect(nextPaymentRun("2026-09-29")).toBe("2026-10-01")
    expect(nextPaymentRun("2026-10-01")).toBe("2026-10-08")
    expect(bankTransferRef("pyb_1")).toMatch(/^BEFTN-[A-Z2-9]{8}$/)
    expect(bankTransferRef("pyb_1")).toBe(bankTransferRef("pyb_1"))
    expect(bankTransferRef("pyb_1")).not.toBe(bankTransferRef("pyb_2"))
  })
})

describe("finance.schedulePayable and finance.payPayable", () => {
  it("the payables view ages the seeded payables and totals them by vendor", async () => {
    const view = await payablesView(db, today(), null)
    expect(view.rows.length).toBeGreaterThanOrEqual(2)
    const open = view.rows.filter((r) => r.payable.status !== "paid")
    const agingTotal = Object.values(view.aging).reduce((s, a) => s + a.amountP, 0)
    expect(agingTotal).toBe(open.reduce((s, r) => s + r.payable.amountP, 0))
    expect(view.openP).toBe(agingTotal)
    expect(view.byVendor.reduce((s, v) => s + v.amountP, 0)).toBe(agingTotal)
  })

  it("schedules a payment run, never in the past", async () => {
    const payable = await openPayable()
    await expectRule(
      commit(
        schedulePayable,
        { payableId: payable.id, expectedVersion: payable.version, scheduledFor: addDaysISO(today(), -1) },
        { db, actor: IMRAN }
      ),
      "SCHEDULE_DATE_PAST"
    )
    const runDay = nextPaymentRun(today())
    const { events } = await commit(
      schedulePayable,
      { payableId: payable.id, expectedVersion: payable.version, scheduledFor: runDay },
      { db, actor: IMRAN }
    )
    expect((await db.payables.get(payable.id))!).toMatchObject({ status: "scheduled", scheduledFor: runDay })
    expect(events.map((e) => e.type)).toEqual(["PayableScheduled"])
    await expect(
      commit(
        schedulePayable,
        { payableId: payable.id, expectedVersion: payable.version, scheduledFor: runDay },
        { db, actor: IMRAN }
      )
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("pays by a simulated bank transfer, once; the purchase order is untouched", async () => {
    const payable = (await db.payables.where("status").equals("scheduled").first())!
    const po = (await db.purchaseOrders.get(payable.poId))!
    const idempotencyKey = key("pay")
    const first = await commit(
      payPayable,
      { payableId: payable.id, expectedVersion: payable.version, idempotencyKey },
      { db, actor: SABRINA }
    )
    expect(first.result.paymentRef).toBe(bankTransferRef(payable.id))
    const paid = (await db.payables.get(payable.id))!
    expect(paid).toMatchObject({ status: "paid", paymentRef: bankTransferRef(payable.id) })
    expect(paid.paidAt).toBeGreaterThan(0)
    expect(first.events.map((e) => e.type)).toEqual(["PayablePaid"])
    expect(first.events[0].params).toMatchObject({ ref: paid.paymentRef })
    expect((await db.purchaseOrders.get(po.id))!).toEqual(po)

    // A double click replays the first commit instead of paying twice.
    const again = await commit(
      payPayable,
      { payableId: payable.id, expectedVersion: payable.version, idempotencyKey },
      { db, actor: SABRINA }
    )
    expect(again.deduplicated).toBe(true)
    expect((await db.payables.get(payable.id))!.version).toBe(paid.version)

    await expectRule(
      commit(payPayable, { payableId: payable.id, expectedVersion: paid.version, idempotencyKey: key() }, { db, actor: SABRINA }),
      "PAYABLE_PAID"
    )
    await expectRule(
      commit(
        schedulePayable,
        { payableId: payable.id, expectedVersion: paid.version, scheduledFor: nextPaymentRun(today()) },
        { db, actor: SABRINA }
      ),
      "PAYABLE_PAID"
    )
    const view = await payablesView(db, today(), null)
    expect(view.rows.find((r) => r.payable.id === payable.id)?.payable.status).toBe("paid")
  })
})
