import { z } from "zod"

import { dhakaTime } from "@/core/clock/dates"
import { notifyPatient, queueSms } from "@/core/comms/sms"
import { newId } from "@/core/db/ids"
import type { HHMM, PatientRow } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { bnDigits } from "@/core/seed/content"

import {
  freeSlotTimes,
  isActiveAppointment,
  isSessionBookable,
  isSessionOver,
  sessionLoad,
} from "./slots"

const hhmm = z.string().regex(/^\d{2}:\d{2}$/)

/** Bangla words for the booking source, carried in event params for the BN label. */
const SOURCE_BN = {
  app: "অ্যাপ",
  call: "কল সেন্টার",
  counter: "কাউন্টার",
  "walk-in": "ওয়াক-ইন",
} as const

/** The QR payload printed on the slip and shown in the app (same format as the seed). */
export function appointmentQr(appointmentId: string): string {
  return `MC|APT|${appointmentId}`
}

/**
 * Patient-app notifications are sent unless the patient declined the app
 * purpose. The push itself is generic; no health data (plan §11).
 */
export function appNotificationsAllowed(patient: Pick<PatientRow, "consents">) {
  return patient.consents.find((c) => c.purpose === "app")?.granted !== false
}

export const bookInput = z.object({
  sessionId: z.string(),
  patientId: z.string(),
  source: z.enum(["app", "call", "counter", "walk-in"]),
  visitType: z.enum(["first", "follow-up", "report"]).default("first"),
  /** Requested slot; the first free slot when absent (walk-ins take "now") */
  slotStart: hhmm.optional(),
  smsLang: z.enum(["en", "bn"]).default("bn"),
  idempotencyKey: z.string().optional(),
})

export type BookInput = z.output<typeof bookInput>

export type BookResult = {
  appointmentId: string
  slotStart: HHMM
  feeP: number
  qrCode: string
}

/**
 * The booking itself, reusable inside other commands (the walk-in desk flow
 * books and checks in within one commit).
 */
export async function bookInTx(tx: Tx, input: BookInput): Promise<BookResult> {
  const session = await tx.get("sessions", input.sessionId)
  if (!isSessionBookable(session)) {
    tx.reject("SESSION_UNAVAILABLE", { status: session.status })
  }
  if (!session.visitTypes.includes(input.visitType)) {
    tx.reject("VISIT_TYPE_UNAVAILABLE", { visitType: input.visitType })
  }
  const patient = await tx.get("patients", input.patientId)
  if (patient.identityStatus === "merged") tx.reject("PATIENT_MERGED", { uhid: patient.uhid })

  const inSession = await tx.list("appointments", "sessionId", session.id)
  const active = inSession.filter(isActiveAppointment)
  if (active.some((a) => a.patientId === patient.id)) {
    tx.reject("ALREADY_BOOKED", { uhid: patient.uhid })
  }
  const walkIn = input.source === "walk-in"
  const load = sessionLoad(session, inSession)
  if (walkIn) {
    if (session.date !== tx.today()) tx.reject("WALK_IN_NOT_TODAY", { date: session.date })
    if (isSessionOver(session, tx.now())) tx.reject("SESSION_ENDED", {})
    if (load.walkInLeft <= 0) tx.reject("WALK_IN_QUOTA_FULL", {})
  } else if (load.bookedLeft <= 0) {
    tx.reject("SESSION_FULL", {})
  }

  let slotStart: HHMM
  if (walkIn) {
    slotStart = dhakaTime(tx.now())
  } else {
    const free = freeSlotTimes(session, inSession, tx.now())
    if (input.slotStart) {
      if (!free.includes(input.slotStart)) tx.reject("SLOT_TAKEN", { slot: input.slotStart })
      slotStart = input.slotStart
    } else {
      if (!free.length) {
        tx.reject(isSessionOver(session, tx.now()) ? "SESSION_ENDED" : "SESSION_FULL", {})
      }
      slotStart = free[0]
    }
  }

  const doctor = await tx.get("doctors", session.doctorId)
  const doctorStaff = await tx.get("staff", doctor.staffId)
  const feeP =
    input.visitType === "follow-up"
      ? session.followUpFeeP
      : input.visitType === "report"
        ? 0
        : session.feeP
  const employee = patient.corporateEmployeeId
    ? await tx.find("corporateEmployees", patient.corporateEmployeeId)
    : undefined
  const corporate = employee?.status === "active"

  const appointmentId = newId("apt")
  let feeBasketLineId: string | undefined
  if (feeP > 0) {
    feeBasketLineId = tx.insert("basketLines", {
      patientId: patient.id,
      branchId: session.branchId,
      sourceType: "consult",
      sourceId: appointmentId,
      serviceType: input.visitType === "follow-up" ? "follow-up" : "consultation",
      description: `Consultation: ${doctorStaff.nameEn}`,
      descriptionBn: `পরামর্শ: ${doctorStaff.nameBn}`,
      doctorId: doctor.id,
      qty: 1,
      unitPriceP: feeP,
      status: "open",
      payerType: corporate ? "corporate" : "self",
      corporateClientId: corporate ? employee?.clientId : undefined,
    }).id
  }
  const qrCode = appointmentQr(appointmentId)
  tx.insert("appointments", {
    id: appointmentId,
    sessionId: session.id,
    patientId: patient.id,
    doctorId: doctor.id,
    branchId: session.branchId,
    date: session.date,
    slotStart,
    source: input.source,
    visitType: input.visitType,
    status: "booked",
    bookedBy: tx.actor.staffId,
    feeBasketLineId,
    qrCode,
  })

  // A walk-in is at the desk and gets a printed token, so no booking SMS.
  const smsConsent = patient.consents.find((c) => c.purpose === "sms")
  if (!walkIn && patient.phone && smsConsent?.granted !== false) {
    queueSms(tx, {
      to: patient.phone,
      patientId: patient.id,
      lang: input.smsLang,
      templateId: "appointment-booked",
      params: {
        doctor: input.smsLang === "bn" ? doctorStaff.nameBn : doctorStaff.nameEn,
        date:
          input.smsLang === "bn"
            ? bnDigits(session.date.split("-").reverse().join("-"))
            : session.date.split("-").reverse().join("-"),
        time: input.smsLang === "bn" ? bnDigits(slotStart) : slotStart,
      },
    })
  }

  const refs = { patientId: patient.id, appointmentId, sessionId: session.id }
  if (appNotificationsAllowed(patient)) {
    notifyPatient(tx, {
      patientId: patient.id,
      kind: "appointment-booked",
      titleKey: "patientApp.notifications.appointmentBooked",
      params: {
        doctor: doctorStaff.nameEn,
        doctorBn: doctorStaff.nameBn,
        date: session.date,
        time: slotStart,
        source: input.source,
      },
      refs,
    })
  }
  tx.emit("AppointmentBooked", {
    branchId: session.branchId,
    refs,
    params: {
      doctor: doctorStaff.nameEn,
      doctorBn: doctorStaff.nameBn,
      date: session.date,
      time: slotStart,
      timeBn: bnDigits(slotStart),
      source: input.source,
      sourceBn: SOURCE_BN[input.source],
    },
  })
  return { appointmentId, slotStart, feeP, qrCode }
}

/**
 * Book an appointment (plan §6 `scheduling.book`): the one scheduler shared by
 * the patient app, the call centre and the counter. Creates the appointment,
 * a consultation fee line in the patient's billing basket, a confirmation SMS
 * (not for walk-ins) and a patient-app notification. Owned by WS-A.
 */
export const bookAppointment = defineCommand({
  name: "scheduling.book",
  roles: ["receptionist", "patient", "doctor"],
  input: bookInput,
  run: bookInTx,
})
