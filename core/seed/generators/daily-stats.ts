/**
 * Dashboard history (plan §7.4): 90 days x 5 branches x departments, up to
 * yesterday. Weekly seasonality (Friday is the quiet day, Saturday and Sunday
 * the busiest), a slow upward trend, collections around 85% of billed, and the
 * planted stories:
 * - yesterday the B3 analyser was down for 3 hours, so lab TAT spiked;
 * - B2 consumables spending spiked this week.
 *
 * Every row also splits its visits and billing by service (OPD specialty, lab
 * section, imaging modality, pharmacy sale category, inpatient ward kind) for
 * the executive drill-down (branch to department to service).
 *
 * Today gets one baseline row per branch and department covering the day up
 * to the seed moment (`asAt`): the hospital's activity outside the demo's
 * itemised records. The dashboard adds today's live records on top, so its
 * figures stay realistic and still move during the demo.
 */

import { branches, type BranchCode } from "@/config/brand.config"
import type { BaseRow, DailyStatRow } from "@/core/db/schema"
import type { Rng } from "@/lib/mock/rng"

import type { SeedCtx } from "../context"
import { WARDS } from "../content/org"
import { HOUR, isoWeekday } from "../time"

type Dept = DailyStatRow["dept"]
type Service = NonNullable<DailyStatRow["services"]>[number]

/** Typical daily volume per branch and department. */
const VOLUME: Record<BranchCode, Partial<Record<Dept, number>>> = {
  B1: { opd: 260, lab: 320, imaging: 70, pharmacy: 380, inpatient: 22 },
  B2: { opd: 180, lab: 220, imaging: 45, pharmacy: 260, inpatient: 9 },
  B3: { opd: 120, lab: 340, imaging: 60, pharmacy: 150 },
  B4: { lab: 280, imaging: 55 },
  B5: { opd: 190, lab: 230, imaging: 50, pharmacy: 270, inpatient: 10 },
}

/** Average billed per visit (taka); inpatient is per occupied bed per day. */
const TICKET: Record<Dept, number> = {
  opd: 950,
  lab: 1100,
  imaging: 1900,
  pharmacy: 650,
  inpatient: 5500,
}

/** Sunday ... Saturday */
const WEEKDAY_FACTOR = [1.08, 1.04, 1.0, 1.0, 0.95, 0.55, 1.12]

const SERVICE_OF: Record<
  Dept,
  "opd" | "lab" | "imaging" | "pharmacy" | "inpatient"
> = {
  opd: "opd",
  lab: "lab",
  imaging: "imaging",
  pharmacy: "pharmacy",
  inpatient: "inpatient",
}

/** Service mix: [key, share of visits, price relative to the department's average]. */
type Mix = readonly (readonly [key: string, weight: number, ticket: number])[]

const OPD_HOSPITAL: Mix = [
  ["MED", 22, 1],
  ["CARD", 10, 1.3],
  ["PAED", 12, 0.95],
  ["GYN", 12, 1.05],
  ["ORTH", 8, 1.1],
  ["ENT", 6, 0.9],
  ["DERM", 6, 0.9],
  ["NEURO", 4, 1.3],
  ["GASTRO", 5, 1.15],
  ["NEPH", 3, 1.2],
  ["ENDO", 4, 1.15],
  ["PSY", 2, 1.2],
  ["OPH", 3, 0.85],
  ["URO", 3, 1.1],
  ["SURG", 6, 1.05],
  ["CHEST", 4, 1.05],
]
/** Mirpur (B3) runs OPD chambers for a few specialties. */
const OPD_CHAMBERS: Mix = [
  ["MED", 30, 1],
  ["CARD", 20, 1.3],
  ["GYN", 14, 1.05],
  ["PAED", 14, 0.95],
  ["ENDO", 12, 1.15],
  ["DERM", 10, 0.9],
]
const LAB: Mix = [
  ["haematology", 30, 0.6],
  ["biochemistry", 34, 1],
  ["immunology", 6, 1.6],
  ["serology", 8, 0.9],
  ["microbiology", 5, 1.4],
  ["histopathology", 2, 3],
  ["hormones", 9, 1.5],
  ["urine", 6, 0.4],
]
const IMAGING: Mix = [
  ["xray", 40, 0.6],
  ["usg", 38, 1.2],
  ["ecg", 14, 0.3],
  ["echo", 8, 1.8],
]
const PHARMACY: Mix = [
  ["rx", 72, 1.1],
  ["otc", 26, 0.6],
  ["controlled", 2, 1],
]

function mixFor(branch: BranchCode, dept: Dept): Mix {
  switch (dept) {
    case "opd":
      return branch === "B3" ? OPD_CHAMBERS : OPD_HOSPITAL
    case "lab":
      return LAB
    case "imaging":
      return IMAGING
    case "pharmacy":
      return PHARMACY
    case "inpatient": {
      // Occupied beds by ward kind, priced by the ward's bed-day rate.
      const wards = WARDS.filter((w) => w.branch === branch)
      const kinds = [...new Set(wards.map((w) => w.kind))]
      const avgRate =
        wards.reduce((s, w) => s + w.bedDayRateTaka * w.beds * w.occupancy, 0) /
        Math.max(1, wards.reduce((s, w) => s + w.beds * w.occupancy, 0))
      return kinds.map((kind) => {
        const of = wards.filter((w) => w.kind === kind)
        const beds = of.reduce((s, w) => s + w.beds * w.occupancy, 0)
        const rate =
          of.reduce((s, w) => s + w.bedDayRateTaka * w.beds * w.occupancy, 0) /
          Math.max(1, beds)
        return [kind, beds, rate / avgRate] as const
      })
    }
  }
}

/** Opening hours (Dhaka) over which a department's day accumulates. */
const OPEN_HOURS: Record<Dept, readonly [number, number]> = {
  opd: [8, 21],
  lab: [7, 22],
  imaging: [8, 21],
  pharmacy: [8, 23],
  inpatient: [0, 24],
}

/** Split a whole number over weights exactly (largest remainder). */
function splitExact(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  if (total <= 0 || sum <= 0) return weights.map(() => 0)
  const exact = weights.map((w) => (total * w) / sum)
  const out = exact.map((x) => Math.floor(x))
  let left = total - out.reduce((s, x) => s + x, 0)
  const order = exact
    .map((x, i) => ({ i, f: x - Math.floor(x) }))
    .sort((a, b) => b.f - a.f || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out
}

/** The day's visits and billing by service; the parts add up to the row exactly. */
function servicesFor(
  rng: Rng,
  branch: BranchCode,
  dept: Dept,
  visits: number,
  billedP: number
): Service[] {
  const mix = mixFor(branch, dept)
  const jitter = mix.map(() => rng.around(1, 0.1, 0.75, 1.25))
  const visitParts = splitExact(
    visits,
    mix.map(([, w], i) => w * jitter[i])
  )
  // Billing is split in whole taka so every part stays a whole-taka amount.
  const takaParts = splitExact(
    Math.round(billedP / 100),
    mix.map(([, w, ticket], i) => w * jitter[i] * ticket)
  )
  return mix.map(([key], i) => ({
    key,
    visits: visitParts[i],
    billedP: takaParts[i] * 100,
  }))
}

type Figures = Omit<
  DailyStatRow,
  keyof BaseRow | "branchId" | "date" | "dept" | "services" | "asAt"
>

/** One full day's figures for a branch and department (history and today). */
function dayFigures(
  rng: Rng,
  branch: BranchCode,
  dept: Dept,
  offset: number,
  date: string
): Figures {
  const taka = (n: number) => Math.round(n) * 100
  const weekday = isoWeekday(date)
  const trend = 1 + (offset + 90) * 0.0012
  const base = VOLUME[branch][dept]!
  const seasonal = dept === "inpatient" ? 1 : WEEKDAY_FACTOR[weekday]
  const visits = Math.max(
    1,
    Math.round(base * seasonal * trend * rng.around(1, 0.12, 0.8, 1.2))
  )
  const billed = visits * TICKET[dept] * rng.around(1, 0.1, 0.85, 1.15)
  // Outstanding is corporate and credit: higher for inpatient stays.
  const collectionRate =
    dept === "inpatient"
      ? rng.around(0.7, 0.06, 0.6, 0.8)
      : rng.around(0.86, 0.04, 0.8, 0.92)
  const collected = billed * collectionRate
  let expenses = billed * rng.around(0.55, 0.05, 0.45, 0.65)
  // B2 consumables spike this week (anomaly alert story).
  if (branch === "B2" && offset >= -6 && dept !== "pharmacy")
    expenses *= 2.1 + rng.next() * 0.3
  let labTat =
    dept === "lab"
      ? rng.around(branch === "B4" ? 120 : 145, 12, 100, 190)
      : dept === "imaging"
        ? rng.around(230, 25, 160, 300)
        : 0
  // Yesterday the B3 analyser was down for 3 hours.
  if (branch === "B3" && dept === "lab" && offset === -1)
    labTat = 395 + rng.int(0, 20)
  const wait =
    dept === "opd"
      ? rng.around(18 + 10 * seasonal, 4, 10, 45)
      : dept === "pharmacy"
        ? rng.around(8, 2, 3, 15)
        : dept === "inpatient"
          ? 0
          : rng.around(14, 3, 6, 25)
  const stockValue =
    dept === "pharmacy"
      ? rng.around(
          (branch === "B1" ? 48 : 30) * 100_000,
          150_000,
          1_500_000,
          6_000_000
        )
      : dept === "lab"
        ? rng.around(9 * 100_000, 60_000, 500_000, 1_500_000)
        : 0
  return {
    visits,
    newPatients: Math.round(
      visits *
        (dept === "opd"
          ? rng.around(0.18, 0.03, 0.1, 0.3)
          : rng.around(0.07, 0.02, 0.02, 0.12))
    ),
    billedP: taka(billed),
    collectedP: taka(collected),
    outstandingP: taka(billed) - taka(collected),
    avgWaitMin: Math.round(wait),
    labTatMin: Math.round(labTat),
    expensesP: taka(expenses),
    stockValueP: taka(stockValue),
  }
}

export function seedDailyStats(ctx: SeedCtx): void {
  const rng = ctx.rng("daily-stats")
  const serviceRng = ctx.rng("daily-stats-services")

  for (let offset = -90; offset <= -1; offset++) {
    const date = ctx.day(offset)
    const at = ctx.at(offset, "23:55")
    for (const b of branches) {
      for (const dept of Object.keys(VOLUME[b.code]) as Dept[]) {
        if (!b.services.includes(SERVICE_OF[dept])) continue
        const figures = dayFigures(rng, b.code, dept, offset, date)
        const row = ctx.bag.put(
          "dailyStats",
          `ds_${b.code}_${dept}_${date}`,
          at,
          {
            branchId: b.code,
            date,
            dept,
            ...figures,
            services: servicesFor(
              serviceRng,
              b.code,
              dept,
              figures.visits,
              figures.billedP
            ),
          }
        )
        row.createdAt = at
        row.updatedAt = at + HOUR / 60
      }
    }
  }

  seedTodayBaseline(ctx)
}

/**
 * Today up to the seed moment: a full day's figures scaled by how much of the
 * department's opening hours have passed. Averages (waits, TAT) and the stock
 * value are levels, so they are not scaled; inpatient visits are the bed
 * census, which does not grow through the day.
 */
function seedTodayBaseline(ctx: SeedCtx): void {
  const rng = ctx.rng("daily-stats-today")
  const serviceRng = ctx.rng("daily-stats-today-services")
  const date = ctx.today
  const hour = (ctx.now - ctx.at(0, "00:00")) / HOUR
  for (const b of branches) {
    for (const dept of Object.keys(VOLUME[b.code]) as Dept[]) {
      if (!b.services.includes(SERVICE_OF[dept])) continue
      const full = dayFigures(rng, b.code, dept, 0, date)
      const [open, close] = OPEN_HOURS[dept]
      const f = Math.min(1, Math.max(0, (hour - open) / (close - open)))
      const scale = (n: number) => Math.round(n * f)
      const scaleP = (p: number) => Math.round((p * f) / 100) * 100
      const visits = dept === "inpatient" ? full.visits : scale(full.visits)
      const billedP = scaleP(full.billedP)
      const collectedP = Math.min(billedP, scaleP(full.collectedP))
      ctx.bag.put("dailyStats", `ds_${b.code}_${dept}_${date}`, ctx.now, {
        branchId: b.code,
        date,
        dept,
        visits,
        newPatients: scale(full.newPatients),
        billedP,
        collectedP,
        outstandingP: billedP - collectedP,
        avgWaitMin: full.avgWaitMin,
        labTatMin: full.labTatMin,
        expensesP: scaleP(full.expensesP),
        stockValueP: full.stockValueP,
        services: servicesFor(serviceRng, b.code, dept, visits, billedP),
        asAt: ctx.now,
      })
    }
  }
}
