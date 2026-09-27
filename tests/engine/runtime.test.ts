import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { applyClockOffset, getClockOffset, now } from "@/core/clock/clock"
import { advanceClock, resetClock } from "@/core/clock/control"
import { sweepOnce } from "@/core/clock/sweeper"
import type { SweepJob } from "@/core/clock/types"
import { getControlDb } from "@/core/db/control"
import { getCentralDb } from "@/core/db/database"
import { resetDemo } from "@/core/demo/reset"
import { defineCommand } from "@/core/engine/defineCommand"
import { changedFields } from "@/core/engine/invariants"
import { baseFields } from "@/core/db/base"

beforeEach(async () => {
  applyClockOffset(0)
  await resetDemo()
})
afterEach(() => applyClockOffset(0))

describe("demo clock", () => {
  it("fast-forwards for every reader and records the change", async () => {
    const before = now()
    await advanceClock(30 * 60_000)
    expect(getClockOffset()).toBe(30 * 60_000)
    expect(now() - before).toBeGreaterThanOrEqual(30 * 60_000)
    expect((await getControlDb().clock.get("clock"))?.offsetMs).toBe(30 * 60_000)
    const types = (await getCentralDb().events.toArray()).map((e) => e.type)
    expect(types).toContain("ClockAdvanced")
    await resetClock()
    expect(getClockOffset()).toBe(0)
  })
})

describe("sweeper", () => {
  it("runs jobs as the System actor, isolating failures", async () => {
    const mark = defineCommand({
      name: "test.sweepMark",
      roles: [],
      input: z.object({}),
      async run(tx) {
        return tx.nextNumber("swept")
      },
    })
    const jobs: SweepJob[] = [
      {
        id: "broken",
        run: async () => {
          throw new Error("boom")
        },
      },
      { id: "marker", run: async (ctx) => void (await ctx.commitSystem(mark, {})) },
    ]
    await sweepOnce([getCentralDb()], jobs)
    expect((await getCentralDb().counters.get("swept"))?.value).toBe(1)
  })
})

describe("change detection", () => {
  it("ignores key order inside nested values", () => {
    type WithPayload = ReturnType<typeof baseFields> & { payload: Record<string, number> }
    const a: WithPayload = { ...baseFields("x", 1), payload: { a: 1, b: 2 } }
    const b: WithPayload = { ...baseFields("x", 1), payload: { b: 2, a: 1 } }
    expect(changedFields(a, b)).toEqual([])
    const c: WithPayload = { ...b, payload: { a: 1, b: 3 } }
    expect(changedFields(a, c)).toEqual(["payload"])
  })
})
