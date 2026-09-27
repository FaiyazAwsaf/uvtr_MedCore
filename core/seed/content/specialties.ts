/**
 * Specialties (plan §7.1) with the hospital-approved symptom phrases the
 * health-concern navigator maps to them (T2). Phrases describe what a patient
 * notices; they never name a diagnosis. Pathology and radiology have none:
 * patients are not routed to them.
 */

import type { Bilingual } from "@/config/brand.config"

export type SpecialtySeed = {
  code: string
  name: Bilingual
  /** lucide icon name */
  icon: string
  /** Token prefix shown on the display board, e.g. "M-14" */
  tokenPrefix: string
  navigatorSymptoms: Bilingual[]
  /** Qualification strings used for doctors of this specialty */
  qualifications: string[]
  /** Short bio interest phrases */
  interests: Bilingual[]
}

export const SPECIALTIES: SpecialtySeed[] = [
  {
    code: "MED",
    name: { en: "Medicine", bn: "মেডিসিন" },
    icon: "stethoscope",
    tokenPrefix: "M",
    navigatorSymptoms: [
      { en: "Fever for more than two days", bn: "দুই দিনের বেশি জ্বর" },
      { en: "Weakness or tiredness", bn: "দুর্বলতা বা ক্লান্তি" },
      {
        en: "Diabetes or blood pressure check-up",
        bn: "ডায়াবেটিস বা প্রেশার চেক-আপ",
      },
      { en: "Body ache and joint pain", bn: "শরীর ব্যথা ও গিঁটে ব্যথা" },
    ],
    qualifications: [
      "MBBS, FCPS (Medicine)",
      "MBBS, MD (Internal Medicine)",
      "MBBS, FCPS (Medicine), MRCP (UK)",
      "MBBS, MD (Medicine)",
    ],
    interests: [
      {
        en: "diabetes and hypertension care",
        bn: "ডায়াবেটিস ও উচ্চ রক্তচাপের চিকিৎসা",
      },
      { en: "fever and infectious diseases", bn: "জ্বর ও সংক্রামক রোগ" },
      {
        en: "long-term care of older adults",
        bn: "বয়স্কদের দীর্ঘমেয়াদি চিকিৎসা",
      },
    ],
  },
  {
    code: "CARD",
    name: { en: "Cardiology", bn: "হৃদরোগ" },
    icon: "heart-pulse",
    tokenPrefix: "C",
    navigatorSymptoms: [
      { en: "Chest pain or tightness", bn: "বুকে ব্যথা বা চাপ" },
      { en: "Racing or irregular heartbeat", bn: "বুক ধড়ফড় করা" },
      { en: "Breathless when walking", bn: "হাঁটলে শ্বাসকষ্ট" },
      { en: "Swelling of both feet", bn: "দুই পা ফুলে যাওয়া" },
    ],
    qualifications: [
      "MBBS, MD (Cardiology)",
      "MBBS, FCPS (Medicine), MD (Cardiology)",
      "MBBS, D-Card, FACC",
    ],
    interests: [
      { en: "preventive cardiology", bn: "হৃদরোগ প্রতিরোধ" },
      { en: "heart failure clinics", bn: "হার্ট ফেইলিউর ক্লিনিক" },
      { en: "echocardiography", bn: "ইকোকার্ডিওগ্রাফি" },
    ],
  },
  {
    code: "PAED",
    name: { en: "Paediatrics", bn: "শিশুরোগ" },
    icon: "baby",
    tokenPrefix: "P",
    navigatorSymptoms: [
      { en: "Child has fever", bn: "শিশুর জ্বর" },
      { en: "Child is not feeding well", bn: "শিশু ঠিকমতো খাচ্ছে না" },
      { en: "Child has loose motions", bn: "শিশুর পাতলা পায়খানা" },
      { en: "Vaccination advice", bn: "টিকা সংক্রান্ত পরামর্শ" },
    ],
    qualifications: [
      "MBBS, DCH, FCPS (Paediatrics)",
      "MBBS, MD (Paediatrics)",
      "MBBS, FCPS (Paediatrics)",
    ],
    interests: [
      { en: "newborn and child care", bn: "নবজাতক ও শিশুর যত্ন" },
      { en: "childhood asthma", bn: "শিশুদের হাঁপানি" },
      { en: "growth and nutrition", bn: "বৃদ্ধি ও পুষ্টি" },
    ],
  },
  {
    code: "GYN",
    name: { en: "Gynae & Obs", bn: "স্ত্রীরোগ ও প্রসূতি" },
    icon: "heart-handshake",
    tokenPrefix: "G",
    navigatorSymptoms: [
      { en: "Pregnancy check-up", bn: "গর্ভকালীন চেক-আপ" },
      {
        en: "Irregular or painful periods",
        bn: "অনিয়মিত বা ব্যথাযুক্ত মাসিক",
      },
      { en: "Lower tummy pain in women", bn: "নারীদের তলপেটে ব্যথা" },
    ],
    qualifications: [
      "MBBS, FCPS (Obs & Gynae)",
      "MBBS, MS (Obs & Gynae)",
      "MBBS, DGO, FCPS (Obs & Gynae)",
    ],
    interests: [
      { en: "antenatal care", bn: "গর্ভকালীন সেবা" },
      { en: "menstrual health", bn: "মাসিক সংক্রান্ত স্বাস্থ্য" },
      { en: "infertility counselling", bn: "বন্ধ্যাত্ব বিষয়ে পরামর্শ" },
    ],
  },
  {
    code: "ORTH",
    name: { en: "Orthopaedics", bn: "অর্থোপেডিক্স" },
    icon: "bone",
    tokenPrefix: "O",
    navigatorSymptoms: [
      { en: "Back or neck pain", bn: "কোমর বা ঘাড়ে ব্যথা" },
      { en: "Knee pain", bn: "হাঁটুতে ব্যথা" },
      { en: "Injury after a fall", bn: "পড়ে গিয়ে আঘাত" },
    ],
    qualifications: [
      "MBBS, MS (Orthopaedics)",
      "MBBS, D-Ortho, FCPS (Surgery)",
      "MBBS, MS (Orthopaedics), AO Fellow",
    ],
    interests: [
      { en: "joint pain and arthritis", bn: "গিঁটে ব্যথা ও বাত" },
      { en: "sports injuries", bn: "খেলাধুলাজনিত আঘাত" },
      { en: "spine care", bn: "মেরুদণ্ডের চিকিৎসা" },
    ],
  },
  {
    code: "ENT",
    name: { en: "ENT", bn: "নাক, কান ও গলা" },
    icon: "ear",
    tokenPrefix: "E",
    navigatorSymptoms: [
      { en: "Ear pain or discharge", bn: "কানে ব্যথা বা পুঁজ" },
      { en: "Blocked nose or sinus pain", bn: "নাক বন্ধ বা সাইনাসে ব্যথা" },
      { en: "Sore throat that keeps coming back", bn: "বারবার গলা ব্যথা" },
    ],
    qualifications: ["MBBS, DLO, FCPS (ENT)", "MBBS, MS (ENT)"],
    interests: [
      { en: "sinus and nasal problems", bn: "সাইনাস ও নাকের সমস্যা" },
      { en: "hearing problems", bn: "শ্রবণ সমস্যা" },
    ],
  },
  {
    code: "DERM",
    name: { en: "Dermatology", bn: "চর্মরোগ" },
    icon: "hand",
    tokenPrefix: "D",
    navigatorSymptoms: [
      { en: "Itchy skin or rash", bn: "চুলকানি বা র‍্যাশ" },
      { en: "Pimples or skin spots", bn: "ব্রণ বা ত্বকে দাগ" },
      { en: "Hair fall", bn: "চুল পড়া" },
    ],
    qualifications: [
      "MBBS, DDV, FCPS (Dermatology)",
      "MBBS, MD (Dermatology & Venereology)",
    ],
    interests: [
      {
        en: "eczema and allergy of the skin",
        bn: "একজিমা ও ত্বকের অ্যালার্জি",
      },
      { en: "acne care", bn: "ব্রণের চিকিৎসা" },
    ],
  },
  {
    code: "NEURO",
    name: { en: "Neurology", bn: "স্নায়ুরোগ" },
    icon: "brain",
    tokenPrefix: "N",
    navigatorSymptoms: [
      { en: "Frequent headaches", bn: "ঘন ঘন মাথাব্যথা" },
      { en: "Numbness or tingling", bn: "অবশ ভাব বা ঝিনঝিন করা" },
      { en: "Fits or fainting spells", bn: "খিঁচুনি বা অজ্ঞান হয়ে যাওয়া" },
    ],
    qualifications: [
      "MBBS, MD (Neurology)",
      "MBBS, FCPS (Medicine), MD (Neurology)",
    ],
    interests: [
      { en: "headache clinics", bn: "মাথাব্যথা ক্লিনিক" },
      { en: "stroke follow-up", bn: "স্ট্রোক পরবর্তী ফলো-আপ" },
    ],
  },
  {
    code: "GASTRO",
    name: { en: "Gastroenterology", bn: "গ্যাস্ট্রোএন্টারোলজি" },
    icon: "utensils",
    tokenPrefix: "GI",
    navigatorSymptoms: [
      {
        en: "Burning or pain in the upper tummy",
        bn: "পেটের উপরের অংশে জ্বালা বা ব্যথা",
      },
      { en: "Change in bowel habit", bn: "পায়খানার অভ্যাসে পরিবর্তন" },
      { en: "Yellow eyes", bn: "চোখ হলুদ হয়ে যাওয়া" },
    ],
    qualifications: [
      "MBBS, MD (Gastroenterology)",
      "MBBS, FCPS (Medicine), MD (Hepatology)",
    ],
    interests: [
      { en: "liver care", bn: "লিভারের চিকিৎসা" },
      { en: "endoscopy", bn: "এন্ডোস্কপি" },
    ],
  },
  {
    code: "NEPH",
    name: { en: "Nephrology", bn: "কিডনি রোগ" },
    icon: "droplets",
    tokenPrefix: "K",
    navigatorSymptoms: [
      { en: "Swelling of face or feet", bn: "মুখ বা পা ফুলে যাওয়া" },
      { en: "Change in urine amount", bn: "প্রস্রাবের পরিমাণে পরিবর্তন" },
      { en: "Kidney report follow-up", bn: "কিডনির রিপোর্ট দেখানো" },
    ],
    qualifications: [
      "MBBS, MD (Nephrology)",
      "MBBS, FCPS (Medicine), MD (Nephrology)",
    ],
    interests: [
      { en: "chronic kidney care", bn: "দীর্ঘমেয়াদি কিডনি সেবা" },
      { en: "dialysis planning", bn: "ডায়ালাইসিস পরিকল্পনা" },
    ],
  },
  {
    code: "ENDO",
    name: { en: "Endocrinology", bn: "হরমোন ও ডায়াবেটিস" },
    icon: "syringe",
    tokenPrefix: "H",
    navigatorSymptoms: [
      { en: "High blood sugar", bn: "রক্তে সুগার বেশি" },
      { en: "Thyroid report follow-up", bn: "থাইরয়েড রিপোর্ট দেখানো" },
      { en: "Unexplained weight change", bn: "অকারণে ওজন বাড়া বা কমা" },
    ],
    qualifications: [
      "MBBS, MD (Endocrinology)",
      "MBBS, FCPS (Medicine), MD (Endocrinology & Metabolism)",
    ],
    interests: [
      { en: "diabetes education", bn: "ডায়াবেটিস শিক্ষা" },
      { en: "thyroid care", bn: "থাইরয়েডের চিকিৎসা" },
    ],
  },
  {
    code: "PSY",
    name: { en: "Psychiatry", bn: "মানসিক রোগ" },
    icon: "smile",
    tokenPrefix: "Y",
    navigatorSymptoms: [
      { en: "Trouble sleeping", bn: "ঘুমের সমস্যা" },
      { en: "Feeling low or anxious", bn: "মন খারাপ বা দুশ্চিন্তা" },
    ],
    qualifications: ["MBBS, MD (Psychiatry)", "MBBS, FCPS (Psychiatry)"],
    interests: [
      { en: "anxiety and sleep problems", bn: "উদ্বেগ ও ঘুমের সমস্যা" },
      { en: "family counselling", bn: "পারিবারিক কাউন্সেলিং" },
    ],
  },
  {
    code: "OPH",
    name: { en: "Ophthalmology", bn: "চক্ষুরোগ" },
    icon: "eye",
    tokenPrefix: "V",
    navigatorSymptoms: [
      { en: "Blurred vision", bn: "ঝাপসা দেখা" },
      { en: "Red or watering eyes", bn: "চোখ লাল বা পানি পড়া" },
    ],
    qualifications: [
      "MBBS, DO, FCPS (Ophthalmology)",
      "MBBS, MS (Ophthalmology)",
    ],
    interests: [
      { en: "cataract assessment", bn: "ছানি পরীক্ষা" },
      { en: "diabetic eye screening", bn: "ডায়াবেটিসজনিত চোখ পরীক্ষা" },
    ],
  },
  {
    code: "URO",
    name: { en: "Urology", bn: "মূত্রতন্ত্র রোগ" },
    icon: "shield-plus",
    tokenPrefix: "U",
    navigatorSymptoms: [
      { en: "Burning when passing urine", bn: "প্রস্রাবে জ্বালাপোড়া" },
      { en: "Frequent urination at night", bn: "রাতে ঘন ঘন প্রস্রাব" },
      { en: "Pain in the side of the back", bn: "কোমরের পাশে ব্যথা" },
    ],
    qualifications: [
      "MBBS, MS (Urology)",
      "MBBS, FCPS (Surgery), MS (Urology)",
    ],
    interests: [
      { en: "kidney stone care", bn: "কিডনি পাথরের চিকিৎসা" },
      { en: "prostate clinics", bn: "প্রোস্টেট ক্লিনিক" },
    ],
  },
  {
    code: "SURG",
    name: { en: "General Surgery", bn: "জেনারেল সার্জারি" },
    icon: "scissors",
    tokenPrefix: "S",
    navigatorSymptoms: [
      { en: "Lump or swelling", bn: "চাকা বা ফোলা" },
      {
        en: "Pain or bleeding around the back passage",
        bn: "মলদ্বারে ব্যথা বা রক্তপাত",
      },
      { en: "Swelling in the groin", bn: "কুঁচকিতে ফোলা" },
    ],
    qualifications: [
      "MBBS, FCPS (Surgery)",
      "MBBS, MS (General Surgery)",
      "MBBS, FCPS (Surgery), FRCS",
    ],
    interests: [
      { en: "day-case surgery", bn: "ডে-কেয়ার সার্জারি" },
      { en: "laparoscopic surgery", bn: "ল্যাপারোস্কপিক সার্জারি" },
    ],
  },
  {
    code: "CHEST",
    name: { en: "Chest Medicine", bn: "বক্ষব্যাধি" },
    icon: "wind",
    tokenPrefix: "R",
    navigatorSymptoms: [
      { en: "Cough for more than two weeks", bn: "দুই সপ্তাহের বেশি কাশি" },
      {
        en: "Wheezing or breathlessness",
        bn: "শ্বাসে শাঁ শাঁ শব্দ বা শ্বাসকষ্ট",
      },
    ],
    qualifications: [
      "MBBS, MD (Chest Diseases)",
      "MBBS, FCPS (Medicine), FCCP",
    ],
    interests: [
      {
        en: "asthma and long-term lung care",
        bn: "হাঁপানি ও দীর্ঘমেয়াদি ফুসফুস সেবা",
      },
      { en: "tuberculosis follow-up", bn: "যক্ষ্মা ফলো-আপ" },
    ],
  },
  {
    code: "PATH",
    name: { en: "Pathology", bn: "প্যাথলজি" },
    icon: "microscope",
    tokenPrefix: "L",
    navigatorSymptoms: [],
    qualifications: ["MBBS, M.Phil (Pathology)", "MBBS, FCPS (Haematology)"],
    interests: [{ en: "laboratory quality", bn: "ল্যাবরেটরির মান" }],
  },
  {
    code: "RAD",
    name: { en: "Radiology & Imaging", bn: "রেডিওলজি ও ইমেজিং" },
    icon: "scan-line",
    tokenPrefix: "X",
    navigatorSymptoms: [],
    qualifications: ["MBBS, MD (Radiology & Imaging)"],
    interests: [{ en: "ultrasound", bn: "আল্ট্রাসাউন্ড" }],
  },
]

export const specialtyId = (code: string) => `spc_${code.toLowerCase()}`
