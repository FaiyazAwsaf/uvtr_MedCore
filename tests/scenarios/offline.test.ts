import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset } from "@/core/clock/clock"
import { getControlDb } from "@/core/db/control"
import { getCentralDb, getEdgeDb } from "@/core/db/database"
import { resetDemo } from "@/core/demo/reset"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { reconnectBranch } from "@/core/sync/replay"

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!

beforeAll(async () => {
  await resetDemo()
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

describe("S14 branch offline", () => {
  it("cuts B1 and opens the front desk; running it again changes nothing", async () => {
    for (let run = 0; run < 2; run++) {
      const { route } = await runScenario(scenario("S14"))
      expect(route).toBe("/reception")
      expect((await getControlDb().network.get("B1"))?.status).toBe("offline")
    }
  })
})

describe("S15 reconnect with a duplicate", () => {
  it("queues an offline registration, registers the variant centrally, and the replay sends the pair to review", async () => {
    for (let run = 0; run < 2; run++) {
      const { outcome, route } = await runScenario(scenario("S15"))
      expect(route).toBe("/reception/review")
      const central = getCentralDb()
      const variant = (await central.patients.get(outcome.refs!.patientId!))!
      expect(variant.nameEn).toBe(outcome.params!.variant)
      // The offline registration is on the B1 store only, until B1 reconnects.
      const offline = await getEdgeDb("B1")
        .patients.where("uhid")
        .equals(String(outcome.params!.offlineUhid))
        .first()
      expect(offline?.nameEn).toBe(outcome.params!.name)
      expect(
        await central.patients
          .where("uhid")
          .equals(String(outcome.params!.offlineUhid))
          .count()
      ).toBe(0)

      const replay = await reconnectBranch("B1")
      expect(replay.count).toBeGreaterThan(0)
      const reviews = await central.reviewQueue
        .where("status")
        .equals("open")
        .toArray()
      expect(
        reviews.some(
          (r) =>
            r.kind === "sync-duplicate" && r.patientIds.includes(variant.id)
        )
      ).toBe(true)
    }
  }, 60_000)
})
