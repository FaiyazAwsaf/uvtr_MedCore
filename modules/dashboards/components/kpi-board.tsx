"use client"

import * as React from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  FlaskConical,
  Hourglass,
  Landmark,
  Package,
  Percent,
  ReceiptText,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react"

import { KpiCard, type KpiVariant } from "@/components/shared/kpi-card"
import { NumberTicker } from "@/components/motion/number-ticker"
import { TONE_SOFT, TONE_TEXT } from "@/components/shared/status"
import { cn } from "@/lib/utils"

import {
  pctChange,
  pointsChange,
  type Figures,
  type PayableFigures,
  type Period,
  type ReceivableFigures,
  type StockFigures,
} from "../metrics"
import type { Comparison } from "../view"
import { SyncFlash, useChangeCount } from "./flash"
import type { DashFormat } from "./format"

/** Compact in a 960x600 quadrant, the sample's full size once the row is wide. */
const CARD =
  "h-full min-h-[5.75rem] gap-2.5 p-4 @min-[60rem]/kpis:min-h-[7.5rem] @min-[60rem]/kpis:gap-4 @min-[60rem]/kpis:p-5"

function Figure({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[1.25rem] @min-[15rem]/kpi:text-[1.625rem] @min-[19rem]/kpi:text-[1.75rem]">
      {children}
    </span>
  )
}

function Caption({ children }: { children: React.ReactNode }) {
  return <span className="hidden @min-[14rem]/kpi:inline">{children}</span>
}

/**
 * The KPI board (plan §9 `/ceo`): four gradient cards for the money
 * (billed, collected, outstanding, collection rate) and five calm tiles for
 * operations and balances (OPD visits, OPD wait, lab TAT, stock at cost,
 * receivables). Every figure flashes when another window's commit moves it.
 */
export function KpiBoard({
  period,
  scope,
  current,
  prev,
  comparison,
  stock,
  receivables,
  payables,
  f,
}: {
  period: Period
  /** Flash scope: a change of period or branch is not a sync */
  scope: string
  current?: Figures
  prev?: Figures
  comparison: Comparison
  stock?: StockFigures
  receivables?: ReceivableFigures
  payables?: PayableFigures
  f: DashFormat
}) {
  const { t, num } = f
  const live = period === "today"
  const caption =
    comparison.kind === "yesterday"
      ? t("dashboards.kpi.vsYesterday", { time: f.time(comparison.asAt) })
      : comparison.kind === "previous"
        ? t("dashboards.kpi.vsPrevious", { days: num(comparison.days) })
        : comparison.kind === "live-only"
          ? t("dashboards.kpi.liveOnly")
          : t("dashboards.kpi.noEarlier")

  const money = (poisha: number | undefined) => {
    if (poisha === undefined) return <Figure>-</Figure>
    return (
      <span title={f.money(poisha)}>
        <Figure>
          {live ? (
            <NumberTicker value={Math.round(poisha / 100)} prefix="৳" />
          ) : (
            f.moneyCompact(poisha)
          )}
        </Figure>
      </span>
    )
  }
  const rate = current?.rate ?? null
  const ratePts = pointsChange(rate, prev?.rate)

  return (
    <section
      aria-label={t("dashboards.kpi.label")}
      className="flex flex-col gap-3 @min-[60rem]/kpis:gap-4"
    >
      <div className="@container/kpis">
        <div className="grid grid-cols-2 gap-3 @min-[40rem]/kpis:grid-cols-4 @min-[66rem]/kpis:gap-4">
          <FlashCard
            testId="kpi-billed"
            value={current?.billedP}
            scope={scope}
            variant="cyan"
            icon={ReceiptText}
            title={t("dashboards.kpi.billed")}
            figure={money(current?.billedP)}
            delta={pctChange(current?.billedP, prev?.billedP)}
            caption={caption}
          />
          <FlashCard
            testId="kpi-collected"
            value={current?.collectedP}
            scope={scope}
            variant="yellow"
            icon={Wallet}
            title={t("dashboards.kpi.collected")}
            figure={money(current?.collectedP)}
            delta={pctChange(current?.collectedP, prev?.collectedP)}
            caption={caption}
          />
          <FlashCard
            testId="kpi-outstanding"
            value={current?.outstandingP}
            scope={scope}
            variant="pink"
            icon={Hourglass}
            title={t("dashboards.kpi.outstanding")}
            figure={money(current?.outstandingP)}
            delta={pctChange(current?.outstandingP, prev?.outstandingP)}
            caption={caption}
          />
          <FlashCard
            testId="kpi-rate"
            value={rate === null ? undefined : Math.round(rate * 1000)}
            scope={scope}
            variant="purple"
            icon={Percent}
            title={t("dashboards.kpi.rate")}
            figure={
              <Figure>
                {rate === null ? (
                  "-"
                ) : (
                  <NumberTicker
                    value={Math.round(rate * 1000) / 10}
                    suffix="%"
                    format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
                  />
                )}
              </Figure>
            }
            deltaNode={
              ratePts === undefined ? undefined : (
                <span className="nums inline-flex items-center gap-1 tabular-nums">
                  {ratePts >= 0 ? (
                    <ArrowUpRight className="size-3.5" />
                  ) : (
                    <ArrowDownRight className="size-3.5" />
                  )}
                  {t("dashboards.units.points", {
                    value: `${ratePts >= 0 ? "+" : ""}${f.dec(ratePts, 1)}`,
                  })}
                </span>
              )
            }
            caption={caption}
          />
        </div>
      </div>

      <div className="@container/tiles">
        <div className="grid grid-cols-2 gap-3 @min-[34rem]/tiles:grid-cols-3 @min-[52rem]/tiles:grid-cols-5 @min-[66rem]/tiles:gap-4">
          <StatTile
            f={f}
            testId="kpi-visits"
            value={current?.opdVisits}
            scope={scope}
            icon={Users}
            label={t("dashboards.kpi.visits")}
            figure={
              current ? <NumberTicker value={current.opdVisits} /> : "-"
            }
            delta={pctChange(current?.opdVisits, prev?.opdVisits)}
            higherIsBetter
          />
          <StatTile
            f={f}
            testId="kpi-wait"
            value={current?.waitMin === null ? undefined : Math.round(current?.waitMin ?? 0)}
            scope={scope}
            icon={Clock3}
            label={t("dashboards.kpi.wait")}
            figure={f.minutes(current?.waitMin)}
            delta={pctChange(current?.waitMin, prev?.waitMin)}
            higherIsBetter={false}
          />
          <StatTile
            f={f}
            testId="kpi-tat"
            value={current?.tatMin === null ? undefined : Math.round(current?.tatMin ?? 0)}
            scope={scope}
            icon={FlaskConical}
            label={t("dashboards.kpi.tat")}
            figure={f.minutes(current?.tatMin)}
            delta={pctChange(current?.tatMin, prev?.tatMin)}
            higherIsBetter={false}
          />
          <StatTile
            f={f}
            testId="kpi-stock"
            value={stock?.valueP}
            scope={scope}
            icon={Package}
            label={t("dashboards.kpi.stock")}
            title={stock ? f.money(stock.valueP) : undefined}
            figure={stock ? f.moneyCompact(stock.valueP) : "-"}
            note={
              stock ? (
                <span
                  data-testid="kpi-low-stock"
                  data-count={stock.lowCount}
                  className={cn(stock.lowCount > 0 ? TONE_TEXT.warning : TONE_TEXT.muted)}
                >
                  {t("dashboards.kpi.lowStock", { count: num(stock.lowCount) })}
                </span>
              ) : null
            }
          />
          <StatTile
            f={f}
            testId="kpi-receivables"
            value={receivables?.totalP}
            scope={scope}
            icon={Landmark}
            label={t("dashboards.kpi.receivables")}
            title={
              receivables
                ? t("dashboards.kpi.receivablesSplit", {
                    corporate: f.money(receivables.corporateP),
                    unpaid: f.money(receivables.unpaidP),
                  })
                : undefined
            }
            figure={receivables ? f.moneyCompact(receivables.totalP) : "-"}
            note={
              payables ? (
                <span className={TONE_TEXT.muted}>
                  {t("dashboards.kpi.payablesDue", {
                    amount: f.moneyCompact(payables.dueP),
                  })}
                </span>
              ) : null
            }
          />
        </div>
      </div>
    </section>
  )
}

function FlashCard({
  testId,
  value,
  scope,
  variant,
  icon,
  title,
  figure,
  delta,
  deltaNode,
  caption,
}: {
  testId: string
  value: number | undefined
  scope: string
  variant: KpiVariant
  icon: LucideIcon
  title: string
  figure: React.ReactNode
  delta?: number
  deltaNode?: React.ReactNode
  caption: string
}) {
  const flash = useChangeCount(value, scope)
  return (
    <div
      data-testid={testId}
      data-value={value ?? ""}
      data-flash={flash}
      className="relative min-w-0 rounded-lg"
    >
      <KpiCard
        variant={variant}
        icon={icon}
        title={title}
        value={figure}
        delta={deltaNode ?? delta}
        caption={<Caption>{caption}</Caption>}
        className={CARD}
      />
      <SyncFlash count={flash} />
    </div>
  )
}

/** A signed change on a calm surface, green when it moves the right way. */
function DeltaText({
  value,
  higherIsBetter,
  f,
}: {
  value: number
  higherIsBetter: boolean
  f: DashFormat
}) {
  const up = value >= 0
  const good = Math.abs(value) < 0.05 ? true : up === higherIsBetter
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        "nums inline-flex h-5.5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[0.6875rem] font-medium tabular-nums",
        good ? TONE_SOFT.success : TONE_SOFT.destructive
      )}
    >
      <Icon className="size-3" />
      {up ? "+" : ""}
      {f.num(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
    </span>
  )
}

/** A calm stat tile (surface card) for the second KPI row. */
function StatTile({
  testId,
  value,
  scope,
  icon: Icon,
  label,
  figure,
  title,
  delta,
  higherIsBetter = true,
  note,
  f,
}: {
  testId: string
  value: number | undefined
  scope: string
  icon: LucideIcon
  label: string
  figure: React.ReactNode
  title?: string
  delta?: number
  higherIsBetter?: boolean
  note?: React.ReactNode
  f: DashFormat
}) {
  const flash = useChangeCount(value, scope)
  return (
    <div
      data-testid={testId}
      data-value={value ?? ""}
      data-flash={flash}
      className="surface-card relative flex min-w-0 flex-col gap-2 p-3.5 @min-[66rem]/tiles:p-4"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="icon-well flex size-8 shrink-0 items-center justify-center text-link">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 truncate text-[0.8125rem] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex min-w-0 items-end justify-between gap-2">
        <span
          title={title}
          className="figure min-w-0 truncate text-[1.25rem] leading-tight @min-[66rem]/tiles:text-[1.375rem]"
        >
          {figure}
        </span>
        {delta !== undefined ? (
          <DeltaText value={delta} higherIsBetter={higherIsBetter} f={f} />
        ) : null}
      </div>
      {note ? <div className="truncate text-xs">{note}</div> : null}
      <SyncFlash count={flash} />
    </div>
  )
}
