/**
 * The store's view of stock (plan §9 `/store`, objective §3D): per brand at a
 * branch, on hand against the reorder level, in transit, quarantined, the
 * nearest usable expiry and the value at cost; the batches expiring soon;
 * and the lots held in quarantine with where they came from. Pure over rows
 * (`summarizeStock`), plus the live loader the screen runs (`loadStore`).
 *
 * Lists are ordered alphabetically by brand (HAZ-04: never by stock or
 * value); expiry lists by date, soonest first.
 */

import { rules } from "@/config/rules.config"
import type { BranchCode } from "@/config/brand.config"
import type { MedcoreDb } from "@/core/db/database"
import type {
  BatchRow,
  BrandRow,
  GrnRow,
  ISODate,
  Id,
  Poisha,
  PurchaseOrderRow,
  ReorderLevelRow,
  StockLevelRow,
  VendorRow,
} from "@/core/db/schema"

import { brandLabel } from "./stock"

export type StockStatus = "out" | "low" | "ok"

export type StockRow = {
  key: string
  branchId: BranchCode
  brand: BrandRow
  onHand: number
  reorderLevel?: number
  reorderQty?: number
  status: StockStatus
  /** On hand at or below the reorder level (the low-stock alert) */
  alert: boolean
  inTransitIn: number
  inTransitOut: number
  quarantined: number
  nearestExpiry?: ISODate
  valueP: Poisha
}

export type ExpiringRow = {
  key: string
  branchId: BranchCode
  brand: BrandRow
  batch: BatchRow
  qty: number
  valueP: Poisha
  daysLeft: number
  /** Past its expiry date (or marked expired): blocked from dispensing */
  expired: boolean
}

export type QuarantineRow = {
  key: string
  branchId: BranchCode
  brand: BrandRow
  batch: BatchRow
  level: StockLevelRow
  qty: number
  /** Held for its vendor since a goods receipt (may be returned to the vendor) */
  vendorLot: boolean
  grn?: GrnRow
  po?: PurchaseOrderRow
  vendor?: VendorRow
  /** Why the goods receipt refused it */
  rejectReason?: "damaged" | "short-expiry" | "wrong-item" | "other"
  /** The stored movement reason (patient returns) */
  note?: string
}

export type StoreKpis = {
  valueP: Poisha
  brandsOnHand: number
  low: number
  expiring: number
  inTransitIn: number
  inTransitOut: number
  quarantinedLots: number
}

export type StoreSummary = {
  rows: StockRow[]
  expiring: ExpiringRow[]
  quarantine: QuarantineRow[]
  kpis: StoreKpis
}

const DAY_MS = 86_400_000

/** Whole days from `from` to `to` (calendar days, negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  const [fy, fm, fd] = from.split("-").map(Number)
  const [ty, tm, td] = to.split("-").map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS)
}

const byLabel = (a: { brand: BrandRow; branchId: string }, b: { brand: BrandRow; branchId: string }) =>
  brandLabel(a.brand).localeCompare(brandLabel(b.brand)) || a.branchId.localeCompare(b.branchId)

/** Stock by brand, expiring batches and quarantined lots for the given levels. */
export function summarizeStock(input: {
  levels: readonly StockLevelRow[]
  batches: ReadonlyMap<Id, BatchRow>
  brands: ReadonlyMap<Id, BrandRow>
  reorders: readonly ReorderLevelRow[]
  today: ISODate
  nearExpiryDays?: number
}): StoreSummary {
  const nearDays = input.nearExpiryDays ?? rules.nearExpiryDays
  const rowsByKey = new Map<string, StockRow>()
  const rowFor = (branchId: BranchCode, brand: BrandRow): StockRow => {
    const key = `${branchId}:${brand.id}`
    let row = rowsByKey.get(key)
    if (!row) {
      row = {
        key,
        branchId,
        brand,
        onHand: 0,
        status: "ok",
        alert: false,
        inTransitIn: 0,
        inTransitOut: 0,
        quarantined: 0,
        valueP: 0,
      }
      rowsByKey.set(key, row)
    }
    return row
  }

  const expiring: ExpiringRow[] = []
  const quarantine: QuarantineRow[] = []
  for (const level of input.levels) {
    const brand = input.brands.get(level.brandId)
    const batch = input.batches.get(level.batchId)
    if (!brand || !batch) continue
    const row = rowFor(level.branchId, brand)
    const qty = Math.max(0, level.qty)
    row.onHand += qty
    row.inTransitIn += level.inTransitIn
    row.inTransitOut += level.inTransitOut
    row.quarantined += level.quarantinedQty
    row.valueP += qty * batch.costP
    const expired = batch.status === "expired" || batch.expiry < input.today
    const usable = batch.status === "ok" && !expired
    if (usable && qty > 0 && (!row.nearestExpiry || batch.expiry < row.nearestExpiry)) {
      row.nearestExpiry = batch.expiry
    }
    if (qty > 0 && batch.status !== "quarantine") {
      const daysLeft = daysBetween(input.today, batch.expiry)
      if (expired || daysLeft <= nearDays) {
        expiring.push({
          key: level.id,
          branchId: level.branchId,
          brand,
          batch,
          qty,
          valueP: qty * batch.costP,
          daysLeft,
          expired,
        })
      }
    }
    if (level.quarantinedQty > 0) {
      quarantine.push({
        key: level.id,
        branchId: level.branchId,
        brand,
        batch,
        level,
        qty: level.quarantinedQty,
        vendorLot: batch.status === "quarantine",
      })
    }
  }
  for (const reorder of input.reorders) {
    const brand = input.brands.get(reorder.brandId)
    if (!brand) continue
    const row = rowFor(reorder.branchId, brand)
    row.reorderLevel = reorder.reorderLevel
    row.reorderQty = reorder.reorderQty
  }

  const rows = [...rowsByKey.values()]
  for (const row of rows) {
    row.alert = row.reorderLevel !== undefined && row.onHand <= row.reorderLevel
    row.status = row.onHand <= 0 ? "out" : row.alert ? "low" : "ok"
  }
  rows.sort(byLabel)
  expiring.sort(
    (a, b) => a.batch.expiry.localeCompare(b.batch.expiry) || byLabel(a, b)
  )
  quarantine.sort(byLabel)

  return {
    rows,
    expiring,
    quarantine,
    kpis: {
      valueP: rows.reduce((sum, r) => sum + r.valueP, 0),
      brandsOnHand: rows.filter((r) => r.onHand > 0).length,
      low: rows.filter((r) => r.alert).length,
      expiring: expiring.filter((e) => !e.expired).length,
      inTransitIn: rows.reduce((sum, r) => sum + r.inTransitIn, 0),
      inTransitOut: rows.reduce((sum, r) => sum + r.inTransitOut, 0),
      quarantinedLots: quarantine.length,
    },
  }
}

const unique = <T>(values: (T | undefined | null)[]): T[] => [
  ...new Set(values.filter((v): v is T => v !== undefined && v !== null)),
]

function byId<T extends { id: Id }>(rows: (T | undefined)[]): Map<Id, T> {
  return new Map(rows.filter((r): r is T => !!r).map((r) => [r.id, r]))
}

/** The store screen's live data: one branch, or every branch (`null`). */
export async function loadStore(
  db: MedcoreDb,
  branch: BranchCode | null,
  today: ISODate
): Promise<StoreSummary> {
  const [levels, reorders] = await Promise.all([
    branch ? db.stockLevels.where("branchId").equals(branch).toArray() : db.stockLevels.toArray(),
    branch
      ? db.reorderLevels.where("branchId").equals(branch).toArray()
      : db.reorderLevels.toArray(),
  ])
  const [batchRows, brandRows] = await Promise.all([
    db.batches.bulkGet(unique(levels.map((l) => l.batchId))),
    db.brands.bulkGet(unique([...levels.map((l) => l.brandId), ...reorders.map((r) => r.brandId)])),
  ])
  const summary = summarizeStock({
    levels,
    batches: byId(batchRows),
    brands: byId(brandRows),
    reorders,
    today,
  })
  if (!summary.quarantine.length) return summary

  // Where each quarantined lot came from: the goods receipt that held it.
  const batchIds = unique(summary.quarantine.map((q) => q.batch.id))
  const held = (await db.stockMovements.where("batchId").anyOf(batchIds).toArray()).filter(
    (m) => m.type === "quarantine"
  )
  const grnIds = unique(held.map((m) => m.refs.grnId))
  const [grns, grnLines, vendors] = await Promise.all([
    db.grns.bulkGet(grnIds),
    grnIds.length ? db.grnLines.where("grnId").anyOf(grnIds).toArray() : [],
    db.vendors.bulkGet(unique(summary.quarantine.map((q) => q.batch.vendorId))),
  ])
  const grnById = byId(grns)
  const pos = byId(await db.purchaseOrders.bulkGet(unique(grns.map((g) => g?.poId))))
  const vendorById = byId(vendors)
  for (const row of summary.quarantine) {
    const move = held.find((m) => m.batchId === row.batch.id && m.branchId === row.branchId)
    const grn = move?.refs.grnId ? grnById.get(move.refs.grnId) : undefined
    const line =
      grnLines.find((l) => l.grnId === grn?.id && l.batchId === row.batch.id) ??
      grnLines.find((l) => l.grnId === grn?.id && l.brandId === row.brand.id && l.quarantine)
    row.grn = grn
    row.po = grn ? pos.get(grn.poId) : undefined
    row.vendor = row.batch.vendorId ? vendorById.get(row.batch.vendorId) : undefined
    row.rejectReason = line?.rejectReason
    row.note = move?.reason
  }
  return summary
}
