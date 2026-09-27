/**
 * The demo clock (plan §3.8). App time is wall time plus a shared offset held
 * in the control database, so "fast-forward 30 minutes" in one window moves
 * every window. Domain code reads time ONLY through `now()`.
 */

type Listener = () => void

let offsetMs = 0
const listeners = new Set<Listener>()

/** Current demo time in epoch milliseconds. */
export function now(): number {
  return Date.now() + offsetMs
}

export function getClockOffset(): number {
  return offsetMs
}

/**
 * Apply an offset read from the control database. Called by the clock
 * subscription (and by tests); does not persist anything.
 */
export function applyClockOffset(ms: number): void {
  if (ms === offsetMs) return
  offsetMs = ms
  listeners.forEach((listener) => listener())
}

/** Subscribe to offset changes (not to every tick). */
export function onClockChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
