"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { getBranch, type BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type {
  DoctorRow,
  Id,
  PatientRow,
  RoomRow,
  SpecialtyRow,
  StaffRow,
} from "@/core/db/schema"
import type { Locale } from "@/lib/i18n/config"
import { useLocale } from "@/lib/i18n/provider"

import { familyMembers, resolveMember, type FamilyMember } from "../lib/family"
import { updateAppState, useAppState } from "../state/app-state"

/* ================================================================== *
 * Labels
 * ================================================================== */

export function patientName(patient: Pick<PatientRow, "nameEn" | "nameBn">, locale: Locale) {
  return locale === "bn" ? patient.nameBn : patient.nameEn
}

/** First name for greetings ("Tanvir"), skipping honorifics like "Md.". */
export function firstName(patient: Pick<PatientRow, "nameEn" | "nameBn">, locale: Locale) {
  const parts = patientName(patient, locale).split(/\s+/)
  return parts.find((p) => !/^(md\.?|mohammad|মোঃ|মো\.)$/i.test(p)) ?? parts[0]
}

export function staffName(staff: Pick<StaffRow, "nameEn" | "nameBn"> | undefined, locale: Locale) {
  if (!staff) return ""
  return locale === "bn" ? staff.nameBn : staff.nameEn
}

export function branchName(code: BranchCode, locale: Locale) {
  return getBranch(code).name[locale]
}

/** Today in Dhaka on the demo clock, re-rendered every minute. */
export function useToday(): string {
  const nowMs = useNow(60_000)
  return dhakaDate(nowMs || now())
}

/* ================================================================== *
 * Family (HAZ-14): the account holder plus consented members
 * ================================================================== */

type FamilyValue = {
  account: PatientRow
  members: FamilyMember[]
  /** The member whose records every screen shows */
  member: FamilyMember
  selectMember: (patientId: Id) => void
}

const FamilyContext = React.createContext<FamilyValue | null>(null)

export function FamilyProvider({
  accountId,
  loading,
  children,
}: {
  accountId: Id
  loading: React.ReactNode
  children: React.ReactNode
}) {
  const db = useDb()
  const today = useToday()
  const { memberId } = useAppState()
  const data = useLiveQuery(async () => {
    const account = await db.patients.get(accountId)
    const links = await db.familyLinks.where("ownerPatientId").equals(accountId).toArray()
    const found = await db.patients.bulkGet(links.map((l) => l.memberPatientId))
    return { account, links, patients: found.filter((p): p is PatientRow => !!p) }
  }, [db, accountId])

  const value = React.useMemo<FamilyValue | null>(() => {
    if (!data?.account) return null
    const members = familyMembers(data.account, data.links, data.patients, today)
    const member = resolveMember(members, memberId) ?? members[0]
    return {
      account: data.account,
      members,
      member,
      selectMember: (patientId) => updateAppState({ memberId: patientId }),
    }
  }, [data, today, memberId])

  if (!value) return <>{loading}</>
  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>
}

export function useFamily(): FamilyValue {
  const value = React.useContext(FamilyContext)
  if (!value) throw new Error("useFamily must be used inside <FamilyProvider>")
  return value
}

/** The patient whose records are on screen. */
export function useMember(): PatientRow {
  return useFamily().member.patient
}

/* ================================================================== *
 * Directory: doctors, staff, specialties and rooms (small tables)
 * ================================================================== */

type DirectoryValue = {
  doctors: Map<Id, DoctorRow>
  staff: Map<Id, StaffRow>
  specialties: Map<Id, SpecialtyRow>
  rooms: Map<Id, RoomRow>
}

const DirectoryContext = React.createContext<DirectoryValue | null>(null)

const byId = <T extends { id: Id }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]))

export function DirectoryProvider({
  loading,
  children,
}: {
  loading: React.ReactNode
  children: React.ReactNode
}) {
  const db = useDb()
  const value = useLiveQuery(async () => {
    const [doctors, staff, specialties, rooms] = await Promise.all([
      db.doctors.toArray(),
      db.staff.toArray(),
      db.specialties.toArray(),
      db.rooms.toArray(),
    ])
    return {
      doctors: byId(doctors),
      staff: byId(staff),
      specialties: byId(specialties),
      rooms: byId(rooms),
    }
  }, [db])
  if (!value) return <>{loading}</>
  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>
}

export function useDirectory(): DirectoryValue {
  const value = React.useContext(DirectoryContext)
  if (!value) throw new Error("useDirectory must be used inside <DirectoryProvider>")
  return value
}

export type DoctorInfo = {
  doctor: DoctorRow
  staff?: StaffRow
  specialty?: SpecialtyRow
  name: string
  specialtyName: string
}

/** A doctor's display details in the window's language. */
export function useDoctorInfo(): (doctorId: Id) => DoctorInfo | undefined {
  const { doctors, staff, specialties } = useDirectory()
  const { locale } = useLocale()
  return React.useCallback(
    (doctorId: Id) => {
      const doctor = doctors.get(doctorId)
      if (!doctor) return undefined
      const person = staff.get(doctor.staffId)
      const specialty = specialties.get(doctor.specialtyId)
      return {
        doctor,
        staff: person,
        specialty,
        name: staffName(person, locale),
        specialtyName: specialty?.name[locale] ?? "",
      }
    },
    [doctors, staff, specialties, locale]
  )
}

/** "Room 3" / "কক্ষ ৩" for a room id. */
export function useRoomName(): (roomId: Id | undefined) => string {
  const { rooms } = useDirectory()
  const { locale } = useLocale()
  return React.useCallback(
    (roomId) => (roomId ? (rooms.get(roomId)?.name[locale] ?? "") : ""),
    [rooms, locale]
  )
}
