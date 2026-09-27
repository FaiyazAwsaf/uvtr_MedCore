/**
 * Scripted scribe consultations (plan §7.2, D12: no AI calls). The transcript
 * plays back as if recorded; the draft is what the "AI draft: not saved until
 * signed" panel shows. Every draft line links to the transcript lines it came
 * from, and drafts never contain medicines or diagnoses: the assessment is
 * left for the doctor and medicines stay on the Rx pad (plan §11).
 */

import type { Bilingual } from "@/config/brand.config"
import type { ScribeDraftRow, TranscriptLine } from "@/core/db/schema"

import { HERO } from "./hero-ids"

export type ScribeScript = {
  id: string
  title: Bilingual
  specialtyCode: string
  /** Patient the script is written for, when it belongs to the hero story */
  patientId?: string
  durationSec: number
  transcript: TranscriptLine[]
  draft: ScribeDraftRow["draft"]
}

const line = (
  id: string,
  speaker: TranscriptLine["speaker"],
  lang: TranscriptLine["lang"],
  atSec: number,
  text: string
): TranscriptLine => ({ id, speaker, lang, atSec, text })

/** Hero consultation: Abdul Karim, fever and cough for 5 days (with his son). */
const HERO_FEVER_COUGH: ScribeScript = {
  id: "scr_hero_fever_cough",
  title: { en: "Fever and cough for 5 days", bn: "৫ দিন ধরে জ্বর ও কাশি" },
  specialtyCode: "MED",
  patientId: HERO.patient.abdulKarim,
  durationSec: 120,
  transcript: [
    line(
      "h01",
      "doctor",
      "bn",
      0,
      "আসসালামু আলাইকুম, বসুন। বলুন, কী সমস্যা নিয়ে এসেছেন?"
    ),
    line(
      "h02",
      "patient",
      "bn",
      6,
      "ডাক্তার সাহেব, পাঁচ দিন ধরে জ্বর, সাথে কাশিও আছে।"
    ),
    line(
      "h03",
      "doctor",
      "bn",
      12,
      "জ্বর কত পর্যন্ত উঠছে? থার্মোমিটারে মেপেছেন?"
    ),
    line(
      "h04",
      "patient",
      "bn",
      18,
      "রাতের দিকে বেশি আসে, একবার একশো এক পর্যন্ত উঠেছিল।"
    ),
    line("h05", "doctor", "bn", 25, "কাশির সাথে কফ আসে? কফের রং কেমন?"),
    line("h06", "patient", "bn", 30, "হ্যাঁ, গত তিন দিন ধরে হলুদ কফ আসছে।"),
    line("h07", "doctor", "en", 36, "Any chest pain or shortness of breath?"),
    line(
      "h08",
      "patient",
      "bn",
      41,
      "বুকে ব্যথা নেই, তবে সিঁড়ি দিয়ে উঠলে একটু হাঁপিয়ে যাই।"
    ),
    line(
      "h09",
      "doctor",
      "bn",
      48,
      "আপনার নিয়মিত ওষুধগুলো কি ঠিকমতো খাচ্ছেন?"
    ),
    line(
      "h10",
      "patient",
      "bn",
      54,
      "জি, সকালে-রাতে একটা আর রাতে আরেকটা ওষুধ খাই, বাদ দিই না।"
    ),
    line("h11", "doctor", "bn", 61, "কোনো ওষুধে কখনো অ্যালার্জি হয়েছিল?"),
    line(
      "h12",
      "attendant",
      "bn",
      65,
      "জি, আব্বার আগে একবার একটা ওষুধ খাওয়ার পর সারা গায়ে র‍্যাশ উঠেছিল। কার্ডে লেখা আছে।"
    ),
    line(
      "h13",
      "doctor",
      "en",
      74,
      "Okay, noted. বাসায় সুগার মেপেছিলেন ইদানীং?"
    ),
    line("h14", "patient", "bn", 80, "গতকাল সকালে খালি পেটে নয়ের মতো ছিল।"),
    line(
      "h15",
      "doctor",
      "en",
      88,
      "Temperature is 100.8, SpO2 96 percent on room air."
    ),
    line(
      "h16",
      "doctor",
      "bn",
      95,
      "একটু বুকটা শুনি... ডান দিকের নিচে কিছু crackles পাচ্ছি।"
    ),
    line(
      "h17",
      "doctor",
      "bn",
      104,
      "আমরা আজ CBC আর CRP করাব, প্রয়োজনে বুকের এক্স-রে।"
    ),
    line(
      "h18",
      "doctor",
      "bn",
      112,
      "প্রচুর পানি খাবেন, বিশ্রাম নেবেন, রিপোর্ট নিয়ে আবার দেখাবেন।"
    ),
  ],
  draft: [
    {
      section: "chiefComplaint",
      lines: [
        {
          text: "Fever for 5 days with cough.",
          transcriptLineIds: ["h01", "h02"],
        },
      ],
    },
    {
      section: "history",
      lines: [
        {
          text: "Fever up to 101 F, worse at night.",
          transcriptLineIds: ["h03", "h04"],
        },
        {
          text: "Cough with yellow sputum for the last 3 days.",
          transcriptLineIds: ["h05", "h06"],
        },
        {
          text: "No chest pain; mild breathlessness on climbing stairs.",
          transcriptLineIds: ["h07", "h08"],
        },
        {
          text: "Takes his regular long-term medicines morning and night without missing doses (see current medicines list).",
          transcriptLineIds: ["h09", "h10"],
        },
        {
          text: "Attendant reports a generalised rash after a previous medicine; verify against the allergy list.",
          transcriptLineIds: ["h11", "h12"],
        },
        {
          text: "Home fasting sugar about 9 mmol/L yesterday.",
          transcriptLineIds: ["h13", "h14"],
        },
      ],
    },
    {
      section: "examination",
      lines: [
        {
          text: "Temperature 100.8 F, SpO2 96% on room air.",
          transcriptLineIds: ["h15"],
        },
        {
          text: "Crackles heard at the right lung base.",
          transcriptLineIds: ["h16"],
        },
      ],
    },
    {
      section: "plan",
      lines: [
        {
          text: "Tests discussed: CBC and CRP; chest X-ray if needed.",
          transcriptLineIds: ["h17"],
        },
        {
          text: "Advised plenty of fluids and rest; review with the reports.",
          transcriptLineIds: ["h18"],
        },
      ],
    },
  ],
}

/** Paediatrics: a 3-year-old with loose motions, told by the mother. */
const PAEDS_LOOSE_MOTIONS: ScribeScript = {
  id: "scr_paeds_loose_motions",
  title: {
    en: "Child with loose motions for 2 days",
    bn: "২ দিন ধরে শিশুর পাতলা পায়খানা",
  },
  specialtyCode: "PAED",
  durationSec: 80,
  transcript: [
    line("p01", "doctor", "bn", 0, "আসুন, বসুন। বাবুর কী হয়েছে?"),
    line(
      "p02",
      "attendant",
      "bn",
      5,
      "দুই দিন ধরে পাতলা পায়খানা, দিনে ছয়-সাত বার।"
    ),
    line("p03", "doctor", "bn", 11, "পায়খানার সাথে রক্ত বা আম যায়?"),
    line(
      "p04",
      "attendant",
      "bn",
      16,
      "না, রক্ত যায় না। তবে দুইবার বমি করেছে।"
    ),
    line("p05", "doctor", "bn", 22, "জ্বর আছে? খাওয়া-দাওয়া কেমন করছে?"),
    line(
      "p06",
      "attendant",
      "bn",
      27,
      "কাল রাতে হালকা জ্বর ছিল। বুকের দুধ আর পানি খাচ্ছে, কিন্তু ভাত খেতে চায় না।"
    ),
    line("p07", "doctor", "bn", 36, "প্রস্রাব ঠিকমতো হচ্ছে?"),
    line(
      "p08",
      "attendant",
      "bn",
      40,
      "হ্যাঁ, তবে আগের চেয়ে একটু কম মনে হচ্ছে।"
    ),
    line(
      "p09",
      "doctor",
      "en",
      46,
      "Weight 13 kg, temperature 99.6, eyes not sunken, skin pinch goes back quickly."
    ),
    line("p10", "doctor", "bn", 56, "পেট নরম, চাপ দিলে ব্যথা নেই।"),
    line(
      "p11",
      "doctor",
      "bn",
      62,
      "বেশি বেশি তরল খাবার দেবেন, বুকের দুধ চালিয়ে যাবেন।"
    ),
    line(
      "p12",
      "doctor",
      "bn",
      70,
      "বাবু খুব নিস্তেজ হয়ে গেলে বা কিছু খেতে না পারলে সাথে সাথে নিয়ে আসবেন।"
    ),
  ],
  draft: [
    {
      section: "chiefComplaint",
      lines: [
        {
          text: "Loose motions for 2 days, 6 to 7 times a day.",
          transcriptLineIds: ["p01", "p02"],
        },
      ],
    },
    {
      section: "history",
      lines: [
        {
          text: "No blood or mucus in the stool; vomited twice.",
          transcriptLineIds: ["p03", "p04"],
        },
        {
          text: "Mild fever last night; taking breast milk and water, poor appetite for solids.",
          transcriptLineIds: ["p05", "p06"],
        },
        {
          text: "Passing urine, slightly less than usual.",
          transcriptLineIds: ["p07", "p08"],
        },
      ],
    },
    {
      section: "examination",
      lines: [
        {
          text: "Weight 13 kg, temperature 99.6 F; eyes not sunken, skin pinch returns quickly.",
          transcriptLineIds: ["p09"],
        },
        { text: "Abdomen soft, non-tender.", transcriptLineIds: ["p10"] },
      ],
    },
    {
      section: "plan",
      lines: [
        {
          text: "Advised extra fluids and continued breastfeeding.",
          transcriptLineIds: ["p11"],
        },
        {
          text: "Danger signs explained to the mother.",
          transcriptLineIds: ["p12"],
        },
      ],
    },
  ],
}

/** Cardiology: chest heaviness on walking. */
const CARDIO_CHEST_HEAVINESS: ScribeScript = {
  id: "scr_cardio_chest_heaviness",
  title: { en: "Chest heaviness on walking", bn: "হাঁটলে বুকে চাপ" },
  specialtyCode: "CARD",
  durationSec: 85,
  transcript: [
    line("c01", "doctor", "bn", 0, "বসুন। আজ কী সমস্যা নিয়ে এসেছেন?"),
    line(
      "c02",
      "patient",
      "bn",
      5,
      "কয়েক সপ্তাহ ধরে হাঁটলে বুকে একটা চাপ চাপ লাগে।"
    ),
    line(
      "c03",
      "doctor",
      "bn",
      11,
      "কতক্ষণ হাঁটলে শুরু হয়, আর থামলে কি কমে যায়?"
    ),
    line(
      "c04",
      "patient",
      "bn",
      17,
      "দশ মিনিটের মতো হাঁটলে শুরু হয়, একটু দাঁড়ালে পাঁচ মিনিটে কমে যায়।"
    ),
    line("c05", "doctor", "en", 25, "Does it spread to your arm, jaw or back?"),
    line("c06", "patient", "bn", 30, "মাঝে মাঝে বাম হাতে একটু ছড়ায়।"),
    line(
      "c07",
      "doctor",
      "bn",
      36,
      "ধূমপান করেন? পরিবারে কারো হার্টের সমস্যা আছে?"
    ),
    line(
      "c08",
      "patient",
      "bn",
      42,
      "দিনে দশটার মতো সিগারেট খাই। বাবার হার্টের সমস্যা ছিল।"
    ),
    line("c09", "doctor", "en", 50, "BP 150 over 95, pulse 88 and regular."),
    line("c10", "doctor", "bn", 57, "হৃৎশব্দ স্বাভাবিক, ফুসফুস পরিষ্কার।"),
    line(
      "c11",
      "doctor",
      "bn",
      64,
      "আজ ইসিজি করব, সাথে লিপিড প্রোফাইল আর ইকো।"
    ),
    line(
      "c12",
      "doctor",
      "bn",
      73,
      "সিগারেট একদম ছেড়ে দিতে হবে, আর ব্যথা বাড়লে সাথে সাথে চলে আসবেন।"
    ),
  ],
  draft: [
    {
      section: "chiefComplaint",
      lines: [
        {
          text: "Chest heaviness on walking for a few weeks.",
          transcriptLineIds: ["c01", "c02"],
        },
      ],
    },
    {
      section: "history",
      lines: [
        {
          text: "Starts after about 10 minutes of walking; settles within 5 minutes of rest.",
          transcriptLineIds: ["c03", "c04"],
        },
        {
          text: "Occasionally spreads to the left arm.",
          transcriptLineIds: ["c05", "c06"],
        },
        {
          text: "Smokes about 10 cigarettes a day; father had a heart problem.",
          transcriptLineIds: ["c07", "c08"],
        },
      ],
    },
    {
      section: "examination",
      lines: [
        {
          text: "BP 150/95 mmHg, pulse 88/min, regular.",
          transcriptLineIds: ["c09"],
        },
        {
          text: "Heart sounds normal; lungs clear.",
          transcriptLineIds: ["c10"],
        },
      ],
    },
    {
      section: "plan",
      lines: [
        {
          text: "Tests discussed: ECG, lipid profile and echocardiography.",
          transcriptLineIds: ["c11"],
        },
        {
          text: "Advised to stop smoking; return at once if the pain gets worse.",
          transcriptLineIds: ["c12"],
        },
      ],
    },
  ],
}

export const SCRIBE_SCRIPTS: ScribeScript[] = [
  HERO_FEVER_COUGH,
  PAEDS_LOOSE_MOTIONS,
  CARDIO_CHEST_HEAVINESS,
]

export const HERO_SCRIBE_SCRIPT_ID = HERO_FEVER_COUGH.id
