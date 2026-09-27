/**
 * Patients, households and family links (plan §7.1, §7.2). 500 synthetic
 * patients: the Karim household (fixed ids), the scenario patients, 8 planted
 * fuzzy duplicates, the records left by the B2 offline period, about 120
 * shared-phone households with about 90 minors (each with a guardian and a
 * guardian's treatment consent) and single registrations. No real people.
 */

import type { BranchCode } from "@/config/brand.config"
import { counterKey, docNo, uhidFromSerial } from "@/core/db/numbering"
import type {
  Allergy,
  Consent,
  CurrentMed,
  ISODate,
  Ms,
  PatientRow,
  Problem,
  Relation,
  Sex,
} from "@/core/db/schema"
import type { Rng } from "@/lib/mock/rng"

import type { SeedCtx } from "../context"
import { HERO } from "../content/hero-ids"
import { SEED_REFS } from "../content/seed-refs"
import {
  CHATTOGRAM_AREAS,
  DHAKA_AREAS,
  FEMALE_GIVEN_OLDER,
  FEMALE_GIVEN_YOUNGER,
  FEMALE_SURNAMES_OLDER,
  FEMALE_SURNAMES_YOUNGER,
  HINDU_FEMALE_GIVEN,
  HINDU_MALE_GIVEN,
  HINDU_SURNAMES,
  MALE_GIVEN_OLDER,
  MALE_GIVEN_YOUNGER,
  MALE_SURNAMES,
  MD_PREFIX,
  MST_PREFIX,
  RANI,
  UL_SURNAMES,
  UR_SURNAME,
  type NamePart,
} from "../content/names"
import { ageOn, DAY, HOUR, isoAddDays, isoAddYears, MINUTE } from "../time"
import { nameSearchKeys } from "./search-keys"

export const TOTAL_PATIENTS = 500
const TARGET_HOUSEHOLDS = 120
const TARGET_MINORS = 90
/** First UHID serial issued after this (a network with years of history). */
export const UHID_SERIAL_BASE = 184_200

const ICD = {
  dm: {
    icd10: "E11.9",
    label: "Type 2 diabetes mellitus without complications",
  },
  htn: { icd10: "I10", label: "Essential (primary) hypertension" },
  asthma: { icd10: "J45.9", label: "Asthma, unspecified" },
  ckd3: { icd10: "N18.3", label: "Chronic kidney disease, stage 3" },
  ckd4: { icd10: "N18.4", label: "Chronic kidney disease, stage 4" },
}

const ALLERGY: Record<"penicillin" | "sulfa" | "nsaid", Allergy[]> = {
  penicillin: [
    {
      substance: "Penicillin",
      allergyClass: "penicillins",
      reaction: "Itchy rash all over the body",
      severity: "moderate",
    },
    {
      substance: "Amoxicillin",
      allergyClass: "penicillins",
      reaction: "Hives and lip swelling",
      severity: "severe",
    },
  ],
  sulfa: [
    {
      substance: "Sulfonamide antibiotics",
      allergyClass: "sulfonamides",
      reaction: "Skin rash",
      severity: "moderate",
    },
  ],
  nsaid: [
    {
      substance: "Diclofenac",
      allergyClass: "nsaids",
      reaction: "Wheeze and breathlessness",
      severity: "moderate",
    },
    {
      substance: "Aspirin",
      allergyClass: "nsaids",
      reaction: "Stomach bleeding in the past",
      severity: "severe",
    },
  ],
}

type Draft = {
  id: string
  nameEn: string
  nameBn: string
  sex: Sex
  dob: ISODate
  dobEstimated?: boolean
  branch: BranchCode
  registeredAt: Ms
  phone?: string
  phoneVerified?: boolean
  attendantPhone?: string
  nid?: string
  brn?: string
  passport?: string
  bloodGroup?: string
  address?: string
  householdId?: string
  relationToHead?: Relation
  guardianPatientId?: string
  guardianRelation?: Relation
  allergies?: Allergy[]
  problems?: Problem[]
  currentMeds?: CurrentMed[]
  consents?: Consent[]
  registrationNote?: string
  /** Fixed UHID (provisional records); otherwise a serial is issued */
  fixedUhid?: string
}

export type PatientPools = {
  all: PatientRow[]
  /** Hero, scenario, duplicate and offline records: never picked at random */
  reserved: Set<string>
  byId: Map<string, PatientRow>
  age: (p: PatientRow) => number
  adults: PatientRow[]
  minors: PatientRow[]
}

class Ids {
  private readonly used = new Set<string>()
  constructor(private readonly rng: Rng) {}
  reserve(v: string) {
    this.used.add(v)
  }
  phone(): string {
    for (;;) {
      const v = `01${this.rng.pick(["3", "4", "5", "6", "7", "8", "9"])}${this.rng.int(10, 99)}-${this.rng.int(100000, 999999)}`
      if (!this.used.has(v)) {
        this.used.add(v)
        return v
      }
    }
  }
  nid(): string {
    for (;;) {
      const v = String(this.rng.int(1_000_000_000, 9_999_999_999))
      if (!this.used.has(v)) {
        this.used.add(v)
        return v
      }
    }
  }
  brn(birthYear: number): string {
    for (;;) {
      const v = `${birthYear}${String(this.rng.int(0, 999_999)).padStart(6, "0")}${String(this.rng.int(0, 9_999_999)).padStart(7, "0")}`
      if (!this.used.has(v)) {
        this.used.add(v)
        return v
      }
    }
  }
}

function join(...parts: (NamePart | undefined)[]): [string, string] {
  const p = parts.filter((x): x is NamePart => Boolean(x))
  return [p.map((x) => x[0]).join(" "), p.map((x) => x[1]).join(" ")]
}

export function seedPatients(ctx: SeedCtx): PatientPools {
  const rng = ctx.rng("patients")
  const ids = new Ids(rng)
  const drafts: Draft[] = []
  const reserved = new Set<string>()

  const HERO_PHONE = HERO.karimPhone
  ids.reserve(HERO_PHONE)
  ids.reserve(SEED_REFS.s1.variantPhone)
  for (const c of SEED_REFS.nidCollisions) ids.reserve(c.nid)

  const dobForAge = (age: number, maxBack = 360): ISODate =>
    isoAddDays(isoAddYears(ctx.today, -age), -rng.int(1, maxBack))
  const since = (years: number): ISODate =>
    isoAddDays(ctx.today, -Math.round(years * 365) - rng.int(0, 60))
  const registered = (maxDays: number, minDays = 20): Ms =>
    ctx.now - rng.int(minDays, maxDays) * DAY - rng.int(0, 10) * HOUR
  const area = (branch: BranchCode) =>
    branch === "B5"
      ? `Holding ${rng.int(3, 180)}, ${rng.pick(CHATTOGRAM_AREAS)}, Chattogram`
      : `House ${rng.int(1, 120)}, Road ${rng.int(1, 32)}, ${rng.pick(DHAKA_AREAS)}, Dhaka`
  const blood = () =>
    rng.bool(0.3)
      ? undefined
      : rng.weighted<string>([
          ["B+", 30],
          ["O+", 28],
          ["A+", 24],
          ["AB+", 8],
          ["B-", 3],
          ["O-", 3],
          ["A-", 3],
          ["AB-", 1],
        ])
  const pickBranch = (): BranchCode =>
    rng.weighted<BranchCode>([
      ["B1", 40],
      ["B2", 20],
      ["B3", 15],
      ["B4", 10],
      ["B5", 15],
    ])

  const med = (
    brandKey: keyof typeof SEED_REFS.brand | null,
    genericId: string,
    brandId: string | undefined,
    name: string,
    dose: string,
    sinceIso: ISODate
  ): CurrentMed => ({
    genericId,
    brandId: brandKey ? SEED_REFS.brand[brandKey] : brandId,
    name,
    dose,
    since: sinceIso,
  })

  /* ---------------- Hero household (fixed ids, plan §7.2) ---------------- */

  const heroRegistered = ctx.now - 3 * 365 * DAY - 40 * DAY
  const abdulDob = isoAddDays(isoAddYears(ctx.today, -62), -143)
  const rokeyaDob = isoAddDays(isoAddYears(ctx.today, -55), -201)
  const tanvirDob = isoAddDays(isoAddYears(ctx.today, -34), -77)
  const nusratDob = isoAddDays(isoAddYears(ctx.today, -8), -118)
  const heroAddress = "House 22, Road 9A, Dhanmondi, Dhaka"
  drafts.push(
    {
      id: HERO.patient.abdulKarim,
      nameEn: "Abdul Karim",
      nameBn: "আব্দুল করিম",
      sex: "M",
      dob: abdulDob,
      branch: "B1",
      registeredAt: heroRegistered,
      phone: HERO_PHONE,
      phoneVerified: true,
      nid: "2692418307",
      bloodGroup: "B+",
      address: heroAddress,
      householdId: HERO.household.karim,
      relationToHead: "self",
      allergies: [
        {
          substance: "Penicillin",
          allergyClass: "penicillins",
          reaction: "Itchy rash all over the body",
          severity: "moderate",
        },
      ],
      problems: [
        { ...ICD.dm, since: isoAddDays(ctx.today, -8 * 365), status: "active" },
        {
          ...ICD.htn,
          since: isoAddDays(ctx.today, -5 * 365),
          status: "active",
        },
      ],
      currentMeds: [
        med(
          "comet500",
          SEED_REFS.generic.metformin,
          undefined,
          "Metformin 500 mg",
          "1+0+1 after meals",
          isoAddDays(ctx.today, -8 * 365)
        ),
        med(
          "camlodin5",
          SEED_REFS.generic.amlodipine,
          undefined,
          "Amlodipine 5 mg",
          "0+0+1 after meals",
          isoAddDays(ctx.today, -5 * 365)
        ),
      ],
    },
    {
      id: HERO.patient.rokeyaBegum,
      nameEn: "Rokeya Begum",
      nameBn: "রোকেয়া বেগম",
      sex: "F",
      dob: rokeyaDob,
      branch: "B1",
      registeredAt: heroRegistered + 5 * MINUTE,
      phone: HERO_PHONE,
      phoneVerified: true,
      nid: "3715520946",
      bloodGroup: "O+",
      address: heroAddress,
      householdId: HERO.household.karim,
      relationToHead: "spouse",
    },
    {
      id: HERO.patient.tanvirKarim,
      nameEn: "Tanvir Karim",
      nameBn: "তানভীর করিম",
      sex: "M",
      dob: tanvirDob,
      branch: "B1",
      registeredAt: heroRegistered + 10 * MINUTE,
      phone: HERO_PHONE,
      phoneVerified: true,
      nid: "8820461735",
      bloodGroup: "B+",
      address: heroAddress,
      householdId: HERO.household.karim,
      relationToHead: "son",
    },
    {
      id: HERO.patient.nusratKarim,
      nameEn: "Nusrat Karim",
      nameBn: "নুসরাত করিম",
      sex: "F",
      dob: nusratDob,
      branch: "B1",
      registeredAt: heroRegistered + 15 * MINUTE,
      phone: HERO_PHONE,
      phoneVerified: true,
      brn: `${nusratDob.slice(0, 4)}0000000418266`,
      address: heroAddress,
      householdId: HERO.household.karim,
      relationToHead: "grandchild",
      guardianPatientId: HERO.patient.tanvirKarim,
      guardianRelation: "father",
    }
  )

  /* ---------------- Scenario master data (plan §10) ---------------- */

  const P = SEED_REFS.patient
  drafts.push(
    {
      id: P.rafiqul,
      nameEn: "Md. Rafiqul Islam",
      nameBn: "মো. রফিকুল ইসলাম",
      sex: "M",
      dob: SEED_REFS.s1.dob,
      branch: "B1",
      registeredAt: ctx.now - 700 * DAY,
      phone: "01712-908133",
      phoneVerified: true,
      nid: SEED_REFS.nidCollisions[0].nid,
      bloodGroup: "A+",
      address: "House 41, Road 3, Mohammadpur, Dhaka",
    },
    {
      id: P.jahanara,
      nameEn: "Jahanara Begum",
      nameBn: "জাহানারা বেগম",
      sex: "F",
      dob: dobForAge(67),
      branch: "B1",
      registeredAt: ctx.now - 900 * DAY,
      phone: "01815-227390",
      phoneVerified: true,
      nid: ids.nid(),
      bloodGroup: "O+",
      address: "House 8, Road 2, Kalabagan, Dhaka",
      problems: [
        { ...ICD.ckd4, since: since(3), status: "active" },
        { ...ICD.htn, since: since(12), status: "active" },
      ],
      currentMeds: [
        med(
          null,
          SEED_REFS.generic.amlodipine,
          "brd_camlodin_10mg",
          "Amlodipine 10 mg",
          "0+0+1 after meals",
          since(6)
        ),
      ],
    },
    {
      id: P.shahidul,
      nameEn: "Shahidul Alam",
      nameBn: "শহিদুল আলম",
      sex: "M",
      dob: dobForAge(48),
      branch: "B1",
      registeredAt: ctx.now - 420 * DAY,
      phone: "01911-734502",
      phoneVerified: true,
      nid: ids.nid(),
      bloodGroup: "AB+",
      address: "House 17, Road 11, Lalmatia, Dhaka",
    },
    {
      id: P.nasima,
      nameEn: "Nasima Khatun",
      nameBn: "নাসিমা খাতুন",
      sex: "F",
      dob: dobForAge(41),
      branch: "B1",
      registeredAt: ctx.now - 300 * DAY,
      phone: "01552-418907",
      phoneVerified: true,
      nid: ids.nid(),
      bloodGroup: "A+",
      address: "House 5, Road 27, Jigatola, Dhaka",
    },
    {
      id: P.kamrul,
      nameEn: "Kamrul Hasan",
      nameBn: "কামরুল হাসান",
      sex: "M",
      dob: dobForAge(36),
      branch: "B1",
      registeredAt: ctx.now - 210 * DAY,
      phone: "01677-305218",
      phoneVerified: true,
      nid: ids.nid(),
      bloodGroup: "O+",
      address: "House 30, Road 6, Dhanmondi, Dhaka",
    },
    {
      id: P.shahnaz,
      nameEn: "Shahnaz Parvin",
      nameBn: "শাহনাজ পারভীন",
      sex: "F",
      dob: dobForAge(45),
      branch: "B3",
      registeredAt: ctx.now - 560 * DAY,
      phone: "01748-662019",
      phoneVerified: true,
      nid: SEED_REFS.nidCollisions[1].nid,
      bloodGroup: "B+",
      address: "House 9, Road 4, Mirpur 10, Dhaka",
    }
  )
  for (const id of Object.values(P)) reserved.add(id)
  for (const id of Object.values(HERO.patient)) reserved.add(id)

  /* ---------------- Planted fuzzy duplicates (same DOB) ---------------- */

  const DUPS: [
    string,
    [string, string],
    [string, string],
    Sex,
    number,
    BranchCode,
    BranchCode,
    boolean,
  ][] = [
    [
      "kashem",
      ["Md. Abul Kashem", "মো. আবুল কাশেম"],
      ["Mohammad Abul Kashem", "মোহাম্মদ আবুল কাশেম"],
      "M",
      58,
      "B1",
      "B3",
      false,
    ],
    [
      "rahima",
      ["Rahima Begum", "রহিমা বেগম"],
      ["Rahima Begom", "রহিমা বেগম"],
      "F",
      49,
      "B1",
      "B1",
      true,
    ],
    [
      "shafiqul",
      ["Mohammed Shafiqul Islam", "মোহাম্মদ শফিকুল ইসলাম"],
      ["Md. Shafiqul Islam", "মো. শফিকুল ইসলাম"],
      "M",
      44,
      "B2",
      "B1",
      false,
    ],
    [
      "nurjahan",
      ["Nurjahan Khatun", "নুরজাহান খাতুন"],
      ["Nurjahan Khatoon", "নূরজাহান খাতুন"],
      "F",
      63,
      "B1",
      "B2",
      true,
    ],
    [
      "abdur",
      ["Abdur Rahman", "আব্দুর রহমান"],
      ["Abdur Rahaman", "আব্দুর রহমান"],
      "M",
      71,
      "B1",
      "B3",
      false,
    ],
    [
      "sharmin",
      ["Sharmin Akter", "শারমিন আক্তার"],
      ["Sharmin Akhter", "শারমিন আখতার"],
      "F",
      31,
      "B1",
      "B4",
      false,
    ],
    [
      "hasna",
      ["Mst. Hasna Begum", "মোছা. হাসনা বেগম"],
      ["Mosammat Hasna Begum", "মোসাম্মৎ হাসনা বেগম"],
      "F",
      52,
      "B2",
      "B1",
      true,
    ],
    [
      "tanjila",
      ["Tanjila Chowdhury", "তানজিলা চৌধুরী"],
      ["Tanjila Chowdhuri", "তানজিলা চৌধুরী"],
      "F",
      27,
      "B3",
      "B1",
      false,
    ],
  ]
  for (const [key, a, b, sex, age, branchA, branchB, samePhone] of DUPS) {
    const dob = dobForAge(age)
    const phoneA = ids.phone()
    const regA = registered(1200, 400)
    drafts.push({
      id: `pat_dup_${key}_a`,
      nameEn: a[0],
      nameBn: a[1],
      sex,
      dob,
      branch: branchA,
      registeredAt: regA,
      phone: phoneA,
      phoneVerified: true,
      nid: ids.nid(),
      bloodGroup: blood(),
      address: area(branchA),
    })
    drafts.push({
      id: `pat_dup_${key}_b`,
      nameEn: b[0],
      nameBn: b[1],
      sex,
      dob,
      branch: branchB,
      registeredAt: regA + rng.int(40, 300) * DAY,
      phone: samePhone ? phoneA : ids.phone(),
      phoneVerified: false,
      address: area(branchB),
      registrationNote: "NID not brought at registration",
    })
    reserved.add(`pat_dup_${key}_a`)
    reserved.add(`pat_dup_${key}_b`)
  }

  /* ---------------- Records from the B2 offline period (4 days ago) ---------------- */

  const offlineAt = ctx.at(-4, "11:20")
  const replayAt = ctx.at(-4, "12:22")
  const parulDob = dobForAge(46)
  drafts.push(
    {
      id: "pat_off_moriom",
      nameEn: "Moriom Akter",
      nameBn: "মরিয়ম আক্তার",
      sex: "F",
      dob: dobForAge(29),
      branch: "B2",
      registeredAt: offlineAt,
      phone: ids.phone(),
      phoneVerified: false,
      nid: ids.nid(),
      address: area("B2"),
      registrationNote:
        "Registered while the branch was offline; permanent UHID issued on reconnect",
    },
    {
      id: "pat_off_sajib",
      nameEn: "Sajib Hossain",
      nameBn: "সজীব হোসেন",
      sex: "M",
      dob: dobForAge(38),
      branch: "B2",
      registeredAt: offlineAt + 22 * MINUTE,
      phone: ids.phone(),
      phoneVerified: false,
      address: area("B2"),
      registrationNote:
        "Registered while the branch was offline; permanent UHID issued on reconnect",
    },
    {
      id: "pat_off_parul_central",
      nameEn: "Parul Akter",
      nameBn: "পারুল আক্তার",
      sex: "F",
      dob: parulDob,
      branch: "B3",
      registeredAt: ctx.now - 380 * DAY,
      phone: ids.phone(),
      phoneVerified: true,
      nid: ids.nid(),
      bloodGroup: "A+",
      address: area("B3"),
    },
    {
      id: "pat_off_parul_edge",
      nameEn: "Parul Aktar",
      nameBn: "পারুল আক্তার",
      sex: "F",
      dob: parulDob,
      branch: "B2",
      registeredAt: offlineAt + 41 * MINUTE,
      phone: ids.phone(),
      phoneVerified: false,
      address: area("B2"),
      registrationNote:
        "Offline registration; matched an existing record on replay and merged after review",
      fixedUhid: "provisional",
    }
  )
  for (const id of [
    "pat_off_moriom",
    "pat_off_sajib",
    "pat_off_parul_central",
    "pat_off_parul_edge",
  ])
    reserved.add(id)

  /* ---------------- Households ---------------- */

  type HhType =
    "young" | "extended" | "couple" | "single-parent" | "elder-child"
  const typeMix: HhType[] = [
    ...Array<HhType>(35).fill("young"),
    ...Array<HhType>(20).fill("extended"),
    ...Array<HhType>(30).fill("couple"),
    ...Array<HhType>(10).fill("single-parent"),
    ...Array<HhType>(TARGET_HOUSEHOLDS - 1 - 95).fill("elder-child"),
  ]
  const hhTypes = rng.shuffle(typeMix)
  const minorsPlan = hhTypes.map((t) =>
    t === "young"
      ? rng.int(1, 3)
      : t === "extended"
        ? rng.int(0, 2)
        : t === "single-parent"
          ? rng.int(1, 2)
          : 0
  )
  // Nusrat is the 90th minor.
  const target = TARGET_MINORS - 1
  let total = minorsPlan.reduce((s, n) => s + n, 0)
  for (let i = 0; total > target && i < 10_000; i++) {
    const k = i % minorsPlan.length
    const min = hhTypes[k] === "young" || hhTypes[k] === "single-parent" ? 1 : 0
    if (minorsPlan[k] > min) {
      minorsPlan[k]--
      total--
    }
  }
  for (let i = 0; total < target && i < 10_000; i++) {
    const k = i % minorsPlan.length
    if (hhTypes[k] === "young" && minorsPlan[k] < 4) {
      minorsPlan[k]++
      total++
    }
  }

  const bornYear = (age: number) => Number(ctx.today.slice(0, 4)) - age
  const maleName = (
    age: number,
    surname: NamePart | undefined,
    hindu: boolean
  ): [string, string, NamePart] => {
    if (hindu) {
      const s = surname ?? rng.pick(HINDU_SURNAMES)
      return [...join(rng.pick(HINDU_MALE_GIVEN), s), s]
    }
    if (bornYear(age) >= 1990 || surname) {
      const s = surname ?? rng.pick(MALE_SURNAMES)
      return [...join(rng.pick(MALE_GIVEN_YOUNGER), s), s]
    }
    const [en, bn, kind] = rng.pick(MALE_GIVEN_OLDER)
    const s =
      kind === "ur"
        ? UR_SURNAME
        : kind === "ul"
          ? rng.pick(UL_SURNAMES)
          : rng.pick(MALE_SURNAMES)
    const prefix =
      bornYear(age) < 1985 && rng.bool(0.35) ? MD_PREFIX : undefined
    return [...join(prefix, [en, bn], s), s]
  }
  const femaleName = (
    age: number,
    familySurname: NamePart | undefined,
    hindu: boolean,
    married: boolean
  ): [string, string] => {
    const older = bornYear(age) < 1988
    if (hindu) {
      const s = familySurname ?? rng.pick(HINDU_SURNAMES)
      return join(
        rng.pick(HINDU_FEMALE_GIVEN),
        older && married && rng.bool(0.6) ? RANI : undefined,
        s
      )
    }
    const given = older
      ? rng.pick(FEMALE_GIVEN_OLDER)
      : rng.pick(FEMALE_GIVEN_YOUNGER)
    let surname: NamePart
    if (!married && familySurname && rng.bool(0.5)) surname = familySurname
    else if (married && familySurname && rng.bool(0.2)) surname = familySurname
    else
      surname = older
        ? rng.pick(FEMALE_SURNAMES_OLDER)
        : rng.pick(FEMALE_SURNAMES_YOUNGER)
    const prefix =
      older && bornYear(age) < 1975 && rng.bool(0.12) ? MST_PREFIX : undefined
    return join(prefix, given, surname)
  }

  const householdRows: {
    id: string
    phone: string
    memberIds: string[]
    headId: string
    at: Ms
  }[] = []
  let serial = 0
  const nextId = () => `pat_${String(++serial).padStart(4, "0")}`

  for (let h = 0; h < hhTypes.length; h++) {
    const type = hhTypes[h]
    const hindu = rng.bool(0.07)
    const branch = pickBranch()
    const phone = ids.phone()
    const address = area(branch)
    const hhId = `hh_${String(h + 1).padStart(3, "0")}`
    const regBase = registered(1400, 60)
    const members: Draft[] = []
    const add = (
      d: Omit<
        Draft,
        "branch" | "phone" | "address" | "householdId" | "registeredAt"
      > & { registeredAt?: Ms }
    ) => {
      const draft: Draft = {
        ...d,
        branch,
        phone,
        phoneVerified: rng.bool(0.85),
        address,
        householdId: hhId,
        registeredAt: d.registeredAt ?? regBase + members.length * 7 * MINUTE,
      }
      members.push(draft)
      return draft
    }

    const adult = (
      sex: Sex,
      age: number,
      relation: Relation,
      surname: NamePart | undefined,
      married: boolean
    ) => {
      const [en, bn] =
        sex === "M"
          ? maleName(age, surname, hindu)
          : femaleName(age, surname, hindu, married)
      return add({
        id: nextId(),
        nameEn: en,
        nameBn: bn,
        sex,
        dob: dobForAge(age),
        relationToHead: relation,
        nid: rng.bool(0.9) ? ids.nid() : undefined,
        bloodGroup: blood(),
      })
    }
    const minor = (
      age: number,
      relation: Relation,
      surname: NamePart | undefined,
      guardian: Draft,
      guardianRelation: Relation
    ) => {
      const sex: Sex = rng.bool() ? "M" : "F"
      const dob = dobForAge(age, age === 0 ? 150 : 360)
      const [en, bn] =
        sex === "M"
          ? hindu
            ? join(rng.pick(HINDU_MALE_GIVEN), surname)
            : join(rng.pick(MALE_GIVEN_YOUNGER), surname)
          : femaleName(age, surname, hindu, false)
      const birth = Date.parse(`${dob}T06:00:00Z`)
      return add({
        id: nextId(),
        nameEn: en,
        nameBn: bn,
        sex,
        dob,
        relationToHead: relation,
        guardianPatientId: guardian.id,
        guardianRelation,
        brn: rng.bool(0.75) ? ids.brn(Number(dob.slice(0, 4))) : undefined,
        bloodGroup: blood(),
        registeredAt: Math.min(
          ctx.now - DAY,
          Math.max(regBase, birth + 7 * DAY) + members.length * 7 * MINUTE
        ),
      })
    }

    if (type === "young") {
      const headAge = rng.int(28, 45)
      const [en, bn, surname] = maleName(headAge, undefined, hindu)
      const head = add({
        id: nextId(),
        nameEn: en,
        nameBn: bn,
        sex: "M",
        dob: dobForAge(headAge),
        relationToHead: "self",
        nid: ids.nid(),
        bloodGroup: blood(),
      })
      const wifeAge = Math.max(21, headAge - rng.int(2, 8))
      const wife = adult("F", wifeAge, "spouse", surname, true)
      for (let c = 0; c < minorsPlan[h]; c++) {
        const age = rng.int(0, Math.min(17, wifeAge - 19))
        const fatherGuards = rng.bool(0.6)
        const child = minor(
          age,
          "other",
          surname,
          fatherGuards ? head : wife,
          fatherGuards ? "father" : "mother"
        )
        child.relationToHead = child.sex === "M" ? "son" : "daughter"
      }
    } else if (type === "extended") {
      const headAge = rng.int(56, 78)
      const [en, bn, surname] = maleName(headAge, undefined, hindu)
      add({
        id: nextId(),
        nameEn: en,
        nameBn: bn,
        sex: "M",
        dob: dobForAge(headAge),
        relationToHead: "self",
        nid: ids.nid(),
        bloodGroup: blood(),
      })
      adult(
        "F",
        Math.max(45, headAge - rng.int(3, 10)),
        "spouse",
        surname,
        true
      )
      const sonAge = Math.min(headAge - 24, rng.int(27, 40))
      const son = adult("M", sonAge, "son", surname, true)
      if (rng.bool(0.6))
        adult("F", Math.max(21, sonAge - rng.int(2, 6)), "other", surname, true)
      for (let c = 0; c < minorsPlan[h]; c++) {
        minor(
          rng.int(0, Math.min(14, sonAge - 21)),
          "grandchild",
          surname,
          son,
          "father"
        )
      }
    } else if (type === "couple") {
      const headAge = rng.int(40, 78)
      const [en, bn, surname] = maleName(headAge, undefined, hindu)
      add({
        id: nextId(),
        nameEn: en,
        nameBn: bn,
        sex: "M",
        dob: dobForAge(headAge),
        relationToHead: "self",
        nid: ids.nid(),
        bloodGroup: blood(),
      })
      adult(
        "F",
        Math.max(35, headAge - rng.int(3, 10)),
        "spouse",
        surname,
        true
      )
    } else if (type === "single-parent") {
      const headAge = rng.int(28, 48)
      const [en, bn] = femaleName(headAge, undefined, hindu, true)
      const head = add({
        id: nextId(),
        nameEn: en,
        nameBn: bn,
        sex: "F",
        dob: dobForAge(headAge),
        relationToHead: "self",
        nid: ids.nid(),
        bloodGroup: blood(),
      })
      const familySurname: NamePart = hindu
        ? rng.pick(HINDU_SURNAMES)
        : rng.pick(MALE_SURNAMES)
      for (let c = 0; c < minorsPlan[h]; c++) {
        const child = minor(
          rng.int(0, Math.min(17, headAge - 19)),
          "other",
          familySurname,
          head,
          "mother"
        )
        child.relationToHead = child.sex === "M" ? "son" : "daughter"
      }
    } else {
      const headSex: Sex = rng.bool(0.6) ? "F" : "M"
      const headAge = rng.int(62, 85)
      let surname: NamePart | undefined
      if (headSex === "M") {
        const [en, bn, s] = maleName(headAge, undefined, hindu)
        surname = s
        add({
          id: nextId(),
          nameEn: en,
          nameBn: bn,
          sex: "M",
          dob: dobForAge(headAge),
          dobEstimated: rng.bool(0.3),
          relationToHead: "self",
          nid: ids.nid(),
          bloodGroup: blood(),
        })
      } else {
        const [en, bn] = femaleName(headAge, undefined, hindu, true)
        surname = hindu ? rng.pick(HINDU_SURNAMES) : rng.pick(MALE_SURNAMES)
        add({
          id: nextId(),
          nameEn: en,
          nameBn: bn,
          sex: "F",
          dob: dobForAge(headAge),
          dobEstimated: rng.bool(0.3),
          relationToHead: "self",
          nid: ids.nid(),
          bloodGroup: blood(),
        })
      }
      const childSex: Sex = rng.bool() ? "M" : "F"
      adult(
        childSex,
        rng.int(30, Math.min(52, headAge - 20)),
        childSex === "M" ? "son" : "daughter",
        surname,
        childSex === "F"
      )
    }

    drafts.push(...members)
    householdRows.push({
      id: hhId,
      phone,
      memberIds: members.map((m) => m.id),
      headId: members[0].id,
      at: members[0].registeredAt,
    })
  }

  /* ---------------- Single registrations ---------------- */

  const householdMembers = householdRows.reduce(
    (s, h) => s + h.memberIds.length,
    0
  )
  const fixedCount = drafts.length - householdMembers
  const singles = TOTAL_PATIENTS - drafts.length
  if (singles < 0)
    throw new Error(
      `seed: too many patients (${fixedCount} fixed, ${householdMembers} in households)`
    )
  for (let i = 0; i < singles; i++) {
    const sex: Sex = rng.bool(0.5) ? "M" : "F"
    const age = rng.weighted<number>([
      [rng.int(18, 30), 25],
      [rng.int(31, 45), 30],
      [rng.int(46, 60), 28],
      [rng.int(61, 85), 17],
    ])
    const hindu = rng.bool(0.07)
    const [en, bn] =
      sex === "M"
        ? maleName(age, undefined, hindu)
        : femaleName(age, undefined, hindu, rng.bool(0.7))
    const branch = pickBranch()
    const hasPhone = rng.bool(0.95)
    drafts.push({
      id: nextId(),
      nameEn: en,
      nameBn: bn,
      sex,
      dob: dobForAge(age),
      dobEstimated: age > 70 && rng.bool(0.3),
      branch,
      registeredAt: registered(1400),
      phone: hasPhone ? ids.phone() : undefined,
      attendantPhone: hasPhone ? undefined : ids.phone(),
      phoneVerified: hasPhone && rng.bool(0.75),
      nid: rng.bool(0.85) ? ids.nid() : undefined,
      passport: rng.bool(0.03)
        ? `A${rng.int(10_000_000, 99_999_999)}`
        : undefined,
      bloodGroup: blood(),
      address: area(branch),
      registrationNote: hasPhone
        ? undefined
        : "No personal phone; attendant's number recorded",
    })
  }

  /* ---------------- Clinical background for generated patients ---------------- */

  for (const d of drafts) {
    if (reserved.has(d.id)) continue
    const age = ageOn(d.dob, ctx.today)
    const allergies: Allergy[] = []
    if (rng.bool(0.07)) allergies.push(rng.pick(ALLERGY.penicillin))
    if (rng.bool(0.03)) allergies.push(rng.pick(ALLERGY.sulfa))
    if (age >= 12 && rng.bool(0.04)) allergies.push(rng.pick(ALLERGY.nsaid))
    const problems: Problem[] = []
    const meds: CurrentMed[] = []
    const band = age < 18 ? 0 : age < 35 ? 1 : age < 50 ? 2 : 3
    if (band > 0 && rng.bool([0, 0.02, 0.12, 0.25][band])) {
      problems.push({
        ...ICD.dm,
        since: since(rng.int(1, 12)),
        status: "active",
      })
      meds.push(
        rng.bool(0.7)
          ? med(
              "comet500",
              SEED_REFS.generic.metformin,
              undefined,
              "Metformin 500 mg",
              "1+0+1 after meals",
              since(rng.int(1, 8))
            )
          : med(
              null,
              SEED_REFS.generic.metformin,
              "brd_informet_500mg",
              "Metformin 500 mg",
              "1+0+1 after meals",
              since(rng.int(1, 8))
            )
      )
    }
    if (band > 0 && rng.bool([0, 0.03, 0.15, 0.35][band])) {
      problems.push({
        ...ICD.htn,
        since: since(rng.int(1, 15)),
        status: "active",
      })
      meds.push(
        rng.bool(0.6)
          ? med(
              "camlodin5",
              SEED_REFS.generic.amlodipine,
              undefined,
              "Amlodipine 5 mg",
              "0+0+1 after meals",
              since(rng.int(1, 8))
            )
          : med(
              null,
              "gen_losartan",
              "brd_angilock_50mg",
              "Losartan 50 mg",
              "1+0+0 after meals",
              since(rng.int(1, 8))
            )
      )
    }
    if (rng.bool(age < 18 ? 0.05 : 0.06)) {
      problems.push({
        ...ICD.asthma,
        since: since(rng.int(1, 10)),
        status: "active",
      })
      meds.push(
        med(
          null,
          "gen_salbutamol",
          "brd_azmasol_100mcgpuff_inhaler",
          "Salbutamol inhaler",
          "2 puffs when needed",
          since(rng.int(1, 6))
        )
      )
    }
    if (band === 3 && rng.bool(0.04)) {
      problems.push({
        ...ICD.ckd3,
        since: since(rng.int(1, 5)),
        status: "active",
      })
    }
    d.allergies = allergies
    d.problems = problems
    d.currentMeds = meds
  }

  /* ---------------- Rows, UHIDs and consents ---------------- */

  const byId = new Map<string, PatientRow>()
  const draftById = new Map(drafts.map((d) => [d.id, d]))
  const rows: PatientRow[] = []
  for (const d of drafts) {
    const age = ageOn(d.dob, ctx.today)
    const guardian = d.guardianPatientId
      ? draftById.get(d.guardianPatientId)
      : undefined
    const consents: Consent[] = [
      {
        purpose: "treatment",
        granted: true,
        at: d.registeredAt,
        byPatientId: guardian?.id,
      },
      {
        purpose: "sms",
        granted: d.phone ? rng.bool(0.85) : false,
        at: d.registeredAt,
        byPatientId: guardian?.id,
      },
    ]
    if (rng.bool(0.03))
      consents.push({
        purpose: "research",
        granted: true,
        at: d.registeredAt + HOUR,
        byPatientId: guardian?.id,
      })
    const band =
      age < 13 ? "child" : age < 18 ? "teen" : age < 60 ? "adult" : "senior"
    const row = ctx.bag.put("patients", d.id, d.registeredAt, {
      uhid: "",
      aliases: [],
      identityStatus: "active",
      nameEn: d.nameEn,
      nameBn: d.nameBn,
      nameSearchKeys: nameSearchKeys(d.nameEn, d.nameBn),
      dob: d.dob,
      dobEstimated: d.dobEstimated,
      sex: d.sex,
      bloodGroup: d.bloodGroup,
      address: d.address,
      phone: d.phone,
      phoneVerified: d.phoneVerified ?? false,
      attendantPhone: d.attendantPhone,
      nid: d.nid,
      brn: d.brn,
      passport: d.passport,
      householdId: d.householdId,
      relationToHead: d.relationToHead,
      guardianPatientId: d.guardianPatientId,
      guardianRelation: d.guardianRelation,
      allergies: d.allergies ?? [],
      currentMeds: d.currentMeds ?? [],
      problems: d.problems ?? [],
      photoSeed: `${d.sex === "M" ? "m" : "f"}-${band}-${d.id}`,
      consents: d.consents ?? consents,
      registrationNote: d.registrationNote,
      registeredAtBranch: d.branch,
    })
    if (!d.fixedUhid) {
      ctx.numbers.request(counterKey.uhid(), d.registeredAt, (n) => {
        row.uhid = uhidFromSerial(n)
      })
    }
    rows.push(row)
    byId.set(row.id, row)
  }
  ctx.numbers.base(counterKey.uhid(), UHID_SERIAL_BASE)

  /* Hero consents: Tanvir holds the patient-app account; Nusrat's by Tanvir. */
  const tanvir = byId.get(HERO.patient.tanvirKarim)!
  tanvir.consents.push({
    purpose: "app",
    granted: true,
    at: heroRegistered + 400 * DAY,
  })
  byId
    .get(HERO.patient.abdulKarim)!
    .consents.push({ purpose: "app", granted: true, at: ctx.now - 180 * DAY })

  /* B2 offline records: provisional numbers, then permanent UHIDs or a merge. */
  const moriom = byId.get("pat_off_moriom")!
  const sajib = byId.get("pat_off_sajib")!
  const parulEdge = byId.get("pat_off_parul_edge")!
  const parulCentral = byId.get("pat_off_parul_central")!
  const offKey = counterKey.provisionalUhid("B2")
  ctx.numbers.request(offKey, moriom.createdAt, (n) => {
    moriom.provisionalUhid = docNo.provisionalUhid("B2", n)
    moriom.aliases = [moriom.provisionalUhid]
  })
  ctx.numbers.request(offKey, sajib.createdAt, (n) => {
    sajib.provisionalUhid = docNo.provisionalUhid("B2", n)
    sajib.aliases = [sajib.provisionalUhid]
  })
  ctx.numbers.request(offKey, parulEdge.createdAt, (n) => {
    const provisional = docNo.provisionalUhid("B2", n)
    parulEdge.uhid = provisional
    parulEdge.provisionalUhid = provisional
    parulCentral.aliases = [provisional]
  })
  parulEdge.identityStatus = "merged"
  parulEdge.mergedInto = parulCentral.id
  parulEdge.updatedAt = replayAt + 2 * HOUR
  parulCentral.updatedAt = replayAt + 2 * HOUR

  /* Households and family links */
  ctx.bag.put("households", HERO.household.karim, heroRegistered, {
    phone: HERO_PHONE,
    memberIds: [
      HERO.patient.abdulKarim,
      HERO.patient.rokeyaBegum,
      HERO.patient.tanvirKarim,
      HERO.patient.nusratKarim,
    ],
    headPatientId: HERO.patient.abdulKarim,
  })
  for (const h of householdRows) {
    ctx.bag.put("households", h.id, h.at, {
      phone: h.phone,
      memberIds: h.memberIds,
      headPatientId: h.headId,
    })
  }
  ctx.bag.put("familyLinks", "fl_tanvir_nusrat", heroRegistered + 400 * DAY, {
    ownerPatientId: HERO.patient.tanvirKarim,
    memberPatientId: HERO.patient.nusratKarim,
    kind: "guardian",
    status: "granted",
    grantedAt: heroRegistered + 400 * DAY,
    otpVerifiedAt: heroRegistered + 400 * DAY,
  })
  ctx.bag.put("familyLinks", "fl_tanvir_abdul", ctx.now - 180 * DAY, {
    ownerPatientId: HERO.patient.tanvirKarim,
    memberPatientId: HERO.patient.abdulKarim,
    kind: "proxy",
    status: "granted",
    grantedAt: ctx.now - 180 * DAY,
    otpVerifiedAt: ctx.now - 180 * DAY,
  })

  const age = (p: PatientRow) => ageOn(p.dob, ctx.today)
  const pool = rows.filter((p) => !reserved.has(p.id))
  return {
    all: rows,
    reserved,
    byId,
    age,
    adults: pool.filter((p) => age(p) >= 18),
    minors: pool.filter((p) => age(p) < 18),
  }
}
