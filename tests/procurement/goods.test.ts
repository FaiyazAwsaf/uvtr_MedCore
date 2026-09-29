import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { returnToVendor } from "@/modules/inventory/commands"
import { receiveGoods, recordVendorInvoice } from "@/modules/procurement/commands"

import { dropDb, seededDb } from "../pharmacy/fixtures"
import {
  anisur,
  habibur,
  inDays,
  ledgerMismatches,
  NAPA,
  orderedNapa,
  sabrina,
  stockOf,
  today,
} from "./fixtures"

let db: MedcoreDb
beforeAll(async () => {
  db = await seededDb("procurement-goods-test")
}, 60_000)
afterAll(async () => {
  await dropDb(db)
})

/** S12's delivery: 80 boxes in a good lot, 5 in a short-dated lot held for the vendor. */
const s12Lots = (poLineId: string) => [
  { poLineId, batchNo: "NP1042A", expiry: inDays(730), received: 80 },
  {
    poLineId,
    batchNo: "NP1042S",
    expiry: inDays(60),
    received: 5,
    rejected: 5,
    rejectReason: "short-expiry" as const,
    quarantine: true,
  },
]

describe("procurement.receiveGoods", () => {
  it("receives 85 with 5 short-dated into quarantine: 80 received · 20 pending, stock up by 8,000 tablets", async () => {
    const order = await orderedNapa(db)
    const before = await stockOf(db, "B1", NAPA)
    const reorder = (await db.reorderLevels.where("[branchId+brandId]").equals(["B1", NAPA]).first())!
    const { result, events } = await commit(
      receiveGoods,
      { poId: order.poId, lots: s12Lots(order.poLineId) },
      { db, actor: habibur }
    )
    expect(result).toMatchObject({
      poNo: order.poNo,
      received: 85,
      accepted: 80,
      rejected: 5,
      pending: 20,
      quarantinedLots: 1,
      status: "partial",
    })
    expect(result.grnNo).toMatch(/^GRN-/)
    const after = await stockOf(db, "B1", NAPA)
    expect(after.qty - before.qty).toBe(8_000)
    expect(after.quarantined - before.quarantined).toBe(500)
    expect(after.qty).toBeGreaterThan(reorder.reorderLevel)

    const po = (await db.purchaseOrders.get(order.poId))!
    expect(po.status).toBe("partial")
    const line = (await db.poLines.get(order.poLineId))!
    expect(line).toMatchObject({ qtyReceived: 85, qtyRejected: 5 })
    const grn = (await db.grns.get(result.grnId))!
    expect(grn).toMatchObject({ status: "partial", branchId: "B1", receivedBy: habibur.staffId })
    const grnLines = await db.grnLines.where("grnId").equals(grn.id).toArray()
    expect(grnLines).toHaveLength(2)
    const held = grnLines.find((l) => l.quarantine)!
    expect(held).toMatchObject({ qtyReceived: 5, qtyAccepted: 0, qtyRejected: 5, rejectReason: "short-expiry" })
    const heldBatch = (await db.batches.get(held.batchId!))!
    expect(heldBatch).toMatchObject({ status: "quarantine", batchNo: "NP1042S", vendorId: "ven_beximco" })
    const good = grnLines.find((l) => !l.quarantine)!
    const goodBatch = (await db.batches.get(good.batchId!))!
    // Cost per tablet = the PO's box price over 100 tablets.
    expect(goodBatch).toMatchObject({ status: "ok", costP: Math.round(order.costP / 100) })
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["BatchQuarantined", "GoodsReceived"])
    )
    expect(events.find((e) => e.type === "GoodsReceived")!.params).toMatchObject({
      accepted: 80,
      pending: 20,
    })
    expect(await ledgerMismatches(db)).toEqual([])
  })

  it("refuses short expiry accepted, over-pending, reasons, other branches and closed orders", async () => {
    const order = await orderedNapa(db, 10)
    const lot = { poLineId: order.poLineId, batchNo: "X1", expiry: inDays(400), received: 5 }
    const run = (lots: object[], actor = habibur) =>
      commit(receiveGoods, { poId: order.poId, lots } as never, { db, actor })
    await expect(run([{ ...lot, expiry: inDays(100) }])).rejects.toMatchObject({
      code: "GRN_SHORT_EXPIRY",
    })
    await expect(
      run([{ ...lot, expiry: inDays(100), rejected: 5, rejectReason: "damaged" }])
    ).rejects.toMatchObject({ code: "GRN_SHORT_EXPIRY" })
    await expect(run([{ ...lot, received: 11 }])).rejects.toMatchObject({
      code: "GRN_ABOVE_PENDING",
    })
    await expect(run([{ ...lot, rejected: 6, rejectReason: "damaged" }])).rejects.toMatchObject({
      code: "GRN_REJECTED_ABOVE_RECEIVED",
    })
    await expect(run([{ ...lot, rejected: 1 }])).rejects.toMatchObject({
      code: "GRN_REASON_REQUIRED",
    })
    await expect(run([{ ...lot, received: 0 }])).rejects.toMatchObject({ code: "GRN_EMPTY" })
    await expect(run([{ ...lot, poLineId: "pol_nope" }])).rejects.toMatchObject({
      code: "GRN_LINE_NOT_ON_PO",
    })
    await expect(run([lot], anisur)).rejects.toMatchObject({ code: "GRN_OTHER_BRANCH" })
    const closed = (await db.purchaseOrders.where("status").equals("closed").first())!
    await expect(
      commit(receiveGoods, { poId: closed.id, lots: [lot] }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PO_NOT_OPEN" })
  })

  it("sends back a rejected lot that is not held (nothing stocked) and completes the order", async () => {
    const order = await orderedNapa(db, 10)
    const before = await stockOf(db, "B1", NAPA)
    const first = await commit(
      receiveGoods,
      {
        poId: order.poId,
        lots: [
          {
            poLineId: order.poLineId,
            batchNo: "DMG1",
            expiry: inDays(500),
            received: 6,
            rejected: 2,
            rejectReason: "damaged",
            quarantine: false,
          },
        ],
      },
      { db, actor: habibur }
    )
    expect(first.result).toMatchObject({ accepted: 4, pending: 6, status: "partial" })
    const mid = await stockOf(db, "B1", NAPA)
    expect(mid.qty - before.qty).toBe(400)
    expect(mid.quarantined).toBe(before.quarantined)
    const second = await commit(
      receiveGoods,
      { poId: order.poId, lots: [{ poLineId: order.poLineId, batchNo: "DMG2", expiry: inDays(500), received: 6 }] },
      { db, actor: habibur }
    )
    expect(second.result).toMatchObject({ pending: 0, status: "complete" })
    expect((await db.purchaseOrders.get(order.poId))!.status).toBe("received")
    expect(await ledgerMismatches(db)).toEqual([])
  })
})

describe("inventory.returnToVendor", () => {
  it("sends the quarantined lot back: a write-off at no shelf quantity, the ledger still reconciles", async () => {
    const order = await orderedNapa(db)
    const { result } = await commit(
      receiveGoods,
      { poId: order.poId, lots: s12Lots(order.poLineId) },
      { db, actor: habibur }
    )
    const held = (await db.grnLines.where("grnId").equals(result.grnId).toArray()).find(
      (l) => l.quarantine
    )!
    const level = (await db.stockLevels
      .where("[branchId+batchId]")
      .equals(["B1", held.batchId!])
      .first())!
    expect(level).toMatchObject({ qty: 0, quarantinedQty: 500 })

    await expect(
      commit(returnToVendor, { batchId: held.batchId!, qty: 501, reason: "Depot van" }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "RETURN_ABOVE_QUARANTINED" })
    await expect(
      commit(returnToVendor, { branchId: "B2", batchId: held.batchId!, reason: "Depot van" }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "NOT_YOUR_BRANCH" })
    const okLot = (await db.grnLines.where("grnId").equals(result.grnId).toArray()).find(
      (l) => !l.quarantine
    )!
    await expect(
      commit(returnToVendor, { batchId: okLot.batchId!, reason: "Depot van" }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "RETURN_NOT_VENDOR_LOT" })

    const { events } = await commit(
      returnToVendor,
      { batchId: held.batchId!, reason: "Collected by the depot's van" },
      { db, actor: habibur }
    )
    expect(events[0]).toMatchObject({
      type: "BatchReturnedToVendor",
      params: { batchNo: "NP1042S", units: 500 },
      refs: { grnId: result.grnId, poId: order.poId },
    })
    expect(await db.stockLevels.get(level.id)).toMatchObject({ qty: 0, quarantinedQty: 0 })
    const movements = await db.stockMovements.where("batchId").equals(held.batchId!).toArray()
    expect(movements.map((m) => `${m.type} ${m.qty}`).sort()).toEqual([
      "grn 500",
      "quarantine -500",
      "write-off 0",
    ])
    await expect(
      commit(returnToVendor, { batchId: held.batchId!, reason: "Again" }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "NOTHING_IN_QUARANTINE_LOT" })
    expect(await ledgerMismatches(db)).toEqual([])
  })
})

describe("procurement.recordVendorInvoice", () => {
  it("matches 80 at the PO price and creates the payable; the later 20 match too and close the order", async () => {
    const order = await orderedNapa(db)
    await commit(receiveGoods, { poId: order.poId, lots: s12Lots(order.poLineId) }, { db, actor: habibur })
    const { result, events } = await commit(
      recordVendorInvoice,
      {
        poId: order.poId,
        vendorRef: "BX-55120",
        invoiceDate: today(),
        lines: [{ poLineId: order.poLineId, qty: 80, unitCostP: order.costP }],
      },
      { db, actor: habibur }
    )
    expect(result).toMatchObject({ status: "matched", diffs: [], amountP: 80 * order.costP, poClosed: false })
    expect(result.dueDate).toBe(inDays(30))
    expect(await db.vendorInvoices.get(result.vendorInvoiceId)).toMatchObject({
      status: "payable",
      vendorRef: "BX-55120",
      invoiceDate: today(),
    })
    expect(await db.payables.get(result.payableId!)).toMatchObject({
      amountP: 80 * order.costP,
      status: "open",
      poId: order.poId,
    })
    expect(await db.threeWayMatches.get(result.matchId)).toMatchObject({ status: "matched" })
    expect(events.map((e) => e.type)).toEqual(["ThreeWayMatched", "PayableCreated"])

    // Nothing left to bill: another invoice for the same 80 is a quantity mismatch.
    await commit(
      receiveGoods,
      { poId: order.poId, lots: [{ poLineId: order.poLineId, batchNo: "NP1042B", expiry: inDays(700), received: 20 }] },
      { db, actor: habibur }
    )
    const rest = await commit(
      recordVendorInvoice,
      {
        poId: order.poId,
        vendorRef: "BX-55188",
        invoiceDate: today(),
        lines: [{ poLineId: order.poLineId, qty: 20, unitCostP: order.costP }],
      },
      { db, actor: sabrina }
    )
    expect(rest.result).toMatchObject({ status: "matched", poClosed: true })
    expect((await db.purchaseOrders.get(order.poId))!.status).toBe("closed")
    expect(rest.events.map((e) => e.type)).toContain("PurchaseOrderClosed")
  })

  it("sends an invoice 6% above the PO price, or for more than was accepted, to the finance worklist", async () => {
    const order = await orderedNapa(db)
    await commit(receiveGoods, { poId: order.poId, lots: s12Lots(order.poLineId) }, { db, actor: habibur })
    const high = Math.round(order.costP * 1.06)
    const { result, events } = await commit(
      recordVendorInvoice,
      {
        poId: order.poId,
        vendorRef: "BX-60001",
        invoiceDate: today(),
        lines: [{ poLineId: order.poLineId, qty: 80, unitCostP: high }],
      },
      { db, actor: habibur }
    )
    expect(result.status).toBe("mismatch")
    expect(result.diffs).toEqual([
      { poLineId: order.poLineId, field: "price", po: order.costP, grn: order.costP, invoice: high },
    ])
    expect(result.payableId).toBeUndefined()
    expect(await db.vendorInvoices.get(result.vendorInvoiceId)).toMatchObject({ status: "mismatch" })
    expect(await db.payables.where("vendorInvoiceId").equals(result.vendorInvoiceId).count()).toBe(0)
    expect(events.map((e) => e.type)).toEqual(["ThreeWayMismatch"])

    const other = await orderedNapa(db)
    await commit(receiveGoods, { poId: other.poId, lots: s12Lots(other.poLineId) }, { db, actor: habibur })
    const over = await commit(
      recordVendorInvoice,
      {
        poId: other.poId,
        vendorRef: "BX-60002",
        invoiceDate: today(),
        lines: [{ poLineId: other.poLineId, qty: 85, unitCostP: other.costP }],
      },
      { db, actor: habibur }
    )
    expect(over.result.diffs).toEqual([
      { poLineId: other.poLineId, field: "qty", po: 100, grn: 80, invoice: 85 },
    ])
  })

  it("refuses invoices with nothing received, a future date, no quantity, a repeated reference or another branch", async () => {
    const order = await orderedNapa(db, 10)
    const input = {
      poId: order.poId,
      vendorRef: "BX-70001",
      invoiceDate: today(),
      lines: [{ poLineId: order.poLineId, qty: 10, unitCostP: order.costP }],
    }
    await expect(commit(recordVendorInvoice, input, { db, actor: habibur })).rejects.toMatchObject({
      code: "VI_NOTHING_RECEIVED",
    })
    await commit(
      receiveGoods,
      { poId: order.poId, lots: [{ poLineId: order.poLineId, batchNo: "V1", expiry: inDays(600), received: 10 }] },
      { db, actor: habibur }
    )
    await expect(
      commit(recordVendorInvoice, { ...input, invoiceDate: inDays(1) }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "VI_DATE_FUTURE" })
    await expect(
      commit(recordVendorInvoice, { ...input, lines: [{ ...input.lines[0], qty: 0 }] }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "VI_EMPTY" })
    await expect(
      commit(recordVendorInvoice, { ...input, lines: [{ ...input.lines[0], poLineId: "pol_x" }] }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "VI_LINE_NOT_ON_PO" })
    await expect(commit(recordVendorInvoice, input, { db, actor: anisur })).rejects.toMatchObject({
      code: "VI_OTHER_BRANCH",
    })
    await commit(recordVendorInvoice, input, { db, actor: habibur })
    await expect(
      commit(recordVendorInvoice, { ...input, vendorRef: "bx-70001" }, { db, actor: sabrina })
    ).rejects.toMatchObject({ code: "VI_DUPLICATE_REF" })
  })
})
