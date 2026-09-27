"use client"

import { branches, type BranchCode } from "@/config/brand.config"
import { StatusPill, type Tone } from "@/components/shared/status"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

export type StockStatus =
  | "in-stock"
  | "low"
  | "out"
  | "other-branch"
  | "unavailable-offline"

const TONE: Record<StockStatus, Tone> = {
  "in-stock": "success",
  low: "warning",
  out: "destructive",
  "other-branch": "info",
  "unavailable-offline": "muted",
}

/**
 * Stock availability pill (docs/ui_guidelines.md §4): In stock (success),
 * Low (warning), Out (destructive), At another branch (info) and Unavailable
 * offline (muted, HAZ-15). Staff screens may pass `qty`; the patient app shows
 * status only (plan §11). While offline, pass `asAt` for "as at HH:mm".
 */
export function StockBadge({
  status,
  qty,
  branch,
  asAt,
  className,
}: {
  status: StockStatus
  /** On-hand quantity (staff screens only) */
  qty?: number
  /** For "other-branch": which branch holds it */
  branch?: BranchCode
  /** Snapshot time of the figures while the branch is offline */
  asAt?: number
  className?: string
}) {
  const { t, num, time, locale } = useLocale()
  const branchName = branch
    ? branches.find((b) => b.code === branch)?.name[locale]
    : undefined

  const label =
    status === "in-stock"
      ? t("common.stock.inStock")
      : status === "low"
        ? t("common.stock.low")
        : status === "out"
          ? t("common.stock.out")
          : status === "other-branch"
            ? branchName
              ? t("common.stock.atBranch", { branch: branchName })
              : t("common.stock.otherBranch")
            : t("common.stock.unavailableOffline")

  const showQty =
    qty !== undefined && (status === "in-stock" || status === "low" || status === "other-branch")

  return (
    <StatusPill
      data-slot="stock-badge"
      tone={TONE[status]}
      dot
      className={cn("gap-1.5", className)}
    >
      {label}
      {showQty ? <span className="nums opacity-80">· {num(qty)}</span> : null}
      {asAt !== undefined ? (
        <span className="font-normal opacity-75">
          {t("common.stock.asAt", { time: time(asAt) })}
        </span>
      ) : null}
    </StatusPill>
  )
}
