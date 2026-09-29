import { ageOn } from "@/core/clock/dates"
import type {
  AdmissionRow,
  BedRow,
  DepositRow,
  DoctorRow,
  Ms,
  PatientRow,
  Poisha,
  Sex,
  WardRow,
} from "@/core/db/schema"
import { interimBill, type InterimBill } from "@/core/inpatient/interim"
import { ADMISSION_REASONS } from "@/core/seed/content/org"

import { inpatientBn } from "./i18n/bn"
import { inpatientEn } from "./i18n/en"

/**
 * Inpatient billing and beds (plan §5.8): the pure rules shared by the
 * commands, the deposit sweeper and both screens, so the figure a screen
 * shows is the one a command checks. Administrative only: beds, stays,
 * deposits and the interim bill, never a clinical record.
 */

/* ------------------------------------------------------------------ *
 * The interim bill of a stay
 * ------------------------------------------------------------------ */

/** Money received for a stay. Counter deposits are confirmed when taken. */
export function depositsTotal(deposits: readonly Pick<DepositRow, "amountP">[]): Poisha {
  return deposits.reduce((sum, deposit) => sum + deposit.amountP, 0)
}

/**
 * The interim bill of a stay at a moment (core/inpatient/interim.ts, the one
 * formula): bed days at the current ward's rate, nursing by ward kind and one
 * consultant round a day, less every deposit received.
 */
export function stayBill(opts: {
  admission: Pick<AdmissionRow, "admittedAt">
  ward: Pick<WardRow, "kind" | "bedDayRateP">
  consultant?: Pick<DoctorRow, "followUpFeeP">
  deposits: readonly Pick<DepositRow, "amountP">[]
  at: Ms
}): InterimBill {
  return interimBill({
    admittedAt: opts.admission.admittedAt,
    at: opts.at,
    ward: opts.ward,
    consultantRoundP: opts.consultant?.followUpFeeP ?? 0,
    depositsP: depositsTotal(opts.deposits),
  })
}

/**
 * Whether a stay's deposit alert should be raised now: it is admitted, its
 * deposit left is below the threshold and the alert for this crossing has
 * not been raised yet (a top-up that restores the deposit clears it).
 */
export function alertDue(
  admission: Pick<AdmissionRow, "status" | "depositAlertAt">,
  bill: Pick<InterimBill, "low">
): boolean {
  return admission.status === "admitted" && admission.depositAlertAt === undefined && bill.low
}

/* ------------------------------------------------------------------ *
 * Beds and wards
 * ------------------------------------------------------------------ */

/**
 * Status changes a receptionist may make by hand. Occupied beds change only
 * through an admission or a transfer; a transfer sends the old bed for
 * cleaning.
 */
export const BED_TRANSITIONS: Record<BedRow["status"], BedRow["status"][]> = {
  vacant: ["reserved"],
  reserved: ["vacant"],
  cleaning: ["vacant"],
  occupied: [],
}

export function mayChangeBed(from: BedRow["status"], to: BedRow["status"]): boolean {
  return BED_TRANSITIONS[from].includes(to)
}

/** Beds that can take a new admission. */
export function admittable(bed: Pick<BedRow, "status">): boolean {
  return bed.status === "vacant" || bed.status === "reserved"
}

/**
 * The sex a ward is kept for, from its name ("General ward (male)"). Wards
 * without one in their name take everyone. CONFIRM: HOSPITAL (a ward field
 * would be cleaner than the name).
 */
export function wardSex(ward: Pick<WardRow, "name">): Sex | null {
  const name = ward.name.en.toLowerCase()
  if (name.includes("(female)")) return "F"
  if (name.includes("(male)")) return "M"
  return null
}

/** Children's wards take patients under this age (years, on the demo day). */
export const PAEDIATRIC_UNDER_AGE = 18

/**
 * Why a ward cannot take a patient, as a rule code, or null when it can:
 * a men's or women's ward by sex, a children's ward by age.
 */
export function wardRefusal(
  ward: Pick<WardRow, "name" | "kind">,
  patient: Pick<PatientRow, "sex" | "dob">,
  today: string
): "WARD_FOR_MALE" | "WARD_FOR_FEMALE" | "WARD_PAEDIATRIC_ONLY" | null {
  const sex = wardSex(ward)
  if (sex && sex !== patient.sex) return sex === "M" ? "WARD_FOR_MALE" : "WARD_FOR_FEMALE"
  if (ward.kind === "paediatric" && ageOn(patient.dob, today) >= PAEDIATRIC_UNDER_AGE) {
    return "WARD_PAEDIATRIC_ONLY"
  }
  return null
}

/** i18n suffix under `inpatient.wardKind.*` (no hyphens in keys). */
export const WARD_KIND_KEY: Record<WardRow["kind"], keyof typeof inpatientEn.inpatient.wardKind> = {
  general: "general",
  "semi-private": "semiPrivate",
  cabin: "cabin",
  paediatric: "paediatric",
}

/* ------------------------------------------------------------------ *
 * Admission reasons (administrative labels, never a diagnosis)
 * ------------------------------------------------------------------ */

type ReasonKey = keyof typeof inpatientEn.inpatient.reasons

/** The seed's preset reasons, keyed for their Bangla labels. */
const REASON_KEYS: Record<string, ReasonKey> = {
  "Observation and IV fluids": "observation",
  "Short stay for tests": "shortStay",
  "Fever under observation": "fever",
  "Blood sugar control": "sugar",
  "Wound care and dressing": "wound",
  "Chest infection care": "chest",
  "Pain management": "pain",
  "Dehydration care": "dehydration",
  "Investigation work-up": "workUp",
  "Blood pressure control": "pressure",
}

/** Preset reasons offered at admission: the stored text and its label key. */
export const REASON_PRESETS: { text: string; key: ReasonKey }[] = ADMISSION_REASONS.filter(
  (text) => REASON_KEYS[text]
).map((text) => ({ text, key: REASON_KEYS[text] }))

/** The label key of a stored reason, when it is a preset. */
export function reasonKey(reason: string): ReasonKey | undefined {
  return REASON_KEYS[reason]
}

/* ------------------------------------------------------------------ *
 * Event parameters (the stream drawer shows them in both languages)
 * ------------------------------------------------------------------ */

export function patientParams(patient: Pick<PatientRow, "nameEn" | "nameBn">) {
  return { patient: patient.nameEn, patientBn: patient.nameBn || patient.nameEn }
}

export function wardParams(ward: Pick<WardRow, "name" | "code">) {
  return { ward: `${ward.code} ${ward.name.en}`, wardBn: `${ward.code} ${ward.name.bn}` }
}

export function bedStatusParams(status: BedRow["status"]) {
  return {
    status: inpatientEn.inpatient.bedStatus[status],
    statusBn: inpatientBn.inpatient.bedStatus[status],
  }
}

/** A staff member's name for event params, in both languages. */
export function nameParams(
  key: string,
  staff: { nameEn: string; nameBn?: string } | undefined,
  fallback: string
): Record<string, string> {
  return {
    [key]: staff?.nameEn ?? fallback,
    [`${key}Bn`]: staff?.nameBn || staff?.nameEn || fallback,
  }
}

/* ------------------------------------------------------------------ *
 * Deposit suggestions (the cashier's quick amounts)
 * ------------------------------------------------------------------ */

/** Quick deposit amounts on the counter. */
export const QUICK_DEPOSITS_P: Poisha[] = [5_000_00, 10_000_00, 20_000_00, 50_000_00]

/**
 * The smallest round top-up (whole ৳1,000) that brings a low stay's deposit
 * left back to the alert threshold, or 0 when it is not below it.
 */
export function restoreAmountP(balanceP: Poisha, thresholdP: Poisha): Poisha {
  if (balanceP >= thresholdP) return 0
  return Math.ceil((thresholdP - balanceP) / 1_000_00) * 1_000_00
}
