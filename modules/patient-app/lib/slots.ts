import { atDhaka, MINUTE } from "@/core/clock/dates"
import type { AppointmentRow, HHMM, Id, Ms, SessionRow } from "@/core/db/schema"

/**
 * Free-slot rules for the patient app's slot picker. They mirror what
 * `scheduling.book` accepts (modules/scheduling/commands.ts), so the picker
 * only offers times the command will take: a slot is free when no booked
 * (non walk-in) appointment holds it and it has not ended yet, and a session
 * stops taking bookings once its non walk-in places are used up.
 */

/** Appointments that still hold a place in a session. */
export const ACTIVE_STATUSES: readonly AppointmentRow["status"][] = [
  "booked",
  "checked-in",
  "in-consult",
  "done",
]

/** Every slot start of a session, e.g. 10:00, 10:10 ... 12:50. */
export function slotTimes(start: HHMM, end: HHMM, slotMin: number): HHMM[] {
  const [sh, sm] = start.split(":").map(Number)
  const [eh, em] = end.split(":").map(Number)
  const out: HHMM[] = []
  if (!(slotMin > 0)) return out
  for (let m = sh * 60 + sm; m + slotMin <= eh * 60 + em; m += slotMin) {
    out.push(
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
    )
  }
  return out
}

export type SlotState = "free" | "taken" | "past"

export type SessionAvailability = {
  slots: { time: HHMM; state: SlotState }[]
  /** Slots the patient can pick now, in time order */
  free: HHMM[]
  /** Why nothing can be booked in this session, when that is the case */
  closedReason?: "blocked" | "closed" | "full" | "ended"
}

function activeIn(sessionId: Id, appointments: AppointmentRow[]): AppointmentRow[] {
  return appointments.filter(
    (a) => a.sessionId === sessionId && ACTIVE_STATUSES.includes(a.status)
  )
}

/** Slots and bookability of one session at a moment on the demo clock. */
export function sessionAvailability(
  session: SessionRow,
  appointments: AppointmentRow[],
  nowMs: Ms
): SessionAvailability {
  const booked = activeIn(session.id, appointments).filter((a) => a.source !== "walk-in")
  const taken = new Set(booked.map((a) => a.slotStart))
  const slots = slotTimes(session.start, session.end, session.slotMin).map((time) => {
    const state: SlotState = taken.has(time)
      ? "taken"
      : atDhaka(session.date, time) + session.slotMin * MINUTE > nowMs
        ? "free"
        : "past"
    return { time, state }
  })

  let closedReason: SessionAvailability["closedReason"]
  if (session.status === "blocked") closedReason = "blocked"
  else if (session.status === "closed") closedReason = "closed"
  else if (booked.length >= session.capacity - session.walkInQuota) closedReason = "full"
  else if (!slots.some((s) => s.state === "free")) {
    closedReason = atDhaka(session.date, session.end) <= nowMs ? "ended" : "full"
  }
  const free = closedReason ? [] : slots.filter((s) => s.state === "free").map((s) => s.time)
  return { slots, free, closedReason }
}

/** True when the patient already holds a place in the session (scheduling.book refuses a second one). */
export function hasActiveBooking(
  appointments: AppointmentRow[],
  sessionId: Id,
  patientId: Id
): boolean {
  return activeIn(sessionId, appointments).some((a) => a.patientId === patientId)
}

/** Sessions a patient can still book, from today onwards, in date and start order. */
export function bookableSessions(
  sessions: SessionRow[],
  today: string,
  nowMs: Ms
): SessionRow[] {
  return sessions
    .filter(
      (s) =>
        s.date >= today &&
        s.status !== "closed" &&
        atDhaka(s.date, s.end) > nowMs
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
}
