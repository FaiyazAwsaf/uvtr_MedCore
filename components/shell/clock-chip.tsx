"use client"

import * as React from "react"
import { Clock3 } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getClockOffset } from "@/core/clock/clock"
import { useNow } from "@/core/clock/useNow"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

const MINUTE = 60_000

/**
 * Demo clock chip: the demo date and time (the shared demo clock, so a
 * fast-forward in any window moves it), plus a "+1h 15m" tag while the demo is
 * ahead of real time. The demo panel owns the controls.
 */
export function ClockChip({ className }: { className?: string }) {
  const { t, date, time, num } = useLocale()
  const nowMs = useNow(1000)
  const offset = getClockOffset()

  const offsetText = React.useMemo(() => {
    if (Math.abs(offset) < MINUTE) return null
    let minutes = Math.round(Math.abs(offset) / MINUTE)
    const days = Math.floor(minutes / 1440)
    minutes -= days * 1440
    const hours = Math.floor(minutes / 60)
    minutes -= hours * 60
    const parts = [
      days ? `${num(days)}${t("shell.clock.units.d")}` : null,
      hours ? `${num(hours)}${t("shell.clock.units.h")}` : null,
      minutes ? `${num(minutes)}${t("shell.clock.units.m")}` : null,
    ].filter(Boolean)
    return `${offset < 0 ? "-" : "+"}${parts.join(" ")}`
  }, [offset, num, t])

  if (!nowMs) return null

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            data-slot="clock-chip"
            tabIndex={0}
            aria-label={t("shell.clock.label")}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-md bg-card px-3 text-[0.8125rem] shadow-(--card-shadow) outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              offsetText && "ring-1 ring-primary/50",
              className
            )}
          />
        }
      >
        <Clock3 className="size-4 shrink-0 text-primary" />
        <span className="hidden text-muted-foreground @min-[60rem]/topbar:inline">
          {date(nowMs, { weekday: "short", day: "numeric", month: "short" })}
        </span>
        <span className="nums font-semibold whitespace-nowrap tabular-nums">
          {time(nowMs)}
        </span>
        {offsetText ? (
          <span className="nums hidden rounded-full bg-primary-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap text-link @min-[52rem]/topbar:inline">
            {offsetText}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {offsetText
          ? t(offset < 0 ? "shell.clock.behind" : "shell.clock.ahead", {
              offset: offsetText.replace(/^[+-]/, ""),
            })
          : t("shell.clock.realTime")}
      </TooltipContent>
    </Tooltip>
  )
}
