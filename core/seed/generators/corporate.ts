/**
 * Corporate billing (plan §7.1, PRD §10.10): three invented employers with
 * active contracts (contract discount, 20% co-pay, annual limit per employee)
 * and rosters of employees and dependants linked to patients, plus corporate
 * invoices for past visits over the last weeks (the monthly statement).
 */

import { rules } from "@/config/rules.config"
import type {
  AppointmentRow,
  CorporateEmployeeRow,
  Id,
  PatientRow,
} from "@/core/db/schema"
import type { Rng } from "@/lib/mock/rng"

import type { SeedCtx } from "../context"
import { HERO } from "../content/hero-ids"
import { CORPORATE_CLIENTS } from "../content/partners"
import { SEED_REFS } from "../content/seed-refs"
import { BRANCH_ACTORS } from "../content/staff"
import {
  DAY,
  dhakaAt,
  firstOfMonth,
  isoAddDays,
  isoAddYears,
  MINUTE,
} from "../time"
import { consultLine, createPaidInvoice } from "./billing"
import { createLabOrder } from "./clinical"
import type { DoctorInfo } from "./org"
import type { PatientPools } from "./patients"

type RosterEntry = {
  employee: CorporateEmployeeRow
  patient?: PatientRow
  clientId: Id
  discountPct: number
}

export function seedCorporate(
  ctx: SeedCtx,
  pools: PatientPools,
  doctors: DoctorInfo[]
): void {
  const { bag } = ctx
  const rng = ctx.rng("corporate")
  const validFrom = firstOfMonth(isoAddDays(ctx.today, -240))
  const validTo = isoAddDays(isoAddYears(validFrom, 1), -1)
  const doctorById = new Map(doctors.map((d) => [d.id, d]))

  const eligible = (p: PatientRow) => {
    const age = pools.age(p)
    return (
      age >= 22 &&
      age <= 58 &&
      (p.relationToHead === undefined ||
        p.relationToHead === "self" ||
        p.relationToHead === "son")
    )
  }

  // Employees who visited in the last weeks get corporate invoices for those visits.
  const seen = new Set<string>()
  const visits: AppointmentRow[] = []
  for (const a of rng.shuffle(bag.all("appointments"))) {
    if (visits.length >= 14) break
    if (
      a.status !== "done" ||
      a.date >= ctx.today ||
      a.doctorId === HERO.doctor.kamal ||
      seen.has(a.patientId)
    )
      continue
    // Yesterday's B1 visits are billed in the cash-shift history.
    if ((a.date === ctx.day(-1) && a.branchId === "B1") || a.feeBasketLineId)
      continue
    const p = pools.byId.get(a.patientId)
    if (!p || pools.reserved.has(p.id) || p.corporateEmployeeId || !eligible(p))
      continue
    seen.add(p.id)
    visits.push(a)
  }

  const taken = new Set<string>()
  const roster: RosterEntry[] = []
  const pool = pools.adults.filter(eligible)

  CORPORATE_CLIENTS.forEach((c, ci) => {
    bag.put("corporateClients", c.id, ctx.now - 400 * DAY, {
      code: c.code,
      name: c.name,
      contactName: c.contactName,
      phone: c.phone,
      creditLimitP: c.creditLimitTaka * 100,
    })
    const contractId = `cct_${c.id.slice(5)}`
    bag.put("corporateContracts", contractId, ctx.now - 250 * DAY, {
      clientId: c.id,
      validFrom,
      validTo,
      coveredServices: [
        "consultation",
        "follow-up",
        "lab",
        "imaging",
        "medicine",
      ],
      discountPct: c.discountPct,
      coPayPct: rules.corporate.coPayPct,
      annualLimitP: rules.corporate.annualLimitPerEmployeeP,
      status: "active",
    })

    const visitors = visits
      .filter((_, i) => i % CORPORATE_CLIENTS.length === ci)
      .map((a) => pools.byId.get(a.patientId)!)
    for (let i = 0; i < c.employees; i++) {
      let patient: PatientRow | undefined = visitors[i]
      if (!patient && rng.bool(0.7)) {
        for (let tries = 0; tries < 20 && !patient; tries++) {
          const p = rng.pick(pool)
          if (!taken.has(p.id) && !seen.has(p.id)) patient = p
        }
      }
      if (patient) taken.add(patient.id)
      const employeeNo = `${c.code.slice(5)}-${1001 + i}`
      const employee = bag.put(
        "corporateEmployees",
        `cem_${c.id.slice(5)}_${i + 1}`,
        ctx.now - rng.int(60, 230) * DAY,
        {
          clientId: c.id,
          contractId,
          employeeNo,
          patientId: patient?.id,
          nameEn: patient?.nameEn ?? rosterName(rng),
          relation: "employee",
          status: patient || rng.bool(0.9) ? "active" : "left",
          usedP: 0,
        }
      )
      if (patient) patient.corporateEmployeeId = employee.id
      roster.push({
        employee,
        patient,
        clientId: c.id,
        discountPct: c.discountPct,
      })

      // Dependants from the employee's household (spouse and minor children).
      if (patient?.householdId && patient.relationToHead === "self") {
        const household = bag.get("households", patient.householdId)
        const deps = household.memberIds
          .map((id) => pools.byId.get(id)!)
          .filter(
            (m) =>
              m.id !== patient!.id &&
              (m.relationToHead === "spouse" ||
                m.guardianPatientId === patient!.id)
          )
          .slice(0, 2)
        deps.forEach((d, k) => {
          if (taken.has(d.id) || pools.reserved.has(d.id)) return
          taken.add(d.id)
          const dep = bag.put(
            "corporateEmployees",
            `cem_${c.id.slice(5)}_${i + 1}_d${k + 1}`,
            employee.createdAt,
            {
              clientId: c.id,
              contractId,
              employeeNo,
              patientId: d.id,
              nameEn: d.nameEn,
              relation: d.relationToHead === "spouse" ? "spouse" : "child",
              status: "active",
              usedP: 0,
            }
          )
          d.corporateEmployeeId = dep.id
        })
      }
    }
  })

  /* Corporate invoices for those visits: co-pay in cash, the rest on account */
  for (const a of visits) {
    const entry = roster.find((r) => r.patient?.id === a.patientId)
    if (!entry) continue
    const patient = entry.patient!
    const doctor = doctorById.get(a.doctorId)!
    const followUp = a.visitType === "follow-up"
    const fee = (followUp ? doctor.followUpTaka : doctor.feeTaka) * 100
    const at = (a.checkedInAt ?? dhakaAt(a.date, a.slotStart)) - 3 * MINUTE
    const split = (subtotal: number) => {
      const total = subtotal - Math.round((subtotal * entry.discountPct) / 100)
      const coPay = Math.round((total * rules.corporate.coPayPct) / 100)
      return { total, coPay }
    }
    const consult = split(fee)
    const out = createPaidInvoice(ctx, {
      patientId: patient.id,
      branch: a.branchId,
      at,
      cashierId: BRANCH_ACTORS[a.branchId].cashier,
      lines: [consultLine(a.id, doctor, followUp, fee)],
      discountPct: entry.discountPct,
      payerType: "corporate",
      corporateClientId: entry.clientId,
      tenders: [
        { tender: "cash", amountP: consult.coPay },
        { tender: "corporate" },
      ],
    })
    a.feeBasketLineId = out.basketLines[0].id
    entry.employee.usedP += consult.total - consult.coPay

    if (rng.bool(0.6)) {
      const testId = rng.pick([
        SEED_REFS.test.cbc,
        SEED_REFS.test.lipid,
        SEED_REFS.test.hba1c,
        SEED_REFS.test.tsh,
      ])
      const lab = split(bag.get("labTests", testId).priceP)
      createLabOrder(ctx, {
        patient,
        ageYears: pools.age(patient),
        branch: a.branchId,
        at: (a.updatedAt ?? at) + 5 * MINUTE,
        testIds: [testId],
        stage: "released",
        source: "doctor",
        doctorId: doctor.id,
        billing: {
          cashierId: BRANCH_ACTORS[a.branchId].cashier,
          payerType: "corporate",
          corporateClientId: entry.clientId,
          discountPct: entry.discountPct,
          tenders: [
            { tender: "cash", amountP: lab.coPay },
            { tender: "corporate" },
          ],
        },
        labtechId: BRANCH_ACTORS[a.branchId].labtech,
      })
      entry.employee.usedP += lab.total - lab.coPay
    }
    entry.employee.updatedAt = at + MINUTE
  }
}

const ROSTER_GIVEN = [
  "Arif",
  "Nadia",
  "Sohag",
  "Rima",
  "Babul",
  "Tuhin",
  "Sonia",
  "Milon",
  "Keya",
  "Jewel",
]
const ROSTER_FAMILY = [
  "Hossain",
  "Akter",
  "Islam",
  "Rahman",
  "Mia",
  "Sultana",
  "Ahmed",
  "Khan",
]

/** Roster members who have never visited: English name from the employer's list. */
function rosterName(rng: Rng): string {
  return `${rng.pick(ROSTER_GIVEN)} ${rng.pick(ROSTER_FAMILY)}`
}
