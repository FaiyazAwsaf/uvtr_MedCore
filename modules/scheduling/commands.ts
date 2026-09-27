import { z } from "zod"

import { atDhaka, dhakaTime, MINUTE } from "@/core/clock/dates"
import { queueSms } from "@/core/comms/sms"
import { newId } from "@/core/db/ids"
import type { AppointmentRow, HHMM } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"

const hhmm = z.string().regex(/^\d{2}:\d{2}$/)

/** Appointments that still hold a place in a session. */
const ACTIVE: AppointmentRow["status"][] = ["booked", "checked-in", "in-consult", "done"]

function slotTimes(start: HHMM, end: HHMM, slotMin: number): HHMM[] {
  const [sh, sm] = start.split(":").map(Number)
  const [eh, em] = end.split(":").map(Number)
  const out: HHMM[] = []
  for (let m = sh * 60 + sm; m + slotMin <= eh * 60 + em; m += slotMin) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`)
  }
  return out
}

/**
 * Book an appointment (plan §6 `scheduling.book`): the one scheduler shared by
 * the patient app, the call centre and the counter. Creates the appointment,
 * a consultation fee line in the patient's billing basket, and a confirmation
 * SMS. Owned by WS-A (front desk), which may extend it.
 */
export const bookAppointment = defineCommand({
  name: "scheduling.book",
  roles: ["receptionist", "patient", "doctor"],
  input: z.object({
    sessionId: z.string(),
    patientId: z.string(),
    source: z.enum(["app", "call", "counter", "walk-in"]),
    visitType: z.enum(["first", "follow-up", "report"]).default("first"),
    /** Requested slot; the first free slot when absent (walk-ins take "now") */
    slotStart: hhmm.optional(),
    smsLang: z.enum(["en", "bn"]).default("bn"),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const session = await tx.get("sessions", input.sessionId)
    if (session.status === "blocked" || session.status === "closed") {
      tx.reject("SESSION_UNAVAILABLE", { status: session.status })
    }
    const patient = await tx.get("patients", input.patientId)
    if (patient.identityStatus === "merged") tx.reject("PATIENT_MERGED", { uhid: patient.uhid })

    const inSession = (await tx.list("appointments", "sessionId", session.id)).filter((a) =>
      ACTIVE.includes(a.status)
    )
    if (inSession.some((a) => a.patientId === patient.id)) {
      tx.reject("ALREADY_BOOKED", { uhid: patient.uhid })
    }
    const walkIn = input.source === "walk-in"
    const walkIns = inSession.filter((a) => a.source === "walk-in").length
    const booked = inSession.length - walkIns
    if (walkIn && walkIns >= session.walkInQuota) tx.reject("WALK_IN_QUOTA_FULL", {})
    if (!walkIn && booked >= session.capacity - session.walkInQuota) {
      tx.reject("SESSION_FULL", {})
    }

    let slotStart: HHMM
    if (walkIn) {
      slotStart = dhakaTime(tx.now())
    } else {
      const taken = new Set(inSession.filter((a) => a.source !== "walk-in").map((a) => a.slotStart))
      const free = slotTimes(session.start, session.end, session.slotMin).filter(
        (s) => !taken.has(s) && atDhaka(session.date, s) + session.slotMin * MINUTE > tx.now()
      )
      if (input.slotStart) {
        if (!free.includes(input.slotStart)) tx.reject("SLOT_TAKEN", { slot: input.slotStart })
        slotStart = input.slotStart
      } else {
        if (!free.length) tx.reject("SESSION_FULL", {})
        slotStart = free[0]
      }
    }

    const doctor = await tx.get("doctors", session.doctorId)
    const doctorStaff = await tx.get("staff", doctor.staffId)
    const feeP = input.visitType === "follow-up" ? session.followUpFeeP : input.visitType === "report" ? 0 : session.feeP
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
      qrCode: `MEDCORE:APT:${appointmentId}`,
    })

    const smsConsent = patient.consents.find((c) => c.purpose === "sms")
    if (patient.phone && smsConsent?.granted !== false) {
      queueSms(tx, {
        to: patient.phone,
        patientId: patient.id,
        lang: input.smsLang,
        templateId: "appointment-booked",
        params: {
          doctor: input.smsLang === "bn" ? doctorStaff.nameBn : doctorStaff.nameEn,
          date: session.date.split("-").reverse().join("-"),
          time: slotStart,
        },
      })
    }
    tx.emit("AppointmentBooked", {
      branchId: session.branchId,
      refs: { patientId: patient.id, appointmentId, sessionId: session.id },
      params: { doctor: doctorStaff.nameEn, time: slotStart, source: input.source },
    })
    return { appointmentId, slotStart, feeP }
  },
})
