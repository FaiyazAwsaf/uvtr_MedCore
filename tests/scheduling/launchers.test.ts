import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset } from "@/core/clock/clock"
import { getCentralDb } from "@/core/db/database"
import { resetDemo } from "@/core/demo/reset"
import { commit } from "@/core/engine/commit"
import { SCENARIOS } from "@/core/scenarios/registry"
import { runScenario } from "@/core/scenarios/runner"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"
import { applyDelayChoice, recordDelay } from "@/modules/scheduling/commands"
import { isAwaiting } from "@/modules/scheduling/delay"
import { isActiveAppointment } from "@/modules/scheduling/slots"

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!
const desk = actorFor(findPersona("per_reception_farhana")!)
const tanvirApp = actorFor(findPersona("per_patient_tanvir")!)
const SESSION = SEED_REFS.session.arifToday
const TANVIR = HERO.patient.tanvirKarim

beforeAll(async () => {
  await resetDemo()
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

describe("S11 doctor delay launcher", () => {
  it("puts Dr. Arif's session back on time with one booking for Tanvir, twice in a row, and the delay records each time", async () => {
    const central = getCentralDb()
    for (let run = 1; run <= 2; run++) {
      const { outcome, route } = await runScenario(scenario("S11"))
      expect(route).toBe(`/reception/delays?session=${SESSION}&r=S11-${run}`)
      expect(outcome.refs?.sessionId).toBe(SESSION)

      const session = (await central.sessions.get(SESSION))!
      expect(session).toMatchObject({ status: "open", delayMin: 0 })
      expect(session.delayReason).toBeUndefined()
      const inSession = await central.appointments
        .where("sessionId")
        .equals(SESSION)
        .toArray()
      const tanvirs = inSession.filter(
        (a) => a.patientId === TANVIR && isActiveAppointment(a)
      )
      expect(tanvirs).toHaveLength(1)
      expect(tanvirs[0].id).toBe(outcome.refs?.appointmentId)
      // No answer from an earlier run is left on the patients still waiting.
      expect(inSession.filter(isAwaiting).every((a) => !a.delayChoice)).toBe(
        true
      )
      expect(outcome.params?.count).toBe(inSession.filter(isAwaiting).length)

      // The presenter's key action: record 45 minutes and send.
      const sent = await commit(
        recordDelay,
        { sessionId: SESSION, minutes: 45, reason: "earlier-session" },
        { db: central, actor: desk }
      )
      expect(sent.result.recipients).toBeGreaterThan(0)
      expect((await central.sessions.get(SESSION))?.status).toBe("delayed")

      // Tanvir answers in the app: rebook on the first run, wait on the second.
      await commit(
        applyDelayChoice,
        { appointmentId: tanvirs[0].id, choice: run === 1 ? "rebook" : "wait" },
        { db: central, actor: tanvirApp }
      )
    }
  }, 60_000)
})
