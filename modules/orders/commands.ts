import { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import { newId } from "@/core/db/ids"
import type { LabOrderItemRow, LabTestRow } from "@/core/db/schema"
import { nextImagingOrderNo, nextLabOrderNo } from "@/core/engine/docNumbers"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { createSpecimensForItems } from "@/core/lab/specimens"
import {
  activeEmployee,
  actorDoctor,
  payerFor,
  writableEncounter,
} from "@/modules/consultation/server"

import { bodyPartOf } from "./catalog"

/**
 * Test and imaging orders (plan §6 `orders.placeTests`, WS-B). One commit
 * reaches the lab worklist and the billing basket at the same time: each
 * order item gets its own basket line (the record the payment unlocks).
 * Items start unpaid, so collection waits for payment (INV-10), except for a
 * corporate employee, whose company is billed (the payment-gate bypass).
 */

async function orderContext(
  tx: Tx,
  patientId: string,
  encounterId: string | undefined
) {
  const patient = await tx.get("patients", patientId)
  const encounter = encounterId
    ? await writableEncounter(tx, encounterId)
    : undefined
  if (encounter && encounter.patientId !== patient.id)
    tx.reject("WRONG_PATIENT", {})
  const doctor = await actorDoctor(tx)
  const branch = (encounter?.branchId ?? tx.actor.branchId) as BranchCode | null
  if (!branch) tx.reject("BRANCH_REQUIRED", {})
  const employee = await activeEmployee(tx, patient)
  return {
    patient,
    encounter,
    doctorId: encounter?.doctorId ?? doctor?.id,
    branch: branch!,
    employee,
  }
}

async function testsOf(
  tx: Tx,
  ids: string[],
  kind: LabTestRow["kind"]
): Promise<LabTestRow[]> {
  const tests: LabTestRow[] = []
  for (const id of [...new Set(ids)]) {
    const test = await tx.get("labTests", id)
    if (test.kind !== kind) tx.reject("TEST_KIND", { test: test.name })
    tests.push(test)
  }
  return tests
}

/** Tests already ordered (and not cancelled) in this encounter. */
async function orderedInEncounter(
  tx: Tx,
  encounterId: string | undefined
): Promise<Set<string>> {
  const ids = new Set<string>()
  if (!encounterId) return ids
  for (const order of await tx.list("labOrders", "encounterId", encounterId)) {
    if (order.status === "cancelled") continue
    for (const item of await tx.list("labOrderItems", "labOrderId", order.id)) {
      if (item.status !== "cancelled") ids.add(item.testId)
    }
  }
  for (const order of await tx.list(
    "imagingOrders",
    "encounterId",
    encounterId
  )) {
    if (order.status !== "cancelled") ids.add(order.testId)
  }
  return ids
}

/** Order lab tests: a lab order with its items (status ordered) and a basket line per item. */
export const placeTests = defineCommand({
  name: "orders.placeTests",
  roles: ["doctor"],
  input: z.object({
    patientId: z.string(),
    encounterId: z.string().optional(),
    testIds: z.array(z.string()).min(1).max(30),
    priority: z.enum(["routine", "urgent"]).default("routine"),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const ctx = await orderContext(tx, input.patientId, input.encounterId)
    const tests = await testsOf(tx, input.testIds, "lab")
    const already = await orderedInEncounter(tx, ctx.encounter?.id)
    const repeat = tests.find((t) => already.has(t.id))
    if (repeat) tx.reject("DUPLICATE_TEST", { test: repeat.name })

    const corporate = !!ctx.employee
    const orderNo = await nextLabOrderNo(tx, ctx.branch)
    const order = tx.insert("labOrders", {
      orderNo,
      encounterId: ctx.encounter?.id,
      patientId: ctx.patient.id,
      doctorId: ctx.doctorId,
      branchId: ctx.branch,
      priority: input.priority,
      status: "ordered",
      source: "doctor",
    })
    const items: LabOrderItemRow[] = []
    for (const test of tests) {
      const itemId = newId("loi")
      const basketLineId = newId("bsk")
      tx.insert("basketLines", {
        id: basketLineId,
        patientId: ctx.patient.id,
        branchId: ctx.branch,
        sourceType: "test",
        sourceId: itemId,
        serviceType: "lab",
        description: test.name,
        descriptionBn: test.glossBn,
        doctorId: ctx.doctorId,
        qty: 1,
        unitPriceP: test.priceP,
        status: "open",
        ...payerFor(ctx.employee),
      })
      items.push(
        tx.insert("labOrderItems", {
          id: itemId,
          labOrderId: order.id,
          patientId: ctx.patient.id,
          branchId: ctx.branch,
          testId: test.id,
          status: "ordered",
          basketLineId,
          paymentCleared: corporate,
        })
      )
    }
    // A corporate employee's samples can be taken straight away.
    if (corporate) await createSpecimensForItems(tx, items)
    tx.emit("TestOrdered", {
      branchId: ctx.branch,
      refs: {
        patientId: ctx.patient.id,
        labOrderId: order.id,
        encounterId: ctx.encounter?.id,
      },
      params: {
        orderNo,
        count: tests.length,
        tests: tests.map((t) => t.code).join(", "),
      },
    })
    return {
      labOrderId: order.id,
      orderNo,
      itemIds: items.map((i) => i.id),
      basketLineIds: items.map((i) => i.basketLineId!),
    }
  },
})

/** Order imaging: one imaging order per test, each with its basket line. */
export const placeImaging = defineCommand({
  name: "orders.placeImaging",
  roles: ["doctor"],
  input: z.object({
    patientId: z.string(),
    encounterId: z.string().optional(),
    testIds: z.array(z.string()).min(1).max(10),
    indication: z.string().trim().min(2).max(300),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const ctx = await orderContext(tx, input.patientId, input.encounterId)
    const tests = await testsOf(tx, input.testIds, "imaging")
    const already = await orderedInEncounter(tx, ctx.encounter?.id)
    const repeat = tests.find((t) => already.has(t.id))
    if (repeat) tx.reject("DUPLICATE_TEST", { test: repeat.name })

    const orders: {
      imagingOrderId: string
      orderNo: string
      basketLineId: string
    }[] = []
    for (const test of tests) {
      const orderId = newId("img")
      const basketLineId = newId("bsk")
      const orderNo = await nextImagingOrderNo(tx, ctx.branch)
      tx.insert("basketLines", {
        id: basketLineId,
        patientId: ctx.patient.id,
        branchId: ctx.branch,
        sourceType: "imaging",
        sourceId: orderId,
        serviceType: "imaging",
        description: test.name,
        descriptionBn: test.glossBn,
        doctorId: ctx.doctorId,
        qty: 1,
        unitPriceP: test.priceP,
        status: "open",
        ...payerFor(ctx.employee),
      })
      tx.insert("imagingOrders", {
        id: orderId,
        orderNo,
        encounterId: ctx.encounter?.id,
        patientId: ctx.patient.id,
        doctorId: ctx.doctorId,
        branchId: ctx.branch,
        testId: test.id,
        modality: test.modality ?? "xray",
        bodyPart: bodyPartOf(test),
        indication: input.indication,
        contrast: false,
        status: "ordered",
        basketLineId,
        paymentCleared: !!ctx.employee,
      })
      orders.push({ imagingOrderId: orderId, orderNo, basketLineId })
      tx.emit("ImagingOrdered", {
        branchId: ctx.branch,
        refs: {
          patientId: ctx.patient.id,
          imagingOrderId: orderId,
          encounterId: ctx.encounter?.id,
        },
        params: { orderNo, test: test.code },
      })
    }
    return { orders }
  },
})
