"use client"

import * as React from "react"
import { WifiOff } from "lucide-react"

import { SegmentedPills } from "@/components/motion/segmented"
import { TONE_SOFT } from "@/components/shared/status"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { BranchCode } from "@/config/brand.config"
import type { Ms } from "@/core/db/schema"
import { cn } from "@/lib/utils"

import { BRANCH_CODES, PERIODS, type BranchNet, type Period } from "../metrics"
import type { DashFormat } from "./format"

const ALL = "all"

/**
 * The dashboard header: title and scope line, the period control, the branch
 * filter and the freshness chips ("Data as at 11:42", and one per offline
 * branch: "B1 offline · data as at 10:42", HAZ-15).
 */
export function DashboardHeader({
  period,
  onPeriod,
  branch,
  onBranch,
  range,
  asAt,
  offline,
  f,
}: {
  period: Period
  onPeriod: (period: Period) => void
  branch: BranchCode | null
  onBranch: (branch: BranchCode | null) => void
  /** "Today, 29-09-2026" or "30-08-2026 to 28-09-2026" (plus a note) */
  range: string
  /** When the figures were read (demo clock) */
  asAt: Ms
  offline: { branch: BranchCode; net: BranchNet }[]
  f: DashFormat
}) {
  const scope = branch ? f.branchLabel(branch) : f.t("dashboards.branchFilter.all")
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[1.375rem] leading-tight font-semibold">
          {f.t("dashboards.heading")}
        </h1>
        <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
          {scope} · {range}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div data-testid="ceo-period" data-period={period}>
          <SegmentedPills<Period>
            size="sm"
            value={period}
            onChange={onPeriod}
            options={PERIODS.map((p) => ({
              value: p,
              label: f.tk(`dashboards.period.${p}`),
            }))}
          />
        </div>
        <Select
          value={branch ?? ALL}
          onValueChange={(value) =>
            onBranch(value && value !== ALL ? (value as BranchCode) : null)
          }
        >
          <SelectTrigger
            size="sm"
            data-testid="ceo-branch-filter"
            data-branch={branch ?? ALL}
            aria-label={f.t("dashboards.branchFilter.label")}
            className="min-w-[10.5rem] rounded-full"
          >
            <SelectValue>
              {(value: string | null) =>
                value && value !== ALL
                  ? f.branchLabel(value as BranchCode)
                  : f.t("dashboards.branchFilter.all")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{f.t("dashboards.branchFilter.all")}</SelectItem>
            {BRANCH_CODES.map((code) => (
              <SelectItem key={code} value={code} data-testid="ceo-branch-option" data-branch={code}>
                <span className="truncate">{f.branchName(code)}</span>
                <span className="ml-auto pl-3 font-mono text-[0.6875rem] text-muted-foreground">
                  {code}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span
          data-testid="freshness"
          data-as-at={asAt}
          className="flex h-8 items-center gap-2 rounded-full bg-surface-raised px-3 text-xs font-medium"
        >
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
            <span className="relative size-2 rounded-full bg-success" />
          </span>
          {f.t("dashboards.freshness.asAt", { time: f.time(asAt) })}
        </span>
        {offline.map(({ branch: code, net }) => (
          <span
            key={code}
            data-testid="freshness-offline"
            data-branch={code}
            data-status={net.status}
            data-as-at={net.since ?? ""}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
              net.status === "syncing" ? TONE_SOFT.info : TONE_SOFT.warning
            )}
          >
            <WifiOff className="size-3.5" />
            {net.status === "syncing"
              ? f.t("dashboards.freshness.syncing", { code })
              : f.t("dashboards.freshness.offline", {
                  code,
                  time: net.since ? f.time(net.since) : "-",
                })}
          </span>
        ))}
      </div>
    </header>
  )
}
