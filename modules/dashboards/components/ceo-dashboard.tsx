"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Landmark, WifiOff } from "lucide-react"

import { SectionCard } from "@/components/shared/section-card"
import { TONE_TEXT } from "@/components/shared/status"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Skeleton } from "@/components/ui/skeleton"
import type { BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDbInfo } from "@/core/db/DbProvider"
import { cn } from "@/lib/utils"

import {
  isBranchCode,
  isDept,
  isPeriod,
  netOf,
  offlineBranches,
  pickBranches,
  type BranchNet,
  type Dept,
  type Period,
} from "../metrics"
import { buildView, type DashboardView } from "../view"
import { TatChart, TrendChart } from "./charts"
import { BranchTable, DeptTable, ServiceTable } from "./drill"
import { ExceptionRail } from "./exceptions"
import { useDashFormat, type DashFormat } from "./format"
import { DashboardHeader } from "./header"
import { KpiBoard } from "./kpi-board"
import { useDashboardData } from "./use-dashboard"

/** Update the address without a navigation (Next keeps useSearchParams in sync). */
function writeParams(patch: Record<string, string | null>, push: boolean) {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(patch)) {
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
  }
  const next = `${url.pathname}${url.search}`
  if (push) window.history.pushState(null, "", next)
  else window.history.replaceState(null, "", next)
}

/**
 * `/ceo` (plan §9): the executive dashboard. Billed, collected, outstanding
 * and the collection rate; OPD visits and waits, lab TAT, stock and
 * receivables; the billing trend and lab TAT by branch; the branch table
 * with drill-down to departments and services (T2); the exception tiles;
 * and the freshness chips. Live: another window's checkout moves Today's
 * figures within a second. The view lives in the address
 * (`?period=30d&branch=B1&dept=lab`) so the presenter can link it.
 */
export function CeoDashboard() {
  const params = useSearchParams()
  const { network } = useDbInfo()
  const nowMs = useNow(30_000)
  const at = nowMs || now()
  const today = dhakaDate(at)

  const rawPeriod = params.get("period")
  const period: Period = isPeriod(rawPeriod) ? rawPeriod : "today"
  const rawBranch = params.get("branch")
  const branch: BranchCode | null = isBranchCode(rawBranch) ? rawBranch : null
  const rawDept = params.get("dept")
  const dept: Dept | null = branch && isDept(rawDept) ? rawDept : null

  const data = useDashboardData(today)
  const f = useDashFormat(data.specialties)
  const branchNet = React.useCallback(
    (code: BranchCode) => netOf(network, code),
    [network]
  )
  const offline = offlineBranches(network).map((o) => ({
    branch: o.branch,
    net: { status: o.status, since: o.since },
  }))
  const scope = `${today}|${period}|${branch ?? "all"}`

  const setPeriod = (next: Period) => writeParams({ period: next }, false)
  const drill = (nextBranch: BranchCode | null, nextDept: Dept | null = null) =>
    writeParams({ branch: nextBranch, dept: nextDept }, true)

  const { rows, asAt: baselineAt } = data
  const view = React.useMemo(
    () =>
      rows
        ? buildView({ rows, asAt: baselineAt, period, today, branch })
        : undefined,
    [rows, baselineAt, period, today, branch]
  )

  const range =
    period === "today"
      ? `${f.t("dashboards.range.today", { date: f.day(today) })}${
          data.rows && data.asAt === undefined
            ? ` · ${f.t("dashboards.range.liveOnly")}`
            : ""
        }`
      : view
        ? f.t("dashboards.range.days", {
            from: f.day(view.win.dates[0]),
            to: f.day(view.win.dates[view.win.dates.length - 1]),
          })
        : ""

  const highlight = period === "today" ? today : undefined

  return (
    <div
      data-testid="ceo-dashboard"
      data-period={period}
      data-branch={branch ?? ""}
      data-dept={dept ?? ""}
      data-ready={view ? "true" : "false"}
      className="@container/ceo flex flex-col gap-4 pb-2"
    >
      <DashboardHeader
        period={period}
        onPeriod={setPeriod}
        branch={branch}
        onBranch={(code) => drill(code)}
        range={range}
        asAt={at}
        offline={offline}
        f={f}
      />

      <KpiBoard
        period={period}
        scope={scope}
        current={view?.current}
        prev={view?.prev}
        comparison={view?.comparison ?? { kind: "no-earlier" }}
        stock={data.stock ? pickBranches(data.stock, branch) : undefined}
        receivables={
          data.balances
            ? pickBranches(data.balances.receivables, branch)
            : undefined
        }
        payables={
          data.balances
            ? pickBranches(data.balances.payables, branch)
            : undefined
        }
        f={f}
      />

      <div className="grid gap-4 @min-[80rem]/ceo:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4 @min-[80rem]/ceo:col-start-2 @min-[80rem]/ceo:row-span-2 @min-[80rem]/ceo:row-start-1">
          <ExceptionRail
            items={data.exceptions}
            branch={branch}
            nowMs={at}
            netOf={branchNet}
            scope={scope}
            f={f}
          />
          <BalancesCard
            className="hidden @min-[80rem]/ceo:flex"
            data={data}
            branch={branch}
            f={f}
          />
        </div>

        <div className="grid min-w-0 gap-4 @min-[62rem]/ceo:grid-cols-2 @min-[80rem]/ceo:col-start-1 @min-[80rem]/ceo:row-start-1">
          <div
            data-testid="trend-chart"
            data-points={view?.trend.length ?? 0}
            className="@container/chart min-w-0"
          >
            <SectionCard
              title={f.t("dashboards.trend.title")}
              subtitle={
                view?.chartCut !== undefined
                  ? f.t("dashboards.trend.cutSubtitle", {
                      time: f.time(view.chartCut),
                    })
                  : period === "today"
                    ? f.t("dashboards.trend.todaySubtitle")
                    : f.t("dashboards.trend.subtitle", { range })
              }
              className="h-full"
            >
              {view ? (
                <TrendChart
                  points={view.trend}
                  highlight={highlight}
                  cut={
                    view.chartCut === undefined
                      ? undefined
                      : f.time(view.chartCut)
                  }
                  f={f}
                />
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </SectionCard>
          </div>
          <div
            data-testid="tat-chart"
            data-points={view?.tat.length ?? 0}
            className="@container/chart min-w-0"
          >
            <SectionCard
              title={f.t("dashboards.tat.title")}
              subtitle={f.t("dashboards.tat.subtitle")}
              className="h-full"
            >
              {view ? (
                <TatChart
                  points={view.tat}
                  branch={branch}
                  highlight={highlight}
                  f={f}
                />
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </SectionCard>
          </div>
        </div>

        <div className="min-w-0 @min-[80rem]/ceo:col-start-1 @min-[80rem]/ceo:row-start-2">
          <DrillCard
            branch={branch}
            dept={dept}
            view={view}
            data={data}
            netOf={branchNet}
            scope={scope}
            onDrill={drill}
            f={f}
          />
        </div>
      </div>
    </div>
  )
}

function DrillCard({
  branch,
  dept,
  view,
  data,
  netOf: branchNet,
  scope,
  onDrill,
  f,
}: {
  branch: BranchCode | null
  dept: Dept | null
  view?: DashboardView
  data: ReturnType<typeof useDashboardData>
  netOf: (code: BranchCode) => BranchNet
  scope: string
  onDrill: (branch: BranchCode | null, dept?: Dept | null) => void
  f: DashFormat
}) {
  const title = !branch
    ? f.t("dashboards.table.title")
    : !dept
      ? f.t("dashboards.drill.departmentsOf", { branch: f.branchLabel(branch) })
      : f.t("dashboards.drill.servicesOf", {
          dept: f.deptLabel(dept),
          branch: f.branchLabel(branch),
        })
  const subtitle = !branch
    ? f.t("dashboards.table.subtitle")
    : !dept
      ? f.t("dashboards.drill.hint")
      : f.t("dashboards.drill.servicesHint")
  const net = branch ? branchNet(branch) : undefined

  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      bodyClassName="flex flex-col gap-3"
    >
      {branch ? (
        <Breadcrumb>
          <BreadcrumbList>
            <Crumb
              level="network"
              label={f.t("dashboards.drill.network")}
              current={!branch}
              onClick={() => onDrill(null)}
            />
            {branch ? (
              <>
                <BreadcrumbSeparator />
                <Crumb
                  level="branch"
                  label={f.branchLabel(branch)}
                  current={!dept}
                  onClick={() => onDrill(branch)}
                />
              </>
            ) : null}
            {branch && dept ? (
              <>
                <BreadcrumbSeparator />
                <Crumb
                  level="dept"
                  label={f.deptLabel(dept)}
                  current
                  onClick={() => undefined}
                />
              </>
            ) : null}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}

      {net && net.status !== "online" ? (
        <p
          data-testid="drill-offline"
          className={cn("flex items-center gap-1.5 text-xs", TONE_TEXT.warning)}
        >
          <WifiOff className="size-3.5" />
          {f.t("dashboards.drill.offlineNote", {
            code: branch!,
            time: net.since ? f.time(net.since) : "-",
          })}
        </p>
      ) : null}

      {!view ? (
        <Skeleton className="h-56 w-full" />
      ) : !branch ? (
        <BranchTable
          rows={view.periodRows}
          stock={data.stock}
          netOf={branchNet}
          scope={scope}
          onDrill={(code) => onDrill(code)}
          f={f}
        />
      ) : !dept ? (
        <DeptTable
          branch={branch}
          rows={view.periodRows}
          sparkRows={view.chartRows}
          chartDates={view.win.chartDates}
          scope={scope}
          onDrill={(d) => onDrill(branch, d)}
          f={f}
        />
      ) : (
        <ServiceTable
          branch={branch}
          dept={dept}
          rows={view.periodRows}
          sparkRows={view.chartRows}
          chartDates={view.win.chartDates}
          scope={scope}
          f={f}
        />
      )}
    </SectionCard>
  )
}

function Crumb({
  level,
  label,
  current,
  onClick,
}: {
  level: "network" | "branch" | "dept"
  label: string
  current: boolean
  onClick: () => void
}) {
  return (
    <BreadcrumbItem>
      {current ? (
        <BreadcrumbPage
          data-testid="drill-crumb"
          data-level={level}
          data-current="true"
        >
          {label}
        </BreadcrumbPage>
      ) : (
        <button
          type="button"
          data-testid="drill-crumb"
          data-level={level}
          data-current="false"
          onClick={onClick}
          className="text-link underline-offset-4 outline-none hover:underline focus-visible:underline"
        >
          {label}
        </button>
      )}
    </BreadcrumbItem>
  )
}

/** Balances as at now for the right rail: receivables, payables and stock. */
function BalancesCard({
  data,
  branch,
  f,
  className,
}: {
  data: ReturnType<typeof useDashboardData>
  branch: BranchCode | null
  f: DashFormat
  className?: string
}) {
  const receivables = data.balances
    ? pickBranches(data.balances.receivables, branch)
    : undefined
  const payables = data.balances
    ? pickBranches(data.balances.payables, branch)
    : undefined
  const stock = data.stock ? pickBranches(data.stock, branch) : undefined
  const rows: {
    key: string
    label: string
    value: string
    note?: string
    tone?: "warning"
  }[] = [
    {
      key: "corporate",
      label: f.t("dashboards.balances.corporate"),
      value: receivables ? f.moneyFull(receivables.corporateP) : "-",
    },
    {
      key: "unpaid",
      label: f.t("dashboards.balances.unpaid"),
      value: receivables ? f.moneyFull(receivables.unpaidP) : "-",
    },
    {
      key: "payables",
      label: f.t("dashboards.balances.payables"),
      value: payables ? f.moneyFull(payables.dueP) : "-",
      note:
        payables && payables.overdue > 0
          ? f.t("dashboards.balances.overdue", {
              count: f.num(payables.overdue),
            })
          : undefined,
      tone: "warning",
    },
    {
      key: "stock",
      label: f.t("dashboards.balances.stock"),
      value: stock ? f.moneyFull(stock.valueP) : "-",
      note: stock
        ? f.t("dashboards.kpi.lowStock", { count: f.num(stock.lowCount) })
        : undefined,
      tone: stock && stock.lowCount > 0 ? "warning" : undefined,
    },
  ]
  return (
    <SectionCard
      title={f.t("dashboards.balances.title")}
      subtitle={f.t("dashboards.balances.subtitle")}
      icon={Landmark}
      size="sm"
      className={className}
    >
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-0"
          >
            <span className="min-w-0">
              <span className="block truncate text-[0.8125rem]">{r.label}</span>
              {r.note ? (
                <span
                  className={cn(
                    "block truncate text-xs",
                    r.tone === "warning" ? TONE_TEXT.warning : TONE_TEXT.muted
                  )}
                >
                  {r.note}
                </span>
              ) : null}
            </span>
            <span className="nums shrink-0 text-[0.8125rem] font-semibold tabular-nums">
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
