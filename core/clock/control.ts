import { liveQuery } from "dexie"
import { z } from "zod"

import { getControlDb } from "@/core/db/control"
import { getCentralDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { publish, subscribe } from "@/core/events/bus"

import { applyClockOffset, getClockOffset } from "./clock"

const recordClockChange = defineCommand({
  name: "demo.clockChanged",
  roles: "any",
  input: z.object({ minutes: z.number(), reset: z.boolean() }),
  async run(tx, input) {
    if (input.reset) tx.emit("ClockReset", { branchId: null })
    else
      tx.emit("ClockAdvanced", {
        branchId: null,
        params: { minutes: input.minutes },
      })
  },
})

async function persistOffset(offsetMs: number): Promise<void> {
  await getControlDb().clock.put({ id: "clock", offsetMs, updatedAt: Date.now() })
  applyClockOffset(offsetMs)
  publish({ kind: "clock", offsetMs })
}

/** Fast-forward the shared demo clock (every window moves with it). */
export async function advanceClock(deltaMs: number): Promise<void> {
  await persistOffset(getClockOffset() + deltaMs)
  await commit(
    recordClockChange,
    { minutes: Math.round(deltaMs / 60_000), reset: false },
    { db: getCentralDb(), actor: SYSTEM_ACTOR }
  )
}

/** Return the demo clock to real time. */
export async function resetClock(): Promise<void> {
  await persistOffset(0)
  await commit(
    recordClockChange,
    { minutes: 0, reset: true },
    { db: getCentralDb(), actor: SYSTEM_ACTOR }
  )
}

/**
 * Keep this window's clock offset in step with the control database. Call
 * once per window (the ClockProvider does). Returns an unsubscribe function.
 */
export function startClockSync(): () => void {
  const subscription = liveQuery(() => getControlDb().clock.get("clock")).subscribe({
    next: (row) => applyClockOffset(row?.offsetMs ?? 0),
    error: (error) => console.warn("clock sync", error),
  })
  const unsubscribeBus = subscribe((message) => {
    if (message.kind === "clock") applyClockOffset(message.offsetMs)
  })
  return () => {
    subscription.unsubscribe()
    unsubscribeBus()
  }
}
