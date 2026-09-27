/**
 * Today's live state and the hero's history (plan §7.2):
 * - Rafiq Ahmed's open cash shift at B1.
 * - Consult fees: paid at check-in for patients who arrived at B1, open
 *   basket lines for bookings still to arrive (including Dr. Arif's session).
 * - Dr. Kamal's two patients seen this morning: signed notes, one prescription
 *   paid and dispensed, one waiting in the pharmacy queue with an unpaid CBC.
 * - A lab worklist at every stage (awaiting collection to released) at B1 and
 *   two orders at B3, plus an ultrasound awaiting its report.
 * - Abdul Karim's previous visit three weeks ago: note, prescription for his
 *   current medicines (dispensed), and HbA1c, creatinine and lipid results.
 * - Appointment SMS for today's hero sessions (no clinical content).
 */

import { getBranch, hospital } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import type { AppointmentRow, Ms, PatientRow, SmsRow } from "@/core/db/schema"

import type { SeedCtx } from "../context"
import { bnDigits } from "../content/bn"
import { HERO } from "../content/hero-ids"
import { templateForSpecialty } from "../content/note-templates"
import { SEED_REFS } from "../content/seed-refs"
import { ACTOR, BRANCH_ACTORS } from "../content/staff"
import { dhakaAt, HOUR, MINUTE } from "../time"
import {
  consultLine,
  createPaidInvoice,
  openBasketLine,
  pickTenders,
  type InvoiceOut,
} from "./billing"
import {
  clearRxLines,
  createEncounter,
  type LabStage,
  createImagingOrder,
  createLabOrder,
  createPrescription,
  dispenseRx,
  inboxItem,
  notify,
  rxBillingLines,
} from "./clinical"
import type { DoctorInfo } from "./org"
import type { PatientPools } from "./patients"
import type { SchedulingOut } from "./scheduling"
import type { StockLedger } from "./stock"

export const RAFIQ_SHIFT_TODAY = "shf_B1_rafiq_today"
const SHIRIN = { id: ACTOR.shirin, councilNo: "PCB-B-10234" }
const RADIOLOGIST = "doc_enamul_kabir"

export function seedToday(
  ctx: SeedCtx,
  sched: SchedulingOut,
  doctors: DoctorInfo[],
  pools: PatientPools,
  ledger: StockLedger
): void {
  const { bag } = ctx
  const rng = ctx.rng("today")
  const doctorById = new Map(doctors.map((d) => [d.id, d]))

  /* ---------------- Rafiq's open shift ---------------- */
  const openedAt = Math.min(ctx.at(0, "08:00"), ctx.now - 3 * HOUR)
  const shift = bag.put("shifts", RAFIQ_SHIFT_TODAY, openedAt, {
    cashierId: ACTOR.rafiq,
    branchId: "B1",
    date: ctx.today,
    openedAt,
    floatP: 5_000_00,
    status: "open",
  })

  /* ---------------- Consult fees for today's B1 appointments ---------------- */
  const feeInvoices = new Map<string, InvoiceOut>()
  for (const a of sched.todayAppointments) {
    if (a.branchId !== "B1" || a.status === "cancelled") continue
    const doctor = doctorById.get(a.doctorId)!
    const followUp = a.visitType === "follow-up"
    const fee = (followUp ? doctor.followUpTaka : doctor.feeTaka) * 100
    const line = consultLine(a.id, doctor, followUp, fee)
    if (a.checkedInAt) {
      const out = createPaidInvoice(ctx, {
        patientId: a.patientId,
        branch: "B1",
        at: a.checkedInAt - 2 * MINUTE,
        cashierId: ACTOR.rafiq,
        shiftId: shift.id,
        lines: [line],
        tenders: pickTenders(rng, fee),
      })
      a.feeBasketLineId = out.basketLines[0].id
      feeInvoices.set(a.id, out)
    } else {
      a.feeBasketLineId = openBasketLine(
        ctx,
        a.patientId,
        "B1",
        a.createdAt,
        line
      ).id
    }
  }

  /* ---------------- Dr. Kamal's two patients seen this morning ---------------- */
  const kamal = doctorById.get(HERO.doctor.kamal)!
  const template = templateForSpecialty("MED")
  const [first, second] = sched.kamalToday.appointments.filter(
    (a) => a.status === "done"
  )
  const tokenCalledAt = (a: AppointmentRow) =>
    bag.get("queueTokens", a.tokenId!).calledAt ?? ctx.now - HOUR

  {
    const patient = pools.byId.get(first.patientId)!
    const start = tokenCalledAt(first) + 2 * MINUTE
    const { encounter } = createEncounter(ctx, {
      appointmentId: first.id,
      patient,
      doctorId: kamal.id,
      doctorStaffId: kamal.staffId,
      branch: "B1",
      startedAt: start,
      endedAt: start + 11 * MINUTE,
      type: first.visitType,
      vitals: {
        bpSys: 128,
        bpDia: 82,
        pulse: 78,
        tempC: 36.8,
        spo2: 98,
        weightKg: 68,
      },
      templateId: template.id,
      sections: {
        chiefComplaint: "Burning pain in the upper abdomen for 2 weeks.",
        history:
          "Pain worse on an empty stomach and at night, eased by food. No vomiting, no black stools, no weight loss. Irregular meals; takes tea on an empty stomach.",
        examination:
          "Looks well. Mild epigastric tenderness. No palpable mass. Chest and heart normal.",
        assessment: "Dyspepsia, likely acid related.",
        plan: "Medicines as prescribed. Regular meals; avoid tea on an empty stomach and oily food. Review in 2 weeks, earlier if vomiting or black stools.",
      },
      diagnoses: [
        { icd10: "K30", label: "Functional dyspepsia", primary: true },
      ],
    })
    const rx = createPrescription(ctx, ledger, {
      encounter,
      doctorStaffId: kamal.staffId,
      signedAt: start + 10 * MINUTE,
      lines: [
        {
          brandId: "brd_sergel_20mg",
          dosePattern: "1+0+1",
          meal: "before",
          days: 14,
        },
        {
          brandId: "brd_motigut_10mg",
          dosePattern: "1+1+1",
          meal: "before",
          days: 7,
        },
      ],
      advice:
        "Take meals on time. Avoid tea or coffee on an empty stomach, and oily, spicy food.",
      followUpDays: 14,
    })
    const paidAt = start + 17 * MINUTE
    createPaidInvoice(ctx, {
      patientId: patient.id,
      branch: "B1",
      at: paidAt,
      cashierId: ACTOR.rafiq,
      shiftId: shift.id,
      lines: rxBillingLines(ledger, rx.lines),
      tenders: [{ tender: "cash" }],
    })
    clearRxLines(rx.lines, paidAt)
    dispenseRx(ctx, ledger, rx, start + 26 * MINUTE, SHIRIN)
  }

  {
    const patient = pools.byId.get(second.patientId)!
    const start = tokenCalledAt(second) + 2 * MINUTE
    const { encounter } = createEncounter(ctx, {
      appointmentId: second.id,
      patient,
      doctorId: kamal.id,
      doctorStaffId: kamal.staffId,
      branch: "B1",
      startedAt: start,
      endedAt: start + 9 * MINUTE,
      type: second.visitType,
      vitals: {
        bpSys: 118,
        bpDia: 76,
        pulse: 88,
        tempC: 37.9,
        spo2: 97,
        weightKg: 61,
      },
      templateId: template.id,
      sections: {
        chiefComplaint: "Sore throat, runny nose and body ache for 3 days.",
        history:
          "Mild fever, dry cough, sneezing. No breathing difficulty. Two family members had a cold last week.",
        examination:
          "Temperature 37.9 C. Throat congested, no exudate. Chest clear.",
        assessment: "Acute upper respiratory infection, likely viral.",
        plan: "Symptom relief as prescribed. CBC if fever persists beyond 5 days. Plenty of fluids and rest.",
      },
      diagnoses: [
        {
          icd10: "J06.9",
          label: "Acute upper respiratory infection, unspecified",
          primary: true,
        },
      ],
    })
    const rx = createPrescription(ctx, ledger, {
      encounter,
      doctorStaffId: kamal.staffId,
      signedAt: start + 8 * MINUTE,
      lines: [
        {
          brandId: SEED_REFS.brand.fexo120,
          dosePattern: "0+0+1",
          meal: "after",
          days: 7,
        },
        {
          brandId: SEED_REFS.brand.napa500,
          dosePattern: "1+1+1",
          meal: "after",
          days: 3,
        },
      ],
      advice:
        "Drink plenty of fluids and rest. Come back if fever lasts more than 5 days or breathing becomes difficult.",
      followUpDays: 7,
      tests: ["CBC"],
    })
    for (const l of rxBillingLines(ledger, rx.lines))
      openBasketLine(ctx, patient.id, "B1", start + 8 * MINUTE, l)
    createLabOrder(ctx, {
      patient,
      ageYears: pools.age(patient),
      branch: "B1",
      at: start + 8 * MINUTE,
      testIds: [SEED_REFS.test.cbc],
      stage: "ordered",
      source: "doctor",
      doctorId: kamal.id,
      encounterId: encounter.id,
      labtechId: ACTOR.rubel,
    })
  }

  /* ---------------- Lab worklist at every stage ---------------- */
  const labPatients = rng.pickMany(
    pools.adults.filter(
      (p) =>
        p.registeredAtBranch === "B1" &&
        !sched.todayAppointments.some((a) => a.patientId === p.id)
    ),
    8
  )
  const labPlan: [number, string[], LabStage][] = [
    [200, [SEED_REFS.test.lipid, "lt_fbs"], "released"],
    [140, [SEED_REFS.test.tsh], "validated"],
    [95, [SEED_REFS.test.hba1c, SEED_REFS.test.creatinine], "resulted"],
    [60, [SEED_REFS.test.hba1c, "lt_ua"], "received"],
    [32, [SEED_REFS.test.cbc, SEED_REFS.test.esr], "collected"],
    [16, [SEED_REFS.test.urineRe, SEED_REFS.test.rbs], "paid"],
  ]
  labPlan.forEach(([minutesAgo, tests, stage], i) => {
    const patient = labPatients[i]
    const lab = createLabOrder(ctx, {
      patient,
      ageYears: pools.age(patient),
      branch: "B1",
      at: ctx.now - minutesAgo * MINUTE,
      testIds: tests,
      stage,
      source: "counter",
      billing: {
        cashierId: ACTOR.rafiq,
        shiftId: shift.id,
        tenders: pickTenders(rng, 100_000),
      },
      labtechId: ACTOR.rubel,
    })
    if (lab.report) {
      notify(
        ctx,
        patient.id,
        "reportReady",
        { reportId: lab.report.id },
        lab.report.releasedAt!,
        false
      )
      reportReadySms(ctx, patient, lab.report.releasedAt! + MINUTE)
    }
  })
  // B3 (Anika's bench)
  const b3Patients = rng.pickMany(
    pools.adults.filter((p) => p.registeredAtBranch === "B3"),
    2
  )
  createLabOrder(ctx, {
    patient: b3Patients[0],
    ageYears: pools.age(b3Patients[0]),
    branch: "B3",
    at: ctx.now - 70 * MINUTE,
    testIds: [SEED_REFS.test.cbc, SEED_REFS.test.crp],
    stage: "received",
    source: "counter",
    billing: { cashierId: BRANCH_ACTORS.B3.cashier },
    labtechId: ACTOR.anika,
  })
  createLabOrder(ctx, {
    patient: b3Patients[1],
    ageYears: pools.age(b3Patients[1]),
    branch: "B3",
    at: ctx.now - 20 * MINUTE,
    testIds: [SEED_REFS.test.lipid],
    stage: "paid",
    source: "counter",
    billing: { cashierId: BRANCH_ACTORS.B3.cashier },
    labtechId: ACTOR.anika,
  })

  /* ---------------- Ultrasound awaiting its report ---------------- */
  createImagingOrder(ctx, {
    patient: labPatients[6],
    branch: "B1",
    at: ctx.now - 50 * MINUTE,
    testId: SEED_REFS.test.usgWholeAbdomen,
    stage: "paid",
    indication: "Upper abdominal discomfort",
    bodyPart: "Whole abdomen",
    billing: { cashierId: ACTOR.rafiq, shiftId: shift.id },
    radiologistId: RADIOLOGIST,
  })

  /* ---------------- Appointment SMS for today's hero sessions ---------------- */
  for (const a of [
    ...sched.kamalToday.appointments,
    ...sched.arifToday.appointments,
  ]) {
    if (a.source === "walk-in") continue
    const patient = pools.byId.get(a.patientId)!
    const to = patient.phone ?? patient.attendantPhone
    if (!to) continue
    appointmentSms(ctx, patient, a, to)
  }

  seedHeroHistory(ctx, sched, kamal, pools, ledger)
}

function smsParts(
  text: string,
  lang: "en" | "bn"
): { parts: number; encoding: SmsRow["encoding"] } {
  const cfg = rules.smsParts[lang]
  const len = [...text].length
  return {
    parts: len <= cfg.single ? 1 : Math.ceil(len / cfg.multi),
    encoding: lang === "bn" ? "UCS-2" : "GSM",
  }
}

/** Booking confirmation: branch, date, time and serial only (no clinical content). */
export function appointmentSms(
  ctx: SeedCtx,
  patient: PatientRow,
  a: AppointmentRow,
  to: string
): void {
  const lang =
    patient.consents.some((c) => c.purpose === "app" && c.granted) ||
    ctx.rng(`sms:${a.id}`).bool(0.5)
      ? "bn"
      : "en"
  const [y, m, d] = a.date.split("-")
  const branch = getBranch(a.branchId)
  const text =
    lang === "en"
      ? `${hospital.shortName.en}: your appointment at ${branch.name.en} on ${d}-${m}-${y} at ${a.slotStart} is confirmed. Show the QR code at the front desk.`
      : `${hospital.shortName.bn}: ${branch.name.bn} শাখায় ${bnDigits(`${d}-${m}-${y}`)} তারিখ ${bnDigits(a.slotStart)} টায় আপনার অ্যাপয়েন্টমেন্ট নিশ্চিত হয়েছে। ফ্রন্ট ডেস্কে QR কোড দেখান।`
  const { parts, encoding } = smsParts(text, lang)
  const queuedAt = a.createdAt + 5_000
  ctx.bag.put("sms", ctx.seq("sms"), queuedAt, {
    to,
    patientId: patient.id,
    branchId: a.branchId,
    lang,
    templateId: "appointment.confirmed",
    text,
    parts,
    encoding,
    kind: "transactional",
    status: "delivered",
    queuedAt,
    deliveredAt: queuedAt + 2_000,
  })
}

/** "Report ready" SMS: only to an OTP-verified number, never with results. */
export function reportReadySms(
  ctx: SeedCtx,
  patient: PatientRow,
  at: Ms
): void {
  if (!patient.phone || !patient.phoneVerified) return
  const text = `${hospital.shortName.bn}: আপনার একটি রিপোর্ট প্রস্তুত। অ্যাপে বা কাউন্টারে দেখুন।`
  const { parts, encoding } = smsParts(text, "bn")
  ctx.bag.put("sms", ctx.seq("sms"), at, {
    to: patient.phone,
    patientId: patient.id,
    branchId: patient.registeredAtBranch,
    lang: "bn",
    templateId: "report.ready",
    text,
    parts,
    encoding,
    kind: "transactional",
    status: "delivered",
    queuedAt: at,
    deliveredAt: at + 2_000,
  })
}

/** Abdul Karim's previous visit with Dr. Kamal (about three weeks ago). */
function seedHeroHistory(
  ctx: SeedCtx,
  sched: SchedulingOut,
  kamal: DoctorInfo,
  pools: PatientPools,
  ledger: StockLedger
): void {
  const { appointment, session } = sched.abdulHistory
  const abdul = pools.byId.get(HERO.patient.abdulKarim)!
  const date = session.date
  const at = (hhmm: string) => dhakaAt(date, hhmm)

  // Consult fee paid by Tanvir at check-in.
  const fee = createPaidInvoice(ctx, {
    patientId: abdul.id,
    branch: "B1",
    at: at("10:16"),
    cashierId: ACTOR.rafiq,
    lines: [consultLine(appointment.id, kamal, true, kamal.followUpTaka * 100)],
    tenders: [{ tender: "cash" }],
  })
  appointment.feeBasketLineId = fee.basketLines[0].id

  const { encounter } = createEncounter(ctx, {
    appointmentId: appointment.id,
    patient: abdul,
    doctorId: kamal.id,
    doctorStaffId: kamal.staffId,
    branch: "B1",
    startedAt: at("10:32"),
    endedAt: at("10:48"),
    type: "follow-up",
    vitals: {
      bpSys: 148,
      bpDia: 90,
      pulse: 82,
      tempC: 36.8,
      spo2: 98,
      weightKg: 71,
      heightCm: 165,
      rbs: 11.2,
    },
    templateId: "tpl_medicine",
    sections: {
      chiefComplaint:
        "Routine follow-up for diabetes and blood pressure. No new complaints.",
      history:
        "Takes medicines regularly. Home fasting sugar 8 to 10 mmol/L. Walks 20 minutes most days. No chest pain, no numbness of the feet. Known penicillin allergy (rash).",
      examination:
        "BP 148/90 mmHg, pulse 82/min. Feet: pulses present, sensation normal. Chest and heart normal.",
      assessment:
        "Type 2 diabetes, sub-optimally controlled. Essential hypertension, borderline control.",
      plan: "Continue current medicines. HbA1c, creatinine and lipid profile today. Diet and walking advice. Review in 1 month with reports.",
    },
    diagnoses: [
      {
        icd10: "E11.9",
        label: "Type 2 diabetes mellitus without complications",
        primary: true,
      },
      {
        icd10: "I10",
        label: "Essential (primary) hypertension",
        primary: false,
      },
    ],
  })
  const rx = createPrescription(ctx, ledger, {
    encounter,
    doctorStaffId: kamal.staffId,
    signedAt: at("10:47"),
    lines: [
      {
        brandId: SEED_REFS.brand.comet500,
        dosePattern: "1+0+1",
        meal: "after",
        days: 30,
      },
      {
        brandId: SEED_REFS.brand.camlodin5,
        dosePattern: "0+0+1",
        meal: "after",
        days: 30,
      },
    ],
    advice:
      "Avoid sugar and sweets, reduce rice portions and salt. Walk 30 minutes a day. Check fasting sugar at home twice a week.",
    followUpDays: 30,
    tests: ["HbA1c", "S. creatinine", "Lipid profile"],
  })
  const lab = createLabOrder(ctx, {
    patient: abdul,
    ageYears: pools.age(abdul),
    branch: "B1",
    at: at("10:49"),
    testIds: [
      SEED_REFS.test.hba1c,
      SEED_REFS.test.creatinine,
      SEED_REFS.test.lipid,
    ],
    stage: "released",
    source: "doctor",
    doctorId: kamal.id,
    encounterId: encounter.id,
    billing: { cashierId: ACTOR.rafiq, tenders: [{ tender: "bkash" }] },
    values: {
      HBA1C: 8.1,
      CREAT: 1.1,
      CHOL: 212,
      TG: 180,
      HDL: 38,
      LDL: 138,
      VLDL: 36,
    },
    labtechId: ACTOR.rubel,
  })
  const medsAt = at("11:02")
  createPaidInvoice(ctx, {
    patientId: abdul.id,
    branch: "B1",
    at: medsAt,
    cashierId: ACTOR.rafiq,
    lines: rxBillingLines(ledger, rx.lines),
    tenders: [{ tender: "bkash" }],
  })
  clearRxLines(rx.lines, medsAt)
  dispenseRx(ctx, ledger, rx, at("11:15"), SHIRIN)

  const releasedAt = lab.report!.releasedAt!
  inboxItem(ctx, {
    doctorId: kamal.id,
    patientId: abdul.id,
    kind: "abnormal",
    refs: { reportId: lab.report!.id, labOrderId: lab.order.id },
    at: releasedAt,
    status: "acknowledged",
    ackAt: releasedAt + 20 * HOUR,
  })
  notify(
    ctx,
    abdul.id,
    "reportReady",
    { reportId: lab.report!.id },
    releasedAt,
    true
  )
  reportReadySms(ctx, abdul, releasedAt + MINUTE)
}
