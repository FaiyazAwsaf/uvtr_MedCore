"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { BranchCode } from "@/config/brand.config"
import type { ISODate } from "@/core/db/schema"
import { formatCompactCurrency } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"

import {
  BRANCH_CODES,
  deptsOf,
  tatPeak,
  type TatPoint,
  type TrendPoint,
} from "../metrics"
import type { DashFormat } from "./format"

/**
 * Branch colours follow the branch, never its rank (the chart tokens from
 * docs/ui_guidelines.md §2.1). Identity is never colour alone: a legend
 * names every line, the tooltip lists the values, and the branch table
 * carries the same figures.
 */
export const BRANCH_COLOR: Record<BranchCode, string> = {
  B1: "var(--chart-1)",
  B2: "var(--chart-2)",
  B3: "var(--chart-4)",
  B4: "var(--chart-3)",
  B5: "var(--chart-5)",
}

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 }

/** The tooltip bubble (docs/ui_guidelines.md §4 Charts): on --tooltip, white text. */
function Bubble({
  title,
  rows,
}: {
  title: string
  rows: { key: string; color: string; label: string; value: string; strong?: boolean }[]
}) {
  return (
    <div className="min-w-[10rem] rounded-md bg-tooltip px-3 py-2 text-xs text-white shadow-lg">
      <p className="mb-1.5 font-semibold">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-white/85">
              <span className="size-2 rounded-full" style={{ background: r.color }} />
              {r.label}
            </span>
            <span className={cn("nums tabular-nums", r.strong && "font-semibold")}>
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Legend chips above a chart (line swatch plus label). */
export function ChartLegend({
  items,
}: {
  items: { key: string; color: string; label: string; muted?: boolean }[]
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((item) => (
        <li
          key={item.key}
          className={cn("flex items-center gap-1.5", item.muted && "opacity-45")}
        >
          <span
            aria-hidden
            className="h-[3px] w-3.5 rounded-full"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

type TooltipProps = {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: unknown }>
}

/* ------------------------------------------------------------------ *
 * Billed and collected per day
 * ------------------------------------------------------------------ */

type TrendDatum = { date: ISODate; label: string; billed: number; collected: number }

/**
 * Billed versus collected per day: a smooth turquoise line with a gradient
 * fill for billing, a lavender line for collections, and the partial day
 * (today so far) marked when the view includes it.
 */
export function TrendChart({
  points,
  highlight,
  f,
}: {
  points: TrendPoint[]
  /** A day to mark (today, still in progress) */
  highlight?: ISODate
  f: DashFormat
}) {
  const gradientId = React.useId().replace(/:/g, "")
  const data = React.useMemo<TrendDatum[]>(
    () =>
      points.map((p) => ({
        date: p.date,
        label: f.dayMonth(p.date),
        billed: Math.round(p.billedP / 100),
        collected: Math.round(p.collectedP / 100),
      })),
    [points, f]
  )
  const marked = highlight ? data.find((d) => d.date === highlight) : undefined
  const compact = (taka: number) => formatCompactCurrency(taka, f.locale, "BDT")

  return (
    <div className="flex flex-col gap-3">
      <ChartLegend
        items={[
          { key: "billed", color: "var(--chart-1)", label: f.t("dashboards.trend.billed") },
          { key: "collected", color: "var(--chart-2)", label: f.t("dashboards.trend.collected") },
        ]}
      />
      <div className="h-48 @min-[36rem]/chart:h-60">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.34} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--hairline)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              minTickGap={18}
              tickMargin={8}
            />
            <YAxis
              width={58}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickFormatter={compact}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              content={(props: TooltipProps) => {
                const d = props.active ? (props.payload?.[0]?.payload as TrendDatum | undefined) : undefined
                if (!d) return null
                return (
                  <Bubble
                    title={
                      d.date === highlight
                        ? `${f.day(d.date)} · ${f.t("dashboards.trend.today")}`
                        : f.day(d.date)
                    }
                    rows={[
                      {
                        key: "billed",
                        color: "var(--chart-1)",
                        label: f.t("dashboards.trend.billed"),
                        value: f.money(d.billed * 100),
                        strong: true,
                      },
                      {
                        key: "collected",
                        color: "var(--chart-2)",
                        label: f.t("dashboards.trend.collected"),
                        value: f.money(d.collected * 100),
                      },
                    ]}
                  />
                )
              }}
            />
            <Area
              type="monotone"
              dataKey="billed"
              stroke="var(--chart-1)"
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: "var(--chart-1)" }}
              dot={false}
              animationDuration={450}
            />
            <Area
              type="monotone"
              dataKey="collected"
              stroke="var(--chart-2)"
              strokeWidth={2}
              fill="transparent"
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: "var(--chart-2)" }}
              dot={false}
              animationDuration={450}
            />
            {marked ? (
              <ReferenceLine
                x={marked.label}
                stroke="var(--primary)"
                strokeDasharray="4 4"
                strokeOpacity={0.7}
              />
            ) : null}
            {marked ? (
              <ReferenceDot
                x={marked.label}
                y={marked.billed}
                r={6}
                fill="var(--primary)"
                stroke="var(--card)"
                strokeWidth={2}
                label={{
                  value: f.t("dashboards.trend.today"),
                  position: "top",
                  offset: 10,
                  fill: "var(--foreground)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Lab TAT per branch
 * ------------------------------------------------------------------ */

/**
 * Lab turnaround per branch per day, one line per branch. The selected
 * branch stays bright and the others recede; the day and branch with the
 * highest turnaround in view is marked and named under the chart.
 */
export function TatChart({
  points,
  branch,
  highlight,
  f,
}: {
  points: TatPoint[]
  branch?: BranchCode | null
  highlight?: ISODate
  f: DashFormat
}) {
  const codes = BRANCH_CODES.filter((c) => deptsOf(c).includes("lab"))
  const data = React.useMemo(
    () => points.map((p) => ({ ...p, label: f.dayMonth(p.date) })),
    [points, f]
  )
  const peak = tatPeak(points, branch)
  const peakLabel = peak ? f.dayMonth(peak.date) : undefined
  const marked = highlight ? data.find((d) => d.date === highlight) : undefined

  return (
    <div className="flex flex-col gap-3">
      <ChartLegend
        items={codes.map((code) => ({
          key: code,
          color: BRANCH_COLOR[code],
          label: code,
          muted: !!branch && branch !== code,
        }))}
      />
      <div className="h-48 @min-[36rem]/chart:h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 18, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--hairline)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              minTickGap={18}
              tickMargin={8}
            />
            <YAxis
              width={40}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickFormatter={(v: number) => f.num(v)}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              content={(props: TooltipProps) => {
                const d = props.active
                  ? (props.payload?.[0]?.payload as (TatPoint & { label: string }) | undefined)
                  : undefined
                if (!d) return null
                return (
                  <Bubble
                    title={f.day(d.date)}
                    rows={codes.map((code) => ({
                      key: code,
                      color: BRANCH_COLOR[code],
                      label: f.branchLabel(code),
                      value: f.minutes(d[code] ?? null),
                      strong: branch === code,
                    }))}
                  />
                )
              }}
            />
            {marked ? (
              <ReferenceLine
                x={marked.label}
                stroke="var(--primary)"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
              />
            ) : null}
            {codes.map((code) => (
              <Line
                key={code}
                type="monotone"
                dataKey={code}
                name={code}
                stroke={BRANCH_COLOR[code]}
                strokeWidth={branch === code ? 2.75 : 2}
                strokeOpacity={branch && branch !== code ? 0.28 : 1}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: BRANCH_COLOR[code] }}
                connectNulls
                animationDuration={450}
              />
            ))}
            {peak && peakLabel ? (
              <ReferenceDot
                x={peakLabel}
                y={peak.minutes}
                r={5}
                fill={BRANCH_COLOR[peak.branch]}
                stroke="var(--card)"
                strokeWidth={2}
                label={{
                  value: peak.branch,
                  position: "top",
                  offset: 8,
                  fill: "var(--foreground)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {peak ? (
        <p data-testid="tat-peak" data-branch={peak.branch} data-date={peak.date} className="text-xs text-muted-foreground">
          {f.t("dashboards.tat.peak", {
            branch: f.branchLabel(peak.branch),
            date: f.day(peak.date),
            value: f.minutes(peak.minutes),
          })}
        </p>
      ) : null}
    </div>
  )
}
