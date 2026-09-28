import { ageOn } from "@/core/clock/dates"
import type { ISODate, PatientRow, Relation, Sex } from "@/core/db/schema"

/**
 * Registration rules and helpers (PRD §10.1), shared by the `identity.register`
 * command and the registration form so both agree.
 */

/** Relations a household member can have to the head (plan §5.2). */
export const RELATIONS: Relation[] = [
  "spouse",
  "son",
  "daughter",
  "father",
  "mother",
  "brother",
  "sister",
  "grandchild",
  "grandparent",
  "other",
]

/** Relations a guardian can have to a minor. */
export const GUARDIAN_RELATIONS: Relation[] = [
  "father",
  "mother",
  "grandparent",
  "brother",
  "sister",
  "other",
]

/** Why no NID, birth registration number or passport was recorded. */
export const ID_MISSING_REASONS = [
  "not-brought",
  "child-no-brn",
  "no-document",
  "foreign-national",
] as const
export type IdMissingReason = (typeof ID_MISSING_REASONS)[number]

/**
 * The note stored on the patient for each reason. English, like the rest of
 * the seeded registration notes; screens show the translated label instead
 * (see `idReasonFromNote`).
 */
export const ID_MISSING_NOTES: Record<IdMissingReason, string> = {
  "not-brought": "NID not brought at registration",
  "child-no-brn": "Child without a birth registration number yet",
  "no-document": "No identity document available",
  "foreign-national": "Foreign national without a passport at hand",
}

export const NO_OWN_PHONE_NOTE = "No personal phone; attendant's number recorded"

/** The reason code behind a stored note, if the note is one of ours. */
export function idReasonFromNote(note: string | undefined): IdMissingReason | undefined {
  if (!note) return undefined
  return ID_MISSING_REASONS.find((reason) => note.includes(ID_MISSING_NOTES[reason]))
}

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const

/** A Bangladeshi mobile number in the stored form 01XXX-XXXXXX, or undefined. */
export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let digits = raw.replace(/\D/g, "")
  if (digits.startsWith("880")) digits = digits.slice(2)
  if (!/^01[3-9]\d{8}$/.test(digits)) return undefined
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

export const PHONE_PATTERN = /^01[3-9]\d{2}-\d{6}$/

/** NID: 10 (smart card), 13 or 17 digits. */
export const NID_PATTERN = /^(\d{10}|\d{13}|\d{17})$/
/** Birth registration number: 17 digits. */
export const BRN_PATTERN = /^\d{17}$/
/** Passport: one or two letters and 6 to 8 digits. */
export const PASSPORT_PATTERN = /^[A-Z]{1,2}\d{6,8}$/

export const MINOR_AGE = 18

export function isMinor(dob: ISODate, today: ISODate): boolean {
  return ageOn(dob, today) < MINOR_AGE
}

/**
 * A date of birth from an estimated age in whole years: the same day and month
 * as today, so the age reads back exactly (29 February becomes 28).
 */
export function dobFromAge(years: number, today: ISODate): ISODate {
  const [y, m, d] = today.split("-").map(Number)
  const year = y - Math.max(0, Math.floor(years))
  const day = m === 2 && d === 29 ? 28 : d
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** The generated avatar seed, in the seed's format (sex, age band, id). */
export function photoSeedFor(id: string, sex: Sex, dob: ISODate, today: ISODate): string {
  const age = ageOn(dob, today)
  const band = age < 13 ? "child" : age < 18 ? "teen" : age < 60 ? "adult" : "senior"
  return `${sex === "M" ? "m" : "f"}-${band}-${id}`
}

/** Whether a patient can act as a guardian on a given day. */
export function canBeGuardian(
  patient: Pick<PatientRow, "dob" | "identityStatus">,
  today: ISODate
): boolean {
  return patient.identityStatus === "active" && !isMinor(patient.dob, today)
}
