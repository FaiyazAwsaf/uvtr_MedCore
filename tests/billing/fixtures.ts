import { expect } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { seedRow } from "@/core/db/base"
import { MedcoreDb } from "@/core/db/database"
import type {
  AppointmentRow,
  BaseRow,
  BasketLineRow,
  Id,
  ImagingOrderRow,
  LabOrderItemRow,
  LabOrderRow,
  PrescriptionRow,
  RxLineRow,
} from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import type { Actor } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { bookAppointment } from "@/modules/scheduling/commands"

/**
 * Billing test fixtures: a seeded database at 09:30 Dhaka (see
 * tests/scheduling/queue.test.ts) and the hero's open basket as WS-B's
 * contract commands would leave it: a consultation from `scheduling.book`,
 * CBC and CRP lab items, a chest X-ray, and a signed prescription whose
 * lines are in the basket.
 */

export const RAFIQ: Actor = {
  staffId: "stf_rafiq_ahmed",
  personaId: "per_cashier_rafiq",
  role: "cashier",
  branchId: "B1",
  name: "Rafiq Ahmed",
  authorities: ["discount:5"],
}

export const NASRIN: Actor = {
  staffId: "stf_nasrin_jahan",
  personaId: "per_cashier_nasrin",
  role: "cashier",
  branchId: "B1",
  name: "Nasrin Jahan",
  authorities: [
    "discount:15",
    "approve:variance",
    "approve:refund",
    "approve:cancel-after-collection",
  ],
}

export const B3_CASHIER: Actor = {
  staffId: "stf_b3_shamima",
  role: "cashier",
  branchId: "B3",
  name: "B3 cashier",
  authorities: [],
}

export const RECEPTION: Actor = {
  staffId: "stf_farhana_akter",
  personaId: "per_reception_farhana",
  role: "receptionist",
  branchId: "B1",
  name: "Farhana Akter",
  authorities: [],
}

export const TANVIR: Actor = {
  staffId: HERO.patient.tanvirKarim,
  personaId: "per_patient_tanvir",
  role: "patient",
  branchId: null,
  name: "Tanvir Karim",
  authorities: [],
}

export const ROKEYA: Actor = {
  staffId: HERO.patient.rokeyaBegum,
  role: "patient",
  branchId: null,
  name: "Rokeya Begum",
  authorities: [],
}

let dbCounter = 0

/** A freshly seeded database with the demo clock pinned to 09:30 Dhaka today. */
export async function seededDb(prefix: string): Promise<MedcoreDb> {
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "09:30") - Date.now())
  const db = new MedcoreDb(`${prefix}-${++dbCounter}`)
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
  return db
}

export type HeroBasket = {
  patientId: Id
  appointmentId: Id
  consultLineId: Id
  labOrderId: Id
  labItemIds: Id[]
  imagingOrderId: Id
  rxId: Id
  rxLineIds: Id[]
  lineIds: Id[]
  totalP: number
}

let fixtureCounter = 0

function basketLine(
  id: Id,
  data: Omit<BasketLineRow, keyof BaseRow>
): BasketLineRow {
  return seedRow<BasketLineRow>(id, now(), data)
}

/**
 * The hero's basket after his consultation (plan §7.2): consultation fee
 * booked through `scheduling.book`, then CBC, CRP, chest X-ray and three
 * medicines written as the orders and Rx contract commands create them.
 */
export async function heroBasket(
  db: MedcoreDb,
  patientId: Id = HERO.patient.abdulKarim,
  opts: { viaBooking?: boolean } = {}
): Promise<HeroBasket> {
  const n = ++fixtureCounter
  const at = now()
  const kamal = HERO.doctor.kamal
  let appointmentId: Id
  let consultLineId: Id
  if (opts.viaBooking ?? true) {
    const booked = await commit(
      bookAppointment,
      { sessionId: SEED_REFS.session.kamalToday, patientId, source: "counter" },
      { db, actor: RECEPTION }
    )
    appointmentId = booked.result.appointmentId
    consultLineId = (await db.appointments.get(appointmentId))!.feeBasketLineId!
  } else {
    // The same rows scheduling.book writes, without taking a slot in the session.
    const session = (await db.sessions.get(SEED_REFS.session.kamalToday))!
    appointmentId = `apt_fx_${n}`
    consultLineId = `bsk_fx_${n}_consult`
    await db.appointments.add(
      seedRow<AppointmentRow>(appointmentId, at, {
        sessionId: session.id,
        patientId,
        doctorId: kamal,
        branchId: "B1",
        date: session.date,
        slotStart: "12:50",
        source: "counter",
        visitType: "first",
        status: "checked-in",
        bookedBy: RECEPTION.staffId,
        feeBasketLineId: consultLineId,
        qrCode: `MEDCORE:APT:${appointmentId}`,
      })
    )
    await db.basketLines.add(
      basketLine(consultLineId, {
        patientId,
        branchId: "B1",
        sourceType: "consult",
        sourceId: appointmentId,
        serviceType: "consultation",
        description: "Consultation: Dr. Kamal Hossain",
        descriptionBn: "পরামর্শ: ডা. কামাল হোসেন",
        doctorId: kamal,
        qty: 1,
        unitPriceP: session.feeP,
        status: "open",
        payerType: "self",
      })
    )
  }

  /* Lab: CBC and CRP */
  const labOrderId = `lo_fx_${n}`
  await db.labOrders.add(
    seedRow<LabOrderRow>(labOrderId, at, {
      orderNo: `LO-B1-9${String(n).padStart(5, "0")}`,
      patientId,
      doctorId: kamal,
      branchId: "B1",
      priority: "routine",
      status: "ordered",
      source: "doctor",
    })
  )
  const tests = [SEED_REFS.test.cbc, SEED_REFS.test.crp]
  const labItemIds: Id[] = []
  const lineIds: Id[] = [consultLineId]
  for (const testId of tests) {
    const test = (await db.labTests.get(testId))!
    const itemId = `loi_fx_${n}_${testId}`
    const lineId = `bsk_fx_${n}_${testId}`
    await db.labOrderItems.add(
      seedRow<LabOrderItemRow>(itemId, at, {
        labOrderId,
        patientId,
        branchId: "B1",
        testId,
        status: "ordered",
        basketLineId: lineId,
        paymentCleared: false,
      })
    )
    await db.basketLines.add(
      basketLine(lineId, {
        patientId,
        branchId: "B1",
        sourceType: "test",
        sourceId: itemId,
        serviceType: "lab",
        description: test.name,
        descriptionBn: test.glossBn,
        doctorId: kamal,
        qty: 1,
        unitPriceP: test.priceP,
        status: "open",
        payerType: "self",
      })
    )
    labItemIds.push(itemId)
    lineIds.push(lineId)
  }

  /* Imaging: chest X-ray */
  const xray = (await db.labTests.get(SEED_REFS.test.xrayChest))!
  const imagingOrderId = `io_fx_${n}`
  const imagingLineId = `bsk_fx_${n}_xray`
  await db.imagingOrders.add(
    seedRow<ImagingOrderRow>(imagingOrderId, at, {
      orderNo: `IO-B1-9${String(n).padStart(5, "0")}`,
      patientId,
      doctorId: kamal,
      branchId: "B1",
      testId: xray.id,
      modality: "xray",
      bodyPart: "Chest",
      indication: "Cough and fever for 5 days",
      contrast: false,
      status: "ordered",
      basketLineId: imagingLineId,
      paymentCleared: false,
    })
  )
  await db.basketLines.add(
    basketLine(imagingLineId, {
      patientId,
      branchId: "B1",
      sourceType: "imaging",
      sourceId: imagingOrderId,
      serviceType: "imaging",
      description: xray.name,
      descriptionBn: xray.glossBn,
      doctorId: kamal,
      qty: 1,
      unitPriceP: xray.priceP,
      status: "open",
      payerType: "self",
    })
  )
  lineIds.push(imagingLineId)

  /* Signed prescription with three medicines */
  const rxId = `rx_fx_${n}`
  await db.prescriptions.add(
    seedRow<PrescriptionRow>(rxId, at, {
      rxNo: `RX-B1-9${String(n).padStart(5, "0")}`,
      rxVersion: 1,
      patientId,
      doctorId: kamal,
      branchId: "B1",
      status: "signed",
      mode: "in-person",
      advice: "Plenty of fluids and rest.",
      tests: ["CBC", "CRP", "X-ray chest"],
      signedAt: at,
    })
  )
  const meds: [string, number][] = [
    [SEED_REFS.brand.fexo120, 7],
    [SEED_REFS.brand.napa500, 9],
    [SEED_REFS.brand.seclo20, 14],
  ]
  const rxLineIds: Id[] = []
  for (const [index, [brandId, qty]] of meds.entries()) {
    const brand = (await db.brands.get(brandId))!
    const rxLineId = `rxl_fx_${n}_${index + 1}`
    const lineId = `bsk_fx_${n}_rx${index + 1}`
    await db.rxLines.add(
      seedRow<RxLineRow>(rxLineId, at, {
        rxId,
        patientId,
        branchId: "B1",
        lineNo: index + 1,
        brandId,
        genericId: brand.genericId,
        strength: brand.strength,
        form: brand.form,
        dosePattern: "1+0+1",
        mealTiming: "after",
        durationDays: 7,
        qtyPrescribed: qty,
        instructionsEn: "One tablet twice a day after meals",
        instructionsBn: "সকালে ১টা, রাতে ১টা, খাবারের পরে",
        isAntibiotic: brand.isAntibiotic,
        isControlled: false,
        paymentCleared: false,
        dispensedQty: 0,
        status: "open",
      })
    )
    await db.basketLines.add(
      basketLine(lineId, {
        patientId,
        branchId: "B1",
        sourceType: "rx-line",
        sourceId: rxLineId,
        serviceType: "medicine",
        description: `${brand.name} ${brand.strength}`,
        qty,
        unitPriceP: brand.unitPriceP,
        mrpP: brand.mrpP,
        status: "open",
        payerType: "self",
      })
    )
    rxLineIds.push(rxLineId)
    lineIds.push(lineId)
  }

  const lines = await db.basketLines.bulkGet(lineIds)
  const totalP = lines.reduce((sum, line) => sum + line!.qty * line!.unitPriceP, 0)
  return {
    patientId,
    appointmentId,
    consultLineId,
    labOrderId,
    labItemIds,
    imagingOrderId,
    rxId,
    rxLineIds,
    lineIds,
    totalP,
  }
}

/**
 * INV-03 from the outside: the invoice adds up, every line balances, the
 * lines add up to the invoice, and paid equals the confirmed payments.
 */
export async function expectBalanced(db: MedcoreDb, invoiceId: Id): Promise<void> {
  const invoice = (await db.invoices.get(invoiceId))!
  const lines = await db.invoiceLines.where("invoiceId").equals(invoiceId).toArray()
  const payments = await db.payments.where("invoiceId").equals(invoiceId).toArray()
  expect(invoice.totalP).toBe(invoice.subtotalP - invoice.discountP + invoice.taxP)
  for (const line of lines) {
    expect(line.amountP).toBe(line.qty * line.unitPriceP)
    expect(line.netP).toBe(line.amountP - line.discountP)
    expect(line.discountP).toBeGreaterThanOrEqual(0)
    expect(line.netP).toBeGreaterThanOrEqual(0)
  }
  expect(lines.reduce((sum, line) => sum + line.amountP, 0)).toBe(invoice.subtotalP)
  expect(lines.reduce((sum, line) => sum + line.discountP, 0)).toBe(invoice.discountP)
  expect(lines.reduce((sum, line) => sum + line.netP, 0)).toBe(invoice.totalP)
  const confirmed = payments
    .filter((p) => p.status === "confirmed")
    .reduce((sum, p) => sum + p.amountP, 0)
  expect(invoice.paidP).toBe(confirmed)
  expect(invoice.paidP).toBeLessThanOrEqual(invoice.totalP)
  expect(invoice.status === "paid").toBe(invoice.paidP === invoice.totalP)
}

export function resetClock(): void {
  applyClockOffset(0)
}
