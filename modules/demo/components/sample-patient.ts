import { z } from "zod"

import { nextUhid } from "@/core/engine/docNumbers"
import { defineCommand } from "@/core/engine/defineCommand"

/**
 * Developer helper behind the engine check: registers one synthetic adult
 * patient when the patients table is empty (before the full seed ships), so
 * the live-sync and conflict checks have a record to edit. It is hidden as
 * soon as any patient exists, and it is idempotent: with patients present it
 * returns the first one instead of inserting.
 */
export const createSamplePatient = defineCommand({
  name: "demo.createSamplePatient",
  roles: "any",
  input: z.object({}),
  async run(tx) {
    const [existing] = await tx.db.patients.limit(1).toArray()
    if (existing) return { patientId: existing.id, created: false }

    const branch = tx.actor.branchId ?? "B1"
    const { uhid, provisional } = await nextUhid(tx)
    const patient = tx.insert("patients", {
      uhid,
      ...(provisional ? { provisionalUhid: uhid } : {}),
      aliases: [],
      identityStatus: "active",
      nameEn: "Sample Patient",
      nameBn: "নমুনা রোগী",
      nameSearchKeys: ["sample", "patient"],
      dob: "1984-03-12",
      sex: "M",
      phone: "01711-000001",
      phoneVerified: false,
      allergies: [],
      currentMeds: [],
      problems: [],
      photoSeed: "sample-patient",
      consents: [],
      registrationNote: "Engine check sample (synthetic)",
      registeredAtBranch: branch,
    })
    tx.emit("PatientRegistered", {
      refs: { patientId: patient.id },
      params: { name: patient.nameEn, uhid: patient.uhid },
    })
    return { patientId: patient.id, created: true }
  },
})
