"use client"

import * as React from "react"

import { useNow } from "@/core/clock/useNow"
import type { AppointmentRow, HHMM, SessionRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { sessionLoad, slotGrid, type SlotState } from "../slots"

const STATE_CLASS: Record<SlotState, string> = {
  free: "border-border/80 bg-transparent text-foreground hover:border-primary hover:bg-primary-soft",
  taken: "border-transparent bg-surface-raised text-muted-foreground line-through decoration-muted-foreground/60",
  past: "border-transparent bg-transparent text-muted-foreground/60",
  full: "border-dashed border-border/70 bg-transparent text-muted-foreground",
}

/**
 * The slot grid of one session (the one scheduler, PRD §10.2): free, taken,
 * past and full slots, with the walk-in places left. Uses exactly the rules
 * `scheduling.book` enforces. No patient names, so the patient app can use
 * it too.
 */
export function SlotGrid({
  session,
  appointments,
  value,
  onChange,
  showCapacity = true,
  className,
}: {
  session: SessionRow
  appointments: AppointmentRow[]
  value: HHMM | null
  onChange: (slot: HHMM) => void
  showCapacity?: boolean
  className?: string
}) {
  const { t, num, time } = useLocale()
  const nowMs = useNow(30_000)
  const slots = React.useMemo(
    () => (nowMs ? slotGrid(session, appointments, nowMs) : []),
    [session, appointments, nowMs]
  )
  const load = sessionLoad(session, appointments)
  const free = slots.filter((s) => s.state === "free").length

  return (
    <div data-testid="slot-grid" className={cn("@container/slots flex flex-col gap-3", className)}>
      <div
        role="radiogroup"
        aria-label={t("scheduling.slots.label")}
        className="grid grid-cols-3 gap-1.5 @[22rem]/slots:grid-cols-4 @[32rem]/slots:grid-cols-6"
      >
        {slots.map((slot) => {
          const selected = slot.time === value && slot.state === "free"
          return (
            <button
              key={slot.time}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid="book-slot"
              data-slot={slot.time}
              data-state={slot.state}
              disabled={slot.state !== "free"}
              title={t(`scheduling.slots.state.${slot.state}`)}
              onClick={() => onChange(slot.time)}
              className={cn(
                "nums h-9 rounded-md border text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed",
                selected
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : STATE_CLASS[slot.state]
              )}
            >
              {time(slot.startsAt)}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="nums font-medium text-foreground">
          {t("scheduling.slots.freeCount", { count: num(free) })}
        </span>
        {showCapacity ? (
          <>
            <span className="nums">
              {t("scheduling.sessions.places", {
                left: num(load.bookedLeft),
                total: num(load.bookedCapacity),
              })}
            </span>
            <span className="nums" data-testid="walkin-left">
              {t("scheduling.sessions.walkIns", { left: num(load.walkInLeft) })}
            </span>
          </>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-3">
          {(["free", "taken", "past", "full"] as const).map((state) => (
            <span key={state} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-sm border", STATE_CLASS[state])} />
              {t(`scheduling.slots.state.${state}`)}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}
