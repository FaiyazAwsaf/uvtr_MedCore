import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { getCentralDb } from "@/core/db/database"
import { resetDemo } from "@/core/demo/reset"
import { commit } from "@/core/engine/commit"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { receiveGoods, recordVendorInvoice } from "@/modules/procurement/commands"

import { habibur, ledgerMismatches, NAPA, stockOf } from "./fixtures"

const db = getCentralDb()
const s12 = SCENARIOS.find((s) => s.id === "S12")!

beforeAll(async () => {
  await resetDemo()
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

/** The presenter's part: receive 85 with 5 short-dated held, then invoice the 80 at the PO price. */
async function perform(poId: string) {
  const today = dhakaDate(now())
  const [line] = await db.poLines.where("poId").equals(poId).toArray()
  const grn = await commit(
    receiveGoods,
    {
      poId,
      lots: [
        { poLineId: line.id, batchNo: "NPA", expiry: addDaysISO(today, 730), received: 80 },
        {
          poLineId: line.id,
          batchNo: "NPS",
          expiry: addDaysISO(today, 60),
          received: 5,
          rejected: 5,
          rejectReason: "short-expiry",
          quarantine: true,
        },
      ],
    },
    { db, actor: habibur }
  )
  const invoice = await commit(
    recordVendorInvoice,
    {
      poId,
      vendorRef: `BX-${poId.slice(-6)}`,
      invoiceDate: today,
      lines: [{ poLineId: line.id, qty: 80, unitCostP: line.unitCostP }],
    },
    { db, actor: habibur }
  )
  return { grn: grn.result, invoice: invoice.result }
}

describe("S12 partial goods receipt", () => {
  it("sets up a fresh PO-1042 below reorder, and the partial receipt and match work on every run", async () => {
    const first = await runScenario(s12)
    const reorder = (await db.reorderLevels.where("[branchId+brandId]").equals(["B1", NAPA]).first())!
    expect(first.outcome.params).toMatchObject({ poNo: "PO-1042" })
    expect(first.route).toBe(`/store/grn?po=${first.outcome.refs!.poId}`)
    const po = (await db.purchaseOrders.get(first.outcome.refs!.poId!))!
    expect(po).toMatchObject({ status: "issued", branchId: "B1", vendorId: "ven_beximco" })
    const pr = (await db.purchaseRequests.get(first.outcome.refs!.prId!))!
    expect(pr).toMatchObject({
      status: "ordered",
      approvalTier: "procurement-head",
      decidedBy: "stf_tariq_aziz",
    })
    expect((await stockOf(db, "B1", NAPA)).qty).toBe(600)
    expect(600).toBeLessThanOrEqual(reorder.reorderLevel)

    const done = await perform(po.id)
    expect(done.grn).toMatchObject({ accepted: 80, pending: 20 })
    expect(done.invoice.status).toBe("matched")
    expect((await stockOf(db, "B1", NAPA)).qty).toBe(8_600)

    const second = await runScenario(s12)
    expect(second.outcome.params).toMatchObject({ poNo: "PO-1043" })
    expect(second.outcome.refs!.poId).not.toBe(po.id)
    expect((await stockOf(db, "B1", NAPA)).qty).toBe(600)
    const again = await perform(second.outcome.refs!.poId!)
    expect(again.grn).toMatchObject({ accepted: 80, pending: 20 })
    expect(again.invoice.status).toBe("matched")
    expect(await ledgerMismatches(db)).toEqual([])
  }, 60_000)
})
