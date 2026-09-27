/**
 * The demo personas (plan §8) and the staff records behind them. Static so the
 * launcher and the seed agree on ids before any data is generated. All names
 * are fictional. Doctors are all male (owner rule).
 */

import type { Bilingual, BranchCode } from "@/config/brand.config"
import type { Role } from "@/core/rbac/types"
import type { Authority, Sex } from "@/core/db/schema"

import { HERO } from "./hero-ids"

export type PersonaSeed = {
  id: string
  role: Role
  branchId: BranchCode | null
  isDefault: boolean
  order: number
  blurb: Bilingual
  /** Staff behind the persona (absent for the patient persona) */
  staff?: {
    id: string
    nameEn: string
    nameBn: string
    sex: Sex
    designation: Bilingual
    regNo?: string
    regBody?: "BMDC" | "PCB"
    authorities: Authority[]
  }
  /** Patient behind the patient-app persona */
  patientId?: string
  /** Display name for the patient persona (staff personas use staff names) */
  patientName?: Bilingual
}

export const PERSONAS: PersonaSeed[] = [
  /* ---------------- Reception ---------------- */
  {
    id: "per_reception_farhana",
    role: "receptionist",
    branchId: "B1",
    isDefault: true,
    order: 1,
    blurb: {
      en: "Registers patients, books and checks in",
      bn: "রোগী নিবন্ধন, বুকিং ও চেক-ইন করেন",
    },
    staff: {
      id: "stf_farhana_akter",
      nameEn: "Farhana Akter",
      nameBn: "ফারহানা আক্তার",
      sex: "F",
      designation: { en: "Front desk officer", bn: "ফ্রন্ট ডেস্ক কর্মকর্তা" },
      authorities: [],
    },
  },
  {
    id: "per_reception_mahmudul",
    role: "receptionist",
    branchId: "B1",
    isDefault: false,
    order: 2,
    blurb: {
      en: "Approves merges and clears the review queue",
      bn: "একীকরণ অনুমোদন ও পর্যালোচনা সারি নিষ্পত্তি করেন",
    },
    staff: {
      id: "stf_mahmudul_hasan",
      nameEn: "Mahmudul Hasan",
      nameBn: "মাহমুদুল হাসান",
      sex: "M",
      designation: {
        en: "Front office supervisor",
        bn: "ফ্রন্ট অফিস সুপারভাইজার",
      },
      authorities: ["merge:patients"],
    },
  },
  {
    id: "per_reception_sumon",
    role: "receptionist",
    branchId: "B3",
    isDefault: false,
    order: 3,
    blurb: {
      en: "Front desk at Mirpur (B3)",
      bn: "মিরপুর (B3)-এর ফ্রন্ট ডেস্ক",
    },
    staff: {
      id: "stf_sumon_das",
      nameEn: "Sumon Das",
      nameBn: "সুমন দাস",
      sex: "M",
      designation: { en: "Front desk officer", bn: "ফ্রন্ট ডেস্ক কর্মকর্তা" },
      authorities: [],
    },
  },

  /* ---------------- Doctors (all male) ---------------- */
  {
    id: "per_doctor_kamal",
    role: "doctor",
    branchId: "B1",
    isDefault: true,
    order: 1,
    blurb: {
      en: "Medicine OPD: consults, prescribes, orders tests",
      bn: "মেডিসিন আউটডোর: পরামর্শ, প্রেসক্রিপশন ও পরীক্ষার অর্ডার",
    },
    staff: {
      id: "stf_kamal_hossain",
      nameEn: "Dr. Kamal Hossain",
      nameBn: "ডা. কামাল হোসেন",
      sex: "M",
      designation: {
        en: "Consultant, Medicine",
        bn: "কনসালট্যান্ট, মেডিসিন",
      },
      regNo: "A-45127",
      regBody: "BMDC",
      authorities: [],
    },
  },
  {
    id: "per_doctor_arif",
    role: "doctor",
    branchId: "B1",
    isDefault: false,
    order: 2,
    blurb: {
      en: "Paediatrics session; the doctor-delay scenario",
      bn: "শিশুরোগ সেশন; ডাক্তারের বিলম্বের দৃশ্য",
    },
    staff: {
      id: "stf_arif_rahman",
      nameEn: "Dr. Arif Rahman",
      nameBn: "ডা. আরিফ রহমান",
      sex: "M",
      designation: {
        en: "Consultant, Paediatrics",
        bn: "কনসালট্যান্ট, শিশুরোগ",
      },
      regNo: "A-51388",
      regBody: "BMDC",
      authorities: [],
    },
  },
  {
    id: "per_doctor_saiful",
    role: "doctor",
    branchId: "B1",
    isDefault: false,
    order: 3,
    blurb: {
      en: "Duty doctor: critical escalations and payment overrides",
      bn: "ডিউটি ডাক্তার: জরুরি এসকেলেশন ও পেমেন্ট ওভাররাইড",
    },
    staff: {
      id: "stf_saiful_islam",
      nameEn: "Dr. Saiful Islam",
      nameBn: "ডা. সাইফুল ইসলাম",
      sex: "M",
      designation: { en: "Duty doctor", bn: "ডিউটি ডাক্তার" },
      regNo: "A-62904",
      regBody: "BMDC",
      authorities: ["override:payment-gate"],
    },
  },
  {
    id: "per_doctor_nazmul",
    role: "doctor",
    branchId: "B3",
    isDefault: false,
    order: 4,
    blurb: {
      en: "Cardiology at Mirpur (B3)",
      bn: "মিরপুর (B3)-এ হৃদরোগ",
    },
    staff: {
      id: "stf_nazmul_haque",
      nameEn: "Dr. Nazmul Haque",
      nameBn: "ডা. নাজমুল হক",
      sex: "M",
      designation: {
        en: "Consultant, Cardiology",
        bn: "কনসালট্যান্ট, হৃদরোগ",
      },
      regNo: "A-38815",
      regBody: "BMDC",
      authorities: [],
    },
  },

  /* ---------------- Laboratory ---------------- */
  {
    id: "per_labtech_rubel",
    role: "labtech",
    branchId: "B1",
    isDefault: true,
    order: 1,
    blurb: {
      en: "Collection, accession, analyser and validation",
      bn: "নমুনা সংগ্রহ, অ্যাকসেশন, অ্যানালাইজার ও যাচাই",
    },
    staff: {
      id: "stf_rubel_mia",
      nameEn: "Rubel Mia",
      nameBn: "রুবেল মিয়া",
      sex: "M",
      designation: {
        en: "Medical technologist",
        bn: "মেডিকেল টেকনোলজিস্ট",
      },
      authorities: [],
    },
  },
  {
    id: "per_labtech_anika",
    role: "labtech",
    branchId: "B3",
    isDefault: false,
    order: 2,
    blurb: {
      en: "Laboratory at Mirpur (B3)",
      bn: "মিরপুর (B3)-এর ল্যাবরেটরি",
    },
    staff: {
      id: "stf_anika_sultana",
      nameEn: "Anika Sultana",
      nameBn: "আনিকা সুলতানা",
      sex: "F",
      designation: {
        en: "Medical technologist",
        bn: "মেডিকেল টেকনোলজিস্ট",
      },
      authorities: [],
    },
  },
  {
    id: "per_pathologist_mizanur",
    role: "pathologist",
    branchId: "B1",
    isDefault: true,
    order: 1,
    blurb: {
      en: "Signs, releases and corrects reports; calls critical results",
      bn: "রিপোর্ট স্বাক্ষর, প্রকাশ ও সংশোধন; জরুরি ফলাফলে ফোন করেন",
    },
    staff: {
      id: "stf_mizanur_rahman",
      nameEn: "Dr. Mizanur Rahman",
      nameBn: "ডা. মিজানুর রহমান",
      sex: "M",
      designation: {
        en: "Consultant pathologist",
        bn: "কনসালট্যান্ট প্যাথলজিস্ট",
      },
      regNo: "A-29461",
      regBody: "BMDC",
      authorities: ["sign:reports"],
    },
  },

  /* ---------------- Pharmacy ---------------- */
  {
    id: "per_pharmacist_shirin",
    role: "pharmacist",
    branchId: "B1",
    isDefault: true,
    order: 1,
    blurb: {
      en: "Dispenses with FEFO batches and Bangla labels",
      bn: "FEFO ব্যাচ ও বাংলা লেবেলসহ ওষুধ দেন",
    },
    staff: {
      id: "stf_shirin_sultana",
      nameEn: "Shirin Sultana",
      nameBn: "শিরিন সুলতানা",
      sex: "F",
      designation: { en: "Pharmacist", bn: "ফার্মাসিস্ট" },
      regNo: "PCB-B-10234",
      regBody: "PCB",
      authorities: ["dispense:controlled"],
    },
  },
  {
    id: "per_pharmacist_jahid",
    role: "pharmacist",
    branchId: "B3",
    isDefault: false,
    order: 2,
    blurb: {
      en: "Pharmacy at Mirpur (B3), the stock-transfer source",
      bn: "মিরপুর (B3)-এর ফার্মেসি, স্টক স্থানান্তরের উৎস",
    },
    staff: {
      id: "stf_jahid_hasan",
      nameEn: "Jahid Hasan",
      nameBn: "জাহিদ হাসান",
      sex: "M",
      designation: { en: "Pharmacist", bn: "ফার্মাসিস্ট" },
      regNo: "PCB-B-11871",
      regBody: "PCB",
      authorities: ["dispense:controlled"],
    },
  },

  /* ---------------- Cashier ---------------- */
  {
    id: "per_cashier_rafiq",
    role: "cashier",
    branchId: "B1",
    isDefault: true,
    order: 1,
    blurb: {
      en: "Billing, payments and the cash shift",
      bn: "বিলিং, পেমেন্ট ও ক্যাশ শিফট",
    },
    staff: {
      id: "stf_rafiq_ahmed",
      nameEn: "Rafiq Ahmed",
      nameBn: "রফিক আহমেদ",
      sex: "M",
      designation: { en: "Cashier", bn: "ক্যাশিয়ার" },
      authorities: ["discount:5"],
    },
  },
  {
    id: "per_cashier_nasrin",
    role: "cashier",
    branchId: "B1",
    isDefault: false,
    order: 2,
    blurb: {
      en: "Approves discounts, refunds, cancellations and variances",
      bn: "ছাড়, ফেরত, বাতিল ও গরমিল অনুমোদন করেন",
    },
    staff: {
      id: "stf_nasrin_jahan",
      nameEn: "Nasrin Jahan",
      nameBn: "নাসরিন জাহান",
      sex: "F",
      designation: { en: "Cash supervisor", bn: "ক্যাশ সুপারভাইজার" },
      authorities: [
        "discount:15",
        "approve:variance",
        "approve:refund",
        "approve:cancel-after-collection",
      ],
    },
  },

  /* ---------------- Store and procurement ---------------- */
  {
    id: "per_store_habibur",
    role: "store",
    branchId: "B1",
    isDefault: true,
    order: 1,
    blurb: {
      en: "Stock, purchase requests and goods receipt",
      bn: "মজুদ, ক্রয় অনুরোধ ও মাল গ্রহণ",
    },
    staff: {
      id: "stf_habibur_rahman",
      nameEn: "Habibur Rahman",
      nameBn: "হাবিবুর রহমান",
      sex: "M",
      designation: { en: "Store manager", bn: "স্টোর ম্যানেজার" },
      authorities: ["approve:pr:50000"],
    },
  },
  {
    id: "per_store_tariq",
    role: "store",
    branchId: null,
    isDefault: false,
    order: 2,
    blurb: {
      en: "Approves purchases up to ৳5 lakh",
      bn: "৳৫ লাখ পর্যন্ত ক্রয় অনুমোদন করেন",
    },
    staff: {
      id: "stf_tariq_aziz",
      nameEn: "Tariq Aziz",
      nameBn: "তারিক আজিজ",
      sex: "M",
      designation: { en: "Head of procurement", bn: "ক্রয় প্রধান" },
      authorities: ["approve:pr:500000"],
    },
  },

  /* ---------------- Finance ---------------- */
  {
    id: "per_finance_sabrina",
    role: "finance",
    branchId: null,
    isDefault: true,
    order: 1,
    blurb: {
      en: "Cash control, fee share, corporate billing and payables",
      bn: "নগদ নিয়ন্ত্রণ, ফি শেয়ার, কর্পোরেট বিল ও প্রদেয়",
    },
    staff: {
      id: "stf_sabrina_chowdhury",
      nameEn: "Sabrina Chowdhury",
      nameBn: "সাবরিনা চৌধুরী",
      sex: "F",
      designation: {
        en: "Chief financial officer",
        bn: "প্রধান আর্থিক কর্মকর্তা",
      },
      authorities: ["approve:pr:unlimited", "approve:refund", "price:publish"],
    },
  },
  {
    id: "per_finance_imran",
    role: "finance",
    branchId: null,
    isDefault: false,
    order: 2,
    blurb: {
      en: "Reconciliation and the accounting export",
      bn: "হিসাব মিলানো ও অ্যাকাউন্টিং এক্সপোর্ট",
    },
    staff: {
      id: "stf_imran_kabir",
      nameEn: "Imran Kabir",
      nameBn: "ইমরান কবির",
      sex: "M",
      designation: { en: "Accounts officer", bn: "হিসাব কর্মকর্তা" },
      authorities: [],
    },
  },

  /* ---------------- Executive ---------------- */
  {
    id: "per_ceo_anwar",
    role: "ceo",
    branchId: null,
    isDefault: true,
    order: 1,
    blurb: {
      en: "Network dashboards and the command centre",
      bn: "নেটওয়ার্ক ড্যাশবোর্ড ও কমান্ড সেন্টার",
    },
    staff: {
      id: "stf_anwar_hossain",
      nameEn: "Anwar Hossain",
      nameBn: "আনোয়ার হোসেন",
      sex: "M",
      designation: {
        en: "Chief executive officer",
        bn: "প্রধান নির্বাহী কর্মকর্তা",
      },
      authorities: [],
    },
  },

  /* ---------------- Patient app ---------------- */
  {
    id: "per_patient_tanvir",
    role: "patient",
    branchId: null,
    isDefault: true,
    order: 1,
    blurb: {
      en: "Patient app account holder (Karim household)",
      bn: "রোগীর অ্যাপ অ্যাকাউন্টধারী (করিম পরিবার)",
    },
    patientId: HERO.patient.tanvirKarim,
    patientName: { en: "Tanvir Karim", bn: "তানভীর করিম" },
  },
]

/** The persona shown first for a role on the launcher. */
export function defaultPersonaFor(role: Role): PersonaSeed | undefined {
  return PERSONAS.find((p) => p.role === role && p.isDefault)
}

export function findPersona(id: string): PersonaSeed | undefined {
  return PERSONAS.find((p) => p.id === id)
}
