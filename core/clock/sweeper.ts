import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { SYSTEM_ACTOR } from "@/core/engine/types"

import { now, onClockChange } from "./clock"
import { SWEEP_JOBS } from "./registry"
import type { SweepJob } from "./types"

/** Run every job once against each database. Job failures are isolated. */
export async function sweepOnce(
  dbs: MedcoreDb[],
  jobs: SweepJob[] = SWEEP_JOBS
): Promise<void> {
  for (const db of dbs) {
    const ctx = {
      db,
      now: now(),
      commitSystem: ((def, input) =>
        commit(def, input, { db, actor: SYSTEM_ACTOR })) as Parameters<
        SweepJob["run"]
      >[0]["commitSystem"],
    }
    for (const job of jobs) {
      try {
        await job.run(ctx)
      } catch (error) {
        console.warn(`sweep job ${job.id} failed`, error)
      }
    }
  }
}

/**
 * The leader window's background loop: every 2 seconds and right after any
 * demo-clock change. Never overlaps itself.
 */
export function startSweeper(
  getDbs: () => Promise<MedcoreDb[]>,
  intervalMs = 2000
): () => void {
  let running = false
  let stopped = false
  const tick = async () => {
    if (running || stopped) return
    running = true
    try {
      await sweepOnce(await getDbs())
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  const off = onClockChange(() => void tick())
  void tick()
  return () => {
    stopped = true
    clearInterval(timer)
    off()
  }
}
