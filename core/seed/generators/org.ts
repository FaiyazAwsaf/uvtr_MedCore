/**
 * Organisation (plan §7.1): companies and branches from config, departments,
 * rooms, wards and beds per branch, staff (persona staff plus about 40 more),
 * personas, specialties, the 63 doctors and their fee-share contracts.
 */

import { branches, companies } from "@/config/brand.config"
import type { FeeShareRule } from "@/core/db/schema"

import type { SeedCtx } from "../context"
import {
  PERSONA_DOCTORS,
  GENERATED_DOCTORS,
  type DoctorSeed,
} from "../content/doctors"
import {
  CONSULT_ROOMS,
  DEPARTMENTS,
  SERVICE_ROOMS,
  WARDS,
  consultRoom,
  consultRoomId,
  departmentId,
  wardId,
} from "../content/org"
import { PERSONAS } from "../content/personas"
import { SPECIALTIES, specialtyId } from "../content/specialties"
import { STAFF } from "../content/staff"
import { bnDigits } from "../content/bn"
import { rules } from "@/config/rules.config"
import { DAY, firstOfMonth, isoAddDays } from "../time"

const taka = (n: number) => Math.round(n * 100)

export function seedOrganisation(ctx: SeedCtx): void {
  const { bag } = ctx
  // Organisation rows exist from long before the demo window.
  const founded = ctx.now - 5 * 365 * DAY

  for (const c of companies) {
    bag.put("companies", c.code, founded, {
      code: c.code,
      name: c.name,
      tin: c.tin,
      invoicePrefix: c.invoicePrefix,
    })
  }

  for (const b of branches) {
    bag.put("branches", b.code, founded, {
      code: b.code,
      companyId: b.company,
      name: b.name,
      kind: b.kind,
      services: b.services,
      address: b.address,
      phone: b.phone,
    })

    for (const d of DEPARTMENTS) {
      if (d.requires && !b.services.includes(d.requires)) continue
      bag.put("departments", departmentId(b.code, d.code), founded, {
        branchId: b.code,
        code: `${b.code}-${d.code}`,
        name: d.name,
        kind: d.kind,
      })
    }

    const consult = CONSULT_ROOMS[b.code]
    if (consult && b.services.includes("opd")) {
      for (let n = 1; n <= consult.count; n++) {
        const room = consultRoom(n, consult.chamber ?? false)
        bag.put("rooms", consultRoomId(b.code, n), founded, {
          branchId: b.code,
          departmentId: departmentId(b.code, "OPD"),
          code: room.code,
          name: room.name,
          kind: "consult",
        })
      }
    }

    for (const r of SERVICE_ROOMS) {
      if (r.requires && !b.services.includes(r.requires)) continue
      bag.put("rooms", `rm_${b.code}_${r.key}`, founded, {
        branchId: b.code,
        departmentId: departmentId(b.code, r.department),
        code: r.code,
        name: r.name,
        kind: r.kind,
      })
    }
  }

  for (const w of WARDS) {
    const id = wardId(w.branch, w.code)
    bag.put("wards", id, founded, {
      branchId: w.branch,
      code: w.code,
      name: w.name,
      kind: w.kind,
      bedDayRateP: taka(w.bedDayRateTaka),
    })
    for (let n = 1; n <= w.beds; n++) {
      const code = `${w.code}-${String(n).padStart(2, "0")}`
      // Occupancy, cleaning and reservations are set by the inpatient generator.
      bag.put("beds", `bed_${w.branch}_${code.toLowerCase()}`, founded, {
        wardId: id,
        branchId: w.branch,
        code,
        status: "vacant",
      })
    }
  }
}

export function seedStaffAndPersonas(ctx: SeedCtx): void {
  const { bag } = ctx
  const hired = ctx.now - 3 * 365 * DAY

  for (const p of PERSONAS) {
    if (p.staff) {
      bag.put("staff", p.staff.id, hired, {
        nameEn: p.staff.nameEn,
        nameBn: p.staff.nameBn,
        sex: p.staff.sex,
        role: p.role,
        branchId: p.branchId,
        designation: p.staff.designation,
        regNo: p.staff.regNo,
        regBody: p.staff.regBody,
        authorities: p.staff.authorities,
        avatarSeed: p.staff.id,
      })
    }
    bag.put("personas", p.id, hired, {
      staffId: p.staff?.id,
      patientId: p.patientId,
      role: p.role,
      branchId: p.branchId,
      isDefault: p.isDefault,
      blurb: p.blurb,
      order: p.order,
    })
  }

  const rng = ctx.rng("staff")
  for (const s of STAFF) {
    bag.put("staff", s.id, hired - rng.int(0, 700) * DAY, {
      nameEn: s.nameEn,
      nameBn: s.nameBn,
      sex: s.sex,
      role: s.role,
      branchId: s.branchId,
      designation: s.designation,
      regNo: s.regNo,
      regBody: s.regBody,
      authorities: s.authorities,
      avatarSeed: s.id,
      phone: `01${rng.pick(["7", "8", "9", "3", "5"])}${rng.int(10, 99)}-${rng.int(100000, 999999)}`,
    })
  }
}

export type DoctorInfo = DoctorSeed & { staffRowId: string }

/** Seeds specialties, doctors (all male), their staff rows and fee-share contracts. */
export function seedDoctors(ctx: SeedCtx): DoctorInfo[] {
  const { bag } = ctx
  const rng = ctx.rng("doctors")
  const since = ctx.now - 6 * 365 * DAY

  for (const s of SPECIALTIES) {
    bag.put("specialties", specialtyId(s.code), since, {
      code: s.code,
      name: s.name,
      icon: s.icon,
      navigatorSymptoms: s.navigatorSymptoms,
    })
  }

  const usedBmdc = new Set(PERSONA_DOCTORS.map((d) => d.bmdcNo))
  const nextBmdc = () => {
    let no: string
    do no = `A-${rng.int(21000, 79999)}`
    while (usedBmdc.has(no))
    usedBmdc.add(no)
    return no
  }

  const all: DoctorInfo[] = []
  for (const d of PERSONA_DOCTORS) all.push({ ...d, staffRowId: d.staffId })
  for (const g of GENERATED_DOCTORS) {
    const reporting = g.kind === "pathologist" || g.kind === "radiologist"
    const experienceYears = rng.int(6, 28)
    const fee = reporting
      ? 0
      : Math.min(
          1500,
          500 + Math.round((experienceYears * 40 + rng.int(0, 300)) / 100) * 100
        )
    all.push({
      ...g,
      feeTaka: fee,
      followUpTaka: reporting ? 0 : Math.round((fee * 0.6) / 100) * 100,
      experienceYears,
      staffRowId: g.staffId,
    })
  }

  for (const d of all) {
    const spec = SPECIALTIES.find((s) => s.code === d.specialty)
    if (!spec) throw new Error(`seed: unknown specialty ${d.specialty}`)
    const qualifications = d.qualifications ?? rng.pick(spec.qualifications)
    const bmdcNo = d.bmdcNo ?? nextBmdc()
    const interest = rng.pick(spec.interests)
    const title =
      d.kind === "pathologist"
        ? { en: "Consultant pathologist", bn: "কনসালট্যান্ট প্যাথলজিস্ট" }
        : d.kind === "radiologist"
          ? { en: "Consultant radiologist", bn: "কনসালট্যান্ট রেডিওলজিস্ট" }
          : d.kind === "medical-officer"
            ? { en: "Duty doctor", bn: "ডিউটি ডাক্তার" }
            : {
                en: `Consultant, ${spec.name.en}`,
                bn: `কনসালট্যান্ট, ${spec.name.bn}`,
              }

    if (!d.persona) {
      bag.put("staff", d.staffId, since + rng.int(0, 900) * DAY, {
        nameEn: d.nameEn,
        nameBn: d.nameBn,
        // Owner rule: every doctor is male.
        sex: "M",
        role: d.kind === "pathologist" ? "pathologist" : "doctor",
        branchId: d.branches[0],
        designation: title,
        regNo: bmdcNo,
        regBody: "BMDC",
        authorities: d.kind === "pathologist" ? ["sign:reports"] : [],
        avatarSeed: d.staffId,
      })
    }

    bag.put("doctors", d.id, since, {
      staffId: d.staffId,
      specialtyId: specialtyId(d.specialty),
      kind: d.kind,
      bmdcNo,
      bmdcVerified: true,
      qualifications,
      experienceYears: d.experienceYears,
      languages: ["bn", "en"],
      consultFeeP: taka(d.feeTaka),
      followUpFeeP: taka(d.followUpTaka),
      branchIds: d.branches,
      bio: {
        en: `${title.en}. ${d.experienceYears} years of experience, with a special interest in ${interest.en}. Consults in Bangla and English.`,
        bn: `${title.bn}। ${bnDigits(d.experienceYears)} বছরের অভিজ্ঞতা। বিশেষ আগ্রহের বিষয়: ${interest.bn}। বাংলা ও ইংরেজিতে পরামর্শ দেন।`,
      },
      isDutyDoctor: d.isDutyDoctor ?? false,
    })

    // Fee-share contracts (PRD §10.9): consultants and reporting doctors.
    const rulesFor = (pct: number): FeeShareRule[] =>
      d.kind === "pathologist"
        ? [
            {
              serviceType: "lab-reporting",
              basis: "pct-net",
              value: rules.feeShare.diagnosticReportingPct,
              trigger: "collection",
            },
          ]
        : d.kind === "radiologist"
          ? [
              {
                serviceType: "imaging-reporting",
                basis: "pct-net",
                value: rules.feeShare.diagnosticReportingPct,
                trigger: "collection",
              },
            ]
          : [
              {
                serviceType: "consultation",
                basis: "pct-net",
                value: pct,
                trigger: "collection",
              },
              {
                serviceType: "follow-up",
                basis: "pct-net",
                value: pct,
                trigger: "collection",
              },
            ]
    if (d.kind === "medical-officer") continue
    const effectiveFrom = firstOfMonth(
      isoAddDays(ctx.today, -rng.int(200, 900))
    )
    if (d.id === PERSONA_DOCTORS[0].id) {
      // Dr. Kamal: v1 superseded by v2 four months ago, so statements show versions.
      bag.put("feeShareContracts", `fsc_${d.id}_v1`, since, {
        doctorId: d.id,
        contractVersion: 1,
        effectiveFrom: firstOfMonth(isoAddDays(ctx.today, -800)),
        rules: rulesFor(65),
        whtPct: rules.feeShare.withholdingTaxPct,
        discountBearer: "pro-rata",
      })
      bag.put("feeShareContracts", `fsc_${d.id}_v2`, ctx.now - 120 * DAY, {
        doctorId: d.id,
        contractVersion: 2,
        effectiveFrom: firstOfMonth(isoAddDays(ctx.today, -120)),
        rules: rulesFor(rules.feeShare.consultationPct),
        whtPct: rules.feeShare.withholdingTaxPct,
        discountBearer: "pro-rata",
      })
    } else {
      bag.put("feeShareContracts", `fsc_${d.id}_v1`, since, {
        doctorId: d.id,
        contractVersion: 1,
        effectiveFrom,
        rules: rulesFor(rules.feeShare.consultationPct),
        whtPct: rules.feeShare.withholdingTaxPct,
        discountBearer: "pro-rata",
      })
    }
  }

  return all
}

/** The contract row id in force for a doctor (latest version). */
export function contractFor(
  ctx: SeedCtx,
  doctorId: string
): { id: string; version: number } | undefined {
  const v2 = ctx.bag.find("feeShareContracts", `fsc_${doctorId}_v2`)
  if (v2) return { id: v2.id, version: v2.contractVersion }
  const v1 = ctx.bag.find("feeShareContracts", `fsc_${doctorId}_v1`)
  return v1 ? { id: v1.id, version: v1.contractVersion } : undefined
}
