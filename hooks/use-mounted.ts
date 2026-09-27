"use client"

import * as React from "react"

const subscribeNever = () => () => {}

/**
 * Anything that reads from browser storage (theme, locale, IndexedDB) only
 * knows its real value on the client. Gate those renders instead of letting
 * the server and client disagree: false during SSR and hydration, true after.
 */
export function useMounted() {
  return React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )
}
