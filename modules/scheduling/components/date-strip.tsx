"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { addDaysISO, atDhaka } from "@/core/clock/dates"
import type { ISODate } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Date pills (docs/ui_guidelines.md §4): day name and date, the selected one
 * filled turquoise, chevrons at both ends to page a week at a time. Days with
 * sessions carry a dot.
 */
export function DateStrip({
  from,
  days = 14,
  value,
  onChange,
  marked,
  perPage = 7,
  className,
}: {
  /** First bookable day (today) */
  from: ISODate
  days?: number
  value: ISODate
  onChange: (date: ISODate) => void
  /** Days that have sessions */
  marked?: Set<ISODate>
  perPage?: number
  className?: string
}) {
  const { t, date } = useLocale()
  const all = React.useMemo(
    () => Array.from({ length: days }, (_, i) => addDaysISO(from, i)),
    [from, days]
  )
  const index = Math.max(0, all.indexOf(value))
  const [page, setPage] = React.useState(Math.floor(index / perPage))
  const pages = Math.ceil(all.length / perPage)
  const visible = all.slice(page * perPage, page * perPage + perPage)

  return (
    <div data-testid="date-strip" className={cn("flex items-center gap-1.5", className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("common.previous")}
        disabled={page === 0}
        onClick={() => setPage((p) => Math.max(0, p - 1))}
      >
        <ChevronLeft />
      </Button>
      <div className="grid flex-1 grid-cols-7 gap-1.5">
        {visible.map((day) => {
          const ms = atDhaka(day, "12:00")
          const active = day === value
          return (
            <button
              key={day}
              type="button"
              data-testid="book-date"
              data-date={day}
              aria-pressed={active}
              onClick={() => onChange(day)}
              className={cn(
                "relative flex min-w-0 flex-col items-center gap-0.5 rounded-md py-1.5 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                active
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "bg-surface-raised text-foreground/85 hover:text-foreground"
              )}
            >
              <span className={cn("truncate", !active && "text-muted-foreground")}>
                {day === from ? t("common.today") : date(ms, { weekday: "short" })}
              </span>
              <span className="nums text-sm font-semibold">{date(ms, { day: "numeric" })}</span>
              {marked?.has(day) ? (
                <span
                  className={cn(
                    "absolute bottom-1 size-1 rounded-full",
                    active ? "bg-primary-foreground" : "bg-primary"
                  )}
                />
              ) : null}
            </button>
          )
        })}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("common.next")}
        disabled={page >= pages - 1}
        onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}
