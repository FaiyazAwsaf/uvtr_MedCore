"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { StatusPill, type Tone } from "@/components/shared/status"
import {
  branches,
  type Bilingual,
  type BranchCode,
} from "@/config/brand.config"
import { useDbInfo } from "@/core/db/DbProvider"
import type { BrandRow, ReorderLevelRow, StockLevelRow } from "@/core/db/schema"
import {
  stockByBranch,
  stockStatus,
  type BranchStock,
  type StockStatus,
} from "@/core/stock/availability"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

export type StockView = {
  /** Status from `stockStatus` (other-branch when out here but held elsewhere) */
  status: StockStatus
  /** The status at this branch alone: in-stock, low or out */
  local: "in-stock" | "low" | "out"
  onHand: number
  byBranch: Record<BranchCode, BranchStock>
  otherBranches: BranchCode[]
}

export type StockLookup = {
  of: (brandId: string) => StockView
  branch: BranchCode
  offline: boolean
  /** While offline: when this branch's figures were last known */
  asAt?: number
}

/**
 * Live stock for a set of brands at this window's branch (objective §3B):
 * indexed reads, so the badge shows as soon as a medicine is picked. While
 * the branch is offline, other branches are unknown (HAZ-15).
 */
export function useStock(brandIds: string[]): StockLookup | undefined {
  const { db, isEdge, branch, network } = useDbInfo()
  const key = [...new Set(brandIds)].sort().join(",")
  const rows = useLiveQuery(async () => {
    const ids = key ? key.split(",") : []
    if (!ids.length)
      return { levels: [] as StockLevelRow[], reorder: [] as ReorderLevelRow[] }
    const [levels, reorder] = await Promise.all([
      db.stockLevels.where("brandId").anyOf(ids).toArray(),
      db.reorderLevels.where("brandId").anyOf(ids).toArray(),
    ])
    return { levels, reorder }
  }, [db, key])
  return React.useMemo(() => {
    if (!rows || !branch) return undefined
    const cache = new Map<string, StockView>()
    const of = (brandId: string): StockView => {
      const hit = cache.get(brandId)
      if (hit) return hit
      const byBranch = stockByBranch(brandId, rows.levels, rows.reorder)
      const s = stockStatus(branch, byBranch, { offline: isEdge })
      const here = byBranch[branch]
      const view: StockView = {
        status: s.status,
        local:
          here.onHand > here.reorderLevel
            ? "in-stock"
            : here.onHand > 0
              ? "low"
              : "out",
        onHand: s.onHand,
        byBranch,
        otherBranches: s.otherBranches,
      }
      cache.set(brandId, view)
      return view
    }
    const since = network.find((n) => n.branchId === branch)?.since
    return { of, branch, offline: isEdge, asAt: isEdge ? since : undefined }
  }, [rows, branch, isEdge, network])
}

const LOCAL_TONE: Record<StockView["local"], Tone> = {
  "in-stock": "success",
  low: "warning",
  out: "destructive",
}

/** "560 capsules": the brand's unit, plural in English (Bangla has no plural form). */
export function unitText(
  label: Bilingual,
  count: number,
  locale: "en" | "bn"
): string {
  return locale === "en" && count !== 1 ? `${label.en}s` : label[locale]
}

export function branchName(code: BranchCode, locale: "en" | "bn"): string {
  return branches.find((b) => b.code === code)?.name[locale] ?? code
}

/**
 * The stock badge on the Rx pad: this branch first ("Out at B1"), then the
 * branches that hold it. `data-status` carries the `stockStatus` value.
 */
export function RxStockBadge({
  brand,
  view,
  lookup,
  compact = false,
  testId = "rx-stock-badge",
}: {
  brand: Pick<BrandRow, "id" | "unitLabel">
  view: StockView
  lookup: StockLookup
  compact?: boolean
  testId?: string
}) {
  const { t, num, time, locale } = useLocale()
  const label =
    view.local === "in-stock"
      ? t("prescribing.stock.inHere", { branch: lookup.branch })
      : view.local === "low"
        ? t("prescribing.stock.lowHere", { branch: lookup.branch })
        : t("prescribing.stock.outHere", { branch: lookup.branch })
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5",
        compact && "gap-1"
      )}
      data-testid={testId}
      data-status={view.status}
      data-local={view.local}
      data-on-hand={view.onHand}
    >
      <StatusPill
        tone={LOCAL_TONE[view.local]}
        dot
        className={compact ? "h-5 px-2 text-[0.6875rem]" : undefined}
      >
        {label}
        {view.local !== "out" ? (
          <span className="nums opacity-80">
            ·{" "}
            {t("prescribing.stock.units", {
              count: num(view.onHand),
              unit: unitText(brand.unitLabel, view.onHand, locale),
            })}
          </span>
        ) : null}
        {lookup.asAt !== undefined ? (
          <span className="font-normal opacity-75">
            {t("prescribing.stock.asAt", { time: time(lookup.asAt) })}
          </span>
        ) : null}
      </StatusPill>
      {!compact && view.local !== "in-stock" ? (
        lookup.offline ? (
          <StatusPill tone="muted">{t("prescribing.stock.offline")}</StatusPill>
        ) : (
          view.otherBranches.map((code) => (
            <StatusPill
              key={code}
              tone="info"
              dot
              data-testid="rx-stock-other"
              data-branch={code}
            >
              {t("common.stock.atBranch", {
                branch: `${branchName(code, locale)} (${code})`,
              })}
              <span className="nums opacity-80">
                · {num(view.byBranch[code].onHand)}
              </span>
            </StatusPill>
          ))
        )
      ) : null}
    </span>
  )
}
