"use client"

import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type {
  AppointmentRow,
  BrandRow,
  DoctorRow,
  DrugClassRow,
  EncounterRow,
  GenericRow,
  LabTestRow,
  NoteRow,
  PatientRow,
  PharmaCompanyRow,
  QueueTokenRow,
  ScribeDraftRow,
  SpecialtyRow,
  StaffRow,
} from "@/core/db/schema"
import { usePersona } from "@/core/session/persona"

/** The signed-in doctor: persona, staff record and doctor record (live). */
export function useDoctor() {
  const persona = usePersona()
  const db = useDb()
  const staffId = persona?.staff?.id
  const doctor = useLiveQuery(
    async () => (staffId ? ((await db.doctors.where("staffId").equals(staffId).first()) ?? null) : null),
    [db, staffId]
  )
  return { persona, staffId, doctor, branch: persona?.branchId ?? null }
}

export type MedicineCatalogRows = {
  brands: BrandRow[]
  generics: GenericRow[]
  companies: PharmaCompanyRow[]
  classes: DrugClassRow[]
  brandById: Map<string, BrandRow>
  genericById: Map<string, GenericRow>
  companyById: Map<string, PharmaCompanyRow>
}

/** The medicine dictionary (small, static tables). */
export function useMedicineCatalog(): MedicineCatalogRows | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [brands, generics, companies, classes] = await Promise.all([
      db.brands.toArray(),
      db.generics.toArray(),
      db.pharmaCompanies.toArray(),
      db.drugClasses.toArray(),
    ])
    return {
      brands,
      generics,
      companies,
      classes,
      brandById: new Map(brands.map((b) => [b.id, b])),
      genericById: new Map(generics.map((g) => [g.id, g])),
      companyById: new Map(companies.map((c) => [c.id, c])),
    }
  }, [db])
}

/** The lab and imaging catalogue. */
export function useLabCatalog(): { tests: LabTestRow[]; byId: Map<string, LabTestRow> } | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const tests = await db.labTests.toArray()
    return { tests, byId: new Map(tests.map((t) => [t.id, t])) }
  }, [db])
}

export type EncounterCore = {
  encounter: EncounterRow
  patient: PatientRow
  appointment?: AppointmentRow
  token?: QueueTokenRow
  doctor?: DoctorRow
  doctorStaff?: StaffRow
  specialty?: SpecialtyRow
}

/** The encounter with its patient, appointment, token and doctor (null when missing). */
export function useEncounterCore(encounterId: string): EncounterCore | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const encounter = await db.encounters.get(encounterId)
    if (!encounter) return null
    const [patient, appointment, doctor] = await Promise.all([
      db.patients.get(encounter.patientId),
      encounter.appointmentId ? db.appointments.get(encounter.appointmentId) : undefined,
      db.doctors.get(encounter.doctorId),
    ])
    if (!patient) return null
    const [token, doctorStaff, specialty] = await Promise.all([
      appointment?.tokenId ? db.queueTokens.get(appointment.tokenId) : undefined,
      doctor ? db.staff.get(doctor.staffId) : undefined,
      doctor ? db.specialties.get(doctor.specialtyId) : undefined,
    ])
    return { encounter, patient, appointment, token, doctor, doctorStaff, specialty }
  }, [db, encounterId])
}

/** Notes of the encounter, newest version first. */
export function useNotes(encounterId: string): NoteRow[] | undefined {
  const db = useDb()
  return useLiveQuery(
    async () =>
      (await db.notes.where("encounterId").equals(encounterId).toArray()).sort(
        (a, b) => b.noteVersion - a.noteVersion
      ),
    [db, encounterId]
  )
}

/** The encounter's latest scribe draft (any status). */
export function useScribeDraft(encounterId: string): ScribeDraftRow | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const drafts = await db.scribeDrafts.where("encounterId").equals(encounterId).toArray()
    return drafts.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  }, [db, encounterId])
}
