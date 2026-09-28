import { z } from "zod"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import type { Refs } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Actor } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { HERO } from "@/core/seed/content"
import { fefoAllocate } from "@/core/stock/availability"
import { startConsultation } from "@/modules/consultation/commands"
import { callToken, checkIn } from "@/modules/queue/commands"
import { bookAppointment } from "@/modules/scheduling/commands"

export const reception: Actor = {
  staffId: "stf_farhana_akter",
  personaId: "per_reception_farhana",
  role: "receptionist",
  branchId: "B1",
  name: "Farhana Akter",
  authorities: [],
}

export const kamal: Actor = {
  staffId: "stf_kamal_hossain",
  personaId: "per_doctor_kamal",
  role: "doctor",
  branchId: "B1",
  name: "Dr. Kamal Hossain",
  authorities: [],
}

export const arif: Actor = {
  staffId: "stf_arif_rahman",
  personaId: "per_doctor_arif",
  role: "doctor",
  branchId: "B1",
  name: "Dr. Arif Rahman",
  authorities: [],
}

export const shirin: Actor = {
  staffId: "stf_shirin_sultana",
  personaId: "per_pharmacist_shirin",
  role: "pharmacist",
  branchId: "B1",
  name: "Shirin Sultana",
  authorities: ["dispense:controlled"],
}

export const KAMAL_SESSION = "ses_kamal_today"

/** A fresh seeded database with the demo clock at 09:30 Dhaka (before the 10:00 clinic). */
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

/** Book, check in and call a patient in Dr. Kamal's session, then start the consultation. */
export async function startVisit(
  db: MedcoreDb,
  patientId: string = HERO.patient.abdulKarim
): Promise<{ appointmentId: string; tokenId: string; encounterId: string }> {
  const booked = await commit(
    bookAppointment,
    { sessionId: KAMAL_SESSION, patientId, source: "counter" },
    { db, actor: reception }
  )
  const token = await commit(
    checkIn,
    { appointmentId: booked.result.appointmentId },
    { db, actor: reception }
  )
  await commit(callToken, { tokenId: token.result.tokenId }, { db, actor: kamal })
  const started = await commit(
    startConsultation,
    { appointmentId: booked.result.appointmentId },
    { db, actor: kamal }
  )
  return {
    appointmentId: booked.result.appointmentId,
    tokenId: token.result.tokenId,
    encounterId: started.result.encounterId,
  }
}

/**
 * Test stand-in for the pharmacy's dispense (WS-E): marks the line paid,
 * dispenses FEFO batches and moves stock, exactly as the invariants demand.
 */
export const testDispense = defineCommand({
  name: "test.dispense",
  roles: "any",
  input: z.object({ rxLineId: z.string(), qty: z.number().int().positive() }),
  async run(tx, input) {
    const line = await tx.get("rxLines", input.rxLineId)
    const brand = await tx.get("brands", line.brandId!)
    const levels = await tx.list("stockLevels", "[branchId+brandId]", [line.branchId, brand.id])
    const batches = await Promise.all(levels.map((l) => tx.get("batches", l.batchId)))
    const { picks } = fefoAllocate(input.qty, line.branchId, brand.id, levels, batches, tx.today())
    await tx.update("rxLines", line.id, { paymentCleared: true })
    let given = 0
    for (const pick of picks) {
      await tx.update("stockLevels", pick.level.id, { qty: pick.level.qty - pick.take })
      tx.insert("dispenses", {
        rxId: line.rxId,
        rxLineId: line.id,
        patientId: line.patientId,
        branchId: line.branchId,
        saleType: "rx",
        brandId: brand.id,
        batchId: pick.batch.id,
        qty: pick.take,
        unitPriceP: brand.unitPriceP,
        pharmacistId: tx.actor.staffId,
        pharmacyCouncilNo: "PCB-B-10234",
        labelPrinted: true,
        counselled: true,
        outstandingQty: Math.max(0, line.qtyPrescribed - given - pick.take),
        at: tx.now(),
      })
      given += pick.take
    }
    await tx.update("rxLines", line.id, {
      dispensedQty: line.dispensedQty + given,
      status: line.dispensedQty + given >= line.qtyPrescribed ? "dispensed" : "partial",
    })
    return { given }
  },
})

/** Test stand-in for `pharmacy.requestSubstitution` (WS-E). */
export const testRequestSubstitution = defineCommand({
  name: "test.requestSubstitution",
  roles: "any",
  input: z.object({ rxLineId: z.string(), proposedBrandId: z.string(), reason: z.string() }),
  async run(tx, input) {
    const line = await tx.get("rxLines", input.rxLineId)
    const rx = await tx.get("prescriptions", line.rxId)
    const sub = tx.insert("substitutionRequests", {
      rxId: rx.id,
      rxLineId: line.id,
      patientId: rx.patientId,
      doctorId: rx.doctorId,
      branchId: rx.branchId,
      proposedBrandId: input.proposedBrandId,
      reason: input.reason,
      requestedBy: tx.actor.staffId,
      status: "pending",
    })
    const refs: Refs = {
      patientId: rx.patientId,
      rxId: rx.id,
      rxLineId: line.id,
      substitutionId: sub.id,
    }
    tx.insert("inboxItems", {
      doctorId: rx.doctorId,
      patientId: rx.patientId,
      kind: "substitution",
      refs,
      titleKey: "consultation.inbox.kind.substitution",
      status: "unread",
    })
    await tx.update("rxLines", line.id, { status: "awaiting-prescriber" })
    return { substitutionId: sub.id }
  },
})

/** Test stand-in for a released result reaching the doctor's inbox (WS-D). */
export const testInboxItem = defineCommand({
  name: "test.inboxItem",
  roles: "any",
  input: z.object({
    doctorId: z.string(),
    patientId: z.string(),
    kind: z.enum(["result", "abnormal", "critical", "corrected"]),
  }),
  async run(tx, input) {
    return tx.insert("inboxItems", {
      doctorId: input.doctorId,
      patientId: input.patientId,
      kind: input.kind,
      refs: { patientId: input.patientId },
      titleKey: `consultation.inbox.kind.${input.kind}`,
      status: "unread",
    }).id
  },
})

/** Test stand-in for a validated critical result on file (WS-D's analyser and validation). */
export const testCriticalResult = defineCommand({
  name: "test.criticalResult",
  roles: "any",
  input: z.object({ patientId: z.string() }),
  async run(tx, input) {
    return tx.insert("results", {
      labOrderItemId: "loi_test_k",
      patientId: input.patientId,
      testId: "lt_k",
      analyteCode: "K",
      value: 6.8,
      unit: "mmol/L",
      flag: "HH",
      critical: true,
      source: "analyser",
      status: "validated",
      validatedBy: "stf_rubel_mia",
      validatedAt: tx.now(),
    }).id
  },
})
