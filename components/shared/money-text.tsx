"use client"

import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Money from integer poisha: ৳ with lakh/crore grouping, Bangla digits in
 * Bangla, tabular figures. `colorize` tints negatives red and (with `signed`)
 * positives green; `signed` adds a leading + to positive amounts.
 */
export function MoneyText({
  poisha,
  signed = false,
  colorize = false,
  className,
}: {
  poisha: number
  signed?: boolean
  colorize?: boolean
  className?: string
}) {
  const { money } = useLocale()
  const text = money(poisha)
  return (
    <span
      data-slot="money-text"
      className={cn(
        "nums whitespace-nowrap tabular-nums",
        colorize && poisha < 0 && "text-destructive",
        colorize && signed && poisha > 0 && "text-success",
        className
      )}
    >
      {signed && poisha > 0 ? "+" : ""}
      {text}
    </span>
  )
}
