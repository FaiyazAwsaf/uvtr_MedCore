/**
 * Specialty note templates (plan §7.1): the scaffold text a new note starts
 * from, per section, in English and Bangla. They hold headings and prompts
 * only; the doctor writes the findings, assessment and plan.
 */

import type { Bilingual } from "@/config/brand.config"
import type { NoteSections } from "@/core/db/schema"

export type NoteTemplate = {
  id: string
  specialtyCode: string
  name: Bilingual
  sections: Record<keyof NoteSections, Bilingual>
}

const PLAN: Bilingual = {
  en: "Investigations:\nMedicines: see prescription\nAdvice:\nFollow-up:",
  bn: "পরীক্ষা-নিরীক্ষা:\nওষুধ: প্রেসক্রিপশন দেখুন\nপরামর্শ:\nফলো-আপ:",
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "tpl_medicine",
    specialtyCode: "MED",
    name: { en: "Medicine OPD", bn: "মেডিসিন আউটডোর" },
    sections: {
      chiefComplaint: {
        en: "Main complaint and duration:",
        bn: "প্রধান সমস্যা ও কতদিন ধরে:",
      },
      history: {
        en: "History of present illness:\nPast illnesses:\nCurrent medicines:\nAllergies: see allergy list\nFamily and social history:",
        bn: "বর্তমান অসুস্থতার ইতিহাস:\nপূর্বের অসুস্থতা:\nবর্তমানে যে ওষুধ চলছে:\nঅ্যালার্জি: অ্যালার্জি তালিকা দেখুন\nপারিবারিক ও সামাজিক ইতিহাস:",
      },
      examination: {
        en: "General appearance:\nPulse:    BP:    Temp:    SpO2:\nChest:\nHeart:\nAbdomen:\nNervous system:",
        bn: "সাধারণ অবস্থা:\nনাড়ি:    রক্তচাপ:    তাপমাত্রা:    SpO2:\nবুক:\nহৃৎপিণ্ড:\nপেট:\nস্নায়ুতন্ত্র:",
      },
      assessment: {
        en: "Clinical impression:\nDifferentials:",
        bn: "ক্লিনিক্যাল ধারণা:\nসম্ভাব্য অন্যান্য কারণ:",
      },
      plan: PLAN,
    },
  },
  {
    id: "tpl_paediatrics",
    specialtyCode: "PAED",
    name: { en: "Paediatrics OPD", bn: "শিশুরোগ আউটডোর" },
    sections: {
      chiefComplaint: {
        en: "Main complaint (as told by the parent) and duration:",
        bn: "প্রধান সমস্যা (অভিভাবকের ভাষায়) ও কতদিন ধরে:",
      },
      history: {
        en: "History of present illness:\nFeeding and appetite:\nUrine and stool:\nBirth history:\nImmunisation status:\nDevelopment:",
        bn: "বর্তমান অসুস্থতার ইতিহাস:\nখাওয়া-দাওয়া ও রুচি:\nপ্রস্রাব ও পায়খানা:\nজন্মকালীন ইতিহাস:\nটিকার অবস্থা:\nবৃদ্ধি ও বিকাশ:",
      },
      examination: {
        en: "Weight:    Height:    Temp:    Pulse:    RR:    SpO2:\nHydration:\nThroat and ears:\nChest:\nAbdomen:\nSkin:",
        bn: "ওজন:    উচ্চতা:    তাপমাত্রা:    নাড়ি:    শ্বাসের হার:    SpO2:\nপানিশূন্যতার অবস্থা:\nগলা ও কান:\nবুক:\nপেট:\nত্বক:",
      },
      assessment: {
        en: "Clinical impression:\nDanger signs checked:",
        bn: "ক্লিনিক্যাল ধারণা:\nবিপদচিহ্ন যাচাই:",
      },
      plan: {
        en: "Investigations:\nMedicines (dose by weight): see prescription\nAdvice to parents:\nFollow-up:",
        bn: "পরীক্ষা-নিরীক্ষা:\nওষুধ (ওজন অনুযায়ী মাত্রা): প্রেসক্রিপশন দেখুন\nঅভিভাবকদের জন্য পরামর্শ:\nফলো-আপ:",
      },
    },
  },
  {
    id: "tpl_cardiology",
    specialtyCode: "CARD",
    name: { en: "Cardiology OPD", bn: "হৃদরোগ আউটডোর" },
    sections: {
      chiefComplaint: {
        en: "Main complaint and duration:",
        bn: "প্রধান সমস্যা ও কতদিন ধরে:",
      },
      history: {
        en: "Chest pain: site, character, exertion, relief\nBreathlessness (grade):\nPalpitations:\nRisk factors: smoking, sugar, pressure, lipids, family history\nPrevious cardiac tests:",
        bn: "বুকে ব্যথা: স্থান, ধরন, পরিশ্রমে বাড়ে কি না, কীসে কমে\nশ্বাসকষ্ট (মাত্রা):\nবুক ধড়ফড়:\nঝুঁকির কারণ: ধূমপান, সুগার, প্রেশার, চর্বি, পারিবারিক ইতিহাস\nআগের হৃদরোগ পরীক্ষা:",
      },
      examination: {
        en: "Pulse (rate, rhythm):    BP (both arms):\nJVP:\nHeart sounds and murmurs:\nLung bases:\nAnkle swelling:",
        bn: "নাড়ি (হার, ছন্দ):    রক্তচাপ (দুই হাতে):\nজেভিপি:\nহৃৎশব্দ ও মারমার:\nফুসফুসের নিচের অংশ:\nগোড়ালি ফোলা:",
      },
      assessment: {
        en: "Clinical impression:\nRisk category:",
        bn: "ক্লিনিক্যাল ধারণা:\nঝুঁকির মাত্রা:",
      },
      plan: PLAN,
    },
  },
  {
    id: "tpl_gynae",
    specialtyCode: "GYN",
    name: { en: "Gynae and Obs OPD", bn: "স্ত্রীরোগ ও প্রসূতি আউটডোর" },
    sections: {
      chiefComplaint: {
        en: "Main complaint and duration:",
        bn: "প্রধান সমস্যা ও কতদিন ধরে:",
      },
      history: {
        en: "Menstrual history (LMP, cycle):\nObstetric history (G, P):\nIf pregnant: gestational age, EDD:\nContraception:\nPast illnesses and surgery:",
        bn: "মাসিকের ইতিহাস (শেষ মাসিক, চক্র):\nপ্রসূতি ইতিহাস (গর্ভধারণ, প্রসব):\nগর্ভবতী হলে: গর্ভকাল, সম্ভাব্য প্রসবের তারিখ:\nজন্মনিয়ন্ত্রণ পদ্ধতি:\nপূর্বের অসুস্থতা ও অস্ত্রোপচার:",
      },
      examination: {
        en: "BP:    Weight:    Pallor:    Oedema:\nBreasts:\nAbdomen (fundal height, fetal heart if pregnant):\nPelvic examination (with chaperone):",
        bn: "রক্তচাপ:    ওজন:    রক্তস্বল্পতা:    পানি জমা:\nস্তন:\nপেট (গর্ভবতী হলে জরায়ুর উচ্চতা, শিশুর হৃৎস্পন্দন):\nশ্রোণি পরীক্ষা (সহকারী উপস্থিত):",
      },
      assessment: { en: "Clinical impression:", bn: "ক্লিনিক্যাল ধারণা:" },
      plan: PLAN,
    },
  },
  {
    id: "tpl_orthopaedics",
    specialtyCode: "ORTH",
    name: { en: "Orthopaedics OPD", bn: "অর্থোপেডিক্স আউটডোর" },
    sections: {
      chiefComplaint: {
        en: "Main complaint, site and duration:",
        bn: "প্রধান সমস্যা, স্থান ও কতদিন ধরে:",
      },
      history: {
        en: "Onset (injury or gradual):\nPain: character, radiation, night pain\nStiffness and swelling:\nFunction and work:\nPrevious treatment:",
        bn: "শুরু (আঘাত নাকি ধীরে ধীরে):\nব্যথা: ধরন, ছড়ায় কি না, রাতে ব্যথা\nশক্ত ভাব ও ফোলা:\nদৈনন্দিন কাজ ও পেশা:\nপূর্বের চিকিৎসা:",
      },
      examination: {
        en: "Look: swelling, deformity, wasting\nFeel: tenderness, warmth\nMove: range of movement\nNeurovascular status:\nSpecial tests:",
        bn: "দেখা: ফোলা, বিকৃতি, মাংসপেশি শুকানো\nস্পর্শ: ব্যথা, গরম ভাব\nনড়াচড়া: নড়াচড়ার পরিসর\nস্নায়ু ও রক্তসঞ্চালন:\nবিশেষ পরীক্ষা:",
      },
      assessment: { en: "Clinical impression:", bn: "ক্লিনিক্যাল ধারণা:" },
      plan: {
        en: "Imaging and tests:\nMedicines: see prescription\nPhysiotherapy and exercise advice:\nFollow-up:",
        bn: "ইমেজিং ও পরীক্ষা:\nওষুধ: প্রেসক্রিপশন দেখুন\nফিজিওথেরাপি ও ব্যায়ামের পরামর্শ:\nফলো-আপ:",
      },
    },
  },
  {
    id: "tpl_ent",
    specialtyCode: "ENT",
    name: { en: "ENT OPD", bn: "নাক, কান ও গলা আউটডোর" },
    sections: {
      chiefComplaint: {
        en: "Main complaint and duration:",
        bn: "প্রধান সমস্যা ও কতদিন ধরে:",
      },
      history: {
        en: "Ear: pain, discharge, hearing, ringing\nNose: blockage, discharge, bleeding, smell\nThroat: pain, swallowing, voice\nAllergy history:",
        bn: "কান: ব্যথা, পুঁজ, শোনা, কানে শব্দ\nনাক: বন্ধ ভাব, সর্দি, রক্তপাত, ঘ্রাণ\nগলা: ব্যথা, গিলতে কষ্ট, কণ্ঠস্বর\nঅ্যালার্জির ইতিহাস:",
      },
      examination: {
        en: "Ears (otoscopy):\nTuning fork tests:\nNose (anterior rhinoscopy):\nThroat and tonsils:\nNeck nodes:",
        bn: "কান (অটোস্কোপি):\nটিউনিং ফর্ক পরীক্ষা:\nনাক (সামনের অংশ):\nগলা ও টনসিল:\nগলার গ্রন্থি:",
      },
      assessment: { en: "Clinical impression:", bn: "ক্লিনিক্যাল ধারণা:" },
      plan: PLAN,
    },
  },
  {
    id: "tpl_dermatology",
    specialtyCode: "DERM",
    name: { en: "Dermatology OPD", bn: "চর্মরোগ আউটডোর" },
    sections: {
      chiefComplaint: {
        en: "Main complaint, site and duration:",
        bn: "প্রধান সমস্যা, স্থান ও কতদিন ধরে:",
      },
      history: {
        en: "Onset and spread:\nItching (day or night):\nTriggers: soaps, cosmetics, sunlight, food\nFamily members with similar lesions:\nPrevious creams or medicines used:",
        bn: "কীভাবে শুরু ও ছড়ানো:\nচুলকানি (দিনে না রাতে):\nবাড়ানোর কারণ: সাবান, প্রসাধনী, রোদ, খাবার\nপরিবারের অন্য কারো একই সমস্যা:\nআগে ব্যবহৃত ক্রিম বা ওষুধ:",
      },
      examination: {
        en: "Distribution:\nMorphology (type, colour, shape):\nScalp, nails and mucosa:\nSecondary infection:",
        bn: "বিস্তার:\nধরন (প্রকার, রং, আকৃতি):\nমাথার ত্বক, নখ ও মুখের ভেতর:\nদ্বিতীয় সংক্রমণ:",
      },
      assessment: { en: "Clinical impression:", bn: "ক্লিনিক্যাল ধারণা:" },
      plan: {
        en: "Tests:\nMedicines and creams: see prescription\nSkin care advice:\nFollow-up:",
        bn: "পরীক্ষা:\nওষুধ ও ক্রিম: প্রেসক্রিপশন দেখুন\nত্বকের যত্নের পরামর্শ:\nফলো-আপ:",
      },
    },
  },
]

export function templateForSpecialty(code: string): NoteTemplate {
  return (
    NOTE_TEMPLATES.find((t) => t.specialtyCode === code) ?? NOTE_TEMPLATES[0]
  )
}
