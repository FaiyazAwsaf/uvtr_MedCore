/**
 * The doctor roster (plan §7.1): 60 clinical doctors across 16 specialties
 * plus 2 pathologists and 1 radiologist. Every doctor is male (owner rule).
 * The persona doctors keep the fixed ids from hero-ids.ts and the staff ids
 * and BMDC numbers from personas.ts. All names are fictional.
 */

import type { BranchCode } from "@/config/brand.config"
import type { DoctorRow } from "@/core/db/schema"

import { HERO } from "./hero-ids"

export type DoctorSeed = {
  /** DoctorRow id */
  id: string
  staffId: string
  nameEn: string
  nameBn: string
  specialty: string
  kind: DoctorRow["kind"]
  /** First branch is the primary one */
  branches: BranchCode[]
  feeTaka: number
  followUpTaka: number
  experienceYears: number
  /** Fixed for personas; generated otherwise */
  qualifications?: string
  bmdcNo?: string
  isDutyDoctor?: boolean
  /** Persona doctors already have a staff row from personas.ts */
  persona?: boolean
}

export const PERSONA_DOCTORS: DoctorSeed[] = [
  {
    id: HERO.doctor.kamal,
    staffId: "stf_kamal_hossain",
    nameEn: "Dr. Kamal Hossain",
    nameBn: "ডা. কামাল হোসেন",
    specialty: "MED",
    kind: "consultant",
    branches: ["B1"],
    feeTaka: 1000,
    followUpTaka: 500,
    experienceYears: 16,
    qualifications: "MBBS, FCPS (Medicine)",
    bmdcNo: "A-45127",
    persona: true,
  },
  {
    id: HERO.doctor.arif,
    staffId: "stf_arif_rahman",
    nameEn: "Dr. Arif Rahman",
    nameBn: "ডা. আরিফ রহমান",
    specialty: "PAED",
    kind: "consultant",
    branches: ["B1"],
    feeTaka: 900,
    followUpTaka: 500,
    experienceYears: 12,
    qualifications: "MBBS, DCH, FCPS (Paediatrics)",
    bmdcNo: "A-51388",
    persona: true,
  },
  {
    id: HERO.doctor.saiful,
    staffId: "stf_saiful_islam",
    nameEn: "Dr. Saiful Islam",
    nameBn: "ডা. সাইফুল ইসলাম",
    specialty: "MED",
    kind: "medical-officer",
    branches: ["B1"],
    feeTaka: 500,
    followUpTaka: 300,
    experienceYears: 6,
    qualifications: "MBBS, CCD (BIRDEM)",
    bmdcNo: "A-62904",
    isDutyDoctor: true,
    persona: true,
  },
  {
    id: HERO.doctor.nazmul,
    staffId: "stf_nazmul_haque",
    nameEn: "Dr. Nazmul Haque",
    nameBn: "ডা. নাজমুল হক",
    specialty: "CARD",
    kind: "consultant",
    branches: ["B3", "B1"],
    feeTaka: 1500,
    followUpTaka: 800,
    experienceYears: 18,
    qualifications: "MBBS, MD (Cardiology)",
    bmdcNo: "A-38815",
    persona: true,
  },
  {
    id: HERO.doctor.mizanur,
    staffId: "stf_mizanur_rahman",
    nameEn: "Dr. Mizanur Rahman",
    nameBn: "ডা. মিজানুর রহমান",
    specialty: "PATH",
    kind: "pathologist",
    branches: ["B1", "B2", "B5"],
    feeTaka: 0,
    followUpTaka: 0,
    experienceYears: 20,
    qualifications: "MBBS, M.Phil (Pathology)",
    bmdcNo: "A-29461",
    persona: true,
  },
]

/** [English name, Bangla name, specialty code, branches] */
type Row = readonly [string, string, string, readonly BranchCode[]]

const GENERATED: readonly Row[] = [
  ["Dr. Mohammad Abdullah", "ডা. মোহাম্মদ আব্দুল্লাহ", "MED", ["B1"]],
  ["Dr. Ahsanul Kabir", "ডা. আহসানুল কবির", "MED", ["B2"]],
  ["Dr. Towhidul Islam", "ডা. তৌহিদুল ইসলাম", "MED", ["B5"]],
  ["Dr. Rezaul Haque", "ডা. রেজাউল হক", "MED", ["B3", "B1"]],
  ["Dr. Masud Parvez", "ডা. মাসুদ পারভেজ", "MED", ["B2"]],
  ["Dr. Aminul Islam", "ডা. আমিনুল ইসলাম", "MED", ["B5"]],
  ["Dr. Golam Rabbani", "ডা. গোলাম রাব্বানী", "PAED", ["B1"]],
  ["Dr. Faisal Chowdhury", "ডা. ফয়সাল চৌধুরী", "PAED", ["B2"]],
  ["Dr. Nurul Amin", "ডা. নুরুল আমিন", "PAED", ["B5"]],
  ["Dr. Kazi Mahfuzur Rahman", "ডা. কাজী মাহফুজুর রহমান", "PAED", ["B3"]],
  ["Dr. Ehsanul Hoque", "ডা. এহসানুল হক", "CARD", ["B1"]],
  ["Dr. Mostafa Jamal", "ডা. মোস্তফা জামাল", "CARD", ["B2"]],
  ["Dr. A. K. M. Shafiul Alam", "ডা. এ. কে. এম. শফিউল আলম", "CARD", ["B5"]],
  ["Dr. Abu Naser", "ডা. আবু নাসের", "CARD", ["B1", "B3"]],
  ["Dr. Sabbir Hossain", "ডা. সাব্বির হোসেন", "GYN", ["B1"]],
  ["Dr. Rashed Imam", "ডা. রাশেদ ইমাম", "GYN", ["B1"]],
  ["Dr. Harun Rashid", "ডা. হারুন রশিদ", "GYN", ["B2"]],
  ["Dr. Monirul Islam", "ডা. মনিরুল ইসলাম", "GYN", ["B5"]],
  ["Dr. Sajjad Hossain", "ডা. সাজ্জাদ হোসেন", "GYN", ["B3"]],
  ["Dr. Zahid Hasan", "ডা. জাহিদ হাসান", "ORTH", ["B1"]],
  ["Dr. Mahbubul Alam", "ডা. মাহবুবুল আলম", "ORTH", ["B2"]],
  ["Dr. Ferdous Wahid", "ডা. ফেরদৌস ওয়াহিদ", "ORTH", ["B5"]],
  ["Dr. Anwarul Kabir", "ডা. আনোয়ারুল কবির", "ORTH", ["B3"]],
  ["Dr. Shamim Ahmed", "ডা. শামীম আহমেদ", "ENT", ["B1"]],
  ["Dr. Selim Reza", "ডা. সেলিম রেজা", "ENT", ["B2"]],
  ["Dr. Atiqur Rahman", "ডা. আতিকুর রহমান", "ENT", ["B5"]],
  ["Dr. Jubayer Hossain", "ডা. জুবায়ের হোসেন", "DERM", ["B1", "B3"]],
  ["Dr. Pranab Kumar Saha", "ডা. প্রণব কুমার সাহা", "DERM", ["B2"]],
  ["Dr. Subrata Ghosh", "ডা. সুব্রত ঘোষ", "DERM", ["B5"]],
  ["Dr. Debashis Roy", "ডা. দেবাশীষ রায়", "NEURO", ["B1"]],
  ["Dr. Asif Iqbal", "ডা. আসিফ ইকবাল", "NEURO", ["B2"]],
  ["Dr. Nazmus Sakib", "ডা. নাজমুস সাকিব", "NEURO", ["B5"]],
  ["Dr. Fazle Rabbi", "ডা. ফজলে রাব্বি", "GASTRO", ["B1"]],
  ["Dr. Sharif Uddin", "ডা. শরীফ উদ্দিন", "GASTRO", ["B2"]],
  ["Dr. Iftekhar Ahmed", "ডা. ইফতেখার আহমেদ", "GASTRO", ["B5"]],
  ["Dr. Tanzim Rahman", "ডা. তানজিম রহমান", "NEPH", ["B1"]],
  ["Dr. Shafayet Hossain", "ডা. শাফায়েত হোসেন", "NEPH", ["B5"]],
  ["Dr. Abdullah Al Mamun", "ডা. আব্দুল্লাহ আল মামুন", "NEPH", ["B2"]],
  ["Dr. Khaled Hasan", "ডা. খালেদ হাসান", "ENDO", ["B1", "B3"]],
  ["Dr. Hasibul Islam", "ডা. হাসিবুল ইসলাম", "ENDO", ["B2"]],
  ["Dr. Omar Faruk", "ডা. ওমর ফারুক", "ENDO", ["B5"]],
  ["Dr. Rafiul Bari", "ডা. রফিউল বারী", "PSY", ["B1"]],
  ["Dr. Kawsar Alam", "ডা. কাওসার আলম", "PSY", ["B5"]],
  ["Dr. Shahedul Islam", "ডা. শাহেদুল ইসলাম", "OPH", ["B1"]],
  ["Dr. Nafiul Hasan", "ডা. নাফিউল হাসান", "OPH", ["B2"]],
  ["Dr. Emran Hossain", "ডা. এমরান হোসেন", "OPH", ["B5"]],
  ["Dr. Raihan Uddin", "ডা. রায়হান উদ্দিন", "URO", ["B1"]],
  ["Dr. Sirajul Islam", "ডা. সিরাজুল ইসলাম", "URO", ["B2"]],
  ["Dr. Bodiuzzaman", "ডা. বদিউজ্জামান", "URO", ["B5"]],
  ["Dr. Nasimul Gani", "ডা. নাসিমুল গনি", "SURG", ["B1"]],
  ["Dr. Arup Kumar Das", "ডা. অরূপ কুমার দাস", "SURG", ["B2"]],
  ["Dr. Sohel Mahmud", "ডা. সোহেল মাহমুদ", "SURG", ["B5"]],
  ["Dr. Tushar Kanti Dey", "ডা. তুষার কান্তি দে", "SURG", ["B1"]],
  ["Dr. Wahidur Rahman", "ডা. ওয়াহিদুর রহমান", "CHEST", ["B1", "B3"]],
  ["Dr. Ashiqur Rahman", "ডা. আশিকুর রহমান", "CHEST", ["B5"]],
  ["Dr. Shahriar Mahmud", "ডা. শাহরিয়ার মাহমুদ", "CHEST", ["B2"]],
]

/** Second pathologist and the radiologist (report sign-off, no OPD). */
const REPORTING: readonly (readonly [
  string,
  string,
  string,
  readonly BranchCode[],
  DoctorRow["kind"],
])[] = [
  [
    "Dr. Shahnewaz Chowdhury",
    "ডা. শাহনেওয়াজ চৌধুরী",
    "PATH",
    ["B3", "B4"],
    "pathologist",
  ],
  [
    "Dr. Enamul Kabir",
    "ডা. এনামুল কবির",
    "RAD",
    ["B1", "B2", "B3", "B4", "B5"],
    "radiologist",
  ],
]

const slug = (name: string) =>
  name
    .replace(/^Dr\.\s*/, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_|_$/g, "")

/** Generated doctors (fees, experience and BMDC numbers are filled by the generator). */
export const GENERATED_DOCTORS: Omit<
  DoctorSeed,
  "feeTaka" | "followUpTaka" | "experienceYears"
>[] = [
  ...GENERATED.map(([nameEn, nameBn, specialty, branches]) => ({
    id: `doc_${slug(nameEn)}`,
    staffId: `stf_doc_${slug(nameEn)}`,
    nameEn,
    nameBn,
    specialty,
    kind: "consultant" as const,
    branches: [...branches],
  })),
  ...REPORTING.map(([nameEn, nameBn, specialty, branches, kind]) => ({
    id: `doc_${slug(nameEn)}`,
    staffId: `stf_doc_${slug(nameEn)}`,
    nameEn,
    nameBn,
    specialty,
    kind,
    branches: [...branches],
  })),
]
