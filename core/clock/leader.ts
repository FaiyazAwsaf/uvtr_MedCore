import { LEADER_LOCK } from "@/core/engine/locks"

/**
 * Run `start` in exactly one window at a time (plan §3.8). The window holding
 * the Web Lock `mc:leader` runs the sweeper; when it closes, the lock passes
 * to the next window in line. Returns a function that steps down.
 */
export function runWhileLeader(start: () => () => void): () => void {
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined
  if (!locks?.request) {
    const stop = start()
    return stop
  }
  const controller = new AbortController()
  let release: (() => void) | null = null
  let stop: (() => void) | null = null
  locks
    .request(LEADER_LOCK, { signal: controller.signal }, () => {
      stop = start()
      return new Promise<void>((resolve) => {
        release = resolve
      })
    })
    .catch(() => {
      // Aborted before acquiring: this window never led.
    })
  return () => {
    controller.abort()
    stop?.()
    release?.()
  }
}
