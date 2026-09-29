import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { ConflictError, PermissionDenied } from "@/core/engine/errors"
import { dbReader } from "@/modules/billing/queries"
import { coverFor } from "@/modules/billing/settle"
import { admit } from "@/modules/inpatient/commands"

import {
  admitTo,
  B2_DESK,
  bedAt,
  consultantAt,
  dropDb,
  eventsSince,
  expectDuring,
  FARHANA,
  freePatient,
  lastSeq,
  patientFor,
  RAFIQ,
  seededDb,
  vacantBed,
  wardsAt,
} from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("inpatient-admit")
})
afterAll(async () => {
  await dropDb(db)
})

const input = async (bedId: string, patientId: string, extra: Record<string, unknown> = {}) => {
  const bed = (await db.beds.get(bedId))!
  return {
    patientId,
    bedId,
    bedVersion: bed.version,
    consultantId: await consultantAt(db, bed.branchId),
    reason: "Observation and IV fluids",
    ...extra,
  }
}

describe("inpatient.admit", () => {
  it("admits to a vacant cabin bed: the bed turns occupied, the stay is numbered, the event names both languages", async () => {
    const seq = await lastSeq(db)
    const bed = await bedAt(db, "B1", "vacant", { kind: "cabin" })
    const patient = await patientFor(db, bed)
    const before = now()
    const { result } = await commit(admit, await input(bed.id, patient.id), { db, actor: FARHANA })

    expect(result.admissionNo).toMatch(/^ADM-B1-\d{6}$/)
    expect(Number(result.admissionNo.slice(-6))).toBeGreaterThan(1400)
    const admission = (await db.admissions.get(result.admissionId))!
    expect(admission).toMatchObject({
      patientId: patient.id,
      branchId: "B1",
      bedId: bed.id,
      status: "admitted",
      reason: "Observation and IV fluids",
    })
    expectDuring(admission.admittedAt, before)
    expect(admission.depositAlertAt).toBeUndefined()
    const after = (await db.beds.get(bed.id))!
    expect(after).toMatchObject({ status: "occupied", admissionId: admission.id, version: bed.version + 1 })

    const [event] = await eventsSince(db, seq, "PatientAdmitted")
    expect(event.branchId).toBe("B1")
    expect(event.refs).toMatchObject({ patientId: patient.id, admissionId: admission.id, bedId: bed.id })
    expect(event.params).toMatchObject({
      admissionNo: result.admissionNo,
      bed: bed.code,
      patient: patient.nameEn,
      patientBn: patient.nameBn,
    })
    expect(String(event.params.wardBn)).toContain("কেবিন")
    expect(event.params.consultant).toBeTruthy()
    expect(event.params.consultantBn).toBeTruthy()
  })

  it("keeps the patient's corporate cover on the stay", async () => {
    const patient = await freePatient(db, { corporate: true })
    const cover = await coverFor(dbReader(db), patient, dhakaDate(now()))
    const bed = await vacantBed(db)
    const admission = await admitTo(db, bed, { patientId: patient.id })
    expect(admission.corporateClientId).toBe(cover!.clientId)
  })

  it("admits into a reserved bed too", async () => {
    const reserved = await bedAt(db, "B1", "reserved")
    const admission = await admitTo(db, reserved)
    expect((await db.beds.get(reserved.id))!.status).toBe("occupied")
    expect(admission.bedId).toBe(reserved.id)
  })

  it("refuses a patient who is already admitted", async () => {
    const stay = (await db.admissions.where("branchId").equals("B2").toArray()).find(
      (a) => a.status === "admitted"
    )!
    const bed = await vacantBed(db)
    await expect(
      commit(admit, await input(bed.id, stay.patientId), { db, actor: FARHANA })
    ).rejects.toMatchObject({ code: "ALREADY_ADMITTED", params: { admissionNo: stay.admissionNo } })
  })

  it("refuses occupied, cleaning and other-branch beds", async () => {
    const patient = await freePatient(db, { sex: "M" })
    const occupied = await bedAt(db, "B1", "occupied", { kind: "cabin" })
    await expect(commit(admit, await input(occupied.id, patient.id), { db, actor: FARHANA })).rejects.toMatchObject({
      code: "BED_OCCUPIED",
    })
    const cleaning = await bedAt(db, "B1", "cleaning", { kind: "cabin" })
    await expect(commit(admit, await input(cleaning.id, patient.id), { db, actor: FARHANA })).rejects.toMatchObject({
      code: "BED_BEING_CLEANED",
    })
    const elsewhere = await bedAt(db, "B2", "vacant", { kind: "general" })
    await expect(commit(admit, await input(elsewhere.id, patient.id), { db, actor: FARHANA })).rejects.toMatchObject({
      code: "BED_OTHER_BRANCH",
      params: { branch: "B2" },
    })
  })

  it("keeps the men's and women's wards and the children's ward", async () => {
    const [male] = (await wardsAt(db, "B1", "general")).filter((w) => w.name.en.includes("(male)"))
    const [female] = (await wardsAt(db, "B1", "general")).filter((w) => w.name.en.includes("(female)"))
    const woman = await freePatient(db, { sex: "F" })
    const man = await freePatient(db, { sex: "M" })
    const maleBed = await bedAt(db, "B1", "vacant", { wardId: male.id })
    const femaleBed = await bedAt(db, "B1", "vacant", { wardId: female.id })
    await expect(commit(admit, await input(maleBed.id, woman.id), { db, actor: FARHANA })).rejects.toMatchObject({
      code: "WARD_FOR_MALE",
      params: { ward: male.code },
    })
    await expect(commit(admit, await input(femaleBed.id, man.id), { db, actor: FARHANA })).rejects.toMatchObject({
      code: "WARD_FOR_FEMALE",
    })
    const children = await bedAt(db, "B2", "vacant", { kind: "paediatric" })
    await expect(commit(admit, await input(children.id, man.id), { db, actor: B2_DESK })).rejects.toMatchObject({
      code: "WARD_PAEDIATRIC_ONLY",
    })
    const child = await freePatient(db, { child: true })
    const paediatric = await admitTo(db, children, { actor: B2_DESK, patientId: child.id })
    expect(paediatric.branchId).toBe("B2")
  })

  it("needs a consultant who admits at the branch and a reason", async () => {
    const bed = await vacantBed(db)
    const patient = await patientFor(db, bed)
    const medicalOfficer = (await db.doctors.where("kind").equals("medical-officer").first())
    if (medicalOfficer) {
      await expect(
        commit(admit, await input(bed.id, patient.id, { consultantId: medicalOfficer.id }), { db, actor: FARHANA })
      ).rejects.toMatchObject({ code: "NOT_A_CONSULTANT" })
    }
    const away = (await db.doctors.where("kind").equals("consultant").toArray()).find(
      (d) => !d.branchIds.includes("B1")
    )!
    await expect(
      commit(admit, await input(bed.id, patient.id, { consultantId: away.id }), { db, actor: FARHANA })
    ).rejects.toMatchObject({ code: "CONSULTANT_NOT_AT_BRANCH", params: { branch: "B1" } })
    await expect(
      commit(admit, await input(bed.id, patient.id, { reason: "   " }), { db, actor: FARHANA })
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" })
  })

  it("refuses a merged record, pointing at the surviving UHID", async () => {
    const merged = (await db.patients.where("identityStatus").equals("merged").first())!
    const survivor = (await db.patients.get(merged.mergedInto!))!
    const bed = await vacantBed(db)
    await expect(commit(admit, await input(bed.id, merged.id), { db, actor: FARHANA })).rejects.toMatchObject({
      code: "PATIENT_MERGED",
      params: { uhid: survivor.uhid },
    })
  })

  it("a second window admitting into the same bed with the version it saw gets a conflict, not a double booking", async () => {
    const bed = await vacantBed(db)
    const first = await patientFor(db, bed)
    const second = await patientFor(db, bed, [first.id])
    const stale = await input(bed.id, second.id)
    await commit(admit, await input(bed.id, first.id), { db, actor: FARHANA })
    const error = await commit(admit, stale, { db, actor: FARHANA }).catch((e) => e)
    expect(error).toBeInstanceOf(ConflictError)
    expect(error).toMatchObject({ table: "beds", id: bed.id, expectedVersion: bed.version })
    const stays = await db.admissions.where("bedId").equals(bed.id).toArray()
    expect(stays.filter((a) => a.status === "admitted")).toHaveLength(1)
  })

  it("is for reception: a cashier is denied, and a persona without a branch is refused", async () => {
    const bed = await vacantBed(db)
    const patient = await patientFor(db, bed)
    await expect(commit(admit, await input(bed.id, patient.id), { db, actor: RAFIQ })).rejects.toBeInstanceOf(
      PermissionDenied
    )
    await expect(
      commit(admit, await input(bed.id, patient.id), { db, actor: { ...FARHANA, branchId: null } })
    ).rejects.toMatchObject({ code: "NO_BRANCH" })
  })
})
