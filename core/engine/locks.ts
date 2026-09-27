/**
 * Cross-window mutual exclusion. The Web Locks API grants a named lock to one
 * holder at a time across every window, tab and iframe of this origin, and
 * queues the rest in FIFO order: that queue is the engine's serial commit
 * order (Isolation). An in-process chain is the fallback where the API is
 * missing.
 */

const chains = new Map<string, Promise<unknown>>()

function inProcess<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(name) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  // Keep the chain alive even when fn rejects.
  chains.set(
    name,
    run.catch(() => undefined)
  )
  return run
}

export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined
  if (locks?.request) {
    return locks.request(name, { mode: "exclusive" }, fn) as Promise<T>
  }
  return inProcess(name, fn)
}

export const commitLockName = (dbName: string) => `mc:commit:${dbName}`
export const LEADER_LOCK = "mc:leader"
