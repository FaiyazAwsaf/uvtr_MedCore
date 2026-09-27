import * as React from "react"

const subscribeNever = () => () => {}

/** "⌘" on Apple platforms, "Ctrl" elsewhere, for shortcut hints. */
export function useModKey(): string {
  return React.useSyncExternalStore(
    subscribeNever,
    () => (/mac|iphone|ipad/i.test(navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl"
  )
}
