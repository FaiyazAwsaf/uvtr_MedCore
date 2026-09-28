import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset, getClockOffset, now } from "@/core/clock/clock"
import { MINUTE } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import type { SweepContext } from "@/core/clock/types"
import { HERO } from "@/core/seed/content"
import {
  checkout,
  collectBalance,
  confirmMfs,
  payOnline,
  timeoutMfs,
} from "@/modules/billing/commands"
import { mfsTimeoutJob } from "@/modules/billing/jobs"

import {
  B3_CASHIER,
  expectBalanced,
  heroBasket,
  RAFIQ,
  resetClock,
  ROKEYA,
  seededDb,
  TANVIR,
} from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("billing-mfs")
})
afterAll(async () => {
  resetClock()
  await db.delete()
})

function sweepCtx(): SweepContext {
  return {
    db,
    now: now(),
    commitSystem: (def, input) => commit(def, input, { db, actor: SYSTEM_ACTOR }),
  }
}

async function pushAtCounter(patientId: string, bkashP: number) {
  const basket = await heroBasket(db, patientId, { viaBooking: false })
  const { result } = await commit(
    checkout,
    {
      patientId,
      basketLineIds: basket.lineIds,
      tenders: [
        { tender: "bkash", amountP: bkashP },
        { tender: "cash", amountP: basket.totalP - bkashP },
      ],
      idempotencyKey: `push-${patientId}-${bkashP}`,
    },
    { db, actor: RAFIQ }
  )
  return { basket, result, paymentId: result.pendingPaymentIds[0] }
}

describe("MFS timeout", () => {
  it("a timed-out push leaves everything locked; the balance taken in cash then unlocks it", async () => {
    const { basket, result, paymentId } = await pushAtCounter("pat_0031", 1_000_00)
    await commit(timeoutMfs, { paymentId }, { db, actor: RAFIQ })

    expect((await db.payments.get(paymentId))!.status).toBe("timeout")
    const invoice = (await db.invoices.get(result.invoiceId))!
    expect(invoice.status).toBe("partial")
    const items = await db.labOrderItems.bulkGet(basket.labItemIds)
    expect(items.every((item) => !item!.paymentCleared)).toBe(true)
    expect(await db.specimens.where("labOrderId").equals(basket.labOrderId).count()).toBe(0)
    const events = await db.events.where("type").equals("PaymentTimedOut").toArray()
    expect(events.at(-1)?.consumers).toContain("billing.consumers.finance")

    // Confirming a timed-out push is refused; the balance is taken again.
    await expect(
      commit(confirmMfs, { paymentId }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_PENDING" })
    const { result: paid } = await commit(
      collectBalance,
      {
        invoiceId: result.invoiceId,
        tenders: [{ tender: "cash", amountP: 1_000_00, tenderedP: 1_000_00 }],
        idempotencyKey: "balance-0001",
      },
      { db, actor: RAFIQ }
    )
    expect(paid.status).toBe("paid")
    expect(paid.receiptNo).toBeDefined()
    await expectBalanced(db, result.invoiceId)
    const after = await db.labOrderItems.bulkGet(basket.labItemIds)
    expect(after.every((item) => item!.paymentCleared)).toBe(true)
    expect(await db.specimens.where("labOrderId").equals(basket.labOrderId).count()).toBe(2)
  })

  it("the balance cannot be taken while a push is still waiting", async () => {
    const { result } = await pushAtCounter("pat_0032", 500_00)
    await expect(
      commit(
        collectBalance,
        {
          invoiceId: result.invoiceId,
          tenders: [{ tender: "cash", amountP: 500_00 }],
          idempotencyKey: "balance-0002",
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "MFS_STILL_PENDING" })
  })

  it("the sweeper times out pushes older than the limit, on the demo clock, and nothing younger", async () => {
    const old = await pushAtCounter("pat_0033", 700_00)
    applyClockOffset(getClockOffset() + 10 * MINUTE)
    const young = await pushAtCounter("pat_0034", 700_00)
    await mfsTimeoutJob.run(sweepCtx())
    expect((await db.payments.get(old.paymentId))!.status).toBe("pending")

    applyClockOffset(getClockOffset() + 6 * MINUTE)
    await mfsTimeoutJob.run(sweepCtx())
    expect((await db.payments.get(old.paymentId))!.status).toBe("timeout")
    expect((await db.payments.get(young.paymentId))!.status).toBe("pending")
    const items = await db.labOrderItems.bulkGet(old.basket.labItemIds)
    expect(items.every((item) => !item!.paymentCleared)).toBe(true)
    // Idempotent: a second sweep changes nothing.
    const events = await db.events.count()
    await mfsTimeoutJob.run(sweepCtx())
    expect(await db.events.count()).toBe(events)
  })

  it("a cashier at another branch cannot confirm it", async () => {
    const { paymentId } = await pushAtCounter("pat_0035", 300_00)
    await expect(
      commit(confirmMfs, { paymentId }, { db, actor: B3_CASHIER })
    ).rejects.toMatchObject({ code: "PAYMENT_WRONG_BRANCH" })
  })
})

describe("patient app payment", () => {
  it("Tanvir pays his father's bill by bKash in the app; it unlocks only after approval", async () => {
    const basket = await heroBasket(db, HERO.patient.abdulKarim, { viaBooking: false })
    const { result } = await commit(
      payOnline,
      {
        patientId: HERO.patient.abdulKarim,
        basketLineIds: basket.lineIds,
        tender: "bkash",
        idempotencyKey: "app-pay-0001",
      },
      { db, actor: TANVIR }
    )
    expect(result.amountP).toBe(basket.totalP)
    expect(result.invoiceStatus).toBe("unpaid")
    const invoice = (await db.invoices.get(result.invoiceId))!
    expect(invoice).toMatchObject({ branchId: "B1", cashierId: TANVIR.staffId, discountPct: 0 })
    expect(invoice.shiftId).toBeUndefined()
    expect(
      (await db.rxLines.bulkGet(basket.rxLineIds)).every((line) => !line!.paymentCleared)
    ).toBe(true)

    // Someone outside the family cannot approve it.
    await expect(
      commit(confirmMfs, { paymentId: result.paymentId! }, { db, actor: ROKEYA })
    ).rejects.toMatchObject({ code: "NOT_YOUR_PAYMENT" })

    const approved = await commit(
      confirmMfs,
      { paymentId: result.paymentId!, idempotencyKey: `mfs-confirm:${result.paymentId}` },
      { db, actor: TANVIR }
    )
    expect(approved.result.invoiceStatus).toBe("paid")
    expect(
      (await db.rxLines.bulkGet(basket.rxLineIds)).every((line) => line!.paymentCleared)
    ).toBe(true)
    expect(await db.specimens.where("labOrderId").equals(basket.labOrderId).count()).toBe(2)
    await expectBalanced(db, result.invoiceId)
  })

  it("a patient cannot pay for someone who is not linked to the account", async () => {
    const basket = await heroBasket(db, HERO.patient.rokeyaBegum, { viaBooking: false })
    await expect(
      commit(
        payOnline,
        {
          patientId: HERO.patient.rokeyaBegum,
          basketLineIds: basket.lineIds,
          tender: "nagad",
          idempotencyKey: "app-pay-0002",
        },
        { db, actor: TANVIR }
      )
    ).rejects.toMatchObject({ code: "NOT_YOUR_PATIENT" })
  })

  it("after a timeout the app pays the balance of the same invoice", async () => {
    const basket = await heroBasket(db, HERO.patient.tanvirKarim, { viaBooking: false })
    const first = await commit(
      payOnline,
      {
        patientId: HERO.patient.tanvirKarim,
        basketLineIds: basket.lineIds,
        tender: "nagad",
        idempotencyKey: "app-pay-0003",
      },
      { db, actor: TANVIR }
    )
    await commit(timeoutMfs, { paymentId: first.result.paymentId! }, { db, actor: TANVIR })
    const retry = await commit(
      payOnline,
      {
        patientId: HERO.patient.tanvirKarim,
        invoiceId: first.result.invoiceId,
        tender: "bkash",
        idempotencyKey: "app-pay-0004",
      },
      { db, actor: TANVIR }
    )
    expect(retry.result.invoiceId).toBe(first.result.invoiceId)
    expect(retry.result.amountP).toBe(basket.totalP)
    await commit(confirmMfs, { paymentId: retry.result.paymentId! }, { db, actor: TANVIR })
    expect((await db.invoices.get(first.result.invoiceId))!.status).toBe("paid")
    await expectBalanced(db, first.result.invoiceId)
  })
})
