import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import type { Actor } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { boardSessions, boardView } from "@/modules/queue/board"
import { callToken, checkIn, walkIn } from "@/modules/queue/commands"
import { bookAppointment } from "@/modules/scheduling/commands"
import { freeSlotTimes, sessionLoad } from "@/modules/scheduling/slots"

const reception: Actor = {
  staffId: "stf_farhana_akter",
  personaId: "per_reception_farhana",
  role: "receptionist",
  branchId: "B1",
  name: "Farhana Akter",
  authorities: [],
}

const SESSION = SEED_REFS.session.kamalToday
let db: MedcoreDb

beforeAll(async () => {
  // The demo opens at 11:30 in Dhaka (rules.simulated.clinicTime), mid-clinic.
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "11:30") - Date.now())
  db = new MedcoreDb("front-desk-test")
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
})
afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("the hero front desk story", () => {
  it("offers Dr. Kamal's free future slots and the places left", async () => {
    const session = await db.sessions.get(SESSION)
    const appointments = await db.appointments.where("sessionId").equals(SESSION).toArray()
    // Walk-ins take no slot, so the seeded walk-in leaves 12:50 bookable.
    expect(freeSlotTimes(session!, appointments, now())).toEqual([
      "11:50",
      "12:00",
      "12:20",
      "12:40",
      "12:50",
    ])
    expect(sessionLoad(session!, appointments)).toMatchObject({ bookedLeft: 2, walkInLeft: 4 })
  })

  it("books Abdul Karim at a free slot, then checks him in by QR as M-7", async () => {
    const booked = await commit(
      bookAppointment,
      { sessionId: SESSION, patientId: HERO.patient.abdulKarim, source: "counter", slotStart: "11:50" },
      { db, actor: reception }
    )
    const appointment = await db.appointments.get(booked.result.appointmentId)
    expect(appointment).toMatchObject({ slotStart: "11:50", status: "booked", qrCode: booked.result.qrCode })
    expect(booked.result.qrCode).toBe(`MC|APT|${booked.result.appointmentId}`)
    expect(booked.events[0].params).toMatchObject({ doctor: "Dr. Kamal Hossain", time: "11:50", source: "counter" })

    const notes = await db.notifications.where("patientId").equals(HERO.patient.abdulKarim).toArray()
    expect(notes.map((n) => n.titleKey)).toContain("patientApp.notifications.appointmentBooked")

    const checked = await commit(
      checkIn,
      { appointmentId: booked.result.appointmentId, method: "qr" },
      { db, actor: reception }
    )
    expect(checked.result.label).toBe("M-7")
    expect(checked.events.map((e) => [e.type, e.params.method ?? e.params.room])).toEqual([
      ["PatientCheckedIn", "qr"],
      ["TokenIssued", "3"],
    ])

    const tokens = await db.queueTokens.where("sessionId").equals(SESSION).toArray()
    const view = boardView(tokens)
    expect(view.serving).toBeUndefined()
    expect(view.next.map((t) => t.label)).toEqual(["M-3", "M-4"])
    expect(view.waiting.map((t) => t.label)).toEqual(["M-5", "M-6", "M-7"])

    const sessions = await db.sessions.where("[branchId+date]").equals(["B1", dhakaDate(now())]).toArray()
    const byId = new Map<string, typeof tokens>()
    for (const t of await db.queueTokens.where("branchId").equals("B1").toArray()) {
      byId.set(t.sessionId, [...(byId.get(t.sessionId) ?? []), t])
    }
    expect(boardSessions(sessions, byId, now()).map((s) => s.id)).toContain(SESSION)
  })

  it("issues a walk-in token in one commit, interleaved after two booked tokens", async () => {
    const before = await db.sms.count()
    const { result, events } = await commit(
      walkIn,
      { sessionId: SESSION, patientId: HERO.patient.rokeyaBegum },
      { db, actor: reception }
    )
    expect(result.label).toBe("M-8")
    expect(events.map((e) => e.type)).toEqual(["AppointmentBooked", "PatientCheckedIn", "TokenIssued"])
    const appointment = await db.appointments.get(result.appointmentId)
    expect(appointment).toMatchObject({ source: "walk-in", status: "checked-in", tokenId: result.tokenId })
    // A walk-in gets a printed token, not a booking SMS.
    expect(await db.sms.count()).toBe(before)
    const tokens = await db.queueTokens.where("sessionId").equals(SESSION).toArray()
    const order = tokens.sort((a, b) => a.position - b.position).map((t) => t.label)
    // Booked M-1, M-2, walk-in M-3, booked M-4, M-5, walk-in M-8, booked M-6, M-7.
    expect(order).toEqual(["M-1", "M-2", "M-3", "M-4", "M-5", "M-8", "M-6", "M-7"])
  })

  it("calls a token and tells the patient app, without health data", async () => {
    const token = (await db.queueTokens.where("sessionId").equals(SESSION).toArray()).find(
      (t) => t.patientId === HERO.patient.abdulKarim
    )!
    const { events } = await commit(callToken, { tokenId: token.id }, { db, actor: reception })
    expect(events[0]).toMatchObject({ type: "TokenCalled", params: { token: "M-7", room: "3" } })
    const called = (await db.notifications.where("patientId").equals(HERO.patient.abdulKarim).toArray()).find(
      (n) => n.titleKey === "patientApp.notifications.tokenCalled"
    )
    expect(called?.params).toEqual({ token: "M-7", room: "3" })
    const view = boardView(await db.queueTokens.where("sessionId").equals(SESSION).toArray())
    expect(view.serving?.label).toBe("M-7")
  })

  it("refuses a second booking in the same session and a walk-in on another day", async () => {
    await expect(
      commit(bookAppointment, { sessionId: SESSION, patientId: HERO.patient.abdulKarim, source: "call" }, { db, actor: reception })
    ).rejects.toMatchObject({ code: "ALREADY_BOOKED" })
    const tomorrow = (await db.sessions.where("doctorId").equals(HERO.doctor.kamal).toArray()).find(
      (s) => s.date > dhakaDate(now()) && s.status === "open"
    )
    expect(tomorrow).toBeDefined()
    await expect(
      commit(walkIn, { sessionId: tomorrow!.id, patientId: HERO.patient.tanvirKarim }, { db, actor: reception })
    ).rejects.toMatchObject({ code: "WALK_IN_NOT_TODAY" })
  })
})
