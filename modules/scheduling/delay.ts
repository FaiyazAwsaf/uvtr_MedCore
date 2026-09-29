import { smsParts } from "@/core/comms/sms"
import type {
  AppointmentRow,
  PatientRow,
  SmsRow,
  StaffRow,
} from "@/core/db/schema"
import { bnDigits } from "@/core/seed/content/bn"
import type { Locale } from "@/lib/i18n/config"
import { renderSms } from "@/modules/comms/templates"

/**
 * Doctor delay rules (plan §10 S11, PRD §9 Appointment), shared by the
 * `scheduling.recordDelay` command and the delays screen, so the SMS parts
 * counter shown before sending is exactly what the command queues.
 */

/** Preset delay reasons; anything else is typed as free text ("other"). */
export const DELAY_REASONS = [
  "earlier-session",
  "traffic",
  "meeting",
  "personal",
] as const
export type DelayReason = (typeof DELAY_REASONS)[number]

export function isDelayReason(value: string | undefined): value is DelayReason {
  return !!value && (DELAY_REASONS as readonly string[]).includes(value)
}

/** Quick picks for the delay in minutes. */
export const DELAY_PRESETS = [15, 30, 45, 60] as const
export const DELAY_MIN = 5
export const DELAY_MAX = 240

/** Appointments still waiting to be seen: they get the delay notice and a choice. */
export const AWAITING: AppointmentRow["status"][] = ["booked", "checked-in"]

export function isAwaiting(
  appointment: Pick<AppointmentRow, "status">
): boolean {
  return AWAITING.includes(appointment.status)
}

/** Choices the patient (or the desk for them) can make on a delayed appointment. */
export const DELAY_CHOICES = ["wait", "rebook", "refund"] as const
export type DelayChoice = (typeof DELAY_CHOICES)[number]

/** Which choices an appointment allows right now (rebook and refund only before check-in). */
export function allowedChoices(
  appointment: Pick<AppointmentRow, "status">,
  sessionDelayed: boolean
): DelayChoice[] {
  if (!sessionDelayed) return []
  if (appointment.status === "booked") return [...DELAY_CHOICES]
  if (appointment.status === "checked-in") return ["wait"]
  return []
}

/**
 * The language a patient reads SMS in: the language of the last message we
 * sent them, Bangla when there is none (most patients' default).
 */
export function smsLangFrom(
  messages: Pick<SmsRow, "lang" | "queuedAt">[]
): Locale {
  let latest: Pick<SmsRow, "lang" | "queuedAt"> | undefined
  for (const message of messages) {
    if (!latest || message.queuedAt > latest.queuedAt) latest = message
  }
  return latest?.lang ?? "bn"
}

/** Where a delay SMS can go: the patient's own number with SMS consent. */
export function smsNumber(
  patient: Pick<PatientRow, "phone" | "consents">
): string | undefined {
  const consent = patient.consents.find((c) => c.purpose === "sms")
  return patient.phone && consent?.granted !== false ? patient.phone : undefined
}

/** The delay SMS text in one language (no clinical content, no reason). */
export function delaySmsText(
  lang: Locale,
  doctor: Pick<StaffRow, "nameEn" | "nameBn">,
  minutes: number
): string {
  return renderSms("doctor-delay", lang, {
    doctor: lang === "bn" ? doctor.nameBn : doctor.nameEn,
    minutes: lang === "bn" ? bnDigits(minutes) : String(minutes),
  })
}

export type SmsLanePlan = {
  /** Recipients reading this language */
  count: number
  text: string
  chars: number
  /** Parts per message (PRD §10.19: GSM 160/153, Bangla UCS-2 70/67) */
  parts: number
  encoding: "GSM" | "UCS-2"
}

export type DelaySmsPlan = {
  en: SmsLanePlan
  bn: SmsLanePlan
  /** Messages to send */
  messages: number
  /** Billable parts across every message */
  totalParts: number
}

/** The parts counter shown before sending: one text per language, times its recipients. */
export function delaySmsPlan(
  recipients: { lang: Locale }[],
  doctor: Pick<StaffRow, "nameEn" | "nameBn">,
  minutes: number
): DelaySmsPlan {
  const lane = (lang: Locale): SmsLanePlan => {
    const text = delaySmsText(lang, doctor, minutes)
    const { parts, encoding } = smsParts(text)
    return {
      count: recipients.filter((r) => r.lang === lang).length,
      text,
      chars: [...text].length,
      parts,
      encoding,
    }
  }
  const en = lane("en")
  const bn = lane("bn")
  return {
    en,
    bn,
    messages: en.count + bn.count,
    totalParts: en.count * en.parts + bn.count * bn.parts,
  }
}
