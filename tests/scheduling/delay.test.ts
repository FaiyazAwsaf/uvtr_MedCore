import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { z } from "zod"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import type { AppointmentRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { RuleViolation } from "@/core/engine/errors"
import type { Actor, CommandDef } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"
import { checkout, openShift } from "@/modules/billing/commands"
import { checkIn } from "@/modules/queue/commands"
import {
  applyDelayChoice,
  bookAppointment,
  recordDelay,
} from "@/modules/scheduling/commands"
import {
  allowedChoices,
  delaySmsPlan,
  isAwaiting,
  smsLangFrom,
  smsNumber,
} from "@/modules/scheduling/delay"

const actor = (personaId: string) => actorFor(findPersona(personaId)!)
const desk = actor("per_reception_farhana")
const mirpurDesk = actor("per_reception_sumon")
const tanvirApp = actor("per_patient_tanvir")
const cashier = actor("per_cashier_nasrin")

const SESSION = SEED_REFS.session.arifToday
const TANVIR = HERO.patient.tanvirKarim

let db: MedcoreDb

async function run<S extends z.ZodType, O>(
  def: CommandDef<S, O>,
  input: z.input<S>,
  as: Actor = desk
): Promise<O> {
  return (await commit(def, input, { db, actor: as })).result
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof RuleViolation) return error.code
    throw error
  }
  throw new Error("expected a refusal")
}

async function waitingInSession(): Promise<AppointmentRow[]> {
  return (await db.appointments.where("sessionId").equals(SESSION).toArray())
    .filter(isAwaiting)
    .sort((a, b) => a.slotStart.localeCompare(b.slotStart))
}

/** Booked appointments of patients other than Tanvir with no choice made yet. */
async function plainBookings(): Promise<AppointmentRow[]> {
  return (await waitingInSession()).filter(
    (a) => a.patientId !== TANVIR && a.status === "booked" && !a.delayChoice
  )
}

/** Booked appointments of patients other than Tanvir, with an open self-pay fee line. */
async function selfPayBookings(): Promise<AppointmentRow[]> {
  const out: AppointmentRow[] = []
  for (const a of await waitingInSession()) {
    if (a.patientId === TANVIR || a.status !== "booked" || !a.feeBasketLineId)
      continue
    const line = await db.basketLines.get(a.feeBasketLineId)
    if (line?.status === "open" && line.payerType === "self" && !a.delayChoice)
      out.push(a)
  }
  return out
}

beforeAll(async () => {
  // Clinic time: Dr. Arif's evening session is still to come.
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "11:30") - Date.now())
  db = new MedcoreDb("scheduling-delay-test")
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
}, 60_000)

afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("scheduling.recordDelay", () => {
  it("is refused for another branch, and choices are refused while the session is on time", async () => {
    const [first] = await waitingInSession()
    expect(
      await refusal(
        run(applyDelayChoice, { appointmentId: first.id, choice: "wait" })
      )
    ).toBe("SESSION_NOT_DELAYED")
    expect(
      await refusal(
        run(
          recordDelay,
          { sessionId: SESSION, minutes: 45, reason: "traffic" },
          mirpurDesk
        )
      )
    ).toBe("SESSION_OTHER_BRANCH")
    expect(allowedChoices(first, false)).toEqual([])
  })

  it("marks the session late and tells every waiting patient by SMS in their language and in the app", async () => {
    await run(bookAppointment, {
      sessionId: SESSION,
      patientId: TANVIR,
      source: "counter",
      smsLang: "en",
    })
    const session = (await db.sessions.get(SESSION))!
    const staff = (await db.staff.get(
      (await db.doctors.get(session.doctorId))!.staffId
    ))!
    const waiting = await waitingInSession()
    const expectedLang = new Map<string, "en" | "bn">()
    for (const a of waiting) {
      const patient = (await db.patients.get(a.patientId))!
      if (smsNumber(patient)) {
        const messages = await db.sms
          .where("patientId")
          .equals(patient.id)
          .toArray()
        expectedLang.set(patient.id, smsLangFrom(messages))
      }
    }
    const plan = delaySmsPlan(
      [...expectedLang.values()].map((lang) => ({ lang })),
      staff,
      45
    )
    const before = now()

    const result = await run(recordDelay, {
      sessionId: SESSION,
      minutes: 45,
      reason: "traffic",
    })

    expect(await db.sessions.get(SESSION)).toMatchObject({
      status: "delayed",
      delayMin: 45,
      delayReason: "traffic",
    })
    expect(result.recipients).toBe(waiting.length)
    const sent = (
      await db.sms.where("queuedAt").aboveOrEqual(before).toArray()
    ).filter((s) => s.templateId === "doctor-delay")
    expect(sent).toHaveLength(plan.messages)
    expect(result.smsCount).toBe(plan.messages)
    // The counter shown before sending is exactly what was queued.
    expect(sent.reduce((sum, s) => sum + s.parts, 0)).toBe(plan.totalParts)
    expect(result.smsParts).toBe(plan.totalParts)
    for (const sms of sent) {
      expect(sms.lang).toBe(expectedLang.get(sms.patientId!))
      expect(sms.text).toBe(plan[sms.lang].text)
      // The doctor and the minutes only: never the reason.
      expect(sms.text).not.toMatch(/traffic|যানজট/i)
      expect(sms.text).toMatch(sms.lang === "bn" ? /৪৫/ : /45/)
    }
    // Tanvir's booking SMS was English, so his delay SMS is English too.
    expect(sent.find((s) => s.patientId === TANVIR)?.lang).toBe("en")
    // Bangla is sent as UCS-2 and needs more parts than English.
    expect(plan.bn.encoding).toBe("UCS-2")
    expect(plan.bn.parts).toBeGreaterThan(plan.en.parts)

    const tanvirApt = waiting.find((a) => a.patientId === TANVIR)!
    const notice = (
      await db.notifications.where("patientId").equals(TANVIR).toArray()
    ).find((n) => n.kind === "doctorDelayed")
    expect(notice).toMatchObject({
      titleKey: "scheduling.notify.doctorDelayed",
      params: { doctor: staff.nameEn, minutes: 45 },
      refs: { appointmentId: tanvirApt.id },
    })
    const events = await db.events
      .where("type")
      .equals("SessionDelayed")
      .toArray()
    expect(events.at(-1)?.params).toMatchObject({
      minutes: 45,
      count: waiting.length,
    })
  })
})

describe("scheduling.applyDelayChoice", () => {
  it("wait keeps the visit; rebook moves it with its open fee line; refund removes an unpaid fee", async () => {
    const [waiter, mover, leaver] = await selfPayBookings()

    await run(applyDelayChoice, { appointmentId: waiter.id, choice: "wait" })
    expect(await db.appointments.get(waiter.id)).toMatchObject({
      status: "booked",
      delayChoice: "wait",
    })

    const feeLineId = mover.feeBasketLineId!
    const openBefore = await db.basketLines
      .where("[patientId+status]")
      .equals([mover.patientId, "open"])
      .count()
    const moved = await run(applyDelayChoice, {
      appointmentId: mover.id,
      choice: "rebook",
    })
    const next = (await db.appointments.get(moved.newAppointmentId!))!
    const nextSession = (await db.sessions.get(next.sessionId))!
    const from = (await db.sessions.get(SESSION))!
    expect(next).toMatchObject({
      patientId: mover.patientId,
      doctorId: mover.doctorId,
      status: "booked",
      feeBasketLineId: feeLineId,
    })
    expect(
      `${nextSession.date} ${nextSession.start}` > `${from.date} ${from.start}`
    ).toBe(true)
    expect(await db.appointments.get(mover.id)).toMatchObject({
      status: "rebooked",
      rebookedToId: next.id,
      delayChoice: "rebook",
    })
    expect(await db.basketLines.get(feeLineId)).toMatchObject({
      status: "open",
      sourceId: next.id,
    })
    // The fee moved; nothing was charged twice.
    expect(
      await db.basketLines
        .where("[patientId+status]")
        .equals([mover.patientId, "open"])
        .count()
    ).toBe(openBefore)

    const refunded = await run(applyDelayChoice, {
      appointmentId: leaver.id,
      choice: "refund",
    })
    expect(refunded.feePaid).toBe(false)
    expect(await db.appointments.get(leaver.id)).toMatchObject({
      status: "cancelled",
      delayChoice: "refund",
    })
    expect((await db.basketLines.get(leaver.feeBasketLineId!))?.status).toBe(
      "removed"
    )

    // A settled appointment has nothing left to choose.
    expect(
      await refusal(
        run(applyDelayChoice, { appointmentId: leaver.id, choice: "wait" })
      )
    ).toBe("APPOINTMENT_NOT_WAITING")
  })

  it("leaves a paid fee for the cashier on refund, and a paid fee stays paid on rebook", async () => {
    const [refundee, rebooker] = await selfPayBookings()
    await run(openShift, { floatP: 500_000 }, cashier)
    for (const a of [refundee, rebooker]) {
      const line = (await db.basketLines.get(a.feeBasketLineId!))!
      await run(
        checkout,
        {
          patientId: a.patientId,
          basketLineIds: [line.id],
          tenders: [{ tender: "cash", amountP: line.qty * line.unitPriceP }],
          idempotencyKey: `delay-test:${line.id}`,
        },
        cashier
      )
      expect((await db.basketLines.get(line.id))?.status).toBe("invoiced")
    }

    const refunded = await run(applyDelayChoice, {
      appointmentId: refundee.id,
      choice: "refund",
    })
    expect(refunded.feePaid).toBe(true)
    expect((await db.basketLines.get(refundee.feeBasketLineId!))?.status).toBe(
      "invoiced"
    )
    expect(await db.appointments.get(refundee.id)).toMatchObject({
      status: "cancelled",
      delayChoice: "refund",
    })

    const moved = await run(applyDelayChoice, {
      appointmentId: rebooker.id,
      choice: "rebook",
    })
    expect(
      (await db.appointments.get(moved.newAppointmentId!))?.feeBasketLineId
    ).toBe(rebooker.feeBasketLineId)
    expect(
      await db.basketLines
        .where("[patientId+status]")
        .equals([rebooker.patientId, "open"])
        .count()
    ).toBe(0)
  })

  it("lets a patient choose in the app for their own appointment only", async () => {
    const own = (await waitingInSession()).find((a) => a.patientId === TANVIR)!
    const stranger = (await plainBookings())[0]
    expect(
      await refusal(
        run(
          applyDelayChoice,
          { appointmentId: stranger.id, choice: "wait" },
          tanvirApp
        )
      )
    ).toBe("NOT_YOUR_APPOINTMENT")
    await run(
      applyDelayChoice,
      { appointmentId: own.id, choice: "wait" },
      tanvirApp
    )
    expect((await db.appointments.get(own.id))?.delayChoice).toBe("wait")
    // Waiting first does not stop a later rebook.
    const moved = await run(
      applyDelayChoice,
      { appointmentId: own.id, choice: "rebook" },
      tanvirApp
    )
    expect(
      (await db.appointments.get(moved.newAppointmentId!))?.patientId
    ).toBe(TANVIR)
  })

  it("lets a checked-in patient only wait", async () => {
    const [target] = await plainBookings()
    await run(checkIn, { appointmentId: target.id, method: "desk" })
    const checkedIn = (await db.appointments.get(target.id))!
    expect(allowedChoices(checkedIn, true)).toEqual(["wait"])
    expect(
      await refusal(
        run(applyDelayChoice, { appointmentId: target.id, choice: "rebook" })
      )
    ).toBe("ALREADY_CHECKED_IN")
    await run(applyDelayChoice, { appointmentId: target.id, choice: "wait" })
    expect((await db.appointments.get(target.id))?.delayChoice).toBe("wait")
  })
})
