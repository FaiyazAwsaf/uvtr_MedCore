"use client"

import { useNow } from "@/core/clock/useNow"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

export type DateTextVariant =
  | "dmy"
  | "dmyTime"
  | "date"
  | "time"
  | "dateTime"
  | "relative"

/**
 * A date or time in the window's language (Asia/Dhaka, Bangla digits in
 * Bangla). `relative` ("5 minutes ago") is measured from the demo clock and
 * re-renders as it moves. The full date and time is always in the tooltip.
 */
export function DateText({
  value,
  variant = "dmy",
  className,
}: {
  value: number | string | Date
  variant?: DateTextVariant
  className?: string
}) {
  const { dmy, date, time, dateTime, relative } = useLocale()
  // Only relative text needs to tick; the others re-render with their parent.
  useNow(variant === "relative" ? 30_000 : 3_600_000)

  const ms = new Date(value).getTime()
  if (!Number.isFinite(ms)) {
    return <span className={cn("text-muted-foreground", className)}>-</span>
  }

  const text =
    variant === "dmy"
      ? dmy(value)
      : variant === "dmyTime"
        ? `${dmy(value)}, ${time(value)}`
        : variant === "date"
          ? date(value)
          : variant === "time"
            ? time(value)
            : variant === "dateTime"
              ? dateTime(value)
              : relative(value)

  return (
    <time
      data-slot="date-text"
      dateTime={new Date(ms).toISOString()}
      title={`${dmy(value)}, ${time(value)}`}
      className={cn("nums whitespace-nowrap tabular-nums", className)}
    >
      {text}
    </time>
  )
}
