"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { DateText, type DateTextVariant } from "@/components/shared/date-text"
import { TONE_DOT, TONE_TEXT, type Tone } from "@/components/shared/status"
import { cn } from "@/lib/utils"

export type TimelineItem = {
  id: string
  title: React.ReactNode
  description?: React.ReactNode
  /** Demo-clock moment (ms), ISO string or Date */
  at?: number | string | Date
  icon?: LucideIcon
  tone?: Tone
  /** Anything extra on the right of the title (a tag, a link) */
  meta?: React.ReactNode
}

/**
 * A vertical timeline (audit trail, patient 360, report versions): tone dots
 * or icon wells joined by a hairline, the time on the right.
 */
export function Timeline({
  items,
  timeVariant = "dmyTime",
  className,
}: {
  items: TimelineItem[]
  timeVariant?: DateTextVariant
  className?: string
}) {
  return (
    <ol data-slot="timeline" className={cn("relative flex flex-col", className)}>
      {items.map((item, index) => {
        const tone = item.tone ?? "primary"
        const Icon = item.icon
        const last = index === items.length - 1
        return (
          <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last ? (
              <span
                aria-hidden
                className="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 bg-hairline"
              />
            ) : null}
            <span className="relative z-10 flex size-8 shrink-0 items-center justify-center">
              {Icon ? (
                <span
                  className={cn(
                    "icon-well flex size-8 items-center justify-center",
                    TONE_TEXT[tone]
                  )}
                >
                  <Icon className="size-4" />
                </span>
              ) : (
                <span
                  className={cn(
                    "size-2.5 rounded-full ring-4 ring-card",
                    TONE_DOT[tone]
                  )}
                />
              )}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-[0.8125rem] leading-snug font-medium">
                  {item.title}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.meta}
                  {item.at !== undefined ? (
                    <DateText
                      value={item.at}
                      variant={timeVariant}
                      className="text-xs text-muted-foreground"
                    />
                  ) : null}
                </div>
              </div>
              {item.description ? (
                <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </div>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
