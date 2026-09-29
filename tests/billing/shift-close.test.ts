import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { rules } from "@/config/rules.config"
import { now } from "@/core/clock/clock"
import type { MedcoreDb } from "@/core/db/database"
import type { ShiftRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { checkout, closeShift, openShift } from "@/modules/billing/commands"
import {
  lastClosedShiftFor,
  openShiftFor,
  shiftReport,
  shiftSummary,
} from "@/modules/billing/queries"
import { countedFrom, denominationsFor } from "@/modules/billing/shift"

import { heroBasket, NASRIN, RAFIQ, resetClock, seededDb } from "./fixtures"

/** Shift close with the denomination count and the variance rule (PRD §9, S13, INV-12). */

let db: MedcoreDb

/** A direct write to a shift, to prove the engine's own lock. */
const tamperShift = defineCommand({
  name: "test.tamperShift",
  roles: "any",
  input: z.object({ id: z.string() }),
  run: async (tx, input) => {
    await tx.update("shifts", input.id, { countedP: 1 })
  },
})

const NASRIN_OK = {
  approverStaffId: NASRIN.staffId,
  reason: "Counted twice with the cashier",
  pinVerified: true as const,
}

beforeAll(async () => {
  db = await seededDb("billing-shift-close")
})
afterAll(async () => {
  resetClock()
  await db.delete()
})

async function expectedOf(shift: ShiftRow): Promise<number> {
  return (await shiftSummary(db, shift, now())).expectedCashP
}

/** A count that is `offsetP` away from what the drawer should hold (whole taka). */
function countOff(expectedP: number, offsetP: number): Record<string, number> {
  return denominationsFor(expectedP + offsetP)
}

async function takeCash(patientId: string, key: string): Promise<number> {
  const basket = await heroBasket(db, patientId, { viaBooking: false })
  await commit(
    checkout,
    {
      patientId,
      basketLineIds: basket.lineIds,
      tenders: [{ tender: "cash", amountP: basket.totalP }],
      idempotencyKey: key,
    },
    { db, actor: RAFIQ }
  )
  return basket.totalP
}

describe("denominations", () => {
  it("count notes and coins in whole taka", () => {
    expect(countedFrom({ "1000": 40, "500": 10, "100": 20, "50": 2 })).toBe(
      47_100_00
    )
    expect(countedFrom(denominationsFor(48_350_00))).toBe(48_350_00)
    expect(countedFrom(denominationsFor(12_345_67))).toBe(12_345_00)
  })
})

describe("closing a shift", () => {
  it("a count within the threshold closes directly and locks the shift", async () => {
    const shift = (await openShiftFor(db, RAFIQ.staffId, "B1"))!
    const expectedP = await expectedOf(shift)
    const offsetP = 300_00
    expect(offsetP).toBeLessThanOrEqual(rules.cashVarianceThresholdP)
    const denominations = countOff(expectedP, offsetP)

    await expect(
      commit(
        closeShift,
        { shiftId: shift.id, denominations },
        { db, actor: NASRIN }
      )
    ).rejects.toMatchObject({ code: "SHIFT_NOT_YOURS" })

    const { result, commitId } = await commit(
      closeShift,
      { shiftId: shift.id, denominations },
      { db, actor: RAFIQ }
    )
    expect(result.approvalId).toBeUndefined()
    expect(result.expectedP).toBe(expectedP)
    expect(result.countedP).toBe(countedFrom(denominations))
    expect(result.varianceP).toBe(result.countedP - expectedP)
    expect(Math.abs(result.varianceP)).toBeLessThanOrEqual(
      rules.cashVarianceThresholdP
    )
    const closed = (await db.shifts.get(shift.id))!
    expect(closed).toMatchObject({
      status: "closed",
      countedP: result.countedP,
      expectedP,
      varianceP: result.varianceP,
      denominations,
    })
    expect(closed.closedAt).toBeDefined()
    const events = (await db.events.toArray()).filter(
      (e) => e.commitId === commitId
    )
    expect(events.map((e) => e.type)).toEqual(["ShiftClosed"])
    expect(await lastClosedShiftFor(db, RAFIQ.staffId, "B1")).toMatchObject({
      id: shift.id,
    })
  })

  it("a closed shift is locked: no payments on it, no second close", async () => {
    const shift = (await lastClosedShiftFor(db, RAFIQ.staffId, "B1"))!
    const basket = await heroBasket(db, "pat_0051", { viaBooking: false })
    await expect(
      commit(
        checkout,
        {
          patientId: basket.patientId,
          basketLineIds: basket.lineIds,
          tenders: [{ tender: "cash", amountP: basket.totalP }],
          idempotencyKey: "locked-shift-0001",
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "NO_OPEN_SHIFT" })
    await expect(
      commit(
        closeShift,
        { shiftId: shift.id, denominations: {} },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "SHIFT_CLOSED" })
    // The engine refuses any change to a closed shift too (INV-12).
    await expect(
      commit(tamperShift, { id: shift.id }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({
      code: "SHIFT_CLOSED",
    })
  })

  it("a variance above the threshold needs a supervisor, then the shift closes", async () => {
    const opened = await commit(
      openShift,
      { floatP: 5_000_00 },
      { db, actor: RAFIQ }
    )
    const shift = (await db.shifts.get(opened.result.shiftId))!
    const cashP = await takeCash("pat_0052", "variance-cash-0001")
    const expectedP = await expectedOf(shift)
    expect(expectedP).toBe(5_000_00 + cashP)

    const denominations = countOff(expectedP, -1_250_00)
    const input = { shiftId: shift.id, denominations }
    await expect(
      commit(closeShift, input, { db, actor: RAFIQ })
    ).rejects.toMatchObject({
      code: "VARIANCE_APPROVAL_REQUIRED",
    })
    await expect(
      commit(
        closeShift,
        {
          ...input,
          approval: { ...NASRIN_OK, approverStaffId: RAFIQ.staffId },
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "APPROVAL_SAME_PERSON" })
    expect((await db.shifts.get(shift.id))!.status).toBe("open")

    const { result, commitId } = await commit(
      closeShift,
      { ...input, approval: NASRIN_OK },
      { db, actor: RAFIQ }
    )
    expect(result.varianceP).toBe(countedFrom(denominations) - expectedP)
    expect(result.varianceP).toBeLessThan(-rules.cashVarianceThresholdP)
    const closed = (await db.shifts.get(shift.id))!
    expect(closed).toMatchObject({
      status: "closed",
      varianceApprovalId: result.approvalId,
    })
    expect((await db.approvals.get(result.approvalId!))!).toMatchObject({
      kind: "variance",
      approverId: NASRIN.staffId,
      amountP: result.varianceP,
      reason: NASRIN_OK.reason,
    })
    const types = (await db.events.toArray())
      .filter((e) => e.commitId === commitId)
      .map((e) => e.type)
    expect(types).toEqual(
      expect.arrayContaining(["VarianceApproved", "ShiftClosed"])
    )

    const report = await shiftReport(db, closed, now())
    expect(report.approver).toEqual({
      en: "Nasrin Jahan",
      bn: expect.any(String),
    })
    expect(report.expectedCashP).toBe(expectedP)
    expect(report.byTender.cash).toBe(cashP)
  })

  it("an over count above the threshold needs approval too (either direction)", async () => {
    const opened = await commit(
      openShift,
      { floatP: 2_000_00 },
      { db, actor: RAFIQ }
    )
    const shift = (await db.shifts.get(opened.result.shiftId))!
    const denominations = countOff(await expectedOf(shift), 600_00)
    await expect(
      commit(
        closeShift,
        { shiftId: shift.id, denominations },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "VARIANCE_APPROVAL_REQUIRED" })
    const { result } = await commit(
      closeShift,
      { shiftId: shift.id, denominations, approval: NASRIN_OK },
      { db, actor: RAFIQ }
    )
    expect(result.varianceP).toBe(600_00)
  })
})
