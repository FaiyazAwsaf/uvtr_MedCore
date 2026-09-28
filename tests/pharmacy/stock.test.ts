import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { SEED_REFS } from "@/core/seed/content"
import { dispatchTransfer, receiveTransfer, requestTransfer } from "@/modules/inventory/commands"
import {
  counterSale,
  dispense,
  resolveReturn,
  returnToQuarantine,
} from "@/modules/pharmacy/commands"

import { dropDb, jahid, seededDb, shirin, signedRx, usableAt } from "./fixtures"

const B = SEED_REFS.brand

let db: MedcoreDb
beforeAll(async () => {
  db = await seededDb("pharmacy-stock-test")
})
afterAll(async () => {
  await dropDb(db)
})

const units = async (branch: "B1" | "B3", brandId: string) => {
  const levels = await db.stockLevels.where("[branchId+brandId]").equals([branch, brandId]).toArray()
  return {
    qty: levels.reduce((sum, l) => sum + l.qty, 0),
    inTransitIn: levels.reduce((sum, l) => sum + l.inTransitIn, 0),
    inTransitOut: levels.reduce((sum, l) => sum + l.inTransitOut, 0),
  }
}

describe("pharmacy.counterSale", () => {
  it("sells an OTC medicine from FEFO stock as otc dispenses with stock movements", async () => {
    const [first] = await usableAt(db, "B1", B.napa500)
    const brand = await db.brands.get(B.napa500)
    const { result, events } = await commit(
      counterSale,
      { items: [{ brandId: B.napa500, qty: 10 }], tenderedP: 5_000 },
      { db, actor: shirin }
    )
    expect(result.totalP).toBe(10 * brand!.unitPriceP)
    expect(result.changeP).toBe(5_000 - result.totalP)
    const rows = await db.dispenses.bulkGet(result.dispenseIds)
    expect(rows[0]).toMatchObject({
      saleType: "otc",
      batchId: first.batch.id,
      qty: 10,
      pharmacyCouncilNo: "PCB-B-10234",
    })
    const movement = (await db.stockMovements.where("batchId").equals(first.batch.id).toArray()).find(
      (m) => m.refs.dispenseId === rows[0]!.id
    )
    expect(movement).toMatchObject({ type: "dispense", qty: -10 })
    expect(events.map((e) => e.type)).toContain("CounterSaleCompleted")
  })

  it("blocks an antibiotic without a prescription and audits the attempt (INV-06)", async () => {
    const before = await units("B1", B.azithrocin500)
    const auditBefore = await db.audit.count()
    await expect(
      commit(counterSale, { items: [{ brandId: B.azithrocin500, qty: 6 }] }, { db, actor: shirin })
    ).rejects.toMatchObject({ code: "RX_REQUIRED", audit: true })
    expect(await units("B1", B.azithrocin500)).toEqual(before)
    const audit = await db.audit.orderBy("seq").last()
    expect(await db.audit.count()).toBe(auditBefore + 1)
    expect(audit).toMatchObject({
      action: "blocked",
      command: "pharmacy.counterSale",
      code: "RX_REQUIRED",
    })
    const event = await db.events.orderBy("seq").last()
    expect(event).toMatchObject({ type: "RuleViolationBlocked" })
    expect(event?.params).toMatchObject({ code: "RX_REQUIRED", rule: "INV-06" })
  })

  it("refuses a price above MRP, audited (INV-05)", async () => {
    const brand = await db.brands.get(B.napa500)
    await expect(
      commit(
        counterSale,
        { items: [{ brandId: B.napa500, qty: 2, unitPriceP: brand!.mrpP + 1 }] },
        { db, actor: shirin }
      )
    ).rejects.toMatchObject({ code: "PRICE_ABOVE_MRP", audit: true })
  })
})

describe("returns to quarantine", () => {
  it("holds returned units in quarantine until the pharmacist accepts or discards them", async () => {
    const { rxId, lineIds } = await signedRx(db, [
      { brandId: B.alatrol10, dosePattern: "0+0+1", days: 10 },
    ])
    await commit(
      dispense,
      { rxId, lines: [{ rxLineId: lineIds[0], qty: 10 }], verifiedBy: "dob" },
      { db, actor: shirin }
    )
    const [row] = await db.dispenses.where("rxId").equals(rxId).toArray()
    const level = await db.stockLevels.where("[branchId+batchId]").equals(["B1", row.batchId]).first()

    await commit(
      returnToQuarantine,
      { dispenseId: row.id, qty: 4, reason: "Patient stopped the medicine" },
      { db, actor: shirin }
    )
    let now = await db.stockLevels.get(level!.id)
    expect(now).toMatchObject({ qty: level!.qty, quarantinedQty: level!.quarantinedQty + 4 })
    await expect(
      commit(
        returnToQuarantine,
        { dispenseId: row.id, qty: row.qty - 4 + 1, reason: "Too many" },
        { db, actor: shirin }
      )
    ).rejects.toMatchObject({ code: "RETURN_ABOVE_DISPENSED" })

    await commit(resolveReturn, { dispenseId: row.id, action: "accept" }, { db, actor: shirin })
    now = await db.stockLevels.get(level!.id)
    expect(now).toMatchObject({ qty: level!.qty + 4, quarantinedQty: level!.quarantinedQty })

    await commit(
      returnToQuarantine,
      { dispenseId: row.id, qty: 2, reason: "Damaged strip" },
      { db, actor: shirin }
    )
    await commit(resolveReturn, { dispenseId: row.id, action: "discard" }, { db, actor: shirin })
    now = await db.stockLevels.get(level!.id)
    expect(now).toMatchObject({ qty: level!.qty + 4, quarantinedQty: level!.quarantinedQty })

    // The movements reconcile with the level: their sum equals the change in qty.
    const moves = (await db.stockMovements.where("batchId").equals(row.batchId).toArray()).filter(
      (m) => m.refs.dispenseId === row.id
    )
    expect(moves.reduce((sum, m) => sum + m.qty, 0)).toBe(-row.qty + 4)
  })
})

describe("stock transfer B3 to B1", () => {
  it("is requested at B1, dispatched from B3 and received at B1 with both branches updated", async () => {
    const b1Before = await units("B1", B.zimax500)
    const b3Before = await units("B3", B.zimax500)
    expect(b1Before.qty).toBe(0)
    expect(b3Before.qty).toBeGreaterThanOrEqual(30)

    const { result: requested } = await commit(
      requestTransfer,
      {
        fromBranchId: "B3",
        toBranchId: "B1",
        lines: [{ brandId: B.zimax500, qty: 30 }],
        requestedFrom: "pharmacy",
      },
      { db, actor: shirin }
    )

    // Only the source branch dispatches.
    await expect(
      commit(dispatchTransfer, { transferId: requested.transferId }, { db, actor: shirin })
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_SOURCE" })

    const { result: sent, events: sentEvents } = await commit(
      dispatchTransfer,
      { transferId: requested.transferId },
      { db, actor: jahid }
    )
    expect(sent.units).toBe(30)
    expect(sentEvents.map((e) => e.type)).toContain("TransferDispatched")
    expect((await db.transfers.get(requested.transferId))?.status).toBe("dispatched")
    const b3Sent = await units("B3", B.zimax500)
    expect(b3Sent.qty).toBe(b3Before.qty - 30)
    expect(b3Sent.inTransitOut).toBe(b3Before.inTransitOut + 30)
    const b1Sent = await units("B1", B.zimax500)
    expect(b1Sent).toMatchObject({ qty: 0, inTransitIn: b1Before.inTransitIn + 30 })
    const outMoves = await db.stockMovements.where("type").equals("transfer-out").toArray()
    expect(
      outMoves
        .filter((m) => m.refs.transferId === requested.transferId)
        .reduce((sum, m) => sum + m.qty, 0)
    ).toBe(-30)

    // Only the destination receives; the count may come up short.
    await expect(
      commit(receiveTransfer, { transferId: requested.transferId }, { db, actor: jahid })
    ).rejects.toMatchObject({ code: "TRANSFER_NOT_DESTINATION" })
    const lines = await db.transferLines.where("transferId").equals(requested.transferId).toArray()
    const counted = lines.map((l, i) => ({
      transferLineId: l.id,
      qtyReceived: i === 0 ? l.qtyDispatched - 2 : l.qtyDispatched,
    }))
    const { result: got, events } = await commit(
      receiveTransfer,
      { transferId: requested.transferId, lines: counted },
      { db, actor: shirin }
    )
    expect(got).toMatchObject({ units: 28, short: 2 })
    expect(events.map((e) => e.type)).toContain("TransferReceived")
    expect(await units("B1", B.zimax500)).toMatchObject({
      qty: 28,
      inTransitIn: b1Before.inTransitIn,
    })
    expect((await units("B3", B.zimax500)).inTransitOut).toBe(b3Before.inTransitOut)
    const transfer = await db.transfers.get(requested.transferId)
    expect(transfer?.status).toBe("received")
    const after = await db.transferLines.where("transferId").equals(requested.transferId).toArray()
    expect(after.reduce((sum, l) => sum + l.qtyReceived, 0)).toBe(28)
    expect(after.find((l) => l.qtyReceived < l.qtyDispatched)?.discrepancy).toBe("Short by 2")

    // A received transfer cannot be received again.
    await expect(
      commit(receiveTransfer, { transferId: requested.transferId }, { db, actor: shirin })
    ).rejects.toMatchObject({ code: "TRANSFER_STATE" })
  })
})
