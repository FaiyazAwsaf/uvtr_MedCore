/**
 * Scripted analyser values (plan §7.2, §10). The simulated analyser connector
 * fills these when it "receives" results for the named patient and test, and
 * falls back to `defaultAnalyserValue` for everything else. Values are
 * synthetic. Helpers here are pure so the connector and the seed agree.
 */

import type { Analyte, RefRange, ResultFlag, Sex } from "@/core/db/schema"
import { hashSeed } from "@/lib/mock/rng"

import { HERO } from "./hero-ids"
import { SEED_REFS } from "./seed-refs"

export type AnalyserScript = {
  id: string
  patientId: string
  testId: string
  /** Analyte code to value (numbers for quantitative, text for qualitative) */
  values: Record<string, number | string>
  note: string
}

/** Hero CBC: mild neutrophil leukocytosis, otherwise unremarkable. */
const HERO_CBC: AnalyserScript = {
  id: "ana_hero_cbc",
  patientId: HERO.patient.abdulKarim,
  testId: SEED_REFS.test.cbc,
  values: {
    HB: 13.4,
    RBC: 4.6,
    HCT: 40.8,
    MCV: 88.7,
    MCH: 29.1,
    MCHC: 32.8,
    WBC: 12.8,
    NEUT: 79,
    LYMPH: 15,
    MONO: 5,
    EOS: 1,
    BASO: 0,
    PLT: 245,
  },
  note: "Mild leukocytosis with neutrophil predominance.",
}

const HERO_CRP: AnalyserScript = {
  id: "ana_hero_crp",
  patientId: HERO.patient.abdulKarim,
  testId: SEED_REFS.test.crp,
  values: { CRP: 48 },
  note: "Raised CRP.",
}

/** S7: Jahanara Begum, CKD: potassium 6.8 mmol/L, a critical value. */
const JAHANARA_ELECTROLYTES: AnalyserScript = {
  id: "ana_jahanara_elec",
  patientId: SEED_REFS.patient.jahanara,
  testId: SEED_REFS.test.electrolytes,
  values: { NA: 133, K: 6.8, CL: 104, HCO3: 17 },
  note: "Potassium above the critical limit (6.2 mmol/L).",
}

const JAHANARA_POTASSIUM: AnalyserScript = {
  id: "ana_jahanara_k",
  patientId: SEED_REFS.patient.jahanara,
  testId: SEED_REFS.test.potassium,
  values: { K: 6.8 },
  note: "Potassium above the critical limit (6.2 mmol/L).",
}

const JAHANARA_CREATININE: AnalyserScript = {
  id: "ana_jahanara_creat",
  patientId: SEED_REFS.patient.jahanara,
  testId: SEED_REFS.test.creatinine,
  values: { CREAT: 3.9 },
  note: "Raised creatinine, consistent with her known kidney disease.",
}

/** S9: Nasima Khatun's CBC (validated before the cancellation attempt). */
const NASIMA_CBC: AnalyserScript = {
  id: "ana_nasima_cbc",
  patientId: SEED_REFS.patient.nasima,
  testId: SEED_REFS.test.cbc,
  values: {
    HB: 11.6,
    RBC: 4.2,
    HCT: 35.9,
    MCV: 85.4,
    MCH: 27.6,
    MCHC: 32.3,
    WBC: 7.4,
    NEUT: 58,
    LYMPH: 33,
    MONO: 6,
    EOS: 3,
    BASO: 0,
    PLT: 286,
  },
  note: "Borderline low haemoglobin.",
}

export const ANALYSER_SCRIPTS: AnalyserScript[] = [
  HERO_CBC,
  HERO_CRP,
  JAHANARA_ELECTROLYTES,
  JAHANARA_POTASSIUM,
  JAHANARA_CREATININE,
  NASIMA_CBC,
]

export function findAnalyserScript(
  patientId: string,
  testId: string
): AnalyserScript | undefined {
  return ANALYSER_SCRIPTS.find(
    (s) => s.patientId === patientId && s.testId === testId
  )
}

/**
 * S8: Shahidul Alam's TSH. Version 1 was released with a unit conversion
 * error (0.52 instead of 5.2 mIU/L, so it read as normal). The presenter
 * corrects it to version 2 live.
 */
export const TSH_UNIT_ERROR = {
  patientId: SEED_REFS.patient.shahidul,
  testId: SEED_REFS.test.tsh,
  analyteCode: "TSH",
  v1: { value: 0.52, unit: "mIU/L", flag: "N" as ResultFlag },
  v2: { value: 5.2, unit: "mIU/L", flag: "H" as ResultFlag },
  reason: "Unit conversion error at result entry",
  changeSummary:
    "TSH corrected from 0.52 to 5.2 mIU/L after a unit conversion error was found. Flag changed from Normal to High.",
} as const

/* ---------------- Pure helpers ---------------- */

/** The reference range that applies to a patient (sex and age specific first). */
export function rangeFor(
  analyte: Analyte,
  sex: Sex,
  ageYears: number
): RefRange | undefined {
  const fits = (r: RefRange) =>
    (r.sex === undefined || r.sex === sex) &&
    (r.ageMinYears === undefined || ageYears >= r.ageMinYears) &&
    (r.ageMaxYears === undefined || ageYears < r.ageMaxYears)
  const specific = analyte.ranges.filter(fits)
  return (
    specific.find((r) => r.sex !== undefined && r.ageMinYears !== undefined) ??
    specific.find((r) => r.sex !== undefined || r.ageMinYears !== undefined) ??
    specific[0] ??
    analyte.ranges.find(
      (r) => r.sex === undefined && r.ageMinYears === undefined
    ) ??
    analyte.ranges[0]
  )
}

/** Flag for a numeric value against the patient's range and the critical limits. */
export function flagFor(
  analyte: Analyte,
  value: number,
  sex: Sex,
  ageYears: number
): ResultFlag {
  if (analyte.criticalLow !== undefined && value < analyte.criticalLow)
    return "LL"
  if (analyte.criticalHigh !== undefined && value > analyte.criticalHigh)
    return "HH"
  const range = rangeFor(analyte, sex, ageYears)
  if (!range) return "N"
  if (range.low !== undefined && value < range.low) return "L"
  if (range.high !== undefined && value > range.high) return "H"
  return "N"
}

/**
 * A plausible in-range value for an analyte, deterministic for a seed key.
 * Qualitative analytes return their normal text.
 */
export function defaultAnalyserValue(
  analyte: Analyte,
  sex: Sex,
  ageYears: number,
  seedKey: string
): number | string {
  const range = rangeFor(analyte, sex, ageYears)
  if (analyte.qualitative) return range?.text ?? "Negative"
  const f = (hashSeed(`${seedKey}:${analyte.code}`) % 1000) / 1000
  const low = range?.low
  const high = range?.high
  let value: number
  if (low !== undefined && high !== undefined)
    value = low + (high - low) * (0.25 + 0.5 * f)
  else if (high !== undefined) value = high * (0.45 + 0.35 * f)
  else if (low !== undefined) value = low * (1.2 + 0.5 * f)
  else value = 1
  const scale = 10 ** analyte.decimals
  return Math.round(value * scale) / scale
}
