import { ageOn } from "@/core/clock/dates"
import type {
  BasketLineRow,
  BranchCode,
  Id,
  PatientRow,
} from "@/core/db/schema"
import { RuleViolation } from "@/core/engine/errors"
import { HERO } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import {
  checkout,
  confirmMfs,
  openShift,
  type CheckoutResult,
} from "@/modules/billing/commands"
import {
  collectSpecimen,
  importAnalyserResults,
  receiveSpecimen,
  signAndRelease,
  validateItem,
} from "@/modules/lab/commands"
import { placeImaging, placeTests } from "@/modules/orders/commands"
import {
  addRxLine,
  signRx,
  type RxLineInput,
} from "@/modules/prescribing/commands"

import type { ScenarioKit } from "./types"

/**
 * Shared building blocks for launcher setups (plan §10). Each one drives the
 * real commands of the owning module as the right persona, so the data a
 * launcher prepares is exactly what the screens would have produced.
 *
 * None of them books into a clinic session: background visits use an
 * encounter of their own (`openEncounter`), so re-running launchers never
 * uses up the places the hero journey needs in Dr. Kamal's session.
 */

/** The cashier who takes setup payments, so Rafiq's shift (the hero's) is untouched. */
export const SETUP_CASHIER = "per_cashier_nasrin"
export const SETUP_DOCTOR = "per_doctor_kamal"
export const SETUP_LABTECH = "per_labtech_rubel"
export const SETUP_PATHOLOGIST = "per_pathologist_mizanur"

const HERO_IDS = new Set<string>(Object.values(HERO.patient))

function staffIdOf(personaId: string): string {
  const staffId = findPersona(personaId)?.staff?.id
  if (!staffId) throw new Error(`${personaId} is not a staff persona`)
  return staffId
}

/**
 * A seeded patient for a launcher: active, not in the hero family, at the
 * branch, and matching the filters. Deterministic for a given seed day
 * (first by id), so a launcher picks the same person when re-run.
 */
export async function pickPatient(
  kit: ScenarioKit,
  opts: {
    branch?: BranchCode
    minAge?: number
    maxAge?: number
    sex?: PatientRow["sex"]
    /** No recorded allergies */
    noAllergies?: boolean
    /** Not a corporate employee or dependant */
    selfPay?: boolean
    /** Has a verified mobile number (for SMS) */
    verifiedPhone?: boolean
    exclude?: Id[]
  } = {}
): Promise<PatientRow> {
  const db = await kit.db()
  const today = kit.today()
  const exclude = new Set(opts.exclude ?? [])
  const all = await db.patients.orderBy("id").toArray()
  const patient = all.find(
    (p) =>
      p.identityStatus === "active" &&
      !p.mergedInto &&
      !HERO_IDS.has(p.id) &&
      !exclude.has(p.id) &&
      !p.id.startsWith("pat_dup_") &&
      (!opts.branch || p.registeredAtBranch === opts.branch) &&
      (opts.minAge === undefined || ageOn(p.dob, today) >= opts.minAge) &&
      (opts.maxAge === undefined || ageOn(p.dob, today) <= opts.maxAge) &&
      (!opts.sex || p.sex === opts.sex) &&
      (!opts.noAllergies || p.allergies.length === 0) &&
      (!opts.selfPay || !p.corporateEmployeeId) &&
      (!opts.verifiedPhone || (!!p.phone && p.phoneVerified))
  )
  if (!patient)
    throw new Error("No seeded patient matches the launcher's filters")
  return patient
}

/**
 * A fresh open encounter between a patient and a doctor at the doctor's
 * branch, as `consult.start` leaves it, but without an appointment.
 */
export async function openEncounter(
  kit: ScenarioKit,
  opts: { patientId: Id; doctorPersona?: string; type?: "first" | "follow-up" }
): Promise<Id> {
  const doctorPersona = opts.doctorPersona ?? SETUP_DOCTOR
  const staffId = staffIdOf(doctorPersona)
  return kit.fixture(
    "open encounter",
    async (tx) => {
      const [doctor] = await tx.list("doctors", "staffId", staffId)
      if (!doctor) throw new Error(`No doctor record for ${staffId}`)
      const encounter = tx.insert("encounters", {
        patientId: opts.patientId,
        doctorId: doctor.id,
        branchId: tx.actor.branchId ?? "B1",
        mode: "in-person",
        type: opts.type ?? "first",
        status: "open",
        startedAt: tx.now(),
      })
      tx.emit("EncounterStarted", {
        refs: { patientId: opts.patientId, encounterId: encounter.id },
        params: { token: "" },
      })
      return encounter.id
    },
    doctorPersona
  )
}

/**
 * Prescribe and sign through `rx.addLine` and `rx.sign` as the doctor: the Rx
 * reaches the pharmacy queue, the billing basket (what is on the shelf) and
 * the patient app, exactly as from the Rx pad.
 */
export async function signedRx(
  kit: ScenarioKit,
  opts: {
    encounterId: Id
    lines: RxLineInput[]
    doctorPersona?: string
    /**
     * Alert acknowledgements. Default: duplicate order and critical value are
     * acknowledged (a re-run prescribes the same medicine again); an allergy
     * is never overridden unless asked, with a reason.
     */
    overrides?: {
      kind: "allergy" | "duplicate" | "critical"
      reason?: string
    }[]
  }
): Promise<{ rxId: Id; rxNo: string; lineIds: Id[]; basketLineIds: Id[] }> {
  const doctor = opts.doctorPersona ?? SETUP_DOCTOR
  let rxId = ""
  const lineIds: Id[] = []
  for (const line of opts.lines) {
    const added = await kit.run(
      addRxLine,
      {
        encounterId: opts.encounterId,
        line,
        overrides: opts.overrides ?? [
          { kind: "duplicate" },
          { kind: "critical" },
        ],
      },
      doctor
    )
    rxId = added.rxId
    lineIds.push(added.lineId)
  }
  const signed = await kit.run(signRx, { rxId, smsLang: "bn" }, doctor)
  return {
    rxId,
    rxNo: signed.rxNo,
    lineIds,
    basketLineIds: signed.basketLineIds,
  }
}

/** Order lab tests through `orders.placeTests` as the doctor. */
export async function orderTests(
  kit: ScenarioKit,
  opts: {
    patientId: Id
    encounterId?: Id
    testIds: Id[]
    doctorPersona?: string
  }
): Promise<{ labOrderId: Id; orderNo: string; itemIds: Id[] }> {
  const result = await kit.run(
    placeTests,
    {
      patientId: opts.patientId,
      encounterId: opts.encounterId,
      testIds: opts.testIds,
    },
    opts.doctorPersona ?? SETUP_DOCTOR
  )
  return {
    labOrderId: result.labOrderId,
    orderNo: result.orderNo,
    itemIds: result.itemIds,
  }
}

/** Order one imaging test through `orders.placeImaging` as the doctor. */
export async function orderImaging(
  kit: ScenarioKit,
  opts: {
    patientId: Id
    encounterId?: Id
    testId: Id
    indication?: string
    doctorPersona?: string
  }
) {
  return kit.run(
    placeImaging,
    {
      patientId: opts.patientId,
      encounterId: opts.encounterId,
      testIds: [opts.testId],
      indication: opts.indication ?? "Clinical review",
    },
    opts.doctorPersona ?? SETUP_DOCTOR
  )
}

/** A patient's open basket lines at a branch (optionally from given sources). */
export async function openLines(
  kit: ScenarioKit,
  opts: { patientId: Id; branch?: BranchCode; sourceIds?: Id[] }
): Promise<BasketLineRow[]> {
  const db = await kit.db()
  const branch = opts.branch ?? "B1"
  const wanted = opts.sourceIds ? new Set(opts.sourceIds) : undefined
  return (
    await db.basketLines
      .where("[patientId+status]")
      .equals([opts.patientId, "open"])
      .toArray()
  ).filter(
    (line) => line.branchId === branch && (!wanted || wanted.has(line.sourceId))
  )
}

/** Make sure a cashier has an open shift at their branch. */
export async function ensureOpenShift(
  kit: ScenarioKit,
  cashierPersona: string = SETUP_CASHIER,
  floatP = 500_000
): Promise<void> {
  const persona = findPersona(cashierPersona)
  const db = await kit.db(cashierPersona)
  const open = (
    await db.shifts
      .where("cashierId")
      .equals(staffIdOf(cashierPersona))
      .toArray()
  ).some((s) => s.status === "open" && s.branchId === persona?.branchId)
  if (!open) await kit.run(openShift, { floatP }, cashierPersona)
}

/**
 * Pay basket lines in full at the counter through `billing.checkout` (as
 * Nasrin unless told otherwise). bKash and Nagad are approved straight away
 * through `billing.confirmMfs`, so the payment gate opens in both cases.
 */
export async function payLines(
  kit: ScenarioKit,
  opts: {
    patientId: Id
    basketLineIds: Id[]
    tender?: "cash" | "bkash" | "nagad"
    cashierPersona?: string
  }
): Promise<CheckoutResult> {
  const cashier = opts.cashierPersona ?? SETUP_CASHIER
  const tender = opts.tender ?? "cash"
  await ensureOpenShift(kit, cashier)
  const db = await kit.db(cashier)
  const lines = await db.basketLines.bulkGet(opts.basketLineIds)
  const guessP = lines.reduce(
    (sum, line) => sum + (line ? line.qty * line.unitPriceP : 0),
    0
  )
  const pay = (amountP: number) =>
    kit.run(
      checkout,
      {
        patientId: opts.patientId,
        basketLineIds: opts.basketLineIds,
        tenders: amountP > 0 ? [{ tender, amountP }] : [],
        smsLang: "bn",
        idempotencyKey:
          `setup:${kit.scenarioId}:${opts.basketLineIds.join(",")}`.slice(
            0,
            80
          ),
      },
      cashier
    )
  let result: CheckoutResult
  try {
    result = await pay(guessP)
  } catch (error) {
    // Corporate cover and rounding change what the patient owes: pay that.
    if (!(error instanceof RuleViolation) || error.code !== "TENDER_MISMATCH")
      throw error
    result = await pay(Number(error.params.dueP))
  }
  for (const paymentId of result.pendingPaymentIds) {
    await kit.run(confirmMfs, { paymentId, smsLang: "bn" }, cashier)
  }
  return result
}

export type LabStage =
  "collected" | "received" | "resulted" | "validated" | "released"
const STAGES: LabStage[] = [
  "collected",
  "received",
  "resulted",
  "validated",
  "released",
]

/**
 * Walk a paid lab order to a stage with the lab's real commands: collection
 * (second identifier: the patient's date of birth), reception, analyser
 * import, technical validation, then the pathologist's sign and release.
 * Tests the analyser cannot run need manual entry and are not handled here.
 */
export async function advanceLab(
  kit: ScenarioKit,
  opts: {
    labOrderId: Id
    to: LabStage
    labtechPersona?: string
    pathologistPersona?: string
  }
): Promise<{ specimenIds: Id[]; itemIds: Id[]; reportId?: Id }> {
  const labtech = opts.labtechPersona ?? SETUP_LABTECH
  const pathologist = opts.pathologistPersona ?? SETUP_PATHOLOGIST
  const reach = (stage: LabStage) =>
    STAGES.indexOf(opts.to) >= STAGES.indexOf(stage)
  const db = await kit.db(labtech)
  const specimens = await db.specimens
    .where("labOrderId")
    .equals(opts.labOrderId)
    .toArray()
  const items = await db.labOrderItems
    .where("labOrderId")
    .equals(opts.labOrderId)
    .toArray()
  const patient = await db.patients.get(
    specimens[0]?.patientId ?? items[0]?.patientId ?? ""
  )

  for (const specimen of specimens) {
    if (reach("collected") && specimen.status === "awaiting-collection") {
      await kit.run(
        collectSpecimen,
        { specimenId: specimen.id, secondIdentifier: patient?.dob ?? "" },
        labtech
      )
    }
    if (
      reach("received") &&
      ["awaiting-collection", "collected"].includes(specimen.status)
    ) {
      await kit.run(receiveSpecimen, { specimenId: specimen.id }, labtech)
    }
    if (reach("resulted")) {
      await kit.run(importAnalyserResults, { specimenId: specimen.id }, labtech)
    }
  }
  if (reach("validated")) {
    for (const item of items)
      await kit.run(validateItem, { itemId: item.id }, labtech)
  }
  let reportId: Id | undefined
  if (reach("released")) {
    const released = await kit.run(
      signAndRelease,
      { labOrderId: opts.labOrderId, smsLang: "bn" },
      pathologist
    )
    reportId = released.reportId
  }
  return {
    specimenIds: specimens.map((s) => s.id),
    itemIds: items.map((i) => i.id),
    reportId,
  }
}
