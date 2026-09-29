/**
 * The dashboard's view for one period and branch filter: the rows in scope,
 * the figures and what the delta chips compare them with, and the chart
 * series. Pure, so the tests check exactly what the screen shows.
 */

import type { BranchCode } from "@/config/brand.config"
import type { ISODate, Ms } from "@/core/db/schema"

import {
  dailyTotals,
  filterRows,
  hourOfDay,
  PERIOD_DAYS,
  periodWindow,
  scaleToHour,
  sumRows,
  tatByBranch,
  type DayRow,
  type Figures,
  type Period,
} from "./metrics"

/** What the delta chips compare with. */
export type Comparison =
  | { kind: "yesterday"; asAt: Ms }
  | { kind: "previous"; days: number }
  | { kind: "live-only" }
  | { kind: "no-earlier" }

/**
 * Today is compared with yesterday cut to the baseline's time of day (the
 * seeded activity stops there; the demo's live records add on top). Without
 * a baseline (the demo clock moved past midnight) today is live records only
 * and has no comparison. A multi-day period is compared with the equal
 * period before it, when the history covers every day of it. On Today the
 * billing trend and sparklines show each earlier day up to the same time of
 * day, so today's partial figures sit among like-for-like points.
 */
export function buildView(input: {
  rows: DayRow[]
  /** Today's baseline cut-off, if the seed moment was today */
  asAt: Ms | undefined
  period: Period
  today: ISODate
  branch: BranchCode | null
}) {
  const { rows, asAt, period, today, branch } = input
  const win = periodWindow(period, today)
  const periodRows = filterRows(rows, { dates: win.dates })
  const current: Figures = sumRows(
    branch ? periodRows.filter((r) => r.branch === branch) : periodRows
  )
  const prevRows = filterRows(rows, { dates: win.prevDates, branch })
  let prev: Figures | undefined
  let comparison: Comparison
  if (period === "today") {
    if (asAt === undefined) comparison = { kind: "live-only" }
    else if (!prevRows.length) comparison = { kind: "no-earlier" }
    else {
      prev = sumRows(scaleToHour(prevRows, hourOfDay(asAt, today)))
      comparison = { kind: "yesterday", asAt }
    }
  } else if (
    new Set(prevRows.map((r) => r.date)).size === win.prevDates.length
  ) {
    prev = sumRows(prevRows)
    comparison = { kind: "previous", days: PERIOD_DAYS[period] }
  } else {
    comparison = { kind: "no-earlier" }
  }
  // Today's charts compare like with like: each earlier day cut to the
  // baseline's time of day, today as it stands (baseline plus live).
  const chartCut = period === "today" ? asAt : undefined
  const inChart = filterRows(rows, { dates: win.chartDates })
  const chartRows =
    chartCut === undefined
      ? inChart
      : [
          ...scaleToHour(
            inChart.filter((r) => r.date !== today),
            hourOfDay(chartCut, today)
          ),
          ...inChart.filter((r) => r.date === today),
        ]
  return {
    win,
    /** Every branch's rows for the period (the table and the drill-down) */
    periodRows,
    current,
    prev,
    comparison,
    /** Every branch's rows for the chart window (sparklines) */
    chartRows,
    /** Set when the charts show each day up to this time of day (Today) */
    chartCut,
    trend: dailyTotals(chartRows, win.chartDates, branch),
    tat: tatByBranch(chartRows, win.chartDates),
  }
}

export type DashboardView = ReturnType<typeof buildView>
