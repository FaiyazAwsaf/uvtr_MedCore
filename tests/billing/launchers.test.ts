import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { getCentralDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { resetDemo } from "@/core/demo/reset"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { SEED_REFS } from "@/core/seed/content"
import { cancelLine, closeShift, refund } from "@/modules/billing/commands"
import {
  openShiftFor,
  refundView,
  shiftSummary,
} from "@/modules/billing/queries"

import { NASRIN, RAFIQ } from "./fixtures"

/**
 * S9, S10 and S13 (plan §10, P3.3): each setup runs twice in a row through
 * the real commands, prepares exactly the state its cue card describes, and
 * the presenter's key action works on every run.
 */

const db = getCentralDb()
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!

const NASRIN_OK = {
  approverStaffId: NASRIN.staffId,
  reason: "Approved at the counter",
  pinVerified: true as const,
}

beforeAll(async () => {
  await resetDemo()
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

describe("S9 cancellation after payment by stage", () => {
  it("prepares three paid tests at three stages; each cancels as the rule says, on every run", async () => {
    for (let run = 1; run <= 2; run++) {
      const { outcome, route } = await runScenario(scenario("S9"))
      const invoiceId = outcome.refs!.invoiceId!
      expect(outcome.refs!.patientId).toBe(SEED_REFS.patient.nasima)
      expect(route).toBe(
        `/cashier/refunds?patient=${SEED_REFS.patient.nasima}&focus=${invoiceId}`
      )
      expect(outcome.params!.name).toBe("Nasima Khatun")

      const view = (await refundView(db, invoiceId))!
      expect(view.invoice.status).toBe("paid")
      expect(view.payments.map((p) => p.tender).sort()).toEqual([
        "bkash",
        "cash",
      ])
      const byTest = new Map<string, (typeof view.lines)[number]>()
      for (const line of view.lines) {
        const item = (await db.labOrderItems.get(line.line.sourceId))!
        byTest.set(item.testId, line)
      }
      const lipid = byTest.get(SEED_REFS.test.lipid)!
      const hba1c = byTest.get(SEED_REFS.test.hba1c)!
      const cbc = byTest.get(SEED_REFS.test.cbc)!
      expect(lipid.info.stage).toBe("lab-awaiting")
      expect(hba1c.info.stage).toBe("lab-collected")
      expect(cbc.info.stage).toBe("lab-validated")

      // Lipid: cancelled and refunded at once, half bKash and half cash.
      const auto = await commit(
        cancelLine,
        {
          invoiceLineId: lipid.line.id,
          reason: "Patient declined",
          idempotencyKey: `s9-lipid-${run}`,
        },
        { db, actor: RAFIQ }
      )
      expect(
        auto.result.refunds.map((r) => [r.tender, r.amountP]).sort()
      ).toEqual([
        ["bkash", lipid.line.netP / 2],
        ["cash", lipid.line.netP / 2],
      ])

      // HbA1c: collected, so a supervisor approves.
      const late = {
        invoiceLineId: hba1c.line.id,
        reason: "Ordered twice",
        idempotencyKey: `s9-hba1c-${run}`,
      }
      await expect(
        commit(cancelLine, late, { db, actor: RAFIQ })
      ).rejects.toMatchObject({
        code: "CANCEL_APPROVAL_REQUIRED",
      })
      const approved = await commit(
        cancelLine,
        { ...late, approval: NASRIN_OK },
        { db, actor: RAFIQ }
      )
      expect((await db.approvals.get(approved.result.approvalId!))!.kind).toBe(
        "cancel-after-collection"
      )

      // CBC: validated, blocked; a goodwill refund with approval, the result stays.
      await expect(
        commit(
          cancelLine,
          {
            invoiceLineId: cbc.line.id,
            reason: "Complaint",
            idempotencyKey: `s9-cbc-${run}`,
          },
          { db, actor: RAFIQ }
        )
      ).rejects.toMatchObject({ code: "CANCEL_AFTER_VALIDATION" })
      await commit(
        refund,
        {
          invoiceLineIds: [cbc.line.id],
          kind: "goodwill",
          reason: "Complaint about the wait",
          approval: NASRIN_OK,
          idempotencyKey: `s9-goodwill-${run}`,
        },
        { db, actor: RAFIQ }
      )
      expect((await db.labOrderItems.get(cbc.line.sourceId))!.status).toBe(
        "validated"
      )
      expect((await db.invoices.get(invoiceId))!.status).toBe("refunded")
    }
  }, 60_000)
})

describe("S10 refund to the original tender", () => {
  it("prepares a bKash-paid ultrasound with the radiologist's share; the approved refund goes back to bKash, every run", async () => {
    for (let run = 1; run <= 2; run++) {
      const { outcome, route } = await runScenario(scenario("S10"))
      const invoiceId = outcome.refs!.invoiceId!
      expect(route).toBe(`/cashier/refunds?invoice=${invoiceId}`)
      expect(outcome.params!.amount).toBe("৳1,800")

      const view = (await refundView(db, invoiceId))!
      expect(view.patient?.id).toBe(SEED_REFS.patient.kamrul)
      expect(view.payments.map((p) => p.tender)).toEqual(["bkash"])
      const [usg] = view.lines
      expect(usg.info).toEqual({
        stage: "imaging-pending",
        action: "cancel",
        rule: "auto",
      })
      expect(usg.accruals).toHaveLength(1)
      expect(usg.accruals[0]).toMatchObject({
        doctorId: "doc_enamul_kabir",
        shareP: 540_00,
      })

      const input = {
        invoiceLineId: usg.line.id,
        reason: "Patient travelling",
        idempotencyKey: `s10-usg-run-${run}`,
      }
      await expect(
        commit(cancelLine, input, { db, actor: RAFIQ })
      ).rejects.toMatchObject({
        code: "REFUND_APPROVAL_REQUIRED",
      })
      const { result } = await commit(
        cancelLine,
        { ...input, approval: NASRIN_OK },
        { db, actor: RAFIQ }
      )
      expect((await db.approvals.get(result.approvalId!))!.kind).toBe("refund")
      expect(result.refunds).toEqual([
        expect.objectContaining({
          tender: "bkash",
          amountP: 1_800_00,
          ref: expect.stringMatching(/^BKR/),
        }),
      ])
      expect(result.creditNoteNo).toMatch(/^CN-C1-\d{4}-\d{6}$/)
      expect(result.reversals).toEqual([
        expect.objectContaining({
          doctorId: "doc_enamul_kabir",
          shareP: -540_00,
          whtP: -54_00,
        }),
      ])
      expect(
        (await db.imagingOrders.get(outcome.refs!.imagingOrderId!))!.status
      ).toBe("cancelled")
    }
  }, 60_000)
})

describe("S13 cashier variance", () => {
  const expected = async () => {
    const shift = (await openShiftFor(db, RAFIQ.staffId, "B1"))!
    return {
      shift,
      expectedP: (await shiftSummary(db, shift, now())).expectedCashP,
    }
  }

  it("opens Rafiq's shift at exactly ৳48,350; re-running keeps it or refills a new shift after a close", async () => {
    const first = await runScenario(scenario("S13"))
    expect(first.route).toBe("/cashier/shift")
    expect(first.outcome.params).toMatchObject({
      expected: "৳48,350",
      counted: "৳47,100",
      variance: "-৳1,250",
    })
    const a = await expected()
    expect(a.expectedP).toBe(48_350_00)
    expect(first.outcome.refs!.shiftId).toBe(a.shift.id)

    // Again without closing: nothing to add, same shift.
    await runScenario(scenario("S13"))
    const b = await expected()
    expect(b.shift.id).toBe(a.shift.id)
    expect(b.expectedP).toBe(48_350_00)

    // The presenter's count: 40 × 1,000, 10 × 500, 20 × 100, 2 × 50 = ৳47,100.
    const count = { "1000": 40, "500": 10, "100": 20, "50": 2 }
    await expect(
      commit(
        closeShift,
        { shiftId: b.shift.id, denominations: count },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "VARIANCE_APPROVAL_REQUIRED" })
    const closed = await commit(
      closeShift,
      { shiftId: b.shift.id, denominations: count, approval: NASRIN_OK },
      { db, actor: RAFIQ }
    )
    expect(closed.result.varianceP).toBe(-1_250_00)
    expect((await db.shifts.get(b.shift.id))!.status).toBe("closed")

    // After a close, the launcher opens and fills a fresh shift.
    await runScenario(scenario("S13"))
    const c = await expected()
    expect(c.shift.id).not.toBe(b.shift.id)
    expect(c.expectedP).toBe(48_350_00)
    const again = await commit(
      closeShift,
      { shiftId: c.shift.id, denominations: count, approval: NASRIN_OK },
      { db, actor: RAFIQ }
    )
    expect(again.result.varianceP).toBe(-1_250_00)
  }, 60_000)
})
