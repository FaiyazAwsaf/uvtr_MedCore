/**
 * Batches, stock levels, reorder levels, stock movements and offers (plan
 * §7.1). Every pharmacy branch (B1, B2, B3, B5) holds 1 to 3 batches of most
 * brands. Planted states at B1: Napa 500 below its reorder level, Zimax 500
 * and Monas 10 out of stock, only 14 Seclo 20, two near-expiry batches and
 * one expired batch. Movements are recorded as they happen in the seeded
 * history (dispenses, transfers, goods receipts); an opening movement per
 * stock level makes every level reconcile with its movements.
 */

import type { BranchCode } from "@/config/brand.config"
import type {
  BatchRow,
  ISODate,
  Ms,
  Refs,
  StockLevelRow,
  StockMovementRow,
} from "@/core/db/schema"

import type { SeedCtx } from "../context"
import { vendorForCompany } from "../content/partners"
import { SEED_REFS } from "../content/seed-refs"
import { DAY, isoAddDays } from "../time"
import type { BrandInfo } from "./medicines"

export const PHARMACY_BRANCHES: BranchCode[] = ["B1", "B2", "B3", "B5"]

const B = SEED_REFS.brand

/** Brands whose B1 stock is planted; history must not dispense them at B1. */
const PLANTED_B1 = new Set<string>([
  B.napa500,
  B.zimax500,
  B.monas10,
  B.seclo20,
])

export class StockLedger {
  private readonly levels = new Map<string, StockLevelRow>()
  private readonly movements: StockMovementRow[] = []
  private seq = 0

  constructor(
    private readonly ctx: SeedCtx,
    private readonly brands: Map<string, BrandInfo>
  ) {}

  private key(branch: BranchCode, batchId: string) {
    return `${branch}:${batchId}`
  }

  brand(id: string): BrandInfo {
    const b = this.brands.get(id)
    if (!b) throw new Error(`seed: unknown brand ${id}`)
    return b
  }

  batch(id: string): BatchRow {
    return this.ctx.bag.get("batches", id)
  }

  /** Stock level row for a batch at a branch, created empty when missing. */
  level(branch: BranchCode, brandId: string, batchId: string): StockLevelRow {
    const k = this.key(branch, batchId)
    let row = this.levels.get(k)
    if (!row) {
      row = this.ctx.bag.put(
        "stockLevels",
        `stk_${branch}_${batchId.slice(4)}`,
        this.ctx.now - 60 * DAY,
        {
          branchId: branch,
          brandId,
          batchId,
          qty: 0,
          quarantinedQty: 0,
          inTransitIn: 0,
          inTransitOut: 0,
          asAt: this.ctx.now,
        }
      )
      this.levels.set(k, row)
    }
    return row
  }

  levelsAt(branch: BranchCode, brandId: string): StockLevelRow[] {
    return [...this.levels.values()].filter(
      (l) => l.branchId === branch && l.brandId === brandId
    )
  }

  /** Record a movement that has already happened; `qty` is signed. */
  move(
    type: StockMovementRow["type"],
    branch: BranchCode,
    batchId: string,
    qty: number,
    at: Ms,
    refs: Refs = {},
    reason?: string
  ): StockMovementRow {
    const batch = this.batch(batchId)
    const lvl = this.level(branch, batch.brandId, batchId)
    if (type === "quarantine") {
      lvl.quarantinedQty += -qty
    }
    lvl.qty += qty
    const row = this.ctx.bag.put(
      "stockMovements",
      `mov_${String(++this.seq).padStart(5, "0")}`,
      at,
      {
        branchId: branch,
        brandId: batch.brandId,
        batchId,
        type,
        qty,
        refs,
        reason,
        at,
      }
    )
    this.movements.push(row)
    return row
  }

  /**
   * First-expiry-first-out dispense from usable batches at a branch. Returns
   * the batch splits. Throws if stock is short or the brand's B1 stock is
   * planted for a scenario.
   */
  dispense(
    branch: BranchCode,
    brandId: string,
    qty: number,
    at: Ms,
    refs: Refs
  ): { batchId: string; qty: number }[] {
    if (branch === "B1" && PLANTED_B1.has(brandId))
      throw new Error(`seed: ${brandId} stock at B1 is planted`)
    const today = this.ctx.today
    const usable = this.levelsAt(branch, brandId)
      .map((l) => ({ l, b: this.batch(l.batchId) }))
      .filter(({ l, b }) => b.status === "ok" && b.expiry > today && l.qty > 0)
      .sort((x, y) => x.b.expiry.localeCompare(y.b.expiry))
    let left = qty
    const out: { batchId: string; qty: number }[] = []
    for (const { l } of usable) {
      if (left <= 0) break
      const take = Math.min(left, l.qty)
      out.push({ batchId: l.batchId, qty: take })
      left -= take
    }
    if (left > 0) throw new Error(`seed: not enough ${brandId} at ${branch}`)
    for (const o of out)
      this.move("dispense", branch, o.batchId, -o.qty, at, refs)
    return out
  }

  /**
   * Opening balances so each level's quantity equals the sum of its
   * movements. Planned quantities act as the opening count; later history
   * (dispenses, transfers, receipts, quarantine) moves from there.
   */
  finalize(openingAt: Ms): void {
    const sums = new Map<string, number>()
    for (const m of this.movements) {
      const k = this.key(m.branchId, m.batchId)
      sums.set(k, (sums.get(k) ?? 0) + m.qty)
    }
    for (const [k, lvl] of this.levels) {
      const opening = lvl.qty - (sums.get(k) ?? 0)
      if (opening > 0) {
        const batch = this.batch(lvl.batchId)
        const row = this.ctx.bag.put(
          "stockMovements",
          `mov_open_${lvl.id.slice(4)}`,
          openingAt,
          {
            branchId: lvl.branchId,
            brandId: batch.brandId,
            batchId: lvl.batchId,
            type: "opening",
            qty: opening,
            refs: {},
            reason: "Opening balance at stock count",
            at: openingAt,
          }
        )
        this.movements.push(row)
      }
      if (opening < 0) throw new Error(`seed: negative opening for ${lvl.id}`)
    }
  }
}

type PlannedLevel = { branch: BranchCode; qty: number }

export type StockOut = {
  ledger: StockLedger
  brandsById: Map<string, BrandInfo>
}

export function seedStock(ctx: SeedCtx, brands: BrandInfo[]): StockOut {
  const { bag } = ctx
  const rng = ctx.rng("stock")
  const brandsById = new Map(brands.map((b) => [b.id, b]))
  const ledger = new StockLedger(ctx, brandsById)

  const lotPrefix = (companyKey: string) =>
    companyKey
      .replace(/[^a-z]/g, "")
      .slice(0, 2)
      .toUpperCase()
  const newBatch = (
    brand: BrandInfo,
    id: string,
    expiry: ISODate,
    status: BatchRow["status"] = "ok",
    receivedDaysAgo = 90
  ): BatchRow => {
    const yy = expiry.slice(2, 4)
    return bag.put("batches", id, ctx.now - receivedDaysAgo * DAY, {
      brandId: brand.id,
      batchNo: `${lotPrefix(brand.companyKey)}${yy}${String(rng.int(1000, 9999))}`,
      expiry,
      costP: Math.round(brand.mrpP * (0.72 + rng.next() * 0.1)),
      mrpP: brand.mrpP,
      status,
      vendorId: vendorForCompany(brand.companyKey),
    })
  }

  const baseQty = (brand: BrandInfo, branch: BranchCode): number => {
    const size = branch === "B1" ? 1.4 : branch === "B3" ? 1 : 0.8
    const unit = brand.packSizes[0]?.units ?? 1
    let q: number
    switch (brand.form) {
      case "tablet":
      case "capsule":
        q = rng.int(3, 12) * Math.max(10, unit)
        if (brand.category === "controlled")
          q = rng.int(2, 4) * Math.max(10, unit)
        break
      case "injection":
        q = rng.int(10, 60)
        break
      case "suppository":
      case "sachet":
        q = rng.int(4, 12) * unit
        break
      default:
        q = rng.int(8, 40)
    }
    return Math.max(1, Math.round(q * size))
  }
  const reorderFor = (brand: BrandInfo, branch: BranchCode): number => {
    const unit = brand.packSizes[0]?.units ?? 1
    const solid = brand.form === "tablet" || brand.form === "capsule"
    const scale = branch === "B1" ? 1.2 : 1
    return Math.round(
      (solid ? rng.int(2, 3) * Math.max(10, unit) : rng.int(5, 12)) * scale
    )
  }

  /* Planned quantities per brand and branch (before history movements). */
  const plans = new Map<string, PlannedLevel[]>()
  const reorder = new Map<string, number>()
  for (const brand of brands) {
    const levels: PlannedLevel[] = []
    for (const branch of PHARMACY_BRANCHES) {
      if (branch !== "B1" && rng.bool(0.08)) continue // not every branch stocks everything
      let qty = baseQty(brand, branch)
      const ro = reorderFor(brand, branch)
      reorder.set(`${branch}:${brand.id}`, ro)
      if (rng.bool(0.04))
        qty = Math.max(1, Math.round(ro * 0.7)) // a few ordinary low-stock items
      else qty = Math.max(qty, ro + Math.max(5, Math.round(ro * 0.5)))
      levels.push({ branch, qty })
    }
    plans.set(brand.id, levels)
  }

  /* Planted B1 states (plan §7.1). */
  const setPlan = (
    brandId: string,
    branch: BranchCode,
    qty: number,
    reorderLevel?: number
  ) => {
    const levels = plans.get(brandId) ?? []
    const found = levels.find((l) => l.branch === branch)
    if (found) found.qty = qty
    else levels.push({ branch, qty })
    plans.set(brandId, levels)
    if (reorderLevel !== undefined)
      reorder.set(`${branch}:${brandId}`, reorderLevel)
  }
  setPlan(B.napa500, "B1", 600, 1000)
  setPlan(B.zimax500, "B1", 0, 60)
  setPlan(B.zimax500, "B3", 120, 40)
  setPlan(B.monas10, "B1", 0, 90)
  setPlan(B.monas10, "B3", 180, 60)
  setPlan(B.seclo20, "B1", 14, 300)
  setPlan(B.montair10, "B1", 240, 90)
  setPlan(B.lumona10, "B1", 150, 90)
  setPlan(B.azithrocin500, "B1", 60, 30)
  setPlan(B.zimax250, "B1", 36, 24)

  /* Batches and levels */
  for (const brand of brands) {
    const lots: BatchRow[] = []
    const lotCount = rng.int(1, 3)
    for (let i = 0; i < lotCount; i++) {
      const expiry = isoAddDays(
        ctx.today,
        i === 0 ? rng.int(90, 260) : rng.int(300, 800)
      )
      lots.push(
        newBatch(
          brand,
          `bat_${brand.id.slice(4)}_${i + 1}`,
          expiry,
          "ok",
          rng.int(30, 200)
        )
      )
    }
    for (const plan of plans.get(brand.id) ?? []) {
      // Spread the quantity over 1 to 3 lots, older lots holding less.
      const present = lots.slice(0, rng.int(1, lots.length))
      if (plan.qty === 0) {
        // Out of stock: the last lot is on the shelf list with nothing left.
        ledger.level(plan.branch, brand.id, present[0].id)
        continue
      }
      let left = plan.qty
      present.forEach((lot, idx) => {
        const share =
          idx === present.length - 1
            ? left
            : Math.min(
                left,
                Math.max(1, Math.round(plan.qty * (0.25 + rng.next() * 0.2)))
              )
        left -= share
        if (share > 0) ledger.level(plan.branch, brand.id, lot.id).qty += share
      })
    }
  }

  /* Near-expiry and expired batches at B1 (visible in the pharmacy and store) */
  const fexo = brandsById.get(B.fexo120)!
  const alatrol = brandsById.get(B.alatrol10)!
  const ace = brandsById.get(B.ace500)!
  const nearFexo = newBatch(
    fexo,
    SEED_REFS.batch.nearExpiryFexo120,
    isoAddDays(ctx.today, 21),
    "ok",
    400
  )
  const nearAlatrol = newBatch(
    alatrol,
    SEED_REFS.batch.nearExpiryAlatrol10,
    isoAddDays(ctx.today, 45),
    "ok",
    380
  )
  const expiredAce = newBatch(
    ace,
    SEED_REFS.batch.expiredAce500,
    isoAddDays(ctx.today, -12),
    "expired",
    700
  )
  ledger.level("B1", fexo.id, nearFexo.id).qty += 40
  ledger.level("B1", alatrol.id, nearAlatrol.id).qty += 60
  ledger.level("B1", ace.id, expiredAce.id).qty += 30

  /* Reorder levels for every stocked brand and branch */
  const seen = new Set<string>()
  for (const [brandId, levels] of plans) {
    for (const l of levels) {
      const k = `${l.branch}:${brandId}`
      if (seen.has(k)) continue
      seen.add(k)
      const ro = reorder.get(k) ?? 20
      bag.put(
        "reorderLevels",
        `ro_${l.branch}_${brandId.slice(4)}`,
        ctx.now - 90 * DAY,
        {
          branchId: l.branch,
          brandId,
          reorderLevel: ro,
          reorderQty: ro * 3,
        }
      )
    }
  }

  /* Offers: shown only after a medicine is selected (HAZ-04) */
  const offers: [string, string | undefined, string, string][] = [
    [
      "brd_calbod_500mg200iu",
      undefined,
      "5% off on a full box this month",
      "এই মাসে পুরো বক্সে ৫% ছাড়",
    ],
    [
      "brd_orsalinen_1025g_sachet",
      undefined,
      "Free ORS sachet with every box of 20",
      "২০টির প্রতি বক্সে একটি স্যালাইন ফ্রি",
    ],
    [
      "brd_neurob_100mg200mg200mcg",
      "B1",
      "Senior citizen card: 5% off",
      "প্রবীণ নাগরিক কার্ডে ৫% ছাড়",
    ],
    [
      "brd_aristovitb_bcomplex",
      "B3",
      "Buy 2 strips, get 1 free",
      "২ পাতা কিনলে ১ পাতা ফ্রি",
    ],
    [
      "brd_drise_20000iu",
      undefined,
      "Staff family discount 10%",
      "কর্মীর পরিবারের জন্য ১০% ছাড়",
    ],
    [
      "brd_entacydplus_400mg400mg30mg",
      "B5",
      "Festival week: 5% off",
      "উৎসব সপ্তাহে ৫% ছাড়",
    ],
  ]
  offers.forEach(([brandId, branchId, en, bn], i) => {
    if (!brandsById.has(brandId))
      throw new Error(`seed: offer for unknown brand ${brandId}`)
    bag.put("offers", `off_${i + 1}`, ctx.now - (10 + i * 3) * DAY, {
      brandId,
      branchId: branchId as BranchCode | undefined,
      text: { en, bn },
      setBy: i % 2 === 0 ? "stf_sabrina_chowdhury" : "stf_hq_farzana",
      active: true,
    })
  })

  return { ledger, brandsById }
}
