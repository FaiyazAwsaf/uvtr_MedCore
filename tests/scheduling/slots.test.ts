import { describe, expect, it } from "vitest"

import { atDhaka } from "@/core/clock/dates"
import type { AppointmentRow } from "@/core/db/schema"
import { boardSessions, boardView, compareRoomCodes } from "@/modules/queue/board"
import { freeSlotTimes, sessionLoad, slotGrid, slotTimes } from "@/modules/scheduling/slots"

const DAY = "2026-09-28"
const session = {
  date: DAY,
  start: "10:00",
  end: "11:00",
  slotMin: 10,
  capacity: 6,
  walkInQuota: 2,
}

type Appt = Pick<AppointmentRow, "status" | "source" | "slotStart">
const appt = (slotStart: string, over: Partial<Appt> = {}): Appt => ({
  slotStart,
  status: "booked",
  source: "counter",
  ...over,
})

describe("slots", () => {
  it("lists slot start times inside the session", () => {
    expect(slotTimes("10:00", "10:30", 10)).toEqual(["10:00", "10:10", "10:20"])
    expect(slotTimes("17:00", "18:00", 15)).toEqual(["17:00", "17:15", "17:30", "17:45"])
  })

  it("marks slots free, taken, past and full, ignoring cancelled bookings and walk-ins", () => {
    const at1015 = atDhaka(DAY, "10:15")
    const appointments = [
      appt("10:20"),
      appt("10:30", { status: "cancelled" }),
      appt("10:15", { source: "walk-in", status: "checked-in" }),
    ]
    const grid = slotGrid(session, appointments, at1015)
    expect(grid.map((s) => [s.time, s.state])).toEqual([
      ["10:00", "past"],
      ["10:10", "free"],
      ["10:20", "taken"],
      ["10:30", "free"],
      ["10:40", "free"],
      ["10:50", "free"],
    ])
    expect(sessionLoad(session, appointments)).toEqual({
      booked: 1,
      walkIns: 1,
      bookedCapacity: 4,
      bookedLeft: 3,
      walkInLeft: 1,
    })
  })

  it("stops offering slots once the places that can be booked ahead are used", () => {
    const full = ["10:00", "10:10", "10:20", "10:30"].map((t) => appt(t))
    const at0900 = atDhaka(DAY, "09:00")
    expect(freeSlotTimes(session, full, at0900)).toEqual([])
    expect(slotGrid(session, full, at0900).filter((s) => s.state === "full").map((s) => s.time)).toEqual([
      "10:40",
      "10:50",
    ])
  })
})

describe("board", () => {
  const token = (label: string, status: string, position: number, calledAt?: number) => ({
    id: label,
    label,
    status: status as "waiting",
    position,
    number: position,
    calledAt,
  })

  it("shows the latest called token as now serving and the queue in position order", () => {
    const view = boardView([
      token("M-1", "done", 1, 1),
      token("M-2", "called", 2, 5),
      token("M-3", "in-consult", 3, 9),
      token("M-4", "waiting", 5),
      token("M-5", "recalled", 4),
      token("M-6", "waiting", 6),
      token("M-7", "skipped", 7, 3),
    ])
    expect(view.serving?.label).toBe("M-3")
    expect(view.next.map((t) => t.label)).toEqual(["M-5", "M-4"])
    expect(view.waiting.map((t) => t.label)).toEqual(["M-6"])
    expect(view.skipped.map((t) => t.label)).toEqual(["M-7"])
    expect(view.done).toBe(1)
  })

  it("puts one session per room on the board: the live one, or one with patients waiting", () => {
    const at1130 = atDhaka(DAY, "11:30")
    const morning = { id: "am", roomId: "r3", date: DAY, start: "10:00", end: "13:00", status: "open" as const }
    const evening = { id: "eve", roomId: "r3", date: DAY, start: "18:30", end: "21:30", status: "open" as const }
    const early = { id: "early", roomId: "r1", date: DAY, start: "07:00", end: "09:00", status: "open" as const }
    const later = { id: "later", roomId: "r5", date: DAY, start: "17:00", end: "20:00", status: "open" as const }
    const tokens = new Map([["early", [{ status: "waiting" as const }]]])
    expect(boardSessions([evening, morning, early, later], tokens, at1130).map((s) => s.id)).toEqual([
      "am",
      "early",
    ])
    expect(["10", "2", "C-1", "3"].sort(compareRoomCodes)).toEqual(["2", "3", "10", "C-1"])
  })
})
