"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import type {
  DoctorRow,
  RoomRow,
  SessionRow,
  SpecialtyRow,
  StaffRow,
} from "@/core/db/schema"

/** A session with the doctor, room and specialty needed to label it. */
export type SessionInfo = {
  session: SessionRow
  doctor?: DoctorRow
  staff?: StaffRow
  room?: RoomRow
  specialty?: SpecialtyRow
}

function present<T>(rows: (T | undefined)[]): T[] {
  return rows.filter((row): row is T => row !== undefined)
}

/** Label data for a set of sessions (one read of each table involved). */
export async function loadSessionInfo(
  db: MedcoreDb,
  sessions: SessionRow[]
): Promise<Map<string, SessionInfo>> {
  const doctorIds = [...new Set(sessions.map((s) => s.doctorId))]
  const roomIds = [...new Set(sessions.map((s) => s.roomId))]
  const [doctors, rooms, specialties] = await Promise.all([
    db.doctors.bulkGet(doctorIds).then(present),
    db.rooms.bulkGet(roomIds).then(present),
    db.specialties.toArray(),
  ])
  const staff = present(await db.staff.bulkGet(doctors.map((d) => d.staffId)))
  const doctorById = new Map(doctors.map((d) => [d.id, d]))
  const staffById = new Map(staff.map((s) => [s.id, s]))
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const specialtyById = new Map(specialties.map((s) => [s.id, s]))
  const out = new Map<string, SessionInfo>()
  for (const session of sessions) {
    const doctor = doctorById.get(session.doctorId)
    out.set(session.id, {
      session,
      doctor,
      staff: doctor ? staffById.get(doctor.staffId) : undefined,
      room: roomById.get(session.roomId),
      specialty: doctor ? specialtyById.get(doctor.specialtyId) : undefined,
    })
  }
  return out
}

/** Live label data for sessions by id (undefined while loading). */
export function useSessionInfo(sessionIds: string[]): Map<string, SessionInfo> | undefined {
  const db = useDb()
  const key = [...new Set(sessionIds)].sort().join("|")
  return useLiveQuery(async () => {
    const ids = key ? key.split("|") : []
    const sessions = present(await db.sessions.bulkGet(ids))
    return loadSessionInfo(db, sessions)
  }, [db, key])
}
