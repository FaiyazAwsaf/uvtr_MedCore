"use client"

import * as React from "react"

import { StatusPill, StatusText, type Tone } from "@/components/shared/status"
import type {
  Bilingual,
  BrandRow,
  GrnRow,
  PackSize,
  PurchaseOrderRow,
  PurchaseRequestRow,
  VendorInvoiceRow,
} from "@/core/db/schema"
import type { PrTier } from "@/core/procurement/rules"
import { useLocale } from "@/lib/i18n/provider"

import { acceptedOf, pendingOf, poProgress, tierRange, unitsPer } from "../calc"

/* ---------------- Status pills ---------------- */

const PR_TONE: Record<PurchaseRequestRow["status"], Tone> = {
  draft: "muted",
  submitted: "warning",
  approved: "success",
  rejected: "destructive",
  ordered: "primary",
}

export function PrStatusPill({ status }: { status: PurchaseRequestRow["status"] }) {
  const { t } = useLocale()
  return (
    <StatusPill tone={PR_TONE[status]} dot>
      {t(`procurement.prStatus.${status}`)}
    </StatusPill>
  )
}

const PO_TONE: Record<PurchaseOrderRow["status"], Tone> = {
  issued: "info",
  partial: "warning",
  received: "success",
  closed: "muted",
  cancelled: "destructive",
}

export function PoStatusPill({ status }: { status: PurchaseOrderRow["status"] }) {
  const { t } = useLocale()
  return (
    <StatusPill tone={PO_TONE[status]} dot>
      {t(`procurement.poStatus.${status}`)}
    </StatusPill>
  )
}

const VI_TONE: Record<VendorInvoiceRow["status"], Tone> = {
  received: "info",
  matched: "success",
  mismatch: "destructive",
  payable: "success",
  rejected: "muted",
}

export function ViStatusText({ status }: { status: VendorInvoiceRow["status"] }) {
  const { t } = useLocale()
  return (
    <StatusText tone={VI_TONE[status]} dot>
      {t(`procurement.viStatus.${status}`)}
    </StatusText>
  )
}

export function GrnStatusText({ status }: { status: GrnRow["status"] }) {
  const { t } = useLocale()
  return (
    <StatusText tone={status === "complete" ? "success" : "warning"}>
      {t(`procurement.grnStatus.${status}`)}
    </StatusText>
  )
}

/* ---------------- Tiers ---------------- */

/**
 * A tier's name ("Procurement head"), its value range ("৳50,000 to
 * ৳5,00,000"), or both ("Procurement head (৳50,000 to ৳5,00,000)").
 */
export function useTierText() {
  const { t, money } = useLocale()
  return React.useMemo(() => {
    const name = (tier: PrTier) => t(`procurement.tier.${tier}`)
    const range = (tier: PrTier) => {
      const { fromP, belowP } = tierRange(tier)
      if (fromP === 0) return t("procurement.tierRange.below", { max: money(belowP) })
      if (Number.isFinite(belowP)) {
        return t("procurement.tierRange.between", { from: money(fromP), to: money(belowP) })
      }
      return t("procurement.tierRange.above", { from: money(fromP) })
    }
    return { name, range, full: (tier: PrTier) => `${name(tier)} (${range(tier)})` }
  }, [t, money])
}

/* ---------------- Quantities ---------------- */

/** A unit word in the window's language: "tablets" for more than one in English. */
export function unitWord(label: Bilingual | undefined, count: number, locale: "en" | "bn"): string {
  if (!label) return ""
  if (locale !== "en" || count === 1) return label[locale]
  // "suppository" to "suppositories"; "tablet" to "tablets"
  return /[^aeiou]y$/.test(label.en) ? `${label.en.slice(0, -1)}ies` : `${label.en}s`
}

/**
 * How a line's quantity reads: "100 packs of 10 x 10 strip" with a muted
 * "= 10,000 tablets" (packs), or "600 tablets" (loose units).
 */
export function QtyText({
  qty,
  pack,
  brand,
  showUnits = true,
  className,
}: {
  qty: number
  pack?: PackSize
  brand?: Pick<BrandRow, "unitLabel">
  showUnits?: boolean
  className?: string
}) {
  const { t, num, locale } = useLocale()
  if (!pack) {
    return (
      <span className={className}>
        {t("procurement.common.units", {
          count: num(qty),
          unit: unitWord(brand?.unitLabel, qty, locale),
        })}
      </span>
    )
  }
  const units = qty * unitsPer(pack)
  return (
    <span className={className}>
      <span className="nums">
        {t(qty === 1 ? "procurement.common.packsOfOne" : "procurement.common.packsOf", {
          count: num(qty),
          pack: pack.label,
        })}
      </span>
      {showUnits ? (
        <span className="nums block text-xs text-muted-foreground">
          {t("procurement.common.equals", {
            count: num(units),
            unit: unitWord(brand?.unitLabel, units, locale),
          })}
        </span>
      ) : null}
    </span>
  )
}

/** "1 item" or "3 items" in the window's language. */
export function useItemsText() {
  const { t, num } = useLocale()
  return React.useCallback(
    (count: number) =>
      t(count === 1 ? "procurement.common.itemsOne" : "procurement.common.items", {
        count: num(count),
      }),
    [t, num]
  )
}

/** "80 received · 20 pending" for an order line or a whole order. */
export function ProgressText({
  lines,
  className,
  ...props
}: {
  lines: Parameters<typeof poProgress>[0]
  className?: string
} & Omit<React.ComponentProps<"span">, "children">) {
  const { t, num } = useLocale()
  const p = poProgress(lines)
  return (
    <span className={className} {...props}>
      {p.pending > 0
        ? t("procurement.common.progress", { accepted: num(p.accepted), pending: num(p.pending) })
        : t("procurement.common.progressDone", { accepted: num(p.accepted) })}
    </span>
  )
}

/**
 * Ids that appeared after the first render (another window committed them):
 * they flash turquoise for about 1.2 s, the visual proof of live sync.
 */
export function useArrivals(ids: string[] | undefined): Set<string> {
  const known = React.useRef<Set<string> | null>(null)
  const [fresh, setFresh] = React.useState<Set<string>>(new Set())
  const key = ids?.join(",")
  React.useEffect(() => {
    if (key === undefined) return
    const list = key ? key.split(",") : []
    if (!known.current) {
      known.current = new Set(list)
      return
    }
    const added = list.filter((id) => !known.current!.has(id))
    for (const id of added) known.current.add(id)
    if (!added.length) return
    const start = window.setTimeout(() => setFresh(new Set(added)), 0)
    const stop = window.setTimeout(() => setFresh(new Set()), 1400)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(stop)
    }
  }, [key])
  return fresh
}

/** Accepted and pending of one PO line, for tables. */
export function lineProgress(line: Parameters<typeof pendingOf>[0]) {
  return { accepted: acceptedOf(line), pending: pendingOf(line) }
}
