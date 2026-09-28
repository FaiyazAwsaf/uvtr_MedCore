import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { MedcoreDb } from "@/core/db/database"
import type { NetworkRow, ReorderLevelRow, StockLevelRow } from "@/core/db/schema"
import { seedDatabase } from "@/core/seed"
import { SEED_REFS } from "@/core/seed/content/seed-refs"
import { loadCatalog } from "@/modules/medicine-library/catalog"
import { branchStockRows, myBranchStock } from "@/modules/medicine-library/stock"

/** 28-09-2026, 11:30 in Dhaka (UTC+6). */
const OPTS = { now: Date.UTC(2026, 8, 28, 5, 30), today: "2026-09-28" }
const ONLINE: NetworkRow[] = []

let db: MedcoreDb

beforeAll(async () => {
  db = new MedcoreDb("library-stock-test")
  await seedDatabase(db, OPTS)
}, 60_000)

afterAll(async () => {
  await db?.delete()
})

async function stockOf(brandId: string): Promise<{
  levels: StockLevelRow[]
  reorders: ReorderLevelRow[]
}> {
  const [levels, reorders] = await Promise.all([
    db.stockLevels.where("brandId").equals(brandId).toArray(),
    db.reorderLevels.where("brandId").equals(brandId).toArray(),
  ])
  return { levels, reorders }
}

describe("library catalogue from the seeded database", () => {
  it("loads the whole dictionary with class abbreviations", async () => {
    const catalog = await loadCatalog(db)
    expect(catalog.brands).toHaveLength(200)
    expect(catalog.classKeys?.cls_ppi).toContain("ppi")
    expect(catalog.brands.every((b) => b.unitPriceP <= b.mrpP)).toBe(true)
  })
})

describe("stock by branch on the brand page", () => {
  it("shows Napa 500 low at B1: planted below its reorder level", async () => {
    const { levels, reorders } = await stockOf(SEED_REFS.brand.napa500)
    const rows = branchStockRows(SEED_REFS.brand.napa500, levels, reorders, {
      myBranch: "B1",
      isEdge: false,
      network: ONLINE,
    })
    expect(rows.map((r) => r.code)).toEqual(["B1", "B2", "B3", "B5"])
    const b1 = rows.find((r) => r.code === "B1")!
    expect(b1).toMatchObject({ status: "low", mine: true, stocked: true })
    expect(b1.onHand).toBeGreaterThan(0)
    expect(b1.onHand).toBeLessThanOrEqual(b1.reorderLevel)
    expect(rows.filter((r) => !r.mine).every((r) => !r.mine && r.asAt === undefined)).toBe(true)
    expect(myBranchStock(SEED_REFS.brand.napa500, levels, reorders, "B1", false).status).toBe("low")
  })

  it("shows Zimax 500 out at B1 and in stock at B3", async () => {
    const { levels, reorders } = await stockOf(SEED_REFS.brand.zimax500)
    const rows = branchStockRows(SEED_REFS.brand.zimax500, levels, reorders, {
      myBranch: "B1",
      isEdge: false,
      network: ONLINE,
    })
    expect(rows.find((r) => r.code === "B1")).toMatchObject({ status: "out", onHand: 0 })
    expect(rows.find((r) => r.code === "B3")?.status).toBe("in-stock")
    const mine = myBranchStock(SEED_REFS.brand.zimax500, levels, reorders, "B1", false)
    expect(mine.status).toBe("other-branch")
    expect(mine.otherBranches).toContain("B3")
  })

  it("while B1 is offline, other branches are unavailable and B1 shows an as-at time (HAZ-15)", async () => {
    const { levels, reorders } = await stockOf(SEED_REFS.brand.zimax500)
    const network: NetworkRow[] = [
      { branchId: "B1", status: "offline", since: OPTS.now, queuedCount: 0 },
    ]
    const rows = branchStockRows(SEED_REFS.brand.zimax500, levels, reorders, {
      myBranch: "B1",
      isEdge: true,
      network,
    })
    const b1 = rows.find((r) => r.code === "B1")!
    expect(b1.status).toBe("out")
    expect(b1.asAt).toBeGreaterThan(0)
    expect(rows.filter((r) => r.code !== "B1").every((r) => r.status === "unavailable-offline")).toBe(true)
    // Offline, an empty shelf reads "out": nothing claims another branch has it.
    expect(myBranchStock(SEED_REFS.brand.zimax500, levels, reorders, "B1", true).status).toBe("out")
  })

  it("seen from another branch, an offline branch shows its snapshot time", async () => {
    const { levels, reorders } = await stockOf(SEED_REFS.brand.napa500)
    const since = OPTS.now - 60_000
    const rows = branchStockRows(SEED_REFS.brand.napa500, levels, reorders, {
      myBranch: "B3",
      isEdge: false,
      network: [{ branchId: "B1", status: "offline", since, queuedCount: 2 }],
    })
    expect(rows.find((r) => r.code === "B1")).toMatchObject({ branchOffline: true, asAt: since, status: "low" })
    expect(rows.find((r) => r.code === "B3")).toMatchObject({ mine: true, branchOffline: false })
  })

  it("offers exist in the data but are read only by the brand page", async () => {
    const offers = await db.offers.toArray()
    expect(offers.length).toBeGreaterThan(0)
    expect(offers.every((o) => o.active && o.text.en && o.text.bn)).toBe(true)
  })
})
