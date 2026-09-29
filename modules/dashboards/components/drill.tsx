"use client"

import * as React from "react"
import { ChevronRight, WifiOff } from "lucide-react"

import { AreaSpark } from "@/components/motion/comb-chart"
import { StatusText } from "@/components/shared/status"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BranchCode } from "@/config/brand.config"
import type { ISODate } from "@/core/db/schema"
import { cn } from "@/lib/utils"

import {
  BRANCH_CODES,
  billedSeries,
  deptParts,
  deptsOf,
  serviceParts,
  sumRows,
  type BranchNet,
  type DayRow,
  type Dept,
  type Part,
  type StockFigures,
} from "../metrics"
import { useChangeCount } from "./flash"
import type { DashFormat } from "./format"

/** "Offline · data as at 10:42" or "Syncing" (HAZ-15). */
export function NetStatus({ net, f }: { net: BranchNet; f: DashFormat }) {
  if (net.status === "online")
    return (
      <StatusText tone="success" dot>
        {f.t("dashboards.table.online")}
      </StatusText>
    )
  if (net.status === "syncing")
    return (
      <StatusText tone="info" dot>
        {f.t("dashboards.table.syncing")}
      </StatusText>
    )
  return (
    <StatusText tone="warning" dot>
      {f.t("dashboards.table.offline", {
        time: net.since ? f.time(net.since) : "-",
      })}
    </StatusText>
  )
}

const HIDE_OUTSTANDING = "hidden @min-[44rem]/drill:table-cell"
const HIDE_WAIT = "hidden @min-[52rem]/drill:table-cell"
const HIDE_STOCK = "hidden @min-[60rem]/drill:table-cell"
const HIDE_TREND = "hidden @min-[34rem]/drill:table-cell"
const NUM = "text-right nums tabular-nums"

/* ------------------------------------------------------------------ *
 * Network level: one row per branch
 * ------------------------------------------------------------------ */

/**
 * Branch figures for the period: billed, collected, outstanding, OPD
 * visits and wait, lab TAT, stock at cost and network status. An offline
 * branch's figures are what central holds from before the cut, shown muted
 * with the cut time, never as live. Clicking a branch opens its departments.
 */
export function BranchTable({
  rows,
  stock,
  netOf,
  scope,
  onDrill,
  f,
}: {
  rows: DayRow[]
  stock?: Record<BranchCode, StockFigures>
  netOf: (branch: BranchCode) => BranchNet
  scope: string
  onDrill: (branch: BranchCode) => void
  f: DashFormat
}) {
  const total = sumRows(rows)
  return (
    <div className="@container/drill">
      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead>{f.t("dashboards.table.branch")}</TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.table.billed")}
            </TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.table.collected")}
            </TableHead>
            <TableHead className={cn("text-right", HIDE_OUTSTANDING)}>
              {f.t("dashboards.table.outstanding")}
            </TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.table.visits")}
            </TableHead>
            <TableHead className={cn("text-right", HIDE_WAIT)}>
              {f.t("dashboards.table.wait")}
            </TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.table.tat")}
            </TableHead>
            <TableHead className={cn("text-right", HIDE_STOCK)}>
              {f.t("dashboards.table.stock")}
            </TableHead>
            <TableHead>{f.t("dashboards.table.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {BRANCH_CODES.map((code) => (
            <BranchRow
              key={code}
              code={code}
              rows={rows}
              stock={stock?.[code]}
              net={netOf(code)}
              scope={scope}
              onDrill={onDrill}
              f={f}
            />
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell>{f.t("dashboards.table.total")}</TableCell>
            <TableCell
              className={NUM}
              data-testid="branch-total"
              data-value={total.billedP}
            >
              {f.moneyFull(total.billedP)}
            </TableCell>
            <TableCell className={NUM}>
              {f.moneyFull(total.collectedP)}
            </TableCell>
            <TableCell className={cn(NUM, HIDE_OUTSTANDING)}>
              {f.moneyFull(total.outstandingP)}
            </TableCell>
            <TableCell className={NUM}>{f.num(total.opdVisits)}</TableCell>
            <TableCell className={cn(NUM, HIDE_WAIT)}>
              {f.minutes(total.waitMin)}
            </TableCell>
            <TableCell className={NUM}>{f.minutes(total.tatMin)}</TableCell>
            <TableCell className={cn(NUM, HIDE_STOCK)}>
              {stock
                ? f.moneyCompact(
                    BRANCH_CODES.reduce((s, c) => s + stock[c].valueP, 0)
                  )
                : "-"}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

function BranchRow({
  code,
  rows,
  stock,
  net,
  scope,
  onDrill,
  f,
}: {
  code: BranchCode
  rows: DayRow[]
  stock?: StockFigures
  net: BranchNet
  scope: string
  onDrill: (branch: BranchCode) => void
  f: DashFormat
}) {
  const fig = sumRows(rows.filter((r) => r.branch === code))
  const flash = useChangeCount(fig.billedP + fig.collectedP * 3, scope)
  const offline = net.status !== "online"
  const hasOpd = deptsOf(code).includes("opd")
  const hasStock = deptsOf(code).includes("pharmacy")
  const muted = offline ? "text-muted-foreground" : undefined
  return (
    <TableRow
      key={flash}
      data-testid="branch-row"
      data-branch={code}
      data-status={net.status}
      data-billed={fig.billedP}
      onClick={() => onDrill(code)}
      className={cn("cursor-pointer", flash > 0 && "flash-sync")}
    >
      <TableCell>
        <button
          type="button"
          data-testid="drill-branch"
          data-branch={code}
          onClick={(e) => {
            e.stopPropagation()
            onDrill(code)
          }}
          className="flex items-center gap-2 font-medium outline-none hover:text-link focus-visible:text-link"
        >
          {offline ? <WifiOff className="size-3.5 text-warning" /> : null}
          <span className="truncate">{f.branchName(code)}</span>
          <span className="font-mono text-[0.6875rem] text-muted-foreground">
            {code}
          </span>
        </button>
      </TableCell>
      <TableCell className={cn(NUM, muted)}>
        {f.moneyFull(fig.billedP)}
      </TableCell>
      <TableCell className={cn(NUM, muted)}>
        {f.moneyFull(fig.collectedP)}
      </TableCell>
      <TableCell className={cn(NUM, HIDE_OUTSTANDING, muted)}>
        {f.moneyFull(fig.outstandingP)}
      </TableCell>
      <TableCell className={cn(NUM, muted)}>
        {hasOpd ? f.num(fig.opdVisits) : "-"}
      </TableCell>
      <TableCell className={cn(NUM, HIDE_WAIT, muted)}>
        {hasOpd ? f.minutes(fig.waitMin) : "-"}
      </TableCell>
      <TableCell className={cn(NUM, muted)}>{f.minutes(fig.tatMin)}</TableCell>
      <TableCell className={cn(NUM, HIDE_STOCK, muted)}>
        {hasStock && stock ? f.moneyCompact(stock.valueP) : "-"}
      </TableCell>
      <TableCell>
        <NetStatus net={net} f={f} />
      </TableCell>
    </TableRow>
  )
}

/* ------------------------------------------------------------------ *
 * Branch level (departments) and department level (services)
 * ------------------------------------------------------------------ */

function ShareBar({ share, f }: { share: number; f: DashFormat }) {
  const pct = Math.max(0, Math.min(1, share)) * 100
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-raised @min-[40rem]/drill:block">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="nums w-12 text-right tabular-nums">{f.pct(pct, 1)}</span>
    </div>
  )
}

/**
 * A branch's departments: billed, visits, share of the branch and a billing
 * sparkline over the period. The footer is the branch total; the parts add
 * up to it exactly. Clicking a department opens its services.
 */
export function DeptTable({
  branch,
  rows,
  sparkRows,
  chartDates,
  scope,
  onDrill,
  f,
}: {
  branch: BranchCode
  rows: DayRow[]
  sparkRows: DayRow[]
  chartDates: ISODate[]
  scope: string
  onDrill: (dept: Dept) => void
  f: DashFormat
}) {
  const parts = deptParts(rows, branch)
  const total = sumRows(rows.filter((r) => r.branch === branch))
  return (
    <div className="@container/drill">
      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead>{f.t("dashboards.drill.dept")}</TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.drill.billed")}
            </TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.drill.visits")}
            </TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.drill.shareBranch")}
            </TableHead>
            <TableHead className={cn("text-right", HIDE_TREND)}>
              {f.t("dashboards.drill.trend")}
            </TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {parts.map((p) => (
            <PartRow
              key={p.key}
              testId="drill-dept"
              dataKey="data-dept"
              part={p}
              label={f.deptLabel(p.key as Dept)}
              unit={f.unitLabel(p.key as Dept)}
              spark={billedSeries(sparkRows, chartDates, branch, p.key as Dept)}
              scope={scope}
              onClick={() => onDrill(p.key as Dept)}
              f={f}
            />
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell>{f.t("dashboards.drill.total")}</TableCell>
            <TableCell
              className={NUM}
              data-testid="drill-total"
              data-value={total.billedP}
            >
              {f.moneyFull(total.billedP)}
            </TableCell>
            <TableCell
              className={NUM}
              data-testid="drill-total-visits"
              data-value={total.visits}
            >
              {f.num(total.visits)}
            </TableCell>
            <TableCell className={NUM}>
              {f.pct(total.billedP > 0 ? 100 : 0, 1)}
            </TableCell>
            <TableCell className={HIDE_TREND} />
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

/** A department's services at a branch; the footer is the department total. */
export function ServiceTable({
  branch,
  dept,
  rows,
  sparkRows,
  chartDates,
  scope,
  f,
}: {
  branch: BranchCode
  dept: Dept
  rows: DayRow[]
  sparkRows: DayRow[]
  chartDates: ISODate[]
  scope: string
  f: DashFormat
}) {
  const parts = serviceParts(rows, branch, dept)
  const total = sumRows(
    rows.filter((r) => r.branch === branch && r.dept === dept)
  )
  return (
    <div className="@container/drill">
      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead>{f.t("dashboards.drill.service")}</TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.drill.billed")}
            </TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.drill.visits")}
            </TableHead>
            <TableHead className="text-right">
              {f.t("dashboards.drill.shareDept")}
            </TableHead>
            <TableHead className={cn("text-right", HIDE_TREND)}>
              {f.t("dashboards.drill.trend")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {parts.length ? (
            parts.map((p) => (
              <PartRow
                key={p.key}
                testId="drill-service"
                dataKey="data-service"
                part={p}
                label={f.serviceLabel(dept, p.key)}
                spark={billedSeries(sparkRows, chartDates, branch, dept, p.key)}
                scope={scope}
                f={f}
              />
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground"
              >
                {f.t("dashboards.drill.empty")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell>{f.t("dashboards.drill.total")}</TableCell>
            <TableCell
              className={NUM}
              data-testid="drill-total"
              data-value={total.billedP}
            >
              {f.moneyFull(total.billedP)}
            </TableCell>
            <TableCell
              className={NUM}
              data-testid="drill-total-visits"
              data-value={total.visits}
            >
              {f.num(total.visits)}
            </TableCell>
            <TableCell className={NUM}>
              {f.pct(total.billedP > 0 ? 100 : 0, 1)}
            </TableCell>
            <TableCell className={HIDE_TREND} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

function PartRow({
  testId,
  dataKey,
  part,
  label,
  unit,
  spark,
  scope,
  onClick,
  f,
}: {
  testId: string
  dataKey: "data-dept" | "data-service"
  part: Part
  label: string
  unit?: string
  spark: number[]
  scope: string
  onClick?: () => void
  f: DashFormat
}) {
  const flash = useChangeCount(part.billedP + part.visits, scope)
  const attrs = { [dataKey]: part.key }
  return (
    <TableRow
      key={flash}
      data-testid={testId}
      {...attrs}
      data-value={part.billedP}
      data-visits={part.visits}
      onClick={onClick}
      className={cn(onClick && "cursor-pointer", flash > 0 && "flash-sync")}
    >
      <TableCell className="font-medium">
        {onClick ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClick()
            }}
            className="outline-none hover:text-link focus-visible:text-link"
          >
            {label}
          </button>
        ) : (
          label
        )}
      </TableCell>
      <TableCell className={NUM}>{f.moneyFull(part.billedP)}</TableCell>
      <TableCell className={NUM}>
        {f.num(part.visits)}
        {unit ? (
          <span className="ml-1 hidden text-[0.6875rem] text-muted-foreground @min-[40rem]/drill:inline">
            {unit}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <ShareBar share={part.share} f={f} />
      </TableCell>
      <TableCell className={HIDE_TREND}>
        <div className="flex justify-end">
          <AreaSpark values={spark} width={88} height={22} />
        </div>
      </TableCell>
      {onClick ? (
        <TableCell className="w-8 pr-2 text-muted-foreground">
          <ChevronRight className="size-4" />
        </TableCell>
      ) : null}
    </TableRow>
  )
}
