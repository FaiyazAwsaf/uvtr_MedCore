import { rules } from "@/config/rules.config"
import { HOUR, MINUTE } from "@/core/clock/dates"
import type { Id } from "@/core/db/schema"
import {
  advanceLab,
  openEncounter,
  openLines,
  orderTests,
  payLines,
  pickPatient,
  SETUP_DOCTOR,
  SETUP_LABTECH,
  SETUP_PATHOLOGIST,
} from "@/core/scenarios/fixtures"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { SEED_REFS } from "@/core/seed/content"
import { TSH_UNIT_ERROR } from "@/core/seed/content/analyser-scripts"

import {
  enterManualResults,
  requestAddOn,
  signAndRelease,
  validateItem,
} from "./commands"
import { addOnCheck } from "./logic"

/**
 * Laboratory and pathology launchers (plan §10): S5 sample rejection, S6
 * and S6B add-on tests, S7 critical call log with escalation, S8 corrected
 * report. Each setup drives the real commands (doctor order, cashier
 * payment, lab and pathology steps) on fresh orders and specimens, so every
 * launcher runs again and again with its key action working each time.
 */

/** Named scenario people, kept for their own launchers. */
const SCENARIO_PEOPLE: Id[] = Object.values(SEED_REFS.patient)

/** A fresh encounter with Dr. Kamal, a test order and its payment at the counter. */
async function paidOrder(kit: ScenarioKit, patientId: Id, testIds: Id[]) {
  const encounterId = await openEncounter(kit, { patientId })
  const order = await orderTests(kit, { patientId, encounterId, testIds })
  const lines = await openLines(kit, { patientId, sourceIds: order.itemIds })
  await payLines(kit, { patientId, basketLineIds: lines.map((l) => l.id) })
  return order
}

/**
 * An adult at Dhanmondi with a verified phone who agreed to SMS, so the
 * rejection's SMS is actually sent (the seed leaves some without consent).
 */
async function pickSmsPatient(kit: ScenarioKit) {
  const exclude = [...SCENARIO_PEOPLE]
  for (let tries = 0; tries < 50; tries++) {
    const patient = await pickPatient(kit, {
      branch: "B1",
      minAge: 18,
      selfPay: true,
      verifiedPhone: true,
      exclude,
    })
    const sms = patient.consents.find((c) => c.purpose === "sms")
    if (sms?.granted !== false) return patient
    exclude.push(patient.id)
  }
  throw new Error("No seeded patient with SMS consent for S5")
}

async function staffNames(kit: ScenarioKit, staffId: Id | undefined) {
  const db = await kit.db()
  const row = staffId ? await db.staff.get(staffId) : undefined
  return { en: row?.nameEn ?? "", bn: row?.nameBn ?? "" }
}

/**
 * S6 and S6B: a serum sample (serum electrolytes) collected `hoursAgo` hours
 * ago and already run, and Dr. Kamal's request to add serum creatinine.
 */
async function addOnSetup(kit: ScenarioKit, hoursAgo: number) {
  const patient = await pickPatient(kit, {
    branch: "B1",
    minAge: 40,
    selfPay: true,
    exclude: SCENARIO_PEOPLE,
  })
  const order = await paidOrder(kit, patient.id, [
    SEED_REFS.test.electrolytes,
  ])
  const { specimenIds } = await advanceLab(kit, {
    labOrderId: order.labOrderId,
    to: "resulted",
  })
  const specimenId = specimenIds[0]
  await kit.fixture("backdate the collection", async (tx) => {
    const collectedAt = tx.now() - hoursAgo * HOUR
    await tx.update("specimens", specimenId, {
      collectedAt,
      receivedAt: collectedAt + 20 * MINUTE,
    })
  })
  const request = await kit.run(
    requestAddOn,
    {
      specimenId,
      testId: SEED_REFS.test.creatinine,
      note: "Please add creatinine to the sample already taken",
    },
    SETUP_DOCTOR
  )
  const db = await kit.db()
  const specimen = (await db.specimens.get(specimenId))!
  const test = (await db.labTests.get(SEED_REFS.test.creatinine))!
  const check = addOnCheck({ specimen, test, now: kit.now() })
  return {
    refs: {
      patientId: patient.id,
      labOrderId: order.labOrderId,
      specimenId,
      labItemId: request.itemId,
    },
    params: {
      name: patient.nameEn,
      nameBn: patient.nameBn,
      accessionNo: specimen.accessionNo,
      hours: Math.round(check.hours),
      stability: check.stabilityHours,
      remainingMl: check.remainingMl,
      neededMl: check.neededMl,
    },
  }
}

export const labScenarios: ScenarioDef[] = [
  {
    id: "S5",
    kind: "scenario",
    module: "lab",
    titleKey: "lab.scenarios.S5.title",
    summaryKey: "lab.scenarios.S5.summary",
    persona: SETUP_LABTECH,
    async setup(kit) {
      const patient = await pickSmsPatient(kit)
      const order = await paidOrder(kit, patient.id, [SEED_REFS.test.cbc])
      const { specimenIds } = await advanceLab(kit, {
        labOrderId: order.labOrderId,
        to: "collected",
      })
      const db = await kit.db()
      const specimen = (await db.specimens.get(specimenIds[0]))!
      return {
        refs: {
          patientId: patient.id,
          labOrderId: order.labOrderId,
          specimenId: specimen.id,
        },
        params: {
          name: patient.nameEn,
          nameBn: patient.nameBn,
          accessionNo: specimen.accessionNo,
        },
      }
    },
    route: ({ refs }) => `/lab/reception?focus=${refs?.specimenId ?? ""}`,
    cueKeys: [
      "lab.scenarios.S5.cue.1",
      "lab.scenarios.S5.cue.2",
      "lab.scenarios.S5.cue.3",
      "lab.scenarios.S5.cue.4",
    ],
  },
  {
    id: "S6",
    kind: "scenario",
    module: "lab",
    titleKey: "lab.scenarios.S6.title",
    summaryKey: "lab.scenarios.S6.summary",
    persona: SETUP_LABTECH,
    setup: (kit) => addOnSetup(kit, 2),
    route: ({ refs }) => `/lab/reception?focus=${refs?.labItemId ?? ""}`,
    cueKeys: [
      "lab.scenarios.S6.cue.1",
      "lab.scenarios.S6.cue.2",
      "lab.scenarios.S6.cue.3",
      "lab.scenarios.S6.cue.4",
    ],
  },
  {
    id: "S6B",
    kind: "scenario",
    module: "lab",
    titleKey: "lab.scenarios.S6B.title",
    summaryKey: "lab.scenarios.S6B.summary",
    persona: SETUP_LABTECH,
    // Serum creatinine keeps 48 hours in a stored sample: this one is older.
    setup: (kit) => addOnSetup(kit, 52),
    route: ({ refs }) => `/lab/reception?focus=${refs?.labItemId ?? ""}`,
    cueKeys: [
      "lab.scenarios.S6B.cue.1",
      "lab.scenarios.S6B.cue.2",
      "lab.scenarios.S6B.cue.3",
      "lab.scenarios.S6B.cue.4",
    ],
  },
  {
    id: "S7",
    kind: "scenario",
    module: "lab",
    titleKey: "lab.scenarios.S7.title",
    summaryKey: "lab.scenarios.S7.summary",
    persona: SETUP_PATHOLOGIST,
    async setup(kit) {
      const patientId = SEED_REFS.patient.jahanara
      const order = await paidOrder(kit, patientId, [
        SEED_REFS.test.potassium,
      ])
      const { itemIds } = await advanceLab(kit, {
        labOrderId: order.labOrderId,
        to: "validated",
      })
      const db = await kit.db()
      const [result] = await db.results
        .where("labOrderItemId")
        .equals(itemIds[0])
        .toArray()
      const patient = (await db.patients.get(patientId))!
      const ordering = await staffNames(kit, kit.actor(SETUP_DOCTOR).staffId)
      const duty = (await db.doctors.toArray())
        .filter((d) => d.isDutyDoctor)
        .sort((a, b) => a.id.localeCompare(b.id))
        .find((d) => d.branchIds.includes("B1"))
      const dutyName = await staffNames(kit, duty?.staffId)
      return {
        refs: {
          patientId,
          labOrderId: order.labOrderId,
          resultId: result.id,
        },
        params: {
          name: patient.nameEn,
          nameBn: patient.nameBn,
          value: result.value ?? "",
          doctor: ordering.en,
          doctorBn: ordering.bn,
          duty: dutyName.en,
          dutyBn: dutyName.bn,
          minutes: rules.criticalEscalationMin,
        },
      }
    },
    route: ({ refs }) =>
      `/pathology?tab=critical&focus=${refs?.resultId ?? ""}`,
    cueKeys: [
      "lab.scenarios.S7.cue.1",
      "lab.scenarios.S7.cue.2",
      "lab.scenarios.S7.cue.3",
      "lab.scenarios.S7.cue.4",
      "lab.scenarios.S7.cue.5",
    ],
  },
  {
    id: "S8",
    kind: "scenario",
    module: "lab",
    titleKey: "lab.scenarios.S8.title",
    summaryKey: "lab.scenarios.S8.summary",
    persona: SETUP_PATHOLOGIST,
    async setup(kit) {
      const patientId = TSH_UNIT_ERROR.patientId
      const order = await paidOrder(kit, patientId, [TSH_UNIT_ERROR.testId])
      await advanceLab(kit, { labOrderId: order.labOrderId, to: "received" })
      const itemId = order.itemIds[0]
      // The unit error happened at result entry: typed by hand, then checked
      // by a second person as manual results must be, and released as v1.
      await kit.run(
        enterManualResults,
        {
          itemId,
          values: [
            {
              analyteCode: TSH_UNIT_ERROR.analyteCode,
              value: TSH_UNIT_ERROR.v1.value,
            },
          ],
        },
        SETUP_LABTECH
      )
      const db = await kit.db()
      const typist = kit.actor(SETUP_LABTECH).staffId
      const checker =
        (await db.staff.where("role").equals("labtech").toArray())
          .filter((s) => s.branchId === "B1" && s.id !== typist)
          .sort((a, b) => a.id.localeCompare(b.id))[0]?.id ??
        kit.actor(SETUP_PATHOLOGIST).staffId
      await kit.run(
        validateItem,
        { itemId, secondCheckBy: checker },
        SETUP_LABTECH
      )
      const released = await kit.run(
        signAndRelease,
        { labOrderId: order.labOrderId, smsLang: "bn" },
        SETUP_PATHOLOGIST
      )
      const patient = (await db.patients.get(patientId))!
      return {
        refs: {
          patientId,
          labOrderId: order.labOrderId,
          reportId: released.reportId,
        },
        params: {
          name: patient.nameEn,
          nameBn: patient.nameBn,
          reportNo: released.reportNo,
          from: TSH_UNIT_ERROR.v1.value,
          to: TSH_UNIT_ERROR.v2.value,
          unit: TSH_UNIT_ERROR.v1.unit,
        },
      }
    },
    route: ({ refs }) =>
      `/pathology?tab=released&focus=${refs?.reportId ?? ""}`,
    cueKeys: [
      "lab.scenarios.S8.cue.1",
      "lab.scenarios.S8.cue.2",
      "lab.scenarios.S8.cue.3",
      "lab.scenarios.S8.cue.4",
      "lab.scenarios.S8.cue.5",
    ],
  },
]
