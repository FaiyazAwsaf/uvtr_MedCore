"use client"

import * as React from "react"

import { now, onClockChange } from "./clock"

/**
 * Demo-clock time that re-renders every `intervalMs` and immediately after a
 * fast-forward. Returns 0 during server render and hydration.
 */
export function useNow(intervalMs = 1000): number {
  const subscribeTick = React.useCallback(
    (onChange: () => void) => {
      const timer = setInterval(onChange, intervalMs)
      const off = onClockChange(onChange)
      return () => {
        clearInterval(timer)
        off()
      }
    },
    [intervalMs]
  )
  return React.useSyncExternalStore(
    subscribeTick,
    () => Math.floor(now() / intervalMs) * intervalMs,
    () => 0
  )
}
