import { z } from "zod"

import { dhakaTime } from "@/core/clock/dates"
import { notifyPatient, queueSms } from "@/core/comms/sms"
import { newId } from "@/core/db/ids"
import type { HHMM, PatientRow, SessionRow } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { bnDigits } from "@/core/seed/content/bn"
import type { Locale } from "@/lib/i18n/config"
import { linkAllows } from "@/modules/patient-app/lib/family"

import {
  allowedChoices,
  DELAY_CHOICES,
  DELAY_MAX,
  DELAY_MIN,
  DELAY_REASONS,
  isAwaiting,
  isDelayReason,
  smsLangFrom,
  smsNumber,
  type DelayChoice,
  type DelayReason,
} from "./delay"
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

export type BookOptions = {
  /**
   * A consultation fee line to carry over instead of charging again (a
   * rebooked appointment keeps its fee): an open line moves to the new
   * appointment, a paid one stays paid. A removed line is not carried.
   */
  carryFeeLineId?: string
}

/**
 * The booking itself, reusable inside other commands (the walk-in desk flow
 * books and checks in within one commit; a delay rebook moves the fee line).
 */
export async function bookInTx(
  tx: Tx,
  input: BookInput,
  opts: BookOptions = {}
): Promise<BookResult> {
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
  const carried = opts.carryFeeLineId
    ? await tx.find("basketLines", opts.carryFeeLineId)
    : undefined
  if (carried && carried.status === "open") {
    // The unpaid fee moves with the patient to the new appointment.
    feeBasketLineId = (
      await tx.update("basketLines", carried.id, {
        sourceId: appointmentId,
        branchId: session.branchId,
      })
    ).id
  } else if (carried && carried.status === "invoiced") {
    // Already paid: the new appointment is covered by the same payment.
    feeBasketLineId = carried.id
  } else if (feeP > 0) {
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
  run: (tx, input) => bookInTx(tx, input),
})

/* ------------------------------------------------------------------ *
 * Doctor delay (plan §10 S11, PRD §9 Appointment)
 * ------------------------------------------------------------------ */

const DELAY_REASON_EN: Record<DelayReason, string> = {
  "earlier-session": "Earlier session ran over",
  traffic: "Held up in traffic",
  meeting: "Hospital meeting ran late",
  personal: "Personal reason",
}
const DELAY_REASON_BN: Record<DelayReason, string> = {
  "earlier-session": "আগের সেশন দেরিতে শেষ",
  traffic: "যানজট",
  meeting: "হাসপাতালের সভা",
  personal: "ব্যক্তিগত কারণ",
}

/** The patient's SMS language: the language of the last message we sent them. */
async function smsLangOf(tx: Tx, patientId: string): Promise<Locale> {
  return smsLangFrom(await tx.list("sms", "patientId", patientId))
}

const dmyOf = (date: string) => date.split("-").reverse().join("-")

export const recordDelayInput = z
  .object({
    sessionId: z.string(),
    minutes: z.number().int().min(DELAY_MIN).max(DELAY_MAX),
    /** A preset reason, or "other" with the reason typed in `reasonText` */
    reason: z.enum([...DELAY_REASONS, "other"]),
    reasonText: z.string().trim().max(120).optional(),
    /** The session version the desk saw (a second desk's change is a conflict) */
    expectedVersion: z.number().int().optional(),
    idempotencyKey: z.string().optional(),
  })
  .refine((v) => v.reason !== "other" || (v.reasonText?.length ?? 0) >= 3, {
    path: ["reasonText"],
    message: "Say why the doctor is late",
  })

export type RecordDelayResult = {
  sessionId: string
  /** Appointments told about the delay */
  recipients: number
  smsCount: number
  smsParts: number
  notified: number
}

/**
 * Record a doctor's delay (plan §10 S11): the session becomes "delayed" with
 * the minutes and the reason, every booked patient not yet seen gets an SMS
 * in their own language (template `doctor-delay`: no reason, no clinical
 * content) and a patient-app notification (the push stays generic), all in
 * one commit. Recording again updates the delay and tells them again.
 */
export const recordDelay = defineCommand({
  name: "scheduling.recordDelay",
  roles: ["receptionist"],
  input: recordDelayInput,
  async run(tx, input): Promise<RecordDelayResult> {
    const session = await tx.get("sessions", input.sessionId, {
      expectedVersion: input.expectedVersion,
    })
    if (tx.actor.branchId && session.branchId !== tx.actor.branchId) {
      tx.reject("SESSION_OTHER_BRANCH", { branch: session.branchId })
    }
    if (session.status === "blocked" || session.status === "closed") {
      tx.reject("SESSION_NOT_RUNNING", {})
    }
    if (session.date !== tx.today()) tx.reject("DELAY_NOT_TODAY", { date: session.date })

    const reason = input.reason === "other" ? (input.reasonText ?? "").trim() : input.reason
    await tx.update("sessions", session.id, {
      status: "delayed",
      delayMin: input.minutes,
      delayReason: reason,
    })

    const doctor = await tx.get("doctors", session.doctorId)
    const staff = await tx.get("staff", doctor.staffId)
    const waiting = (await tx.list("appointments", "sessionId", session.id)).filter(isAwaiting)
    let smsCount = 0
    let parts = 0
    let notified = 0
    for (const appointment of waiting) {
      const patient = await tx.get("patients", appointment.patientId)
      const to = smsNumber(patient)
      if (to) {
        const lang = await smsLangOf(tx, patient.id)
        const sms = queueSms(tx, {
          to,
          patientId: patient.id,
          lang,
          templateId: "doctor-delay",
          params: {
            doctor: lang === "bn" ? staff.nameBn : staff.nameEn,
            minutes: lang === "bn" ? bnDigits(input.minutes) : String(input.minutes),
          },
        })
        smsCount += 1
        parts += sms.parts
      }
      if (appNotificationsAllowed(patient)) {
        notifyPatient(tx, {
          patientId: patient.id,
          kind: "doctorDelayed",
          titleKey: "scheduling.notify.doctorDelayed",
          params: {
            doctor: staff.nameEn,
            doctorBn: staff.nameBn,
            minutes: input.minutes,
          },
          refs: {
            appointmentId: appointment.id,
            sessionId: session.id,
            patientId: patient.id,
          },
        })
        notified += 1
      }
    }

    tx.emit("SessionDelayed", {
      branchId: session.branchId,
      refs: { sessionId: session.id },
      params: {
        doctor: staff.nameEn,
        doctorBn: staff.nameBn,
        minutes: input.minutes,
        count: waiting.length,
        reason: isDelayReason(reason) ? DELAY_REASON_EN[reason] : reason,
        reasonBn: isDelayReason(reason) ? DELAY_REASON_BN[reason] : reason,
      },
    })
    return {
      sessionId: session.id,
      recipients: waiting.length,
      smsCount,
      smsParts: parts,
      notified,
    }
  },
})

/**
 * The doctor's next session a delayed patient can move to: the same doctor
 * at the same branch, later than this one, still taking bookings, with a
 * free time, and not one the patient already holds a place in.
 */
export async function nextSessionFor(
  tx: Tx,
  from: SessionRow,
  patientId: string
): Promise<{ session: SessionRow; slotStart: HHMM } | undefined> {
  const later = (await tx.list("sessions", "doctorId", from.doctorId))
    .filter(
      (s) =>
        s.id !== from.id &&
        s.branchId === from.branchId &&
        isSessionBookable(s) &&
        s.date >= tx.today() &&
        `${s.date} ${s.start}` > `${from.date} ${from.start}` &&
        !isSessionOver(s, tx.now())
    )
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
  for (const session of later) {
    const inSession = await tx.list("appointments", "sessionId", session.id)
    if (inSession.some((a) => a.patientId === patientId && isActiveAppointment(a))) continue
    if (sessionLoad(session, inSession).bookedLeft <= 0) continue
    const free = freeSlotTimes(session, inSession, tx.now())
    if (free.length) return { session, slotStart: free[0] }
  }
  return undefined
}

export type DelayChoiceResult = {
  appointmentId: string
  choice: DelayChoice
  /** Rebook: the new appointment */
  newAppointmentId?: string
  date?: string
  slotStart?: HHMM
  /** Refund: the fee was already paid, so the cashier refunds it */
  feePaid?: boolean
}

/**
 * Apply a delayed patient's choice (plan §10 S11), from the front desk or
 * from the patient app for the patient's own or a linked family member's
 * appointment (HAZ-14):
 * - wait: the appointment stays, marked "wait".
 * - rebook: booked into the doctor's next available session through the one
 *   scheduler; the old appointment becomes "rebooked" (linked to the new one)
 *   and its fee line moves with it (a paid fee stays paid).
 * - refund: the appointment is cancelled; an unpaid fee line is removed from
 *   the basket, a paid fee is left for the cashier to refund.
 */
export const applyDelayChoice = defineCommand({
  name: "scheduling.applyDelayChoice",
  roles: ["receptionist", "patient"],
  input: z.object({
    appointmentId: z.string(),
    choice: z.enum(DELAY_CHOICES),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input): Promise<DelayChoiceResult> {
    const appointment = await tx.get("appointments", input.appointmentId)
    if (tx.actor.role === "patient") {
      const account = tx.actor.staffId
      if (appointment.patientId !== account) {
        const member = await tx.find("patients", appointment.patientId)
        const links = await tx.list("familyLinks", "ownerPatientId", account)
        if (!links.some((link) => linkAllows(link, account, member, tx.today()))) {
          tx.reject("NOT_YOUR_APPOINTMENT", {})
        }
      }
    } else if (tx.actor.branchId && appointment.branchId !== tx.actor.branchId) {
      tx.reject("SESSION_OTHER_BRANCH", { branch: appointment.branchId })
    }
    const session = await tx.get("sessions", appointment.sessionId)
    if (session.status !== "delayed") tx.reject("SESSION_NOT_DELAYED", {})
    const allowed = allowedChoices(appointment, true)
    if (!allowed.length) tx.reject("APPOINTMENT_NOT_WAITING", {})
    if (!allowed.includes(input.choice)) tx.reject("ALREADY_CHECKED_IN", {})

    const doctor = await tx.get("doctors", appointment.doctorId)
    const staff = await tx.get("staff", doctor.staffId)
    const refs = {
      patientId: appointment.patientId,
      appointmentId: appointment.id,
      sessionId: session.id,
    }

    if (input.choice === "wait") {
      await tx.update("appointments", appointment.id, { delayChoice: "wait" })
      tx.emit("DelayChoiceRecorded", {
        branchId: appointment.branchId,
        refs,
        params: {
          doctor: staff.nameEn,
          doctorBn: staff.nameBn,
          minutes: session.delayMin,
        },
      })
      return { appointmentId: appointment.id, choice: "wait" }
    }

    if (input.choice === "rebook") {
      const next = await nextSessionFor(tx, session, appointment.patientId)
      if (!next) return tx.reject("NO_LATER_SESSION", {})
      const booked = await bookInTx(
        tx,
        {
          sessionId: next.session.id,
          patientId: appointment.patientId,
          source: appointment.source === "walk-in" ? "counter" : appointment.source,
          visitType: appointment.visitType,
          slotStart: next.slotStart,
          smsLang: await smsLangOf(tx, appointment.patientId),
        },
        { carryFeeLineId: appointment.feeBasketLineId }
      )
      await tx.update("appointments", appointment.id, {
        status: "rebooked",
        rebookedToId: booked.appointmentId,
        delayChoice: "rebook",
      })
      tx.emit("AppointmentRebooked", {
        branchId: appointment.branchId,
        refs: { ...refs, appointmentId: booked.appointmentId },
        params: {
          doctor: staff.nameEn,
          doctorBn: staff.nameBn,
          date: dmyOf(next.session.date),
          dateBn: bnDigits(dmyOf(next.session.date)),
          time: booked.slotStart,
          timeBn: bnDigits(booked.slotStart),
        },
      })
      return {
        appointmentId: appointment.id,
        choice: "rebook",
        newAppointmentId: booked.appointmentId,
        date: next.session.date,
        slotStart: booked.slotStart,
      }
    }

    // Refund: cancel the visit. An unpaid fee simply leaves the basket; a
    // paid one is refunded by the cashier (billing lists these cancellations).
    const line = appointment.feeBasketLineId
      ? await tx.find("basketLines", appointment.feeBasketLineId)
      : undefined
    if (line?.status === "open") {
      await tx.update("basketLines", line.id, { status: "removed" })
    }
    const feePaid = line?.status === "invoiced"
    await tx.update("appointments", appointment.id, {
      status: "cancelled",
      delayChoice: "refund",
    })
    tx.emit("AppointmentCancelled", {
      branchId: appointment.branchId,
      refs,
      params: {
        doctor: staff.nameEn,
        doctorBn: staff.nameBn,
        feePaid: feePaid ? 1 : 0,
      },
    })
    return { appointmentId: appointment.id, choice: "refund", feePaid }
  },
})
