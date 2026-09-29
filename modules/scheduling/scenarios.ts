import { newId } from "@/core/db/ids"
import type { Id, SessionRow } from "@/core/db/schema"
import { RuleViolation } from "@/core/engine/errors"
import type { NewRow } from "@/core/engine/types"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { bnDigits } from "@/core/seed/content/bn"
import { HERO } from "@/core/seed/content/hero-ids"
import { SEED_REFS } from "@/core/seed/content/seed-refs"

import { appointmentQr, bookAppointment } from "./commands"
import { isAwaiting } from "./delay"
import { isActiveAppointment, slotTimes } from "./slots"

/**
 * S11 doctor delay (plan §10): Dr. Arif's session later today, with its seeded
 * bookings and Tanvir Karim (the patient-app persona) among them, back on
 * time so a delay can be recorded, sent and answered again on every run.
 */

const DESK = "per_reception_farhana"
const SESSION = SEED_REFS.session.arifToday
const TANVIR = HERO.patient.tanvirKarim

/**
 * Put the session back on time: no delay, and no "wait" answers left on the
 * patients still booked (rebooked and refunded visits stay as they are).
 */
async function resetDelay(kit: ScenarioKit): Promise<SessionRow> {
  return kit.fixture("put the session back on time", async (tx) => {
    const session = await tx.get("sessions", SESSION)
    const updated = await tx.update("sessions", session.id, {
      status: "open",
      delayMin: 0,
      delayReason: undefined,
    })
    for (const appointment of await tx.list(
      "appointments",
      "sessionId",
      session.id
    )) {
      if (isAwaiting(appointment) && appointment.delayChoice) {
        await tx.update("appointments", appointment.id, {
          delayChoice: undefined,
        })
      }
    }
    return updated
  })
}

/**
 * Tanvir holds one booking in the session: reused when he still has one,
 * otherwise booked at the counter through the one scheduler. When no slot is
 * left to book (late in the day, or full), he is placed on the last free time.
 */
async function ensureTanvirBooked(
  kit: ScenarioKit,
  session: SessionRow
): Promise<Id> {
  const db = await kit.db()
  const existing = (
    await db.appointments.where("sessionId").equals(session.id).toArray()
  ).find((a) => a.patientId === TANVIR && isActiveAppointment(a))
  if (existing) return existing.id
  try {
    const booked = await kit.run(
      bookAppointment,
      {
        sessionId: session.id,
        patientId: TANVIR,
        source: "counter",
        visitType: "first",
        smsLang: "bn",
      },
      DESK
    )
    return booked.appointmentId
  } catch (error) {
    if (!(error instanceof RuleViolation)) throw error
    return kit.fixture("place Tanvir in the session", async (tx) => {
      const current = await tx.get("sessions", session.id)
      const appointments = await tx.list(
        "appointments",
        "sessionId",
        current.id
      )
      const taken = new Set(
        appointments
          .filter((a) => isActiveAppointment(a) && a.source !== "walk-in")
          .map((a) => a.slotStart)
      )
      const times = slotTimes(current.start, current.end, current.slotMin)
      const slot =
        [...times].reverse().find((time) => !taken.has(time)) ??
        times[times.length - 1]
      const doctor = await tx.get("doctors", current.doctorId)
      const staff = await tx.get("staff", doctor.staffId)
      const appointmentId = newId("apt")
      const fee = tx.insert("basketLines", {
        patientId: TANVIR,
        branchId: current.branchId,
        sourceType: "consult",
        sourceId: appointmentId,
        serviceType: "consultation",
        description: `Consultation: ${staff.nameEn}`,
        descriptionBn: `পরামর্শ: ${staff.nameBn}`,
        doctorId: doctor.id,
        qty: 1,
        unitPriceP: current.feeP,
        status: "open",
        payerType: "self",
      })
      const row: NewRow<"appointments"> = {
        id: appointmentId,
        sessionId: current.id,
        patientId: TANVIR,
        doctorId: doctor.id,
        branchId: current.branchId,
        date: current.date,
        slotStart: slot,
        source: "counter",
        visitType: "first",
        status: "booked",
        bookedBy: kit.actor(DESK).staffId,
        feeBasketLineId: fee.id,
        qrCode: appointmentQr(appointmentId),
      }
      tx.insert("appointments", row)
      return appointmentId
    })
  }
}

export const schedulingScenarios: ScenarioDef[] = [
  {
    id: "S11",
    kind: "scenario",
    module: "scheduling",
    titleKey: "scheduling.scenarios.S11.title",
    summaryKey: "scheduling.scenarios.S11.summary",
    persona: DESK,
    async setup(kit) {
      const db = await kit.db()
      if (!(await db.sessions.get(SESSION))) {
        throw new Error(
          "Dr. Arif's session for today is missing: reset the demo data"
        )
      }
      const session = await resetDelay(kit)
      const appointmentId = await ensureTanvirBooked(kit, session)
      const doctor = await db.doctors.get(session.doctorId)
      const staff = doctor ? await db.staff.get(doctor.staffId) : undefined
      const waiting = (
        await db.appointments.where("sessionId").equals(session.id).toArray()
      ).filter(isAwaiting).length
      const run =
        (await db.scenarioRuns.where("scenarioId").equals("S11").count()) + 1
      return {
        refs: { sessionId: session.id, appointmentId, patientId: TANVIR },
        params: {
          run,
          doctor: staff?.nameEn ?? "",
          doctorBn: staff?.nameBn ?? "",
          time: session.start,
          timeBn: bnDigits(session.start),
          count: waiting,
          countBn: bnDigits(waiting),
        },
      }
    },
    route: ({ params }) =>
      `/reception/delays?session=${SESSION}&r=S11-${params?.run ?? 1}`,
    cueKeys: [
      "scheduling.scenarios.S11.cue.1",
      "scheduling.scenarios.S11.cue.2",
      "scheduling.scenarios.S11.cue.3",
      "scheduling.scenarios.S11.cue.4",
      "scheduling.scenarios.S11.cue.5",
    ],
  },
]
