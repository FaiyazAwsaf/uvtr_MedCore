/**
 * The dispensing label (PRD §10.5 "Bangla labels from structured dose
 * fields", HAZ-06 "outstanding quantity on label"). Built as plain strings in
 * the label's own language, which is Bangla by default whatever the window
 * language is: the label is for the patient. Medicine names stay in English
 * and identifiers keep Latin digits (plan §3.11).
 */

import type { Bilingual } from "@/config/brand.config"
import type { ISODate, MealTiming, Ms } from "@/core/db/schema"
import { doseInstruction } from "@/core/seed/content"
import { dictionaries, interpolate, lookup, type Locale } from "@/lib/i18n"
import { formatDmy, formatNumber } from "@/lib/i18n/format"

export type LabelInput = {
  rxNo: string
  patient: { nameEn: string; nameBn: string; uhid: string }
  brand: { name: string; strength: string; unitLabel: Bilingual }
  genericName: string
  dosePattern: string
  mealTiming: MealTiming
  durationDays: number
  /** Units handed over in this dispense */
  dispensedQty: number
  /** Units still owed on the line after it */
  outstandingQty: number
  balanceUntil?: Ms
  batches: { batchNo: string; expiry: ISODate }[]
  pharmacist: { nameEn: string; nameBn: string; councilNo: string }
  at: Ms
}

export type LabelModel = {
  lang: Locale
  rx: string
  patient: string
  uhid: string
  medicine: string
  generic: string
  dose: string
  given: string
  outstanding: string
  batches: string[]
  pharmacist: string
  date: string
}

function tr(lang: Locale, key: string, params?: Record<string, string | number>): string {
  return interpolate(lookup(dictionaries[lang], `pharmacy.label.${key}`), params)
}

/** "14 capsules" or "১৪টি ক্যাপসুল". */
function count(lang: Locale, qty: number, unit: Bilingual): string {
  if (lang === "bn") return tr(lang, "count", { count: formatNumber(qty, "bn"), unit: unit.bn })
  const word = qty === 1 ? unit.en : unit.en.endsWith("y") ? `${unit.en.slice(0, -1)}ies` : `${unit.en}s`
  return tr(lang, "count", { count: formatNumber(qty, "en"), unit: word })
}

export function buildLabel(input: LabelInput, lang: Locale = "bn"): LabelModel {
  const dose = doseInstruction(input.dosePattern, input.mealTiming, input.durationDays)[lang]
  const outstanding =
    input.outstandingQty > 0
      ? input.balanceUntil !== undefined
        ? tr(lang, "outstandingUntil", {
            qty: count(lang, input.outstandingQty, input.brand.unitLabel),
            date: formatDmy(input.balanceUntil, lang),
          })
        : tr(lang, "outstanding", { qty: count(lang, input.outstandingQty, input.brand.unitLabel) })
      : tr(lang, "nothingOutstanding")
  return {
    lang,
    rx: tr(lang, "rx", { rxNo: input.rxNo }),
    patient: lang === "bn" ? input.patient.nameBn : input.patient.nameEn,
    uhid: input.patient.uhid,
    medicine: `${input.brand.name} ${input.brand.strength}`.trim(),
    generic: input.genericName,
    dose,
    given: tr(lang, "given", { qty: count(lang, input.dispensedQty, input.brand.unitLabel) }),
    outstanding,
    batches: input.batches.map((b) =>
      tr(lang, "batch", { batch: b.batchNo, expiry: formatDmy(b.expiry, lang) })
    ),
    pharmacist: tr(lang, "pharmacist", {
      name: lang === "bn" ? input.pharmacist.nameBn : input.pharmacist.nameEn,
      councilNo: input.pharmacist.councilNo,
    }),
    date: tr(lang, "date", { date: formatDmy(input.at, lang) }),
  }
}
