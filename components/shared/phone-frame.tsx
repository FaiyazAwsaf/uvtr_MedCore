"use client"

import * as React from "react"
import { BatteryFull, SignalHigh, Wifi } from "lucide-react"

import { useNow } from "@/core/clock/useNow"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * A phone around the patient app (plan §9 `/app`): bezel, island and a status
 * bar with the demo-clock time. Below 30rem wide (a phone-sized window) the
 * frame disappears and the screen fills the window. The screen scrolls
 * inside; its height tracks the window so it fits a 960x600 quadrant.
 */
export function PhoneFrame({
  children,
  className,
  screenClassName,
}: {
  children: React.ReactNode
  className?: string
  /** Classes for the scrolling screen (e.g. a background) */
  screenClassName?: string
}) {
  const { time } = useLocale()
  const nowMs = useNow(15_000)

  return (
    <div
      data-slot="phone-frame"
      className={cn(
        "relative flex h-svh w-full flex-col overflow-hidden bg-background",
        "min-[30rem]:h-[min(52.75rem,calc(100svh-2rem))] min-[30rem]:w-[24.375rem] min-[30rem]:rounded-[3rem] min-[30rem]:border-[0.625rem] min-[30rem]:border-[#101012] min-[30rem]:shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_30px_80px_-20px_rgb(0_0_0/0.6)]",
        className
      )}
    >
      <div className="relative z-20 hidden h-11 shrink-0 items-center justify-between px-7 text-[0.8125rem] font-semibold min-[30rem]:flex">
        <span className="nums tabular-nums">{nowMs ? time(nowMs) : ""}</span>
        <span
          aria-hidden
          className="absolute top-2 left-1/2 h-7 w-[6.5rem] -translate-x-1/2 rounded-full bg-[#101012]"
        />
        <span className="flex items-center gap-1.5 [&_svg]:size-4">
          <SignalHigh />
          <Wifi />
          <BatteryFull />
        </span>
      </div>
      <div
        data-slot="phone-screen"
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
          screenClassName
        )}
      >
        {children}
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-2 left-1/2 hidden h-1.5 w-32 -translate-x-1/2 rounded-full bg-foreground/35 min-[30rem]:block"
      />
    </div>
  )
}
