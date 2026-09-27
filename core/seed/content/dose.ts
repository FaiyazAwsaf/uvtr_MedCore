/**
 * Dose patterns, meal timing, durations and quick-texts for the Rx pad and
 * note (plan §7.1). Typing a pattern such as "1+0+1" expands to Bangla dose
 * words; the printed Rx dose line is always Bangla (plan §3.11). Quick-texts
 * carry general advice only: no medicine names and no diagnoses.
 */

import type { Bilingual } from "@/config/brand.config"
import type { MealTiming } from "@/core/db/schema"

import { bnDigits } from "./bn"

export type DosePattern = {
  /** As typed, e.g. "1+0+1" */
  code: string
  /** Pattern with Bangla digits, e.g. "১+০+১" */
  bnCode: string
  /** Units per day (0 for "when needed") */
  perDay: number
  /** When to take it */
  words: Bilingual
}

const pattern = (
  code: string,
  perDay: number,
  en: string,
  bn: string
): DosePattern => ({
  code,
  bnCode: bnDigits(code),
  perDay,
  words: { en, bn },
})

export const DOSE_PATTERNS: DosePattern[] = [
  pattern("1+0+0", 1, "in the morning", "সকালে"),
  pattern("0+1+0", 1, "at midday", "দুপুরে"),
  pattern("0+0+1", 1, "at night", "রাতে"),
  pattern("1+0+1", 2, "morning and night", "সকালে ও রাতে"),
  pattern("1+1+0", 2, "morning and midday", "সকালে ও দুপুরে"),
  pattern("0+1+1", 2, "midday and night", "দুপুরে ও রাতে"),
  pattern("1+1+1", 3, "morning, midday and night", "সকালে, দুপুরে ও রাতে"),
  pattern("1+1+1+1", 4, "four times a day", "দিনে চারবার"),
  pattern(
    "1/2+0+1/2",
    1,
    "half in the morning and half at night",
    "সকালে আধা ও রাতে আধা"
  ),
  pattern("1/2+0+0", 0.5, "half in the morning", "সকালে আধা"),
  pattern("0+0+1/2", 0.5, "half at night", "রাতে আধা"),
  pattern(
    "2+0+2",
    4,
    "two in the morning and two at night",
    "সকালে দুটি ও রাতে দুটি"
  ),
  pattern("SOS", 0, "only when needed", "প্রয়োজন হলে"),
]

export const MEAL_TIMING: Record<MealTiming, Bilingual> = {
  before: { en: "before meals", bn: "খাবারের আগে" },
  after: { en: "after meals", bn: "খাবারের পরে" },
  with: { en: "with meals", bn: "খাবারের সাথে" },
  any: { en: "at any time", bn: "যেকোনো সময়" },
}

/** Common course lengths; 0 means "continue until review". */
export const DURATIONS: { days: number; label: Bilingual }[] = [
  ...[3, 5, 7, 10, 14, 30, 60, 90].map((days) => ({
    days,
    label: { en: `${days} days`, bn: `${bnDigits(days)} দিন` },
  })),
  { days: 0, label: { en: "Continue", bn: "চলবে" } },
]

export function findDosePattern(code: string): DosePattern | undefined {
  return DOSE_PATTERNS.find((p) => p.code === code.trim())
}

/**
 * The instruction line for one Rx line, e.g. EN "1+0+1, morning and night,
 * after meals, for 5 days" and BN "১+০+১ (সকালে ও রাতে) খাবারের পরে, ৫ দিন".
 */
export function doseInstruction(
  code: string,
  meal: MealTiming,
  durationDays: number
): Bilingual {
  const p = findDosePattern(code)
  const words = p?.words ?? { en: code, bn: bnDigits(code) }
  const mealWords = MEAL_TIMING[meal]
  const duration = DURATIONS.find((d) => d.days === durationDays)?.label ?? {
    en: `${durationDays} days`,
    bn: `${bnDigits(durationDays)} দিন`,
  }
  const mealEn = meal === "any" ? "" : `, ${mealWords.en}`
  const mealBn = meal === "any" ? "" : ` ${mealWords.bn}`
  const forEn = durationDays === 0 ? "continue" : `for ${duration.en}`
  return {
    en: `${code}, ${words.en}${mealEn}, ${forEn}`,
    bn: `${p?.bnCode ?? bnDigits(code)} (${words.bn})${mealBn}, ${duration.bn}`,
  }
}

/** Units to supply for a course (rounded up; "when needed" gives 0). */
export function courseQuantity(code: string, durationDays: number): number {
  const p = findDosePattern(code)
  if (!p || durationDays === 0) return 0
  return Math.ceil(p.perDay * durationDays)
}

export type QuickText = {
  /** Typed shortcut, e.g. ".fluids" */
  trigger: string
  section: "advice" | "history" | "examination" | "plan"
  text: Bilingual
}

export const QUICK_TEXTS: QuickText[] = [
  {
    trigger: ".fluids",
    section: "advice",
    text: {
      en: "Drink plenty of safe water and fluids.",
      bn: "প্রচুর নিরাপদ পানি ও তরল খাবার খাবেন।",
    },
  },
  {
    trigger: ".rest",
    section: "advice",
    text: {
      en: "Take adequate rest for a few days.",
      bn: "কয়েক দিন পর্যাপ্ত বিশ্রাম নেবেন।",
    },
  },
  {
    trigger: ".reports",
    section: "advice",
    text: {
      en: "Come back with the test reports.",
      bn: "পরীক্ষার রিপোর্ট নিয়ে আবার দেখা করবেন।",
    },
  },
  {
    trigger: ".sugar",
    section: "advice",
    text: {
      en: "Avoid sugar, sweets and soft drinks; limit rice portions.",
      bn: "চিনি, মিষ্টি ও কোমল পানীয় এড়িয়ে চলবেন; ভাতের পরিমাণ কমাবেন।",
    },
  },
  {
    trigger: ".salt",
    section: "advice",
    text: {
      en: "Reduce salt; avoid extra salt at the table.",
      bn: "লবণ কম খাবেন; পাতে আলাদা লবণ খাবেন না।",
    },
  },
  {
    trigger: ".walk",
    section: "advice",
    text: {
      en: "Walk briskly for 30 minutes on most days.",
      bn: "সপ্তাহের বেশিরভাগ দিন ৩০ মিনিট দ্রুত হাঁটবেন।",
    },
  },
  {
    trigger: ".smoke",
    section: "advice",
    text: {
      en: "Stop smoking and avoid jorda and betel leaf.",
      bn: "ধূমপান বন্ধ করবেন; জর্দা ও পান এড়িয়ে চলবেন।",
    },
  },
  {
    trigger: ".oily",
    section: "advice",
    text: {
      en: "Avoid oily, spicy and fried food.",
      bn: "তৈলাক্ত, ঝাল ও ভাজা খাবার এড়িয়ে চলবেন।",
    },
  },
  {
    trigger: ".sponge",
    section: "advice",
    text: {
      en: "Sponge the body with normal water if the temperature is high.",
      bn: "জ্বর বেশি হলে স্বাভাবিক পানি দিয়ে শরীর মুছে দেবেন।",
    },
  },
  {
    trigger: ".ors",
    section: "advice",
    text: {
      en: "Give oral saline after every loose stool.",
      bn: "প্রতিবার পাতলা পায়খানার পর খাবার স্যালাইন খাওয়াবেন।",
    },
  },
  {
    trigger: ".danger",
    section: "advice",
    text: {
      en: "Come to hospital at once if breathing becomes difficult, the patient becomes drowsy, or cannot drink.",
      bn: "শ্বাসকষ্ট হলে, খুব নিস্তেজ হয়ে পড়লে বা কিছু খেতে না পারলে সাথে সাথে হাসপাতালে আসবেন।",
    },
  },
  {
    trigger: ".course",
    section: "advice",
    text: {
      en: "Complete the full course of medicines even if you feel better.",
      bn: "ভালো লাগলেও ওষুধের পুরো কোর্স শেষ করবেন।",
    },
  },
  {
    trigger: ".fu7",
    section: "plan",
    text: { en: "Follow-up after 7 days.", bn: "৭ দিন পর ফলো-আপে আসবেন।" },
  },
  {
    trigger: ".fu1m",
    section: "plan",
    text: { en: "Follow-up after 1 month.", bn: "১ মাস পর ফলো-আপে আসবেন।" },
  },
  {
    trigger: ".nad",
    section: "examination",
    text: {
      en: "No abnormality detected.",
      bn: "কোনো অস্বাভাবিকতা পাওয়া যায়নি।",
    },
  },
  {
    trigger: ".chestclear",
    section: "examination",
    text: {
      en: "Chest clear, vesicular breath sounds, no added sounds.",
      bn: "বুক পরিষ্কার, স্বাভাবিক শ্বাসের শব্দ, অতিরিক্ত শব্দ নেই।",
    },
  },
]
