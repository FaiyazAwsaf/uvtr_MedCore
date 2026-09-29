/**
 * Inpatient billing and beds (plan §5.8; administrative only, not a clinical
 * record): current admissions filling part of each ward, beds being cleaned or
 * reserved, deposits, a few recent discharges, and one cabin admission whose
 * deposit is running low (feeds the deposit threshold alert).
 */

import { rules } from "@/config/rules.config"
import type { Tender } from "@/core/db/schema"
import { counterKey, docNo } from "@/core/db/numbering"
import { bedDays, dailyChargeP } from "@/core/inpatient/interim"

import type { SeedCtx } from "../context"
import { ADMISSION_REASONS, WARDS, wardId } from "../content/org"
import { DAY, HOUR, MINUTE } from "../time"
import type { DoctorInfo } from "./org"
import type { PatientPools } from "./patients"
import type { SchedulingOut } from "./scheduling"

const CONSULTANT_SPECIALTIES = [
  "MED",
  "SURG",
  "GYN",
  "CARD",
  "NEPH",
  "ORTH",
  "GASTRO",
  "CHEST",
]

export function seedInpatient(
  ctx: SeedCtx,
  pools: PatientPools,
  doctors: DoctorInfo[],
  sched: SchedulingOut
): void {
  const { bag } = ctx
  const rng = ctx.rng("inpatient")
  const busyToday = new Set(sched.todayAppointments.map((a) => a.patientId))
  const used = new Set<string>()

  const pick = (branch: string, paediatric: boolean, female?: boolean) => {
    const list = (paediatric ? pools.minors : pools.adults).filter(
      (p) =>
        !used.has(p.id) &&
        !busyToday.has(p.id) &&
        (female === undefined || (p.sex === "F") === female)
    )
    const local = list.filter((p) => p.registeredAtBranch === branch)
    const p = rng.pick(local.length > 3 ? local : list)
    used.add(p.id)
    return p
  }

  let lowDepositDone = false
  for (const w of WARDS) {
    const ward = bag.get("wards", wardId(w.branch, w.code))
    const beds = bag.all("beds").filter((b) => b.wardId === ward.id)
    const occupied = Math.round(beds.length * w.occupancy)
    const consultants = doctors.filter(
      (d) =>
        d.branches.includes(w.branch) &&
        (w.kind === "paediatric"
          ? d.specialty === "PAED"
          : CONSULTANT_SPECIALTIES.includes(d.specialty)) &&
        d.kind === "consultant"
    )
    const shuffled = rng.shuffle(beds)
    shuffled.forEach((bed, i) => {
      if (i < occupied) {
        const female =
          ward.code === "4B" ? true : ward.code === "4A" ? false : undefined
        const patient = pick(w.branch, w.kind === "paediatric", female)
        const lowDeposit = !lowDepositDone && w.kind === "cabin"
        const stayDays = lowDeposit ? 5 : rng.int(1, 9)
        const admittedAt = ctx.now - stayDays * DAY - rng.int(1, 10) * HOUR
        const consultant = rng.pick(
          consultants.length
            ? consultants
            : doctors.filter((d) => d.kind === "consultant")
        )
        const corporate = patient.corporateEmployeeId
          ? bag.get("corporateEmployees", patient.corporateEmployeeId).clientId
          : undefined
        const admission = bag.put("admissions", ctx.seq("adm"), admittedAt, {
          admissionNo: "",
          patientId: patient.id,
          branchId: w.branch,
          consultantId: consultant.id,
          bedId: bed.id,
          admittedAt,
          status: "admitted",
          reason:
            w.kind === "paediatric"
              ? rng.pick([
                  "Fever under observation",
                  "Dehydration care",
                  "Chest infection care",
                ])
              : rng.pick(ADMISSION_REASONS),
          corporateClientId: corporate,
        })
        ctx.numbers.request(counterKey.admission(w.branch), admittedAt, (n) => {
          admission.admissionNo = docNo.admission(w.branch, n)
        })
        bed.status = "occupied"
        bed.admissionId = admission.id
        bed.updatedAt = admittedAt

        // Deposits sized with the interim bill (core/inpatient/interim.ts): an
        // admission deposit for about three days plus the alert threshold,
        // and top-ups every three days, so every stay keeps at least two days
        // of charges above the threshold. The one planted cabin stay has a
        // single deposit that its charges have almost used up (deposit alert).
        const daily = dailyChargeP(ward, consultant.followUpTaka * 100)
        const days = bedDays(admittedAt, ctx.now)
        const roundUp = (p: number) => Math.ceil(p / 5_000_00) * 5_000_00
        const deposits: [number, number][] = []
        if (lowDeposit) {
          const charged = daily * days
          // ৳4,000 to ৳9,000 left: below the ৳10,000 alert threshold.
          const amountP = Math.floor((charged + 9_000_00) / 5_000_00) * 5_000_00
          deposits.push([Math.max(5_000_00, amountP), admittedAt + 20 * MINUTE])
        } else {
          const needed = daily * (days + 2) + rules.depositThresholdP
          let paid = roundUp(daily * 3 + rules.depositThresholdP)
          deposits.push([paid, admittedAt + 20 * MINUTE])
          for (let k = 1; paid < needed; k++) {
            const top = roundUp(daily * 3)
            const at = Math.min(admittedAt + k * 3 * DAY, ctx.now - rng.int(1, 5) * HOUR)
            deposits.push([top, at])
            paid += top
          }
        }
        deposits.forEach(([amountP, at]) => {
          bag.put("deposits", ctx.seq("dep"), at, {
            admissionId: admission.id,
            patientId: patient.id,
            branchId: w.branch,
            amountP,
            tender: rng.pick<Tender>(["cash", "cash", "bkash", "card"]),
            at,
          })
        })
        if (lowDeposit) admission.depositAlertAt = ctx.now - 2 * HOUR
        if (lowDeposit) lowDepositDone = true
      } else if (i < occupied + (w.beds >= 12 ? 2 : 1)) {
        bed.status = "cleaning"
        bed.updatedAt = ctx.now - rng.int(20, 90) * MINUTE
      } else if (w.kind === "cabin" && i === occupied + 2) {
        bed.status = "reserved"
        bed.updatedAt = ctx.now - 3 * HOUR
      }
    })

    // Two recent discharges per ward (history; those beds are free again).
    for (let k = 0; k < 2; k++) {
      const patient = pick(w.branch, w.kind === "paediatric")
      const dischargedAt = ctx.now - rng.int(1, 12) * DAY - rng.int(1, 8) * HOUR
      const admittedAt = dischargedAt - rng.int(2, 6) * DAY
      const vacant = beds.find((b) => b.status === "vacant") ?? beds[0]
      const consultant = rng.pick(
        consultants.length
          ? consultants
          : doctors.filter((d) => d.kind === "consultant")
      )
      const admission = bag.put("admissions", ctx.seq("adm"), admittedAt, {
        admissionNo: "",
        patientId: patient.id,
        branchId: w.branch,
        consultantId: consultant.id,
        bedId: vacant.id,
        admittedAt,
        dischargedAt,
        status: "discharged",
        reason: rng.pick(ADMISSION_REASONS),
      })
      admission.updatedAt = dischargedAt
      ctx.numbers.request(counterKey.admission(w.branch), admittedAt, (n) => {
        admission.admissionNo = docNo.admission(w.branch, n)
      })
      bag.put("deposits", ctx.seq("dep"), admittedAt + 30 * MINUTE, {
        admissionId: admission.id,
        patientId: patient.id,
        branchId: w.branch,
        amountP: 20_000_00,
        tender: "cash",
        at: admittedAt + 30 * MINUTE,
      })
    }
  }
  ctx.numbers.base(counterKey.admission("B1"), 1400)
  ctx.numbers.base(counterKey.admission("B2"), 620)
  ctx.numbers.base(counterKey.admission("B5"), 540)
}
