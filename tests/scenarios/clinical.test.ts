import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset } from "@/core/clock/clock"
import { getCentralDb } from "@/core/db/database"
import { resetDemo } from "@/core/demo/reset"
import { commit } from "@/core/engine/commit"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { SEED_REFS } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"
import {
  dispatchTransfer,
  receiveTransfer,
  requestTransfer,
} from "@/modules/inventory/commands"

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!
const db = getCentralDb()

async function zimaxAtB1(): Promise<number> {
  const levels = await db.stockLevels
    .where("[branchId+brandId]")
    .equals(["B1", SEED_REFS.brand.zimax500])
    .toArray()
  return levels.reduce((sum, level) => sum + level.qty, 0)
}

beforeAll(async () => {
  await resetDemo()
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

describe("S2 out of stock", () => {
  it("opens a fresh encounter with Zimax 500 out at Dhanmondi, even after a transfer restocked it", async () => {
    const first = await runScenario(scenario("S2"))
    expect(await zimaxAtB1()).toBe(0)
    const encounter = (await db.encounters.get(
      first.outcome.refs!.encounterId!
    ))!
    expect(encounter.status).toBe("open")
    expect(first.route).toBe(`/doctor/encounter/${encounter.id}`)

    // A presenter completes a B3 to B1 transfer between runs.
    const jahid = actorFor(findPersona("per_pharmacist_jahid")!)
    const shirin = actorFor(findPersona("per_pharmacist_shirin")!)
    const requested = await commit(
      requestTransfer,
      {
        fromBranchId: "B3",
        toBranchId: "B1",
        lines: [{ brandId: SEED_REFS.brand.zimax500, qty: 30 }],
        requestedFrom: "pharmacy",
      },
      { db, actor: shirin }
    )
    const transferId = requested.result.transferId
    await commit(dispatchTransfer, { transferId }, { db, actor: jahid })
    const lines = await db.transferLines
      .where("transferId")
      .equals(transferId)
      .toArray()
    await commit(
      receiveTransfer,
      {
        transferId,
        lines: lines.map((line) => ({
          transferLineId: line.id,
          qtyReceived: line.qtyDispatched,
        })),
      },
      { db, actor: shirin }
    )
    expect(await zimaxAtB1()).toBeGreaterThan(0)

    const second = await runScenario(scenario("S2"))
    expect(await zimaxAtB1()).toBe(0)
    expect(second.outcome.refs!.encounterId).not.toBe(
      first.outcome.refs!.encounterId
    )
  }, 60_000)
})

describe("S4D doctor window", () => {
  it("needs no setup and opens the doctor's inbox", async () => {
    const { route } = await runScenario(scenario("S4D"))
    expect(route).toBe("/doctor/inbox")
  })
})
