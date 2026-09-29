import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { verifyChain } from "@/core/audit/verify"
import { applyClockOffset } from "@/core/clock/clock"
import { getControlDb } from "@/core/db/control"
import { getCentralDb } from "@/core/db/database"
import { resetDemo } from "@/core/demo/reset"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { cutBranch } from "@/core/sync/offline"
import { reconnectBranch } from "@/core/sync/replay"

/**
 * A presenter may launch other scenarios while Dhanmondi is still offline
 * after S14: every launcher must still set up, on the branch's own store.
 */

beforeAll(async () => {
  await resetDemo()
  await cutBranch("B1")
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

describe("launchers while B1 is offline", () => {
  const ids = SCENARIOS.map((s) => s.id).filter((id) => id !== "S15")
  for (const id of ids) {
    it(`${id} sets up`, async () => {
      const scenario = SCENARIOS.find((s) => s.id === id)!
      const { route } = await runScenario(scenario)
      expect(route.startsWith("/")).toBe(true)
    }, 60_000)
  }

  it("replays all of it onto central when B1 reconnects", async () => {
    const outcome = await reconnectBranch("B1")
    expect(outcome.count).toBeGreaterThan(0)
    expect(outcome.edgeChainOk).toBe(true)
    expect((await getControlDb().network.get("B1"))?.status).toBe("online")
    expect(await verifyChain(getCentralDb())).toMatchObject({ ok: true })
  }, 60_000)
})
