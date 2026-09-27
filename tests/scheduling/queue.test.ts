import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import type { Actor } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { HERO } from "@/core/seed/content"
import { callToken, checkIn, recallToken, skipToken } from "@/modules/queue/commands"
import { interleavePositions } from "@/modules/queue/interleave"
import { bookAppointment } from "@/modules/scheduling/commands"

const reception: Actor = {
  staffId: "stf_farhana_akter",
  personaId: "per_reception_farhana",
  role: "receptionist",
  branchId: "B1",
  name: "Farhana Akter",
  authorities: [],
}
const doctor: Actor = {
  staffId: "stf_kamal_hossain",
  personaId: "per_doctor_kamal",
  role: "doctor",
  branchId: "B1",
  name: "Dr. Kamal Hossain",
  authorities: [],
}

let db: MedcoreDb
const SESSION = "ses_kamal_today"

beforeAll(async () => {
  // 09:30 in Dhaka today, before seeding, so today's 10:00 to 13:00 session has free future slots.
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "09:30") - Date.now())
  db = new MedcoreDb("queue-test")
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
})
afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("interleave", () => {
  it("orders two booked tokens, then one walk-in", () => {
    expect(interleavePositions(["booked", "walk-in", "booked", "booked", "walk-in", "booked"])).toEqual([
      1, 3, 2, 4, 6, 5,
    ])
  })
})

describe("front desk queue on the seeded day", () => {
  it("books the hero, checks him in with the next token, then calls, skips and recalls", async () => {
    const session = await db.sessions.get(SESSION)
    expect(session?.doctorId).toBe(HERO.doctor.kamal)
    const before = await db.queueTokens.where("sessionId").equals(SESSION).toArray()
    const lastNumber = Math.max(...before.map((t) => t.number))

    const booked = await commit(
      bookAppointment,
      { sessionId: SESSION, patientId: HERO.patient.abdulKarim, source: "counter" },
      { db, actor: reception }
    )
    const { result: token } = await commit(
      checkIn,
      { appointmentId: booked.result.appointmentId },
      { db, actor: reception }
    )
    expect(token.label).toBe(`M-${lastNumber + 1}`)
    const appointment = await db.appointments.get(booked.result.appointmentId)
    expect(appointment).toMatchObject({ status: "checked-in", tokenId: token.tokenId })

    // Every token in the session has a distinct queue position.
    const after = await db.queueTokens.where("sessionId").equals(SESSION).toArray()
    expect(new Set(after.map((t) => t.position)).size).toBe(after.length)

    await expect(
      commit(checkIn, { appointmentId: booked.result.appointmentId }, { db, actor: reception })
    ).rejects.toMatchObject({ code: "NOT_CHECKABLE" })

    await commit(callToken, { tokenId: token.tokenId }, { db, actor: doctor })
    expect((await db.queueTokens.get(token.tokenId))?.status).toBe("called")
    await commit(skipToken, { tokenId: token.tokenId }, { db, actor: doctor })
    await expect(
      commit(skipToken, { tokenId: token.tokenId }, { db, actor: doctor })
    ).rejects.toMatchObject({ code: "TOKEN_STATE" })
    await commit(recallToken, { tokenId: token.tokenId }, { db, actor: doctor })
    await commit(callToken, { tokenId: token.tokenId }, { db, actor: doctor })
    expect((await db.queueTokens.get(token.tokenId))?.status).toBe("called")

    const types = (await db.events.toArray()).map((e) => e.type)
    expect(types).toEqual([
      "AppointmentBooked",
      "PatientCheckedIn",
      "TokenIssued",
      "TokenCalled",
      "TokenSkipped",
      "TokenRecalled",
      "TokenCalled",
    ])
    const called = (await db.events.toArray()).at(-1)
    expect(called?.params).toMatchObject({ token: token.label, room: "3" })
  })
})
