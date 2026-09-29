import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { SEED_REFS } from "@/core/seed/content"
import { returnToVendor } from "@/modules/inventory/commands"
import { daysBetween, loadStore, summarizeStock } from "@/modules/inventory/store-stock"
import { receiveGoods } from "@/modules/procurement/commands"

import { dropDb, seededDb } from "../pharmacy/fixtures"
import { habibur, inDays, ledgerMismatches, NAPA, orderedNapa, today } from "../procurement/fixtures"

/** The store's stock view (plan §9 `/store`) over the seeded demo and after real commands. */

let db: MedcoreDb
beforeAll(async () => {
  db = await seededDb("inventory-store-test")
}, 60_000)
afterAll(async () => {
  await dropDb(db)
})

const napaRow = async () =>
  (await loadStore(db, "B1", today())).rows.find((r) => r.brand.id === NAPA)!

describe("the store view", () => {
  it("raises 'Napa 500 below reorder level' at Dhanmondi, alphabetically among the alerts", async () => {
    const summary = await loadStore(db, "B1", today())
    const row = summary.rows.find((r) => r.brand.id === NAPA)!
    expect(row).toMatchObject({ onHand: 600, reorderLevel: 1000, status: "low", alert: true })
    const alerts = summary.rows.filter((r) => r.alert)
    expect(summary.kpis.low).toBe(alerts.length)
    const names = alerts.map((r) => `${r.brand.name} ${r.brand.strength}`)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    // Out of stock at B1 (planted): an alert with status "out"
    const zimax = summary.rows.find((r) => r.brand.id === SEED_REFS.brand.zimax500)!
    expect(zimax.status).toBe("out")
  })

  it("values stock at cost and lists expiring and expired batches, soonest first", async () => {
    const summary = await loadStore(db, "B1", today())
    const levels = await db.stockLevels.where("branchId").equals("B1").toArray()
    const batches = await db.batches.bulkGet(levels.map((l) => l.batchId))
    const value = levels.reduce((sum, l, i) => sum + Math.max(0, l.qty) * batches[i]!.costP, 0)
    expect(summary.kpis.valueP).toBe(value)
    const ids = summary.expiring.map((e) => e.batch.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        SEED_REFS.batch.expiredAce500,
        SEED_REFS.batch.nearExpiryAlatrol10,
        SEED_REFS.batch.nearExpiryFexo120,
      ])
    )
    const expired = summary.expiring.find((e) => e.batch.id === SEED_REFS.batch.expiredAce500)!
    expect(expired.expired).toBe(true)
    expect(summary.kpis.expiring).toBe(summary.expiring.filter((e) => !e.expired).length)
    const dates = summary.expiring.map((e) => e.batch.expiry)
    expect(dates).toEqual([...dates].sort())
  })

  it("clears the alert when a goods receipt lifts Napa 500 above its reorder level, and shows the held lot", async () => {
    const order = await orderedNapa(db)
    const { result } = await commit(
      receiveGoods,
      {
        poId: order.poId,
        lots: [
          { poLineId: order.poLineId, batchNo: "NP1042A", expiry: inDays(730), received: 80 },
          {
            poLineId: order.poLineId,
            batchNo: "NP1042S",
            expiry: inDays(60),
            received: 5,
            rejected: 5,
            rejectReason: "short-expiry",
            quarantine: true,
          },
        ],
      },
      { db, actor: habibur }
    )
    const row = await napaRow()
    expect(row).toMatchObject({ onHand: 8_600, status: "ok", alert: false, quarantined: 500 })

    const summary = await loadStore(db, "B1", today())
    const held = summary.quarantine.find((q) => q.batch.batchNo === "NP1042S")!
    expect(held).toMatchObject({
      qty: 500,
      vendorLot: true,
      rejectReason: "short-expiry",
      grn: { id: result.grnId },
      po: { id: order.poId },
      vendor: { id: "ven_beximco" },
    })

    await commit(
      returnToVendor,
      { batchId: held.batch.id, reason: "Collected by the depot van" },
      { db, actor: habibur }
    )
    const after = await loadStore(db, "B1", today())
    expect(after.quarantine.find((q) => q.batch.batchNo === "NP1042S")).toBeUndefined()
    expect(await ledgerMismatches(db)).toEqual([])
  })

  it("adds up every branch in the network view", async () => {
    const network = await loadStore(db, null, today())
    const perBranch = await Promise.all(
      (["B1", "B2", "B3", "B5"] as const).map((b) => loadStore(db, b, today()))
    )
    expect(network.kpis.valueP).toBe(perBranch.reduce((s, b) => s + b.kpis.valueP, 0))
    expect(network.kpis.low).toBe(perBranch.reduce((s, b) => s + b.kpis.low, 0))
  })
})

describe("summarizeStock", () => {
  it("reads Out, Low at or below the reorder level, and OK", () => {
    const brand = { id: "b1", name: "Test", strength: "1 mg" } as never
    const batch = { id: "bt1", brandId: "b1", expiry: "2030-01-01", status: "ok", costP: 10 } as never
    const level = (qty: number) =>
      ({ id: `l${qty}`, branchId: "B1", brandId: "b1", batchId: "bt1", qty, quarantinedQty: 0, inTransitIn: 0, inTransitOut: 0 }) as never
    const run = (qty: number) =>
      summarizeStock({
        levels: [level(qty)],
        batches: new Map([["bt1", batch]]),
        brands: new Map([["b1", brand]]),
        reorders: [{ branchId: "B1", brandId: "b1", reorderLevel: 100, reorderQty: 300 } as never],
        today: "2026-09-29",
      }).rows[0]
    expect(run(0).status).toBe("out")
    expect(run(100)).toMatchObject({ status: "low", alert: true })
    expect(run(101)).toMatchObject({ status: "ok", alert: false, valueP: 1010 })
    expect(daysBetween("2026-09-29", "2026-12-28")).toBe(90)
  })
})
