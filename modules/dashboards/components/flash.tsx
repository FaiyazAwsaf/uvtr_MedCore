"use client"

import * as React from "react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"

/**
 * Counts the changes of a live value within one scope (period, branch): 0
 * until the value changes after its first load, then +1 per change. A new
 * scope (the presenter switching period) is not a change and never flashes.
 * Previous values are held in state and compared during render, the React
 * pattern for deriving state from changing props.
 */
export function useChangeCount(value: unknown, scope: string): number {
  const [seen, setSeen] = React.useState<{
    value: unknown
    scope: string
    count: number
  }>({ value, scope, count: 0 })
  if (seen.value !== value || seen.scope !== scope) {
    const changed =
      seen.scope === scope && seen.value !== undefined && value !== undefined
    setSeen({ value, scope, count: changed ? seen.count + 1 : seen.count })
  }
  return seen.count
}

/**
 * The sync flash (docs/ui_guidelines.md §5): a turquoise tint that fades in
 * about 1.2 s, plus a fading ring so it also shows on a gradient KPI card.
 * Place it inside a `relative` box; it re-plays whenever `count` grows.
 */
export function SyncFlash({
  count,
  className,
}: {
  count: number
  className?: string
}) {
  if (!count) return null
  return (
    <motion.span
      key={count}
      aria-hidden
      data-slot="sync-flash"
      initial={{ boxShadow: "inset 0 0 0 2px rgb(255 255 255 / 0.85)" }}
      animate={{ boxShadow: "inset 0 0 0 2px rgb(255 255 255 / 0)" }}
      transition={{ duration: 1.2, ease: "easeOut" }}
      className={cn(
        "flash-sync pointer-events-none absolute inset-0 z-10 rounded-[inherit]",
        className
      )}
    />
  )
}
