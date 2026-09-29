import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { rules } from "@/config/rules.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { PermissionDenied } from "@/core/engine/errors"
import { seedDatabase } from "@/core/seed"
import { openShiftFor, shiftSummary } from "@/modules/billing/queries"
import { takeDeposit } from "@/modules/inpatient/commands"
import { depositsOn, stayById, billOf } from "@/modules/inpatient/queries"
import { restoreAmountP } from "@/modules/inpatient/stay"

import {
  admitTo,
  B2_CASHIER,
  dropDb,
  eventsSince,
  expectDuring,
  FARHANA,
  lastSeq,
  NASRIN,
  plantedLowStay,
  RAFIQ,
  seededDb,
  vacantBed,
} from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("inpatient-deposits")
})
afterAll(async () => {
  await dropDb(db)
})

let keyNo = 0
const key = () => `dep-test-${String(++keyNo).padStart(4, "0")}`

async function balanceOf(admissionId: string): Promise<number> {
  return billOf((await stayById(db, admissionId))!, now())!.balanceP
}

describe("inpatient.takeDeposit", () => {
  it("a ৳20,000 cash deposit lands on the cashier's shift and raises its expected cash by ৳20,000", async () => {
    const stay = await admitTo(db, await vacantBed(db))
    const shift = (await openShiftFor(db, RAFIQ.staffId, "B1"))!
    expect(shift).toBeTruthy()
    const before = await shiftSummary(db, shift)
    const today = await depositsOn(db, "B1", dhakaDate(now()))
    const seq = await lastSeq(db)
    const at = now()

    const { result } = await commit(
      takeDeposit,
      { admissionId: stay.id, amountP: 20_000_00, tender: "cash", tenderedP: 20_500_00, idempotencyKey: key() },
      { db, actor: RAFIQ }
    )
    expect(result.receiptNo).toMatch(/^RC-B1-\d{6}$/)
    expect(result.changeDueP).toBe(500_00)
    const deposit = (await db.deposits.get(result.depositId))!
    expect(deposit).toMatchObject({
      admissionId: stay.id,
      patientId: stay.patientId,
      branchId: "B1",
      amountP: 20_000_00,
      tender: "cash",
      shiftId: shift.id,
      cashierId: RAFIQ.staffId,
      receiptNo: result.receiptNo,
    })
    expectDuring(deposit.at, at)
    expect(deposit.ref).toBeUndefined()

    const after = await shiftSummary(db, shift)
    expect(after.cashDepositsP - before.cashDepositsP).toBe(20_000_00)
    expect(after.expectedCashP - before.expectedCashP).toBe(20_000_00)
    expect(await depositsOn(db, "B1", dhakaDate(now()))).toEqual({
      count: today.count + 1,
      amountP: today.amountP + 20_000_00,
    })

    const [event] = await eventsSince(db, seq, "DepositReceived")
    expect(event.refs).toMatchObject({ admissionId: stay.id, depositId: deposit.id, shiftId: shift.id })
    expect(event.params).toMatchObject({
      receiptNo: result.receiptNo,
      admissionNo: stay.admissionNo,
      amount: "৳20,000",
      amountBn: "৳২০,০০০",
      tender: "Cash",
    })
    expect(result.balanceP).toBe(await balanceOf(stay.id))
  })

  it("card and bKash deposits carry their simulated references and stay out of the cash drawer", async () => {
    const stay = await admitTo(db, await vacantBed(db))
    const shift = (await openShiftFor(db, RAFIQ.staffId, "B1"))!
    const before = await shiftSummary(db, shift)
    await expect(
      commit(takeDeposit, { admissionId: stay.id, amountP: 5_000_00, tender: "card", idempotencyKey: key() }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "CARD_NOT_APPROVED" })
    await expect(
      commit(takeDeposit, { admissionId: stay.id, amountP: 5_000_00, tender: "bkash", idempotencyKey: key() }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "MFS_NOT_APPROVED" })
    const card = await commit(
      takeDeposit,
      { admissionId: stay.id, amountP: 5_000_00, tender: "card", ref: "POS-123456", idempotencyKey: key() },
      { db, actor: RAFIQ }
    )
    const bkash = await commit(
      takeDeposit,
      { admissionId: stay.id, amountP: 7_000_00, tender: "bkash", ref: "BK7Q2M9XKD", idempotencyKey: key() },
      { db, actor: RAFIQ }
    )
    expect((await db.deposits.get(card.result.depositId))!.ref).toBe("POS-123456")
    expect((await db.deposits.get(bkash.result.depositId))!.ref).toBe("BK7Q2M9XKD")
    const after = await shiftSummary(db, shift)
    expect(after.expectedCashP).toBe(before.expectedCashP)
  })

  it("is idempotent per action key: a double click takes one deposit", async () => {
    const stay = await admitTo(db, await vacantBed(db))
    const input = { admissionId: stay.id, amountP: 10_000_00, tender: "cash" as const, idempotencyKey: key() }
    const first = await commit(takeDeposit, input, { db, actor: RAFIQ })
    const second = await commit(takeDeposit, input, { db, actor: RAFIQ })
    expect(second.deduplicated).toBe(true)
    expect(second.result.depositId).toBe(first.result.depositId)
    expect(await db.deposits.where("admissionId").equals(stay.id).count()).toBe(1)
  })

  it("refuses without an open shift, a zero amount, short cash, other branches, closed stays and other roles", async () => {
    const stay = await admitTo(db, await vacantBed(db))
    const base = { admissionId: stay.id, tender: "cash" as const }
    await expect(
      commit(takeDeposit, { ...base, amountP: 1_000_00, idempotencyKey: key() }, { db, actor: NASRIN })
    ).rejects.toMatchObject({ code: "NO_OPEN_SHIFT" })
    await expect(
      commit(takeDeposit, { ...base, amountP: 0, idempotencyKey: key() }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "AMOUNT_INVALID" })
    await expect(
      commit(takeDeposit, { ...base, amountP: 5_000_00, tenderedP: 4_000_00, idempotencyKey: key() }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "CASH_SHORT", params: { tenderedP: 4_000_00, amountP: 5_000_00 } })
    const b2Stay = (await db.admissions.where("branchId").equals("B2").toArray()).find((a) => a.status === "admitted")!
    await expect(
      commit(takeDeposit, { ...base, admissionId: b2Stay.id, amountP: 1_000_00, idempotencyKey: key() }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "STAY_OTHER_BRANCH", params: { branch: "B2" } })
    const discharged = (await db.admissions.where("branchId").equals("B1").toArray()).find(
      (a) => a.status === "discharged"
    )!
    await expect(
      commit(takeDeposit, { ...base, admissionId: discharged.id, amountP: 1_000_00, idempotencyKey: key() }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "NOT_ADMITTED" })
    await expect(
      commit(takeDeposit, { ...base, amountP: 1_000_00, idempotencyKey: key() }, { db, actor: FARHANA })
    ).rejects.toBeInstanceOf(PermissionDenied)
    await expect(
      commit(takeDeposit, { ...base, amountP: 1_000_00, idempotencyKey: key() }, { db, actor: B2_CASHIER })
    ).rejects.toMatchObject({ code: "NO_OPEN_SHIFT" })
  })

  it("a top-up that restores the planted low stay clears its alert once; a small one leaves it", async () => {
    const planted = await plantedLowStay(db)
    const balance = await balanceOf(planted.id)
    expect(balance).toBeLessThan(rules.depositThresholdP)

    const seq = await lastSeq(db)
    const small = await commit(
      takeDeposit,
      { admissionId: planted.id, amountP: 100_00, tender: "cash", idempotencyKey: key() },
      { db, actor: RAFIQ }
    )
    expect(small.result.alertCleared).toBe(false)
    expect((await db.admissions.get(planted.id))!.depositAlertAt).toBeDefined()

    const restore = restoreAmountP(await balanceOf(planted.id), rules.depositThresholdP)
    expect(restore).toBeGreaterThan(0)
    const top = await commit(
      takeDeposit,
      { admissionId: planted.id, amountP: restore, tender: "cash", idempotencyKey: key() },
      { db, actor: RAFIQ }
    )
    expect(top.result.alertCleared).toBe(true)
    expect(top.result.balanceP).toBeGreaterThanOrEqual(rules.depositThresholdP)
    const cleared = (await db.admissions.get(planted.id))!
    expect(cleared.depositAlertAt).toBeUndefined()
    expect(await eventsSince(db, seq, "DepositAlertCleared")).toHaveLength(1)
    expect(await eventsSince(db, seq, "DepositReceived")).toHaveLength(2)
  })
})

describe("deposits while the branch is offline", () => {
  it("bKash and Nagad need the internet; cash still works on the branch store", async () => {
    const edge = new MedcoreDb("inpatient-deposits-edge", "edge", "B1")
    await seedDatabase(edge, { now: now(), today: dhakaDate(now()) })
    try {
      const stay = (await edge.admissions.where("branchId").equals("B1").toArray()).find(
        (a) => a.status === "admitted"
      )!
      await expect(
        commit(
          takeDeposit,
          { admissionId: stay.id, amountP: 2_000_00, tender: "nagad", ref: "NG4TR8PLWA", idempotencyKey: key() },
          { db: edge, actor: RAFIQ }
        )
      ).rejects.toMatchObject({ code: "MFS_OFFLINE" })
      const cash = await commit(
        takeDeposit,
        { admissionId: stay.id, amountP: 2_000_00, tender: "cash", idempotencyKey: key() },
        { db: edge, actor: RAFIQ }
      )
      expect((await edge.deposits.get(cash.result.depositId))!.receiptNo).toMatch(/^RC-B1-/)
      expect(await edge.outbox.count()).toBe(1)
    } finally {
      await edge.delete()
    }
  })
})
