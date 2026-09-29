import { z } from "zod"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import { defineCommand } from "@/core/engine/defineCommand"
import { nextImagingOrderNo, nextLabOrderNo } from "@/core/engine/docNumbers"
import type { Actor } from "@/core/engine/types"
import { createSpecimensForItems } from "@/core/lab/specimens"
import { seedDatabase } from "@/core/seed"

/**
 * Test fixtures for the lab workstream. Orders normally come from the doctor
 * (orders.placeTests) and are paid at the cashier (billing.checkout); these
 * fixture commands stand in for both so the lab path can be tested alone.
 */

export const labtech: Actor = {
  staffId: "stf_rubel_mia",
  personaId: "per_labtech_rubel",
  role: "labtech",
  branchId: "B1",
  name: "Rubel Mia",
  authorities: [],
}

export const pathologist: Actor = {
  staffId: "stf_mizanur_rahman",
  personaId: "per_pathologist_mizanur",
  role: "pathologist",
  branchId: "B1",
  name: "Dr. Mizanur Rahman",
  authorities: ["sign:reports"],
}

export const doctor: Actor = {
  staffId: "stf_kamal_hossain",
  personaId: "per_doctor_kamal",
  role: "doctor",
  branchId: "B1",
  name: "Dr. Kamal Hossain",
  authorities: [],
}

export const system: Actor = {
  staffId: "system",
  role: "system",
  branchId: null,
  name: "System",
  authorities: ["*"],
}

/** A lab order with items (paid, or not) and their specimens awaiting collection. */
export const placeLabOrder = defineCommand({
  name: "test.placeLabOrder",
  roles: "any",
  input: z.object({
    patientId: z.string(),
    doctorId: z.string().optional(),
    testIds: z.array(z.string()).min(1),
    paid: z.boolean().default(true),
  }),
  async run(tx, input) {
    const orderNo = await nextLabOrderNo(tx, "B1")
    const order = tx.insert("labOrders", {
      orderNo,
      patientId: input.patientId,
      doctorId: input.doctorId,
      branchId: "B1",
      priority: "routine",
      status: input.paid ? "in-progress" : "ordered",
      source: input.doctorId ? "doctor" : "counter",
    })
    const items = input.testIds.map((testId) =>
      tx.insert("labOrderItems", {
        labOrderId: order.id,
        patientId: input.patientId,
        branchId: "B1",
        testId,
        status: input.paid ? "paid" : "ordered",
        paymentCleared: input.paid,
      })
    )
    const specimens = await createSpecimensForItems(tx, items)
    return {
      orderId: order.id,
      orderNo,
      itemIds: items.map((i) => i.id),
      specimens: specimens.map((s) => ({
        id: s.id,
        accessionNo: s.accessionNo,
        container: s.container,
        itemIds: s.itemIds,
      })),
    }
  },
})

/** Flip the payment gate on items (a reversed payment, then a new one). */
export const setPaymentCleared = defineCommand({
  name: "test.setPaymentCleared",
  roles: "any",
  input: z.object({ itemIds: z.array(z.string()), cleared: z.boolean() }),
  async run(tx, input) {
    for (const id of input.itemIds) {
      await tx.update("labOrderItems", id, { paymentCleared: input.cleared })
    }
  },
})

/** Tries to edit a released report's content directly (must hit INV-04). */
export const tamperReport = defineCommand({
  name: "test.tamperReport",
  roles: "any",
  input: z.object({ reportId: z.string() }),
  async run(tx, input) {
    await tx.update("labReports", input.reportId, { hash: "0".repeat(64) })
  },
})

/** A paid imaging order at B1, as billing would leave it. */
export const placeImagingOrder = defineCommand({
  name: "test.placeImagingOrder",
  roles: "any",
  input: z.object({
    patientId: z.string(),
    doctorId: z.string().optional(),
    testId: z.string(),
    paid: z.boolean().default(true),
  }),
  async run(tx, input) {
    const test = await tx.get("labTests", input.testId)
    const orderNo = await nextImagingOrderNo(tx, "B1")
    const order = tx.insert("imagingOrders", {
      orderNo,
      patientId: input.patientId,
      doctorId: input.doctorId,
      branchId: "B1",
      testId: test.id,
      modality: test.modality ?? "xray",
      bodyPart: "Chest",
      indication: "Cough for 5 days",
      contrast: false,
      status: input.paid ? "paid" : "ordered",
      paymentCleared: input.paid,
    })
    return { imagingOrderId: order.id, orderNo }
  },
})

/**
 * A fresh seeded database with the demo clock pinned to 09:30 Dhaka today
 * (as the other workstreams' tests do).
 */
export async function seededDb(name: string): Promise<MedcoreDb> {
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "09:30") - Date.now())
  const db = new MedcoreDb(name)
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
  return db
}

export function releaseClock(): void {
  applyClockOffset(0)
}
