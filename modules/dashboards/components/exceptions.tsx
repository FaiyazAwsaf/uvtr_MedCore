"use client"

import * as React from "react"
import {
  BedDouble,
  ChevronRight,
  FileLock2,
  Pill,
  Scale,
  Siren,
  WifiOff,
  type LucideIcon,
} from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { SectionCard } from "@/components/shared/section-card"
import { TONE_TEXT } from "@/components/shared/status"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { BranchCode } from "@/config/brand.config"
import { cn } from "@/lib/utils"

import {
  EXCEPTION_KINDS,
  summarise,
  type BranchNet,
  type ExceptionItem,
  type ExceptionKind,
  type ExceptionSummary,
} from "../metrics"
import { SyncFlash, useChangeCount } from "./flash"
import type { DashFormat } from "./format"

const ICON: Record<ExceptionKind, LucideIcon> = {
  criticals: Siren,
  held: FileLock2,
  awaiting: Pill,
  mismatch: Scale,
  deposit: BedDouble,
}

/**
 * Exception tiles (plan §9 `/ceo`): unacknowledged critical results, reports
 * held for payment, Rx lines awaiting the prescriber, three-way match
 * mismatches and inpatient deposit alerts, each with its count and the
 * oldest item's age and branch. A tile opens a read-only list of branches,
 * ages and reference numbers: never result values or diagnoses (plan §11).
 */
export function ExceptionRail({
  items,
  branch,
  nowMs,
  netOf,
  scope,
  f,
  className,
}: {
  items?: ExceptionItem[]
  branch: BranchCode | null
  nowMs: number
  netOf: (branch: BranchCode) => BranchNet
  scope: string
  f: DashFormat
  className?: string
}) {
  const [open, setOpen] = React.useState<ExceptionKind | null>(null)
  const summaries = EXCEPTION_KINDS.map((kind) => summarise(items ?? [], kind, branch))
  const openSummary = open ? summaries.find((s) => s.kind === open) : undefined

  return (
    <SectionCard
      title={f.t("dashboards.exceptions.title")}
      subtitle={f.t("dashboards.exceptions.subtitle")}
      size="sm"
      className={className}
    >
      <div className="@container/exc">
        <ul className="grid grid-cols-1 gap-2 @min-[34rem]/exc:grid-cols-2 @min-[52rem]/exc:grid-cols-3">
          {summaries.map((s) => (
            <li key={s.kind}>
              <ExceptionTile
                summary={s}
                loaded={items !== undefined}
                nowMs={nowMs}
                netOf={netOf}
                scope={scope}
                onOpen={() => setOpen(s.kind)}
                f={f}
              />
            </li>
          ))}
        </ul>
      </div>
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="sm:max-w-lg" data-testid="exception-list" data-kind={open ?? ""}>
          {openSummary ? (
            <ExceptionList summary={openSummary} nowMs={nowMs} netOf={netOf} f={f} />
          ) : null}
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

function ExceptionTile({
  summary,
  loaded,
  nowMs,
  netOf,
  scope,
  onOpen,
  f,
}: {
  summary: ExceptionSummary
  loaded: boolean
  nowMs: number
  netOf: (branch: BranchCode) => BranchNet
  scope: string
  onOpen: () => void
  f: DashFormat
}) {
  const Icon = ICON[summary.kind]
  const flash = useChangeCount(loaded ? summary.count : undefined, scope)
  const oldest = summary.oldest
  const offline = uniqueOffline(summary.items, netOf)
  return (
    <button
      type="button"
      data-testid="exception-tile"
      data-kind={summary.kind}
      data-count={summary.count}
      onClick={onOpen}
      className="relative flex w-full min-w-0 items-center gap-3 rounded-md bg-surface-raised/45 px-3 py-2.5 text-left transition-colors outline-none hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <span
        className={cn(
          "icon-well flex size-9 shrink-0 items-center justify-center",
          summary.count > 0 ? TONE_TEXT.warning : "text-muted-foreground"
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-semibold">
          {f.tk(`dashboards.exceptions.kinds.${summary.kind}`)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {oldest
            ? f.t("dashboards.exceptions.oldest", {
                age: f.age(nowMs - oldest.since),
                branch: oldest.branch,
              })
            : f.t("dashboards.exceptions.none")}
          {offline.length ? (
            <span className={cn("ml-1.5 inline-flex items-center gap-1", TONE_TEXT.warning)}>
              <WifiOff className="size-3" />
              {offline.join(", ")}
            </span>
          ) : null}
        </span>
      </span>
      <span
        className={cn(
          "nums flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
          summary.count > 0 ? "count-badge" : "bg-surface-raised text-muted-foreground"
        )}
      >
        {f.num(summary.count)}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      <SyncFlash count={flash} className="rounded-md" />
    </button>
  )
}

/** Offline branches among the items (their figures are as at the cut). */
function uniqueOffline(
  items: ExceptionItem[],
  netOf: (branch: BranchCode) => BranchNet
): BranchCode[] {
  return [...new Set(items.map((i) => i.branch))].filter(
    (b) => netOf(b).status !== "online"
  )
}

function ExceptionList({
  summary,
  nowMs,
  netOf,
  f,
}: {
  summary: ExceptionSummary
  nowMs: number
  netOf: (branch: BranchCode) => BranchNet
  f: DashFormat
}) {
  const offline = uniqueOffline(summary.items, netOf)
  return (
    <>
      <DialogHeader>
        <DialogTitle>{f.tk(`dashboards.exceptions.kinds.${summary.kind}`)}</DialogTitle>
        <DialogDescription>
          {f.t("dashboards.exceptions.listSubtitle", { count: f.num(summary.count) })}
        </DialogDescription>
      </DialogHeader>
      {offline.map((b) => {
        const net = netOf(b)
        return (
          <p key={b} className={cn("flex items-center gap-1.5 text-xs", TONE_TEXT.warning)}>
            <WifiOff className="size-3.5" />
            {f.t("dashboards.freshness.offline", {
              code: b,
              time: net.since ? f.time(net.since) : "-",
            })}
          </p>
        )
      })}
      {summary.items.length ? (
        <ul className="-mx-1 flex max-h-[50svh] flex-col overflow-y-auto">
          <li className="grid grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1fr)] gap-3 rounded-md bg-surface-raised px-3 py-2 text-xs font-medium">
            <span>{f.t("dashboards.exceptions.col.branch")}</span>
            <span>{f.t("dashboards.exceptions.col.age")}</span>
            <span>{f.t("dashboards.exceptions.col.refs")}</span>
          </li>
          {summary.items.map((item) => (
            <li
              key={item.id}
              data-testid="exception-item"
              data-branch={item.branch}
              className="grid grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1fr)] items-center gap-3 border-b border-hairline px-3 py-2.5 text-[0.8125rem] last:border-0"
            >
              <span className="truncate">{f.branchLabel(item.branch)}</span>
              <span className="nums tabular-nums">{f.age(nowMs - item.since)}</span>
              <span className="truncate font-mono text-xs">
                {item.refs.length ? item.refs.join(" · ") : "-"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="sm" title={f.t("dashboards.exceptions.empty")} />
      )}
    </>
  )
}
