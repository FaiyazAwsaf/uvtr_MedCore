import type { BranchCode } from "@/config/brand.config"
import { dhakaDate } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import type {
  AdmissionRow,
  BedRow,
  CorporateClientRow,
  DepositRow,
  DoctorRow,
  Id,
  Ms,
  PatientRow,
  Poisha,
  SpecialtyRow,
  StaffRow,
  WardRow,
} from "@/core/db/schema"
import type { InterimBill } from "@/core/inpatient/interim"

import { stayBill } from "./stay"

/**
 * Reads for the bed board and the deposit desk. They only read the database,
 * so a live query re-runs on every commit in any window; figures that depend
 * on the demo clock (days, charges, deposit left) are computed on render with
 * `billOf(stay, now)`, so moving the clock updates them at once.
 */

export type Consultant = {
  doctor: DoctorRow
  staff?: StaffRow
  specialty?: SpecialtyRow
}

export type StayView = {
  admission: AdmissionRow
  patient?: PatientRow
  bed?: BedRow
  ward?: WardRow
  consultant?: Consultant
  /** The current ward and the wards of earlier beds (transfers) */
  wardById: ReadonlyMap<Id, WardRow>
  /** Oldest first */
  deposits: DepositRow[]
  corporate?: CorporateClientRow
}

const compact = <T>(rows: (T | undefined)[]): T[] => rows.filter((row): row is T => !!row)

function byId<T extends { id: Id }>(rows: (T | undefined)[]): Map<Id, T> {
  return new Map(compact(rows).map((row) => [row.id, row]))
}

async function consultantsById(db: MedcoreDb, ids: Id[]): Promise<Map<Id, Consultant>> {
  const doctors = compact(await db.doctors.bulkGet([...new Set(ids)]))
  const [staff, specialties] = await Promise.all([
    db.staff.bulkGet(doctors.map((d) => d.staffId)),
    db.specialties.bulkGet([...new Set(doctors.map((d) => d.specialtyId))]),
  ])
  const staffById = byId(staff)
  const specialtyById = byId(specialties)
  return new Map(
    doctors.map((doctor) => [
      doctor.id,
      { doctor, staff: staffById.get(doctor.staffId), specialty: specialtyById.get(doctor.specialtyId) },
    ])
  )
}

/** Views of a set of admissions with everything the screens show. */
async function viewsOf(db: MedcoreDb, admissions: AdmissionRow[]): Promise<StayView[]> {
  if (!admissions.length) return []
  const [patients, beds, deposits, consultants, clients] = await Promise.all([
    db.patients.bulkGet([...new Set(admissions.map((a) => a.patientId))]),
    db.beds.bulkGet(admissions.map((a) => a.bedId)),
    db.deposits.where("admissionId").anyOf(admissions.map((a) => a.id)).toArray(),
    consultantsById(
      db,
      admissions.map((a) => a.consultantId)
    ),
    db.corporateClients.bulkGet([
      ...new Set(compact(admissions.map((a) => a.corporateClientId))),
    ]),
  ])
  const wards = byId(
    await db.wards.bulkGet([
      ...new Set([
        ...compact(beds).map((b) => b.wardId),
        ...admissions.flatMap((a) => (a.wardMoves ?? []).flatMap((m) => [m.fromWardId, m.toWardId])),
      ]),
    ])
  )
  const patientById = byId(patients)
  const bedById = byId(beds)
  const clientById = byId(clients)
  return admissions.map((admission) => {
    const bed = bedById.get(admission.bedId)
    return {
      admission,
      patient: patientById.get(admission.patientId),
      bed,
      ward: bed ? wards.get(bed.wardId) : undefined,
      consultant: consultants.get(admission.consultantId),
      wardById: wards,
      deposits: deposits
        .filter((d) => d.admissionId === admission.id)
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)),
      corporate: admission.corporateClientId ? clientById.get(admission.corporateClientId) : undefined,
    }
  })
}

/** Admitted stays at a branch. */
export async function staysAt(db: MedcoreDb, branch: BranchCode): Promise<StayView[]> {
  const admissions = (await db.admissions.where("branchId").equals(branch).toArray()).filter(
    (a) => a.status === "admitted"
  )
  return viewsOf(db, admissions)
}

/** One stay (any status), or null. */
export async function stayById(db: MedcoreDb, admissionId: Id): Promise<StayView | null> {
  const admission = await db.admissions.get(admissionId)
  if (!admission) return null
  return (await viewsOf(db, [admission]))[0] ?? null
}

export type Board = {
  wards: WardRow[]
  /** Bed code order within each ward */
  beds: BedRow[]
  stays: StayView[]
}

/** The bed board of a branch: its wards, beds and admitted stays. */
export async function boardAt(db: MedcoreDb, branch: BranchCode): Promise<Board> {
  const [wards, beds, stays] = await Promise.all([
    db.wards.where("branchId").equals(branch).toArray(),
    db.beds.where("branchId").equals(branch).toArray(),
    staysAt(db, branch),
  ])
  return {
    wards: wards.sort((a, b) => a.code.localeCompare(b.code)),
    beds: beds.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })),
    stays,
  }
}

/** Consultants who admit at a branch, by name. */
export async function consultantsAt(db: MedcoreDb, branch: BranchCode): Promise<Consultant[]> {
  const doctors = (await db.doctors.where("branchIds").equals(branch).toArray()).filter(
    (d) => d.kind === "consultant"
  )
  const map = await consultantsById(
    db,
    doctors.map((d) => d.id)
  )
  return [...map.values()].sort((a, b) =>
    (a.staff?.nameEn ?? a.doctor.id).localeCompare(b.staff?.nameEn ?? b.doctor.id)
  )
}

/** The current stay of a patient anywhere in the network, if admitted. */
export async function currentStayOf(
  db: MedcoreDb,
  patientId: Id
): Promise<{ admission: AdmissionRow; bed?: BedRow } | null> {
  const admission = (await db.admissions.where("patientId").equals(patientId).toArray()).find(
    (a) => a.status === "admitted"
  )
  if (!admission) return null
  return { admission, bed: await db.beds.get(admission.bedId) }
}

/** Deposits taken at a branch on a Dhaka day: receipts and total. */
export async function depositsOn(
  db: MedcoreDb,
  branch: BranchCode,
  day: string
): Promise<{ count: number; amountP: Poisha }> {
  const rows = await db.deposits
    .filter((d) => d.branchId === branch && dhakaDate(d.at) === day)
    .toArray()
  return { count: rows.length, amountP: rows.reduce((sum, d) => sum + d.amountP, 0) }
}

/** The interim bill of a stay at a moment, or null while its ward is unknown. */
export function billOf(stay: StayView, at: Ms): InterimBill | null {
  if (!stay.ward) return null
  return stayBill({
    admission: stay.admission,
    ward: stay.ward,
    wardById: stay.wardById,
    consultant: stay.consultant?.doctor,
    deposits: stay.deposits,
    at,
  })
}
