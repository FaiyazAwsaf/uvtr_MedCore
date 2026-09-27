import { z } from "zod"

import { defineCommand } from "@/core/engine/defineCommand"

/**
 * Phase 1 engine check (plan P1.9): edit a patient's phone with optimistic
 * concurrency, so the checkpoint can show live sync, the conflict dialog and
 * the audit trail before the real registration screens exist.
 */
export const touchPatient = defineCommand({
  name: "demo.touchPatient",
  roles: "any",
  input: z.object({
    patientId: z.string(),
    phone: z.string().regex(/^01\d{3}-?\d{6}$/),
    expectedVersion: z.number().int(),
  }),
  async run(tx, input) {
    const patient = await tx.update(
      "patients",
      input.patientId,
      { phone: input.phone },
      { expectedVersion: input.expectedVersion }
    )
    tx.emit("PatientContactUpdated", {
      refs: { patientId: patient.id },
      params: { uhid: patient.uhid },
    })
    return { version: patient.version }
  },
})
