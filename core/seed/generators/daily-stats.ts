/**
 * Dashboard history (plan §7.4): 90 days x 5 branches x departments, up to
 * yesterday (today is computed live from real records). Weekly seasonality
 * (Friday is the quiet day, Saturday and Sunday the busiest), a slow upward
 * trend, collections around 85% of billed, and the planted stories:
 * - yesterday the B3 analyser was down for 3 hours, so lab TAT spiked;
 * - B2 consumables spending spiked this week.
 */

import { branches, type BranchCode } from "@/config/brand.config"
import type { DailyStatRow } from "@/core/db/schema"

import type { SeedCtx } from "../context"
import { HOUR, isoWeekday } from "../time"

type Dept = DailyStatRow["dept"]

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

export function seedDailyStats(ctx: SeedCtx): void {
  const rng = ctx.rng("daily-stats")
  const taka = (n: number) => Math.round(n) * 100

  for (let offset = -90; offset <= -1; offset++) {
    const date = ctx.day(offset)
    const weekday = isoWeekday(date)
    const trend = 1 + (offset + 90) * 0.0012
    const at = ctx.at(offset, "23:55")
    for (const b of branches) {
      for (const dept of Object.keys(VOLUME[b.code]) as Dept[]) {
        if (!b.services.includes(SERVICE_OF[dept])) continue
        const base = VOLUME[b.code][dept]!
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
        if (b.code === "B2" && offset >= -6 && dept !== "pharmacy")
          expenses *= 2.1 + rng.next() * 0.3
        let labTat =
          dept === "lab"
            ? rng.around(b.code === "B4" ? 120 : 145, 12, 100, 190)
            : dept === "imaging"
              ? rng.around(230, 25, 160, 300)
              : 0
        // Yesterday the B3 analyser was down for 3 hours.
        if (b.code === "B3" && dept === "lab" && offset === -1)
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
                (b.code === "B1" ? 48 : 30) * 100_000,
                150_000,
                1_500_000,
                6_000_000
              )
            : dept === "lab"
              ? rng.around(9 * 100_000, 60_000, 500_000, 1_500_000)
              : 0
        const row = ctx.bag.put(
          "dailyStats",
          `ds_${b.code}_${dept}_${date}`,
          at,
          {
            branchId: b.code,
            date,
            dept,
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
        )
        row.createdAt = at
        row.updatedAt = at + HOUR / 60
      }
    }
  }
}
