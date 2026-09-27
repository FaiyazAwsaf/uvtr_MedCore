/**
 * Departments, rooms and wards per branch (plan §7.1). Branches themselves
 * come from config/brand.config.ts. No emergency, theatre or intensive care
 * units exist: the inpatient area is billing and beds only (plan §11).
 */

import type {
  Bilingual,
  BranchCode,
  BranchService,
} from "@/config/brand.config"
import type { DepartmentKind, RoomRow, WardRow } from "@/core/db/schema"

import { bnDigits } from "./bn"

export type DepartmentSeed = {
  kind: DepartmentKind
  code: string
  name: Bilingual
  /** Created only when the branch offers this service */
  requires?: BranchService
}

export const DEPARTMENTS: DepartmentSeed[] = [
  {
    kind: "reception",
    code: "FO",
    name: { en: "Front office", bn: "ফ্রন্ট অফিস" },
  },
  {
    kind: "opd",
    code: "OPD",
    name: { en: "Outpatient department", bn: "বহির্বিভাগ" },
    requires: "opd",
  },
  {
    kind: "lab",
    code: "LAB",
    name: { en: "Laboratory", bn: "ল্যাবরেটরি" },
    requires: "lab",
  },
  {
    kind: "imaging",
    code: "IMG",
    name: { en: "Radiology and imaging", bn: "রেডিওলজি ও ইমেজিং" },
    requires: "imaging",
  },
  {
    kind: "pharmacy",
    code: "PHR",
    name: { en: "Pharmacy", bn: "ফার্মেসি" },
    requires: "pharmacy",
  },
  {
    kind: "ward",
    code: "IPD",
    name: { en: "Inpatient billing and beds", bn: "ইনপেশেন্ট বিলিং ও বেড" },
    requires: "inpatient",
  },
  {
    kind: "billing",
    code: "BIL",
    name: { en: "Billing and cash", bn: "বিলিং ও ক্যাশ" },
  },
  { kind: "store", code: "STR", name: { en: "Store", bn: "স্টোর" } },
  { kind: "admin", code: "ADM", name: { en: "Administration", bn: "প্রশাসন" } },
]

export const departmentId = (branch: BranchCode, code: string) =>
  `dep_${branch}_${code.toLowerCase()}`

/** Consultation rooms per branch. B3 calls them chambers. */
export const CONSULT_ROOMS: Partial<
  Record<BranchCode, { count: number; chamber?: boolean }>
> = {
  B1: { count: 12 },
  B2: { count: 8 },
  B3: { count: 6, chamber: true },
  B5: { count: 8 },
}

export function consultRoom(
  n: number,
  chamber: boolean
): {
  code: string
  name: Bilingual
} {
  return chamber
    ? {
        code: `C-${n}`,
        name: { en: `Chamber C-${n}`, bn: `চেম্বার সি-${bnDigits(n)}` },
      }
    : { code: String(n), name: { en: `Room ${n}`, bn: `কক্ষ ${bnDigits(n)}` } }
}

export const consultRoomId = (branch: BranchCode, n: number) =>
  `rm_${branch}_c${n}`

export type ServiceRoomSeed = {
  key: string
  code: string
  name: Bilingual
  kind: RoomRow["kind"]
  department: string
  requires?: BranchService
}

export const SERVICE_ROOMS: ServiceRoomSeed[] = [
  {
    key: "coll",
    code: "SC",
    name: { en: "Sample collection", bn: "নমুনা সংগ্রহ" },
    kind: "collection",
    department: "LAB",
    requires: "lab",
  },
  {
    key: "lab",
    code: "LAB",
    name: { en: "Core laboratory", bn: "কোর ল্যাবরেটরি" },
    kind: "lab",
    department: "LAB",
    requires: "lab",
  },
  {
    key: "xray",
    code: "XR",
    name: { en: "X-ray room", bn: "এক্স-রে কক্ষ" },
    kind: "imaging",
    department: "IMG",
    requires: "imaging",
  },
  {
    key: "usg",
    code: "US",
    name: { en: "Ultrasound room", bn: "আল্ট্রাসাউন্ড কক্ষ" },
    kind: "imaging",
    department: "IMG",
    requires: "imaging",
  },
  {
    key: "ecg",
    code: "EC",
    name: { en: "ECG and echo room", bn: "ইসিজি ও ইকো কক্ষ" },
    kind: "imaging",
    department: "IMG",
    requires: "imaging",
  },
  {
    key: "bill1",
    code: "B-1",
    name: { en: "Billing counter 1", bn: "বিলিং কাউন্টার ১" },
    kind: "counter",
    department: "BIL",
  },
  {
    key: "bill2",
    code: "B-2",
    name: { en: "Billing counter 2", bn: "বিলিং কাউন্টার ২" },
    kind: "counter",
    department: "BIL",
  },
  {
    key: "phr",
    code: "PH",
    name: { en: "Pharmacy counter", bn: "ফার্মেসি কাউন্টার" },
    kind: "counter",
    department: "PHR",
    requires: "pharmacy",
  },
  {
    key: "desk",
    code: "FD",
    name: { en: "Front desk", bn: "ফ্রন্ট ডেস্ক" },
    kind: "counter",
    department: "FO",
  },
]

export type WardSeed = {
  branch: BranchCode
  code: string
  name: Bilingual
  kind: WardRow["kind"]
  beds: number
  bedDayRateTaka: number
  /** Share of beds occupied at seed time */
  occupancy: number
}

export const WARDS: WardSeed[] = [
  {
    branch: "B1",
    code: "4A",
    name: { en: "General ward (male)", bn: "জেনারেল ওয়ার্ড (পুরুষ)" },
    kind: "general",
    beds: 12,
    bedDayRateTaka: 1500,
    occupancy: 0.6,
  },
  {
    branch: "B1",
    code: "4B",
    name: { en: "General ward (female)", bn: "জেনারেল ওয়ার্ড (নারী)" },
    kind: "general",
    beds: 12,
    bedDayRateTaka: 1500,
    occupancy: 0.55,
  },
  {
    branch: "B1",
    code: "5C",
    name: { en: "Cabin block", bn: "কেবিন ব্লক" },
    kind: "cabin",
    beds: 12,
    bedDayRateTaka: 6000,
    occupancy: 0.5,
  },
  {
    branch: "B2",
    code: "3A",
    name: { en: "General ward", bn: "জেনারেল ওয়ার্ড" },
    kind: "general",
    beds: 10,
    bedDayRateTaka: 1400,
    occupancy: 0.5,
  },
  {
    branch: "B2",
    code: "3P",
    name: { en: "Paediatric ward", bn: "শিশু ওয়ার্ড" },
    kind: "paediatric",
    beds: 10,
    bedDayRateTaka: 1800,
    occupancy: 0.4,
  },
  {
    branch: "B5",
    code: "2A",
    name: { en: "General ward", bn: "জেনারেল ওয়ার্ড" },
    kind: "general",
    beds: 10,
    bedDayRateTaka: 1200,
    occupancy: 0.5,
  },
  {
    branch: "B5",
    code: "2S",
    name: { en: "Semi-private ward", bn: "সেমি-প্রাইভেট ওয়ার্ড" },
    kind: "semi-private",
    beds: 10,
    bedDayRateTaka: 3000,
    occupancy: 0.5,
  },
]

export const wardId = (branch: BranchCode, code: string) =>
  `wrd_${branch}_${code.toLowerCase()}`

/** Admission reasons are administrative labels, not a clinical record. */
export const ADMISSION_REASONS: string[] = [
  "Observation and IV fluids",
  "Short stay for tests",
  "Fever under observation",
  "Blood sugar control",
  "Wound care and dressing",
  "Chest infection care",
  "Pain management",
  "Dehydration care",
  "Investigation work-up",
  "Blood pressure control",
]
