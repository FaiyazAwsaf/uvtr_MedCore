import { atDhaka, MINUTE } from "@/core/clock/dates"
import type { AppointmentRow, HHMM, Ms, SessionRow } from "@/core/db/schema"

/**
 * The one scheduler's slot rules (plan §5.3, PRD §10.2), shared by the
 * `scheduling.book` command and every screen that shows a slot grid (front
 * desk, call centre, patient app), so what a screen offers is exactly what
 * the command accepts.
 *
 * - A session has `capacity` places; `walkInQuota` of them are held for
 *   walk-ins, so at most `capacity - walkInQuota` places can be booked ahead.
 * - Booked appointments take a slot time; walk-ins take "now" and no slot.
 * - A slot is bookable until it ends (a slot in progress can still be taken).
 */

/** Appointments that still hold a place in a session. */
export const ACTIVE_APPOINTMENT: AppointmentRow["status"][] = [
  "booked",
  "checked-in",
  "in-consult",
  "done",
]

export function isActiveAppointment(appointment: Pick<AppointmentRow, "status">) {
  return ACTIVE_APPOINTMENT.includes(appointment.status)
}

const pad = (n: number) => String(n).padStart(2, "0")

function toMinutes(time: HHMM): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

/** Slot start times of a session, e.g. 10:00, 10:10 ... 12:50. */
export function slotTimes(start: HHMM, end: HHMM, slotMin: number): HHMM[] {
  const out: HHMM[] = []
  if (slotMin <= 0) return out
  for (let m = toMinutes(start); m + slotMin <= toMinutes(end); m += slotMin) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  }
  return out
}

export type SessionLoad = {
  /** Active appointments booked ahead (app, call, counter) */
  booked: number
  /** Active walk-ins */
  walkIns: number
  /** Places that can be booked ahead */
  bookedCapacity: number
  bookedLeft: number
  walkInLeft: number
}

/** How full a session is, from its appointments (any status; inactive ones are ignored). */
export function sessionLoad(
  session: Pick<SessionRow, "capacity" | "walkInQuota">,
  appointments: Pick<AppointmentRow, "status" | "source">[]
): SessionLoad {
  const active = appointments.filter(isActiveAppointment)
  const walkIns = active.filter((a) => a.source === "walk-in").length
  const booked = active.length - walkIns
  const bookedCapacity = Math.max(0, session.capacity - session.walkInQuota)
  return {
    booked,
    walkIns,
    bookedCapacity,
    bookedLeft: Math.max(0, bookedCapacity - booked),
    walkInLeft: Math.max(0, session.walkInQuota - walkIns),
  }
}

/** The moment a slot starts. */
export function slotStartMs(session: Pick<SessionRow, "date">, time: HHMM): Ms {
  return atDhaka(session.date, time)
}

/** True once a slot has ended (it can no longer be booked). */
export function isSlotOver(
  session: Pick<SessionRow, "date" | "slotMin">,
  time: HHMM,
  nowMs: Ms
): boolean {
  return atDhaka(session.date, time) + session.slotMin * MINUTE <= nowMs
}

/** True once the whole session has ended. */
export function isSessionOver(session: Pick<SessionRow, "date" | "end">, nowMs: Ms) {
  return atDhaka(session.date, session.end) <= nowMs
}

/** True while a session is open for bookings (not blocked or closed). */
export function isSessionBookable(session: Pick<SessionRow, "status">) {
  return session.status === "open" || session.status === "delayed"
}

/**
 * - free: can be booked now
 * - taken: another active booking holds it
 * - past: the slot has ended
 * - full: free, but every bookable place in the session is already used
 */
export type SlotState = "free" | "taken" | "past" | "full"

export type SlotInfo = { time: HHMM; state: SlotState; startsAt: Ms }

/** Every slot of a session with its state at `nowMs`. */
export function slotGrid(
  session: Pick<
    SessionRow,
    "date" | "start" | "end" | "slotMin" | "capacity" | "walkInQuota"
  >,
  appointments: Pick<AppointmentRow, "status" | "source" | "slotStart">[],
  nowMs: Ms
): SlotInfo[] {
  const active = appointments.filter(isActiveAppointment)
  const taken = new Set(
    active.filter((a) => a.source !== "walk-in").map((a) => a.slotStart)
  )
  const { bookedLeft } = sessionLoad(session, appointments)
  return slotTimes(session.start, session.end, session.slotMin).map((time) => {
    const startsAt = atDhaka(session.date, time)
    let state: SlotState
    if (taken.has(time)) state = "taken"
    else if (isSlotOver(session, time, nowMs)) state = "past"
    else if (bookedLeft <= 0) state = "full"
    else state = "free"
    return { time, state, startsAt }
  })
}

/** Slot times that can be booked right now. */
export function freeSlotTimes(
  session: Parameters<typeof slotGrid>[0],
  appointments: Parameters<typeof slotGrid>[1],
  nowMs: Ms
): HHMM[] {
  return slotGrid(session, appointments, nowMs)
    .filter((slot) => slot.state === "free")
    .map((slot) => slot.time)
}
