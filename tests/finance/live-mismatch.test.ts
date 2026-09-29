import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addDaysISO } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { resolveMismatch } from "@/modules/finance/commands"
import { matchWorklist } from "@/modules/finance/queries"
import { receiveGoods, recordVendorInvoice } from "@/modules/procurement/commands"

import { habibur, orderedNapa } from "../procurement/fixtures"
import { dropDb, IMRAN, key, seededDb, today } from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("finance-live-mismatch")
})
afterAll(async () => {
  await dropDb(db)
})

/**
 * The S12 story carried into finance: 100 boxes of Napa 500 ordered, 80
 * accepted, and the depot bills the 80 boxes 6% above the PO price. The
 * mismatch lands in the worklist in boxes; paying at the PO price pays the
 * 80 boxes at the ordered price, and the order stays open for the 20 due.
 */
describe("a live mismatch on a partial, packed delivery", () => {
  it("shows in the worklist per box and resolves at the PO price without closing the order", async () => {
    const order = await orderedNapa(db, 100)
    const line = (await db.poLines.get(order.poLineId))!
    expect(line.pack?.units).toBe(100)
    await commit(
      receiveGoods,
      {
        poId: order.poId,
        lots: [{ poLineId: line.id, batchNo: "NPF", expiry: addDaysISO(today(), 730), received: 80 }],
      },
      { db, actor: habibur }
    )
    const billedCostP = Math.round(line.unitCostP * 1.06)
    const recorded = await commit(
      recordVendorInvoice,
      {
        poId: order.poId,
        vendorRef: "BX-LIVE-01",
        invoiceDate: today(),
        lines: [{ poLineId: line.id, qty: 80, unitCostP: billedCostP }],
        idempotencyKey: key("vi"),
      },
      { db, actor: habibur }
    )
    expect(recorded.events.map((e) => e.type)).toContain("ThreeWayMismatch")

    const { open } = await matchWorklist(db, "B1")
    const view = open.find((v) => v.poNo === order.poNo)!
    expect(view.diffs).toHaveLength(1)
    expect(view.diffs[0]).toMatchObject({ field: "price", po: line.unitCostP, invoice: billedCostP })
    expect(view.diffs[0].pack?.units).toBe(100)
    expect(view.atPoPriceP).toBe(80 * line.unitCostP)
    expect(view.vendorInvoice?.vendorRef).toBe("BX-LIVE-01")

    const { result } = await commit(
      resolveMismatch,
      {
        matchId: view.match.id,
        expectedVersion: view.match.version,
        resolution: "pay-po-price",
        idempotencyKey: key(),
      },
      { db, actor: IMRAN }
    )
    expect(result.amountP).toBe(80 * line.unitCostP)
    expect((await db.payables.get(result.payableId!))!.amountP).toBe(80 * line.unitCostP)
    // 20 boxes are still due, so the order stays open.
    expect((await db.purchaseOrders.get(order.poId))!.status).toBe("partial")
  })
})
