/**
 * Hospital identity (plan §3.12). The ONLY place a hospital name may appear.
 * The staff app is UVTR_MedCore; every hospital-facing surface (patient app,
 * printed Rx, reports, display board, verification page) reads this file, so
 * switching to the real client later is a change here plus supplied assets.
 * The current values are a neutral placeholder: "City Care Hospitals".
 */

export type Bilingual = { en: string; bn: string }

export type CompanyCode = "C1" | "C2" | "C3"
export type BranchCode = "B1" | "B2" | "B3" | "B4" | "B5"

export type Company = {
  code: CompanyCode
  name: Bilingual
  /** Prefix used in invoice numbers, e.g. C1-B1-2627-000123 */
  invoicePrefix: CompanyCode
  tin: string
}

export type BranchService = "opd" | "lab" | "imaging" | "pharmacy" | "inpatient"

export type Branch = {
  code: BranchCode
  company: CompanyCode
  name: Bilingual
  kind: "hospital" | "diagnostic"
  services: BranchService[]
  address: Bilingual
  phone: string
  /** Pre-allocated ranges used while the branch is offline (plan §3.7). */
  offline: {
    uhidPrefix: string
    invoiceTag: string
    accessionPrefix: string
  }
}

export const staffApp = {
  name: "UVTR_MedCore",
  vendor: "UVTR Infotech",
} as const

export const hospital = {
  name: {
    en: "City Care Hospitals",
    bn: "সিটি কেয়ার হসপিটালস",
  } satisfies Bilingual,
  shortName: { en: "City Care", bn: "সিটি কেয়ার" } satisfies Bilingual,
  /** Monogram for the generated logo mark until real assets are supplied. */
  monogram: "CC",
  /** Hospital colour. Replaces UVTR turquoise as --primary in the patient app. */
  colors: { primary: "#2f6fde", primaryForeground: "#ffffff" },
  helpline: "09610-100100",
  website: "citycare.example",
  privacyNotice: {
    en: "City Care Hospitals is the data fiduciary for this app. We use your information only to provide your care, and we never share it for marketing.",
    bn: "এই অ্যাপের তথ্যের দায়িত্বে সিটি কেয়ার হসপিটালস। আপনার তথ্য শুধু আপনার চিকিৎসার জন্য ব্যবহার করা হয়, বিপণনের জন্য কখনো শেয়ার করা হয় না।",
  } satisfies Bilingual,
} as const

export const companies: Company[] = [
  {
    code: "C1",
    name: { en: "City Care Hospitals Ltd", bn: "সিটি কেয়ার হসপিটালস লিমিটেড" },
    invoicePrefix: "C1",
    tin: "TIN-000111222333",
  },
  {
    code: "C2",
    name: {
      en: "City Care Diagnostics Ltd",
      bn: "সিটি কেয়ার ডায়াগনস্টিকস লিমিটেড",
    },
    invoicePrefix: "C2",
    tin: "TIN-000444555666",
  },
  {
    code: "C3",
    name: {
      en: "City Care Chattogram Ltd",
      bn: "সিটি কেয়ার চট্টগ্রাম লিমিটেড",
    },
    invoicePrefix: "C3",
    tin: "TIN-000777888999",
  },
]

export const branches: Branch[] = [
  {
    code: "B1",
    company: "C1",
    name: { en: "Dhanmondi", bn: "ধানমন্ডি" },
    kind: "hospital",
    services: ["opd", "lab", "imaging", "pharmacy", "inpatient"],
    address: {
      en: "Road 7, Dhanmondi, Dhaka 1205",
      bn: "রোড ৭, ধানমন্ডি, ঢাকা ১২০৫",
    },
    phone: "09610-100101",
    offline: {
      uhidPrefix: "P-B1-",
      invoiceTag: "OFF",
      accessionPrefix: "B1E-",
    },
  },
  {
    code: "B2",
    company: "C1",
    name: { en: "Uttara", bn: "উত্তরা" },
    kind: "hospital",
    services: ["opd", "lab", "imaging", "pharmacy", "inpatient"],
    address: {
      en: "Sector 7, Uttara, Dhaka 1230",
      bn: "সেক্টর ৭, উত্তরা, ঢাকা ১২৩০",
    },
    phone: "09610-100102",
    offline: {
      uhidPrefix: "P-B2-",
      invoiceTag: "OFF",
      accessionPrefix: "B2E-",
    },
  },
  {
    code: "B3",
    company: "C2",
    name: { en: "Mirpur", bn: "মিরপুর" },
    kind: "diagnostic",
    services: ["opd", "lab", "imaging", "pharmacy"],
    address: {
      en: "Section 10, Mirpur, Dhaka 1216",
      bn: "সেকশন ১০, মিরপুর, ঢাকা ১২১৬",
    },
    phone: "09610-100103",
    offline: {
      uhidPrefix: "P-B3-",
      invoiceTag: "OFF",
      accessionPrefix: "B3E-",
    },
  },
  {
    code: "B4",
    company: "C2",
    name: { en: "Motijheel", bn: "মতিঝিল" },
    kind: "diagnostic",
    services: ["lab", "imaging"],
    address: {
      en: "Dilkusha C/A, Motijheel, Dhaka 1000",
      bn: "দিলকুশা বা/এ, মতিঝিল, ঢাকা ১০০০",
    },
    phone: "09610-100104",
    offline: {
      uhidPrefix: "P-B4-",
      invoiceTag: "OFF",
      accessionPrefix: "B4E-",
    },
  },
  {
    code: "B5",
    company: "C3",
    name: { en: "Chattogram", bn: "চট্টগ্রাম" },
    kind: "hospital",
    services: ["opd", "lab", "imaging", "pharmacy", "inpatient"],
    address: {
      en: "O.R. Nizam Road, Chattogram 4000",
      bn: "ও.আর. নিজাম রোড, চট্টগ্রাম ৪০০০",
    },
    phone: "09610-100105",
    offline: {
      uhidPrefix: "P-B5-",
      invoiceTag: "OFF",
      accessionPrefix: "B5E-",
    },
  },
]

/** Network level (no branch): CEO, CFO and procurement head personas sit here. */
export const headquarters = {
  code: "HQ",
  name: {
    en: "Network headquarters",
    bn: "নেটওয়ার্ক প্রধান কার্যালয়",
  } satisfies Bilingual,
} as const

/**
 * Bangladesh fiscal year runs July to June. "2627" means FY 2026-27, used in
 * invoice numbers: `${company}-${branch}-${fy}-${serial}`.
 */
export function fiscalYearTag(date: Date): string {
  const year = date.getFullYear()
  const start = date.getMonth() >= 6 ? year : year - 1
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`
}

export function getBranch(code: BranchCode): Branch {
  const branch = branches.find((b) => b.code === code)
  if (!branch) throw new Error(`Unknown branch ${code}`)
  return branch
}

export function getCompany(code: CompanyCode): Company {
  const company = companies.find((c) => c.code === code)
  if (!company) throw new Error(`Unknown company ${code}`)
  return company
}
