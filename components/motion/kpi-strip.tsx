"use client"

import * as React from "react"
import { motion } from "motion/react"
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react"

import {
  KPI_VARIANTS,
  KpiCard,
  KpiGrid,
  type KpiVariant,
} from "@/components/shared/kpi-card"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { NumberTicker } from "./number-ticker"
import { Sparkline } from "./comb-chart"

export type KpiCell = {
  id: string
  label: string
  value: number
  delta?: number
  prefix?: string
  suffix?: string
  format?: React.ComponentProps<typeof NumberTicker>["format"]
  spark?: number[]
  color?: string
  /** Gradient; defaults to cycling cyan, yellow, pink, purple */
  variant?: KpiVariant
  icon?: LucideIcon
  /** Line under the delta chip, e.g. "vs last month" */
  caption?: string
}

/** Signed percentage on a plain surface (success or destructive tint). */
export function DeltaPill({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  const { num } = useLocale()
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      data-slot="delta-pill"
      className={cn(
        "nums inline-flex h-6 items-center gap-0.5 rounded-full px-2 text-xs font-medium",
        up
          ? "bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-success"
          : "bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] text-destructive",
        className
      )}
    >
      <Icon className="size-3.5" />
      {up ? "+" : ""}
      {num(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
    </span>
  )
}

/**
 * The top KPI row of a screen as gradient cards (docs/ui_guidelines.md §4):
 * animated figures, a delta chip and an optional sparkline. Four across on
 * wide screens, 2x2 in a 960x600 quadrant.
 */
export function KpiStrip({
  cells,
  className,
}: {
  cells: KpiCell[]
  className?: string
}) {
  return (
    <div data-slot="kpi-strip" className={className}>
      <KpiGrid>
        {cells.map((cell, index) => (
          <motion.div
            key={cell.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: index * 0.05 }}
            className="min-w-0"
          >
            <KpiCard
              variant={cell.variant ?? KPI_VARIANTS[index % KPI_VARIANTS.length]}
              icon={cell.icon}
              title={cell.label}
              value={
                <NumberTicker
                  value={cell.value}
                  format={cell.format}
                  prefix={cell.prefix}
                  suffix={cell.suffix}
                />
              }
              delta={cell.delta}
              caption={
                cell.spark ? (
                  <Sparkline
                    values={cell.spark}
                    color={cell.color ?? "currentColor"}
                    className="opacity-70"
                  />
                ) : (
                  cell.caption
                )
              }
              className="h-full"
            />
          </motion.div>
        ))}
      </KpiGrid>
    </div>
  )
}
