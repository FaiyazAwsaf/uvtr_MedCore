import {
  openEncounter,
  payLines,
  pickPatient,
  signedRx,
} from "@/core/scenarios/fixtures"
import type {
  ScenarioDef,
  ScenarioKit,
  ScenarioOutcome,
} from "@/core/scenarios/types"
import type { PatientRow } from "@/core/db/schema"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { plantUsableStock } from "@/modules/inventory/stock"

/**
 * Pharmacy scenario launchers (plan §10): S3 partial dispense and S4 doctor
 * substitution request. Both run on Shirin's window at Dhanmondi (B1). Each
 * run first puts the planted shelf back (with a recorded stock adjustment),
 * then prescribes, signs and pays through the real commands, so the
 * presenter's key action works every time the launcher is run.
 */

const PHARMACIST = "per_pharmacist_shirin"
const BRANCH = "B1"
const B = SEED_REFS.brand

/** DD-MM-YYYY with Latin digits, as the identity check accepts it. */
const dmy = (iso: string) => iso.split("-").reverse().join("-")

/** What the cue card tells the presenter to type at the identity check. */
function identityParams(patient: PatientRow) {
  const digits = (patient.phone ?? "").replace(/\D/g, "")
  return {
    name: patient.nameEn,
    nameBn: patient.nameBn,
    dob: dmy(patient.dob),
    phoneTail: digits.slice(-4),
  }
}

/** S3: Seclo 20 for 28 capsules when the shelf holds exactly 14. */
async function setupPartialDispense(
  kit: ScenarioKit
): Promise<ScenarioOutcome> {
  await kit.fixture(
    "Seclo 20: 14 on the shelf at B1",
    (tx) =>
      plantUsableStock(tx, BRANCH, B.seclo20, 14, {
        reason: "Demo setup S3: only 14 Seclo 20 on the shelf at Dhanmondi",
      }),
    PHARMACIST
  )
  // Tanvir holds the patient-app account, so his own app shows the balance.
  // He has no recorded allergies, so omeprazole raises no allergy alert.
  const db = await kit.db()
  const patient = await db.patients.get(HERO.patient.tanvirKarim)
  if (!patient) throw new Error("S3: the hero patient Tanvir Karim is missing")
  const encounterId = await openEncounter(kit, { patientId: patient.id })
  const rx = await signedRx(kit, {
    encounterId,
    lines: [
      {
        brandId: B.seclo20,
        dosePattern: "1+0+1",
        mealTiming: "before",
        durationDays: 14,
        qtyPrescribed: 28,
      },
    ],
  })
  // rx.sign billed what is on the shelf (14 of 28): the patient pays that now.
  if (!rx.basketLineIds.length)
    throw new Error("S3: nothing was billed for Seclo 20")
  await payLines(kit, {
    patientId: patient.id,
    basketLineIds: rx.basketLineIds,
  })
  return {
    refs: {
      patientId: patient.id,
      encounterId,
      rxId: rx.rxId,
      rxLineId: rx.lineIds[0],
    },
    params: { ...identityParams(patient), rxNo: rx.rxNo },
  }
}

/**
 * S4: an Rx with Monas 10 while it is out at B1. rx.sign billed only the
 * companion line (Fexo 120, in stock), which the patient pays; the Monas
 * line has nothing billed and waits for the pharmacist's substitution request.
 */
async function setupSubstitution(kit: ScenarioKit): Promise<ScenarioOutcome> {
  await kit.fixture(
    "Monas 10 out at B1; Lumona 10, Montair 10 and Fexo 120 on the shelf",
    async (tx) => {
      const reason =
        "Demo setup S4: Monas 10 out at Dhanmondi, same-strength brands in stock"
      await plantUsableStock(tx, BRANCH, B.monas10, 0, { reason })
      for (const brandId of [B.lumona10, B.montair10]) {
        await plantUsableStock(tx, BRANCH, brandId, 30, {
          reason,
          mode: "at-least",
        })
      }
      await plantUsableStock(tx, BRANCH, B.fexo120, 14, {
        reason,
        mode: "at-least",
      })
    },
    PHARMACIST
  )
  const filters = {
    branch: BRANCH,
    minAge: 18,
    noAllergies: true,
    selfPay: true,
    verifiedPhone: true,
  } as const
  // The first match is S2's patient (same filters): take the next one, so the
  // two stock scenarios show different people.
  const first = await pickPatient(kit, filters)
  const patient = await pickPatient(kit, { ...filters, exclude: [first.id] })
  const encounterId = await openEncounter(kit, { patientId: patient.id })
  const rx = await signedRx(kit, {
    encounterId,
    lines: [
      {
        brandId: B.fexo120,
        dosePattern: "0+0+1",
        mealTiming: "after",
        durationDays: 14,
      },
      {
        brandId: B.monas10,
        dosePattern: "0+0+1",
        mealTiming: "after",
        durationDays: 30,
      },
    ],
  })
  if (!rx.basketLineIds.length)
    throw new Error("S4: nothing was billed for Fexo 120")
  await payLines(kit, {
    patientId: patient.id,
    basketLineIds: rx.basketLineIds,
  })
  return {
    refs: {
      patientId: patient.id,
      encounterId,
      rxId: rx.rxId,
      rxLineId: rx.lineIds[1],
    },
    params: { ...identityParams(patient), rxNo: rx.rxNo },
  }
}

const cues = (id: string, count: number) =>
  Array.from(
    { length: count },
    (_, i) => `pharmacy.scenarios.${id}.cue.${i + 1}`
  )

/** Scenario launchers owned by this module (plan §10). */
export const pharmacyScenarios: ScenarioDef[] = [
  {
    id: "S3",
    kind: "scenario",
    module: "pharmacy",
    titleKey: "pharmacy.scenarios.S3.title",
    summaryKey: "pharmacy.scenarios.S3.summary",
    persona: PHARMACIST,
    setup: setupPartialDispense,
    route: ({ refs }) => `/pharmacy/dispense/${refs?.rxId}`,
    cueKeys: cues("S3", 5),
  },
  {
    id: "S4",
    kind: "scenario",
    module: "pharmacy",
    titleKey: "pharmacy.scenarios.S4.title",
    summaryKey: "pharmacy.scenarios.S4.summary",
    persona: PHARMACIST,
    setup: setupSubstitution,
    route: ({ refs }) => `/pharmacy/dispense/${refs?.rxId}`,
    cueKeys: cues("S4", 5),
  },
]
