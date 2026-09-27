"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

export type KpiVariant = "cyan" | "yellow" | "pink" | "purple"

/** The four sample gradients, in the order the sample uses them. */
export const KPI_VARIANTS: KpiVariant[] = ["cyan", "yellow", "pink", "purple"]

export type KpiCardProps = {
  variant?: KpiVariant
  /** Lucide icon component or any node, shown in the circular well */
  icon?: LucideIcon | React.ReactNode
  title: React.ReactNode
  /** The big figure (already formatted, or a <NumberTicker>) */
  value: React.ReactNode
  /** A number renders as a signed percentage chip; any node renders as-is */
  delta?: number | React.ReactNode
  /** Small line under the chip, e.g. "vs last month" */
  caption?: React.ReactNode
  href?: string
  onClick?: () => void
  className?: string
}

function isIconComponent(value: unknown): value is LucideIcon {
  return (
    typeof value === "function" ||
    (typeof value === "object" &&
      value !== null &&
      "$$typeof" in value &&
      "render" in value)
  )
}

/** Signed percentage chip on a KPI card (translucent white pill). */
export function KpiDelta({ value }: { value: number }) {
  const { num } = useLocale()
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="kpi-chip nums inline-flex h-7 items-center gap-1 px-2.5 text-xs font-semibold tabular-nums">
      <Icon className="size-3.5" />
      {up ? "+" : ""}
      {num(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
    </span>
  )
}

/**
 * Gradient KPI card (docs/ui_guidelines.md §4): icon in a circular well at the
 * top left, a title, the big value, a translucent delta chip and a caption.
 * Only for the top KPI row of a screen, never inside tables or forms.
 */
export function KpiCard({
  variant = "cyan",
  icon,
  title,
  value,
  delta,
  caption,
  href,
  onClick,
  className,
}: KpiCardProps) {
  const Icon = isIconComponent(icon) ? icon : null
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="kpi-well flex size-10 shrink-0 items-center justify-center [&_svg]:size-5">
            {Icon ? <Icon /> : (icon as React.ReactNode)}
          </span>
        ) : null}
        <span className="min-w-0 truncate text-[0.9375rem] leading-snug font-semibold @min-[15rem]/kpi:text-base">
          {title}
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="figure min-w-0 truncate text-[1.75rem] leading-none">
          {value}
        </span>
        {delta !== undefined || caption ? (
          <span className="flex shrink-0 flex-col items-end gap-1.5">
            {typeof delta === "number" ? (
              <KpiDelta value={delta} />
            ) : delta !== undefined ? (
              <span className="kpi-chip inline-flex h-7 items-center px-2.5 text-xs font-semibold">
                {delta}
              </span>
            ) : null}
            {caption ? (
              <span className="text-xs leading-none opacity-80">{caption}</span>
            ) : null}
          </span>
        ) : null}
      </div>
    </>
  )

  const classes = cn(
    "kpi @container/kpi relative flex min-h-[8.25rem] min-w-0 flex-col justify-between gap-4 p-5 transition-transform",
    `kpi-${variant}`,
    (href || onClick) &&
      "cursor-pointer outline-none hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50",
    className
  )

  if (href) {
    return (
      <Link data-slot="kpi-card" href={href} className={classes}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button
        data-slot="kpi-card"
        type="button"
        onClick={onClick}
        className={cn(classes, "text-left")}
      >
        {body}
      </button>
    )
  }
  return (
    <div data-slot="kpi-card" className={classes}>
      {body}
    </div>
  )
}

/**
 * The KPI row: four across on wide screens, a compact 2x2 in a 960x600
 * quadrant, one column when very narrow (container widths).
 */
export function KpiGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div data-slot="kpi-grid" className="@container/kpis">
      <div
        className={cn(
          "grid grid-cols-1 gap-4 @min-[26rem]/kpis:grid-cols-2 @min-[66rem]/kpis:grid-cols-4 @min-[66rem]/kpis:gap-5",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}
