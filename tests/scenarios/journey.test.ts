import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { applyClockOffset } from "@/core/clock/clock"
import { getCentralDb } from "@/core/db/database"
import { resetDemo } from "@/core/demo/reset"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { HERO, SEED_REFS } from "@/core/seed/content"

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!
const db = getCentralDb()
const ABDUL = HERO.patient.abdulKarim

async function abdulToday() {
  const appointments = (
    await db.appointments
      .where("sessionId")
      .equals(SEED_REFS.session.kamalToday)
      .toArray()
  ).filter((a) => a.patientId === ABDUL)
  const encounters = await db.encounters
    .where("patientId")
    .equals(ABDUL)
    .toArray()
  const today = encounters.filter((e) =>
    appointments.some((a) => a.id === e.appointmentId)
  )
  const rxs = (
    await db.prescriptions.where("patientId").equals(ABDUL).toArray()
  ).filter((rx) => today.some((e) => e.id === rx.encounterId))
  return { appointments, encounters: today, rxs }
}

beforeEach(async () => {
  await resetDemo()
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

describe("jump launchers", () => {
  it("J1 and J2 need no setup and open the front desk and the booking screen", async () => {
    expect((await runScenario(scenario("J1"))).route).toBe("/reception")
    expect((await runScenario(scenario("J2"))).route).toBe(
      `/reception/book?patient=${ABDUL}&doctor=${HERO.doctor.kamal}`
    )
  })

  it("J6 brings the whole visit forward, and running it again does no work twice", async () => {
    const first = await runScenario(scenario("J6"))
    const rxId = first.outcome.refs!.rxId!
    expect(first.route).toBe(`/pharmacy/dispense/${rxId}`)

    const visit = await abdulToday()
    expect(visit.appointments).toHaveLength(1)
    expect(visit.appointments[0].status).toBe("done")
    expect(visit.encounters[0].status).toBe("closed")
    expect(visit.rxs).toHaveLength(1)
    const lines = await db.rxLines.where("rxId").equals(rxId).toArray()
    expect(lines.map((l) => l.brandId).sort()).toEqual(
      [SEED_REFS.brand.ace500, SEED_REFS.brand.azithrocin500].sort()
    )
    expect(lines.every((l) => l.paymentCleared)).toBe(true)
    const specimens = await db.specimens
      .where("patientId")
      .equals(ABDUL)
      .toArray()
    expect(specimens.some((s) => s.status === "awaiting-collection")).toBe(true)
    // Paid by bKash at Rafiq's counter (the hero's cashier).
    const open = await db.basketLines
      .where("[patientId+status]")
      .equals([ABDUL, "open"])
      .toArray()
    expect(open).toHaveLength(0)

    const second = await runScenario(scenario("J6"))
    expect(second.outcome.refs!.rxId).toBe(rxId)
    const again = await abdulToday()
    expect(again.appointments).toHaveLength(1)
    expect(again.rxs).toHaveLength(1)
  }, 60_000)

  it("J3, J4 and J5 step the visit forward one stage at a time", async () => {
    const j3 = await runScenario(scenario("J3"))
    expect(j3.route).toBe("/doctor")
    let visit = await abdulToday()
    expect(visit.appointments[0].status).toBe("checked-in")

    const j4 = await runScenario(scenario("J4"))
    expect(j4.route).toBe(`/cashier?patient=${ABDUL}`)
    visit = await abdulToday()
    expect(visit.appointments[0].status).toBe("done")
    const open = await db.basketLines
      .where("[patientId+status]")
      .equals([ABDUL, "open"])
      .toArray()
    expect(open.map((l) => l.sourceType).sort()).toEqual(
      ["consult", "imaging", "rx-line", "rx-line", "test", "test"].sort()
    )

    const j5 = await runScenario(scenario("J5"))
    expect(j5.route).toBe("/lab")
    expect(
      await db.basketLines
        .where("[patientId+status]")
        .equals([ABDUL, "open"])
        .count()
    ).toBe(0)
  }, 60_000)
})
