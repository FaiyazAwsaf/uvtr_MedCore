/**
 * Inpatient test fixtures: a seeded database with the demo clock at 09:30
 * Dhaka, the reception and cashier actors, and finders that pick records by
 * branch and state (never by an id seen once: non-hero seed data varies by
 * weekday, see TEST_DAY_SHIFT in tests/setup.ts).
 */

import { expect } from "vitest"

import type { BranchCode } from "@/config/brand.config"
import { applyClockOffset, getClockOffset, now } from "@/core/clock/clock"
import { ageOn, atDhaka, DAY, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import type { AdmissionRow, BedRow, PatientRow, Sex, WardRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import type { Actor } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"
import { dbReader } from "@/modules/billing/queries"
import { coverFor } from "@/modules/billing/settle"
import { admit } from "@/modules/inpatient/commands"
import { billOf, staysAt, type StayView } from "@/modules/inpatient/queries"
import { wardRefusal } from "@/modules/inpatient/stay"

export const FARHANA: Actor = actorFor(findPersona("per_reception_farhana")!)
export const RAFIQ: Actor = actorFor(findPersona("per_cashier_rafiq")!)
export const NASRIN: Actor = actorFor(findPersona("per_cashier_nasrin")!)

/** A receptionist at another hospital branch (B2 Uttara has the children's ward). */
export const B2_DESK: Actor = {
  staffId: "stf_test_b2_desk",
  role: "receptionist",
  branchId: "B2",
  name: "B2 desk",
  authorities: [],
}

export const B2_CASHIER: Actor = { ...B2_DESK, staffId: "stf_test_b2_cash", role: "cashier" }

/** A fresh seeded database with the demo clock at 09:30 Dhaka today. */
export async function seededDb(name: string): Promise<MedcoreDb> {
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "09:30") - Date.now())
  const db = new MedcoreDb(name)
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
  return db
}

export async function dropDb(db: MedcoreDb): Promise<void> {
  applyClockOffset(0)
  await db.delete()
}

/** Move the demo clock forward (the sweeper and every commit read it). */
export function advance(ms: number): void {
  applyClockOffset(getClockOffset() + ms)
}

export const ONE_DAY = DAY

/** Wards of a branch, optionally of one kind. */
export async function wardsAt(
  db: MedcoreDb,
  branch: BranchCode,
  kind?: WardRow["kind"]
): Promise<WardRow[]> {
  const wards = await db.wards.where("branchId").equals(branch).toArray()
  return wards.filter((w) => !kind || w.kind === kind).sort((a, b) => a.code.localeCompare(b.code))
}

/** A bed in a state at a branch (optionally in a ward kind), or throws. */
export async function bedAt(
  db: MedcoreDb,
  branch: BranchCode,
  status: BedRow["status"],
  opts: { kind?: WardRow["kind"]; except?: string[]; wardId?: string } = {}
): Promise<BedRow> {
  const wards = new Map((await wardsAt(db, branch, opts.kind)).map((w) => [w.id, w]))
  const beds = (await db.beds.where("branchId").equals(branch).toArray())
    .filter(
      (b) =>
        b.status === status &&
        wards.has(b.wardId) &&
        (!opts.wardId || b.wardId === opts.wardId) &&
        !(opts.except ?? []).includes(b.id)
    )
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))
  if (!beds.length) throw new Error(`no ${status} bed at ${branch} ${opts.kind ?? ""}`)
  return beds[0]
}

/** A vacant bed at a branch: a cabin while any is left, otherwise any ward. */
export async function vacantBed(db: MedcoreDb, branch: BranchCode = "B1"): Promise<BedRow> {
  try {
    return await bedAt(db, branch, "vacant", { kind: "cabin" })
  } catch {
    return bedAt(db, branch, "vacant")
  }
}

/** A demo-clock moment taken inside a commit that ran between `before` and now. */
export function expectDuring(value: number | undefined, before: number): void {
  expect(value).toBeGreaterThanOrEqual(before)
  expect(value).toBeLessThanOrEqual(now())
}

/** Patients admitted anywhere right now. */
async function admittedIds(db: MedcoreDb): Promise<Set<string>> {
  const rows = await db.admissions.where("status").equals("admitted").toArray()
  return new Set(rows.map((a) => a.patientId))
}

/**
 * An active patient who is not admitted and whom a ward can take: an adult
 * of the given sex by default (a child with `child`).
 */
export async function freePatient(
  db: MedcoreDb,
  opts: { sex?: Sex; child?: boolean; corporate?: boolean; except?: string[] } = {}
): Promise<PatientRow> {
  const today = dhakaDate(now())
  const busy = await admittedIds(db)
  const patients = (await db.patients.where("identityStatus").equals("active").toArray())
    .filter((p) => {
      if (busy.has(p.id) || (opts.except ?? []).includes(p.id)) return false
      if (opts.sex && p.sex !== opts.sex) return false
      const age = ageOn(p.dob, today)
      return opts.child ? age < 18 : age >= 18
    })
    .sort((a, b) => a.uhid.localeCompare(b.uhid))
  for (const patient of patients) {
    if (!opts.corporate) return patient
    if (await coverFor(dbReader(db), patient, today)) return patient
  }
  throw new Error("no free patient")
}

/** A consultant who admits at a branch. */
export async function consultantAt(db: MedcoreDb, branch: BranchCode): Promise<string> {
  const doctors = (await db.doctors.where("branchIds").equals(branch).toArray())
    .filter((d) => d.kind === "consultant")
    .sort((a, b) => a.id.localeCompare(b.id))
  if (!doctors.length) throw new Error(`no consultant at ${branch}`)
  return doctors[0].id
}

/** A patient the ward of this bed accepts (sex and age by the ward's rules). */
export async function patientFor(db: MedcoreDb, bed: BedRow, except: string[] = []) {
  const ward = (await db.wards.get(bed.wardId))!
  const today = dhakaDate(now())
  for (const sex of ["M", "F"] as const) {
    const patient = await freePatient(db, { sex, child: ward.kind === "paediatric", except })
    if (!wardRefusal(ward, patient, today)) return patient
  }
  throw new Error("no patient fits the ward")
}

/** Admit a fitting patient to a bed through the real command; returns the admission. */
export async function admitTo(
  db: MedcoreDb,
  bed: BedRow,
  opts: { actor?: Actor; patientId?: string; reason?: string } = {}
): Promise<AdmissionRow> {
  const actor = opts.actor ?? FARHANA
  const patientId = opts.patientId ?? (await patientFor(db, bed)).id
  const { result } = await commit(
    admit,
    {
      patientId,
      bedId: bed.id,
      bedVersion: bed.version,
      consultantId: await consultantAt(db, bed.branchId),
      reason: opts.reason ?? "Short stay for tests",
    },
    { db, actor }
  )
  return (await db.admissions.get(result.admissionId))!
}

/** Admitted stays at a branch with their interim bills now. */
export async function billsAt(db: MedcoreDb, branch: BranchCode) {
  const stays = await staysAt(db, branch)
  const at = now()
  return stays.map((stay: StayView) => ({ stay, bill: billOf(stay, at)! }))
}

/** The planted low-deposit cabin stay at B1 (its alert is already raised). */
export async function plantedLowStay(db: MedcoreDb): Promise<AdmissionRow> {
  const cabins = new Set((await wardsAt(db, "B1", "cabin")).map((w) => w.id))
  const stays = await staysAt(db, "B1")
  const planted = stays.filter(
    (s) => s.admission.depositAlertAt !== undefined && s.ward && cabins.has(s.ward.id)
  )
  if (planted.length !== 1) throw new Error(`expected one planted stay, found ${planted.length}`)
  return planted[0].admission
}

/** Events of a type committed after a sequence number. */
export async function eventsSince(db: MedcoreDb, seq: number, type: string) {
  return (await db.events.where("seq").above(seq).toArray()).filter((e) => e.type === type)
}

export async function lastSeq(db: MedcoreDb): Promise<number> {
  return (await db.events.orderBy("seq").last())?.seq ?? 0
}
