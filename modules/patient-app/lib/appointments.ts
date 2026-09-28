import type { AppointmentRow, ISODate, SessionRow } from "@/core/db/schema"

/** Statuses of an appointment that is still ahead of the patient. */
export const UPCOMING_STATUSES: readonly AppointmentRow["status"][] = [
  "booked",
  "checked-in",
  "in-consult",
]

export function isUpcoming(
  appointment: AppointmentRow,
  today: ISODate
): boolean {
  return (
    UPCOMING_STATUSES.includes(appointment.status) && appointment.date >= today
  )
}

const byTime = (a: AppointmentRow, b: AppointmentRow) =>
  a.date.localeCompare(b.date) || a.slotStart.localeCompare(b.slotStart)

/** Upcoming (soonest first) and past (latest first) appointments. */
export function splitAppointments(
  appointments: AppointmentRow[],
  today: ISODate
): { upcoming: AppointmentRow[]; past: AppointmentRow[] } {
  const upcoming = appointments.filter((a) => isUpcoming(a, today)).sort(byTime)
  const past = appointments
    .filter((a) => !isUpcoming(a, today))
    .sort((a, b) => byTime(b, a))
  return { upcoming, past }
}

/** The soonest upcoming appointment, if any. */
export function nextAppointment(
  appointments: AppointmentRow[],
  today: ISODate
): AppointmentRow | undefined {
  return splitAppointments(appointments, today).upcoming[0]
}

export type CheckInState =
  "ready" | "checked-in" | "not-today" | "closed" | "offline"

/**
 * Whether "I'm here" (queue.checkIn, patient role) can run: only for a booked
 * appointment on its own day, in a session that is running, at a branch that
 * is online (an offline branch works on its own server, so a central
 * check-in would not reach its front desk).
 */
export function checkInState(
  appointment: AppointmentRow,
  session: SessionRow | undefined,
  today: ISODate,
  branchOffline: boolean
): CheckInState {
  if (appointment.status !== "booked") return "checked-in"
  if (appointment.date !== today) return "not-today"
  if (!session || session.status === "blocked" || session.status === "closed")
    return "closed"
  if (branchOffline) return "offline"
  return "ready"
}
