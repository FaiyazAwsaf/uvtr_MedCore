import { newId } from "@/core/db/ids"
import type { Id, Poisha } from "@/core/db/schema"
import {
  advanceLab,
  ensureOpenShift,
  openEncounter,
  orderImaging,
  orderTests,
  payLines,
  pickPatient,
  SETUP_CASHIER,
} from "@/core/scenarios/fixtures"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { SEED_REFS } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { formatMoney } from "@/lib/i18n/format"

import { checkout, closeShift, confirmMfs, openShift } from "./commands"
import { openShiftFor, shiftSummary } from "./queries"
import { denominationsFor } from "./shift"

/**
 * Billing launchers (plan §10): S9 cancellation after payment by stage, S10
 * refund to the original tender, S13 cashier variance at shift close. Each
 * setup drives the real commands (orders as the doctor, payment at the
 * counter, the lab's own steps) and creates fresh records, so every launcher
 * can run again and again.
 */

/** The presenter's cashier in all three scenarios, and the hero's. */
const RAFIQ = "per_cashier_rafiq"
const RAFIQ_FLOAT_P: Poisha = 5_000_00
/** S13: what Rafiq's drawer should hold when the presenter counts it */
const S13_EXPECTED_P: Poisha = 48_350_00
/** S13: what the presenter counts (40 × 1,000, 10 × 500, 20 × 100, 2 × 50) */
const S13_COUNTED_P: Poisha = 47_100_00

const money = (poisha: Poisha, key: string) => ({
  [key]: formatMoney(poisha, "en"),
  [`${key}Bn`]: formatMoney(poisha, "bn"),
})

async function patientNames(kit: ScenarioKit, patientId: Id) {
  const db = await kit.db()
  const patient = await db.patients.get(patientId)
  if (!patient) throw new Error(`Seeded patient ${patientId} is missing`)
  return { name: patient.nameEn, nameBn: patient.nameBn }
}

/** S9: three tests as separate orders, paid half by bKash and half in cash. */
async function setupS9(kit: ScenarioKit) {
  const patientId = SEED_REFS.patient.nasima
  // Cash parts of the refunds come out of the presenter's drawer.
  await ensureOpenShift(kit, RAFIQ, RAFIQ_FLOAT_P)
  const encounterId = await openEncounter(kit, { patientId })
  // Separate orders, so each test has its own tube and its own stage.
  const lipid = await orderTests(kit, {
    patientId,
    encounterId,
    testIds: [SEED_REFS.test.lipid],
  })
  const hba1c = await orderTests(kit, {
    patientId,
    encounterId,
    testIds: [SEED_REFS.test.hba1c],
  })
  const cbc = await orderTests(kit, {
    patientId,
    encounterId,
    testIds: [SEED_REFS.test.cbc],
  })

  const db = await kit.db(SETUP_CASHIER)
  const items = await db.labOrderItems.bulkGet([
    ...lipid.itemIds,
    ...hba1c.itemIds,
    ...cbc.itemIds,
  ])
  const basketLineIds = items.map((item) => item?.basketLineId ?? "")
  const lines = await db.basketLines.bulkGet(basketLineIds)
  const totalP = lines.reduce(
    (sum, line) => sum + (line ? line.qty * line.unitPriceP : 0),
    0
  )
  const bkashP = Math.round(totalP / 2 / 100) * 100
  await ensureOpenShift(kit, SETUP_CASHIER)
  const paid = await kit.run(
    checkout,
    {
      patientId,
      basketLineIds,
      tenders: [
        { tender: "bkash", amountP: bkashP },
        { tender: "cash", amountP: totalP - bkashP },
      ],
      smsLang: "bn",
      idempotencyKey: `setup:S9:${basketLineIds.join(",")}`.slice(0, 80),
    },
    SETUP_CASHIER
  )
  for (const paymentId of paid.pendingPaymentIds) {
    await kit.run(confirmMfs, { paymentId, smsLang: "bn" }, SETUP_CASHIER)
  }

  await advanceLab(kit, { labOrderId: hba1c.labOrderId, to: "collected" })
  await advanceLab(kit, { labOrderId: cbc.labOrderId, to: "validated" })
  return {
    refs: { patientId, invoiceId: paid.invoiceId },
    params: await patientNames(kit, patientId),
  }
}

/** S10: an ultrasound paid by bKash; the radiologist's share accrues on collection. */
async function setupS10(kit: ScenarioKit) {
  const patientId = SEED_REFS.patient.kamrul
  const encounterId = await openEncounter(kit, { patientId })
  const { orders } = await orderImaging(kit, {
    patientId,
    encounterId,
    testId: SEED_REFS.test.usgWholeAbdomen,
    indication: "Upper abdominal pain for two weeks",
  })
  const [order] = orders
  const paid = await payLines(kit, {
    patientId,
    basketLineIds: [order.basketLineId],
    tender: "bkash",
  })
  const db = await kit.db(SETUP_CASHIER)
  const accruals = await db.feeShareAccruals
    .where("invoiceId")
    .equals(paid.invoiceId)
    .count()
  if (!accruals) throw new Error("S10 setup: no radiologist fee share accrued")
  return {
    refs: {
      patientId,
      invoiceId: paid.invoiceId,
      imagingOrderId: order.imagingOrderId,
    },
    params: {
      ...(await patientNames(kit, patientId)),
      ...money(paid.totalP, "amount"),
      invoiceNo: paid.invoiceNo,
    },
  }
}

/** Counter services for S13's planted cash takings (priced to reach the target). */
const COUNTER_SERVICES = [
  {
    en: "Executive health check package",
    bn: "এক্সিকিউটিভ হেলথ চেকআপ প্যাকেজ",
  },
  { en: "Pre-employment medical check", bn: "চাকরিপূর্ব মেডিকেল চেকআপ" },
  { en: "Family health check package", bn: "পারিবারিক হেলথ চেকআপ প্যাকেজ" },
] as const

/** Splits a cash amount over up to three counter sales, whole hundreds first. */
function takingsFor(gapP: Poisha): Poisha[] {
  if (gapP < 3_000_00) return [gapP]
  const first = Math.round((gapP * 0.45) / 100_00) * 100_00
  const second = Math.round((gapP * 0.35) / 100_00) * 100_00
  return [first, second, gapP - first - second]
}

/**
 * S13: Rafiq's open shift expecting exactly ৳48,350. His shift is opened if
 * he has none. If it already holds more than that (earlier work today), he
 * hands it over first: it closes on an exact count and a fresh shift opens.
 * Then real cash sales at his counter make up the difference: counter
 * health-check services for seeded patients, paid in cash through
 * `billing.checkout` on his shift. Re-running finds the target already met
 * (nothing to add) or a closed shift (a new one is opened and filled).
 */
async function setupS13(kit: ScenarioKit) {
  const db = await kit.db(RAFIQ)
  const persona = findPersona(RAFIQ)!
  const cashierId = persona.staff!.id
  const branch = persona.branchId!
  const expectedNow = async () => {
    const shift = await openShiftFor(db, cashierId, branch)
    if (!shift) throw new Error("S13 setup: Rafiq has no open shift")
    return {
      shift,
      expectedP: (await shiftSummary(db, shift)).expectedCashP,
    }
  }

  await ensureOpenShift(kit, RAFIQ, RAFIQ_FLOAT_P)
  let { shift, expectedP } = await expectedNow()
  if (expectedP > S13_EXPECTED_P) {
    await kit.run(
      closeShift,
      { shiftId: shift.id, denominations: denominationsFor(expectedP) },
      RAFIQ
    )
    await kit.run(openShift, { floatP: RAFIQ_FLOAT_P }, RAFIQ)
    ;({ shift, expectedP } = await expectedNow())
  }

  const gapP = S13_EXPECTED_P - expectedP
  if (gapP > 0) {
    const picked: Id[] = []
    for (const [index, amountP] of takingsFor(gapP).entries()) {
      const patient = await pickPatient(kit, {
        branch: "B1",
        minAge: 18,
        selfPay: true,
        exclude: [
          ...picked,
          SEED_REFS.patient.nasima,
          SEED_REFS.patient.kamrul,
        ],
      })
      picked.push(patient.id)
      const service = COUNTER_SERVICES[index % COUNTER_SERVICES.length]
      const lineId = await kit.fixture(
        "counter service",
        async (tx) =>
          tx.insert("basketLines", {
            patientId: patient.id,
            branchId: branch,
            sourceType: "other",
            sourceId: newId("svc"),
            serviceType: "other",
            description: service.en,
            descriptionBn: service.bn,
            qty: 1,
            unitPriceP: amountP,
            status: "open",
            payerType: "self",
          }).id,
        RAFIQ
      )
      await payLines(kit, {
        patientId: patient.id,
        basketLineIds: [lineId],
        tender: "cash",
        cashierPersona: RAFIQ,
      })
    }
    ;({ shift, expectedP } = await expectedNow())
  }
  if (expectedP !== S13_EXPECTED_P) {
    throw new Error(
      `S13 setup: expected cash is ${expectedP}, not ${S13_EXPECTED_P}`
    )
  }
  return {
    refs: { shiftId: shift.id },
    params: {
      ...money(S13_EXPECTED_P, "expected"),
      ...money(S13_COUNTED_P, "counted"),
      ...money(S13_COUNTED_P - S13_EXPECTED_P, "variance"),
    },
  }
}

/** Scenario launchers owned by this module (plan §10). */
export const billingScenarios: ScenarioDef[] = [
  {
    id: "S9",
    kind: "scenario",
    module: "billing",
    titleKey: "billing.scenarios.S9.title",
    summaryKey: "billing.scenarios.S9.summary",
    persona: RAFIQ,
    setup: setupS9,
    route: ({ refs }) =>
      `/cashier/refunds?patient=${refs?.patientId ?? ""}&focus=${refs?.invoiceId ?? ""}`,
    cueKeys: [1, 2, 3, 4, 5].map((n) => `billing.scenarios.S9.cue.${n}`),
  },
  {
    id: "S10",
    kind: "scenario",
    module: "billing",
    titleKey: "billing.scenarios.S10.title",
    summaryKey: "billing.scenarios.S10.summary",
    persona: RAFIQ,
    setup: setupS10,
    route: ({ refs }) => `/cashier/refunds?invoice=${refs?.invoiceId ?? ""}`,
    cueKeys: [1, 2, 3, 4].map((n) => `billing.scenarios.S10.cue.${n}`),
  },
  {
    id: "S13",
    kind: "scenario",
    module: "billing",
    titleKey: "billing.scenarios.S13.title",
    summaryKey: "billing.scenarios.S13.summary",
    persona: RAFIQ,
    setup: setupS13,
    route: () => "/cashier/shift",
    cueKeys: [1, 2, 3, 4].map((n) => `billing.scenarios.S13.cue.${n}`),
  },
]
