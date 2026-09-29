import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { getCentralDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { seedDatabase } from "@/core/seed"
import { SEED_REFS } from "@/core/seed/content"
import { summarise, type ExceptionKind } from "@/modules/dashboards/metrics"
import { loadExceptions } from "@/modules/dashboards/queries"
import { acknowledgeCritical, logCriticalCall } from "@/modules/lab/commands"
import { requestSubstitution } from "@/modules/pharmacy/commands"

import { pathologist } from "../lab/fixtures"
import { shirin } from "../pharmacy/fixtures"

/**
 * The exception tiles on the seeded network (demo clock at 11:30): the
 * planted PO-1038 mismatch and cabin deposit alert, then one record of each
 * other kind created through the real launchers and commands (a held report
 * through a test fixture), counted live with branch and age.
 */

const db = getCentralDb()
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!

async function tile(kind: ExceptionKind, branch: "B1" | "B2" | null = null) {
  return summarise(await loadExceptions(db), kind, branch)
}

/** A signed report still held for payment, as `lab.signAndRelease` leaves an unpaid one. */
const heldReport = defineCommand({
  name: "test.heldReport",
  roles: "any",
  input: z.object({ branch: z.enum(["B1", "B2", "B3", "B4", "B5"]) }),
  async run(tx, input) {
    const report = tx.insert("labReports", {
      reportNo: `RPT-${input.branch}-990001`,
      reportVersion: 1,
      patientId: "pat_0001",
      branchId: input.branch,
      labOrderId: "lo_fixture",
      itemIds: [],
      status: "signed",
      signedBy: "stf_mizanur_rahman",
      signedAt: tx.now(),
      heldForPayment: true,
    })
    return { reportId: report.id }
  },
})

beforeAll(async () => {
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "11:30") - Date.now())
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
}, 60_000)

afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("seeded exceptions", () => {
  it("counts the planted PO-1038 mismatch and the cabin deposit alert, and nothing else open", async () => {
    const mismatch = await tile("mismatch")
    expect(mismatch.count).toBe(1)
    expect(mismatch.oldest).toMatchObject({ branch: "B1" })
    expect(mismatch.oldest!.refs[0]).toBe("PO-1038")
    const deposit = await tile("deposit")
    expect(deposit.count).toBe(1)
    expect(deposit.oldest!.branch).toBe("B1")
    expect(deposit.oldest!.refs[0]).toMatch(/^ADM-B1-/)
    expect(now() - deposit.oldest!.since).toBeGreaterThan(0)
    expect((await tile("criticals")).count).toBe(0)
    expect((await tile("held")).count).toBe(0)
    expect((await tile("awaiting")).count).toBe(0)
    expect((await tile("mismatch", "B2")).count).toBe(0)
  })
})

describe("live exceptions", () => {
  it("counts a critical result until its call is acknowledged", async () => {
    const { outcome } = await runScenario(scenario("S7"))
    const resultId = outcome.refs!.resultId!
    let criticals = await tile("criticals")
    expect(criticals.count).toBe(1)
    expect(criticals.oldest).toMatchObject({ id: resultId, branch: "B1" })
    expect(criticals.oldest!.refs[0]).toMatch(/^LO-B1-/)

    // A call logged but not acknowledged still needs attention.
    const { result: call } = await commit(
      logCriticalCall,
      {
        resultId,
        calledPerson: "Dr. Kamal Hossain",
        calledRole: "ordering-doctor",
        readBack: true,
        readBackText: "read back",
      },
      { db, actor: pathologist }
    )
    criticals = await tile("criticals")
    expect(criticals.count).toBe(1)
    expect(criticals.oldest!.id).toBe(call.callId)

    await commit(acknowledgeCritical, { callId: call.callId }, { db, actor: pathologist })
    expect((await tile("criticals")).count).toBe(0)
  })

  it("counts a report held for payment at its branch", async () => {
    await commit(heldReport, { branch: "B2" }, { db, actor: SYSTEM_ACTOR })
    const held = await tile("held")
    expect(held.count).toBe(1)
    expect(held.oldest).toMatchObject({ branch: "B2", refs: ["RPT-B2-990001"] })
    expect((await tile("held", "B1")).count).toBe(0)
  })

  it("counts an Rx line waiting for the prescriber's substitution decision", async () => {
    const { outcome } = await runScenario(scenario("S4"))
    await commit(
      requestSubstitution,
      {
        rxLineId: outcome.refs!.rxLineId!,
        proposedBrandId: SEED_REFS.brand.lumona10,
        reason: "Monas 10 is out of stock",
      },
      { db, actor: shirin }
    )
    const awaiting = await tile("awaiting")
    expect(awaiting.count).toBe(1)
    expect(awaiting.oldest!.branch).toBe("B1")
    expect(awaiting.oldest!.refs[0]).toMatch(/^RX-B1-/)
  })
})
