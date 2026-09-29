import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { getCentralDb } from "@/core/db/database"
import {
  advanceLab,
  openEncounter,
  orderTests,
  payLines,
  pickPatient,
  signedRx,
} from "@/core/scenarios/fixtures"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import type { ScenarioDef } from "@/core/scenarios/types"
import { seedDatabase } from "@/core/seed"
import { SEED_REFS } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"

const db = getCentralDb()

beforeAll(async () => {
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "11:30") - Date.now())
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
}, 60_000)

afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

/** A launcher built only from the shared fixtures: a paid Rx and a released CBC. */
const sample: ScenarioDef = {
  id: "T1",
  kind: "scenario",
  module: "demo",
  titleKey: "demo.scenarios.title",
  persona: "per_pharmacist_shirin",
  cueKeys: [],
  async setup(kit) {
    const patient = await pickPatient(kit, {
      branch: "B1",
      minAge: 18,
      noAllergies: true,
      selfPay: true,
    })
    const encounterId = await openEncounter(kit, { patientId: patient.id })
    const rx = await signedRx(kit, {
      encounterId,
      lines: [
        {
          brandId: SEED_REFS.brand.ace500,
          dosePattern: "1+0+1",
          mealTiming: "after",
          durationDays: 5,
        },
      ],
    })
    const order = await orderTests(kit, {
      patientId: patient.id,
      encounterId,
      testIds: [SEED_REFS.test.cbc],
    })
    const lines = await db.basketLines
      .where("[patientId+status]")
      .equals([patient.id, "open"])
      .toArray()
    await payLines(kit, {
      patientId: patient.id,
      basketLineIds: lines.map((l) => l.id),
      tender: "bkash",
    })
    const lab = await advanceLab(kit, {
      labOrderId: order.labOrderId,
      to: "released",
    })
    return {
      refs: { patientId: patient.id, rxId: rx.rxId, reportId: lab.reportId },
      params: { rxNo: rx.rxNo, name: patient.nameEn },
    }
  },
  route: ({ refs }) => `/pharmacy/dispense/${refs?.rxId}`,
}

describe("scenario runtime", () => {
  it("runs a setup through real commands and records the run, twice in a row", async () => {
    for (let run = 1; run <= 2; run++) {
      const { outcome, route } = await runScenario(sample)
      const rxId = outcome.refs!.rxId!
      expect(route).toBe(`/pharmacy/dispense/${rxId}`)

      const rx = (await db.prescriptions.get(rxId))!
      expect(rx.status).toBe("signed")
      const [line] = await db.rxLines.where("rxId").equals(rxId).toArray()
      expect(line.paymentCleared).toBe(true)
      expect(await db.pharmacyQueue.where("rxId").equals(rxId).count()).toBe(1)

      const report = (await db.labReports.get(outcome.refs!.reportId!))!
      expect(report.status).toBe("released")

      const runs = await db.scenarioRuns
        .where("scenarioId")
        .equals("T1")
        .toArray()
      expect(runs).toHaveLength(run)
      expect(runs.some((r) => r.refs.rxId === rxId)).toBe(true)
    }
  }, 60_000)

  it("keeps setup payments off the hero cashier's shift", async () => {
    const rafiq = findPersona("per_cashier_rafiq")!.staff!.id
    const nasrin = findPersona("per_cashier_nasrin")!.staff!.id
    const payments = await db.payments.toArray()
    const invoices = new Map(
      (await db.invoices.toArray()).map((i) => [i.id, i])
    )
    const setupInvoices = payments
      .map((p) => invoices.get(p.invoiceId))
      .filter((i) => i && i.createdBy === nasrin)
    expect(setupInvoices.length).toBeGreaterThan(0)
    expect(setupInvoices.every((i) => i!.createdBy !== rafiq)).toBe(true)
  })

  it("registers only launchers whose persona exists and whose ids are unique", () => {
    const ids = SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const scenario of SCENARIOS) {
      expect(findPersona(scenario.persona), scenario.id).toBeDefined()
      expect(scenario.cueKeys.length, scenario.id).toBeGreaterThan(0)
    }
  })
})
