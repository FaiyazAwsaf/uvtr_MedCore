"use client"

import * as React from "react"

/**
 * Returns "flash-sync" for about 1.2 s whenever `value` changes after the first
 * render (e.g. a row's `version` bumped by another window's commit), so the
 * row or card tints turquoise: the visual proof of live sync
 * (docs/ui_guidelines.md §5). Put the result in the element's className.
 */
export function useFlashOnChange(value: unknown, durationMs = 1200): string {
  const [flashKey, setFlashKey] = React.useState(0)
  const previous = React.useRef(value)

  React.useEffect(() => {
    if (Object.is(previous.current, value)) return
    previous.current = value
    const start = window.setTimeout(() => setFlashKey((key) => key + 1), 0)
    const stop = window.setTimeout(() => setFlashKey(0), durationMs)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(stop)
    }
  }, [value, durationMs])

  return flashKey > 0 ? "flash-sync" : ""
}
