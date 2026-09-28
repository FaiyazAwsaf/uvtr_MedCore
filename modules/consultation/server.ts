/**
 * Transaction helpers shared by the clinical commands (consultation,
 * prescribing, orders). They only use the `tx` API, so they run inside a
 * command's single atomic commit.
 */

import type {
  CorporateEmployeeRow,
  DoctorRow,
  EncounterRow,
  NoteRow,
  PatientRow,
} from "@/core/db/schema"
import type { Tx } from "@/core/engine/types"

/** The doctor record of the acting staff member, or undefined for other roles. */
export async function actorDoctor(tx: Tx): Promise<DoctorRow | undefined> {
  const rows = await tx.list("doctors", "staffId", tx.actor.staffId)
  return rows[0]
}

/**
 * The encounter, checked for writing: it must exist, not be closed (unless
 * allowed), and belong to the acting doctor.
 */
export async function writableEncounter(
  tx: Tx,
  encounterId: string,
  { allowClosed = false }: { allowClosed?: boolean } = {}
): Promise<EncounterRow> {
  const encounter = await tx.get("encounters", encounterId)
  if (!allowClosed && encounter.status === "closed") {
    tx.reject("ENCOUNTER_CLOSED", {})
  }
  const doctor = await actorDoctor(tx)
  if (tx.actor.role === "doctor" && doctor?.id !== encounter.doctorId) {
    tx.reject("NOT_YOUR_PATIENT", {})
  }
  return encounter
}

/** Notes of an encounter, newest version first. */
export async function notesOf(tx: Tx, encounterId: string): Promise<NoteRow[]> {
  const notes = await tx.list("notes", "encounterId", encounterId)
  return notes.sort((a, b) => b.noteVersion - a.noteVersion)
}

/** The active corporate employment behind a patient, when there is one. */
export async function activeEmployee(
  tx: Tx,
  patient: PatientRow
): Promise<CorporateEmployeeRow | undefined> {
  if (!patient.corporateEmployeeId) return undefined
  const employee = await tx.find("corporateEmployees", patient.corporateEmployeeId)
  return employee?.status === "active" ? employee : undefined
}

/** Payer fields for a basket line: corporate employees bill to their company. */
export function payerFor(employee: CorporateEmployeeRow | undefined): {
  payerType: "self" | "corporate"
  corporateClientId?: string
} {
  return employee
    ? { payerType: "corporate", corporateClientId: employee.clientId }
    : { payerType: "self" }
}

/** DD-MM-YYYY for SMS text (Latin digits; Bangla messages convert them). */
export function dmyLatin(iso: string): string {
  return iso.split("-").reverse().join("-")
}
