import { addDaysISO } from "@/core/clock/dates"
import type { ScenarioDef, ScenarioKit, ScenarioOutcome } from "@/core/scenarios/types"
import { SEED_REFS } from "@/core/seed/content"
import { plantUsableStock } from "@/modules/inventory/stock"

import { estUnitCostP } from "./calc"
import { decidePr, issuePo, savePr, submitPr } from "./commands"

/**
 * S12 partial goods receipt (plan §10): Napa 500 has fallen below its reorder
 * level at Dhanmondi, and the order for it (PO-1042 on a fresh demo) is due
 * from the Beximco depot. The setup raises the request as Habibur, has Tariq
 * approve it (the store manager's own request goes one tier up) and issues
 * the order, all through the real commands; the presenter then receives 85
 * boxes with 5 refused as short expiry, and records the vendor invoice.
 * Every run makes a fresh order, so the key action works each time.
 */

const STORE = "per_store_habibur"
const HEAD = "per_store_tariq"
const BRANCH = "B1"
const NAPA = SEED_REFS.brand.napa500
const DEPOT = SEED_REFS.vendor.beximcoDepot
/** Napa 500's box: 10 strips of 10 tablets */
const BOX = "10 x 10 strip"

const dmy = (iso: string) => iso.split("-").reverse().join("-")
const bnDigits = (text: string) => text.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])

async function setupPartialGrn(kit: ScenarioKit): Promise<ScenarioOutcome> {
  await kit.fixture(
    "Napa 500: 600 tablets on the shelf at B1",
    (tx) =>
      plantUsableStock(tx, BRANCH, NAPA, 600, {
        reason: "Demo setup S12: Napa 500 below its reorder level at Dhanmondi",
      }),
    STORE
  )
  const db = await kit.db(STORE)
  const brand = await db.brands.get(NAPA)
  if (!brand) throw new Error("S12: Napa 500 is missing from the library")
  const pack = brand.packSizes.find((p) => p.label === BOX) ?? brand.packSizes[0]
  const batches = await db.batches.where("brandId").equals(NAPA).toArray()
  const cost = estUnitCostP(brand, batches, pack)

  const pr = await kit.run(
    savePr,
    {
      lines: [{ brandId: NAPA, qty: 100, pack, estUnitCostP: cost }],
      vendorId: DEPOT,
      note: "Napa 500 below reorder level",
    },
    STORE
  )
  await kit.run(submitPr, { prId: pr.prId }, STORE)
  // Tariq (head of procurement, network level) decides on Dhanmondi's store,
  // so this also works while the branch is offline.
  await kit.run(
    decidePr,
    { prId: pr.prId, decision: "approve", note: "Reorder approved" },
    HEAD,
    { storeOf: STORE }
  )
  const issued = await kit.run(issuePo, { prId: pr.prId, vendorId: DEPOT }, STORE)
  const po = issued.pos[0]
  const vendor = await db.vendors.get(DEPOT)

  const today = kit.today()
  const digits = po.poNo.replace(/\D/g, "").slice(-4)
  const expiry = addDaysISO(today, 730)
  const shortExpiry = addDaysISO(today, 60)
  return {
    refs: { prId: pr.prId, poId: po.poId },
    params: {
      poNo: po.poNo,
      prNo: pr.prNo,
      vendor: vendor?.name ?? DEPOT,
      batchNo: `NP${digits}A`,
      shortBatchNo: `NP${digits}S`,
      expiry: dmy(expiry),
      expiryBn: bnDigits(dmy(expiry)),
      shortExpiry: dmy(shortExpiry),
      shortExpiryBn: bnDigits(dmy(shortExpiry)),
    },
  }
}

const cues = (id: string, count: number) =>
  Array.from({ length: count }, (_, i) => `procurement.scenarios.${id}.cue.${i + 1}`)

/** Scenario launchers owned by this module (plan §10). */
export const procurementScenarios: ScenarioDef[] = [
  {
    id: "S12",
    kind: "scenario",
    module: "procurement",
    titleKey: "procurement.scenarios.S12.title",
    summaryKey: "procurement.scenarios.S12.summary",
    persona: STORE,
    setup: setupPartialGrn,
    route: ({ refs }) => `/store/grn?po=${refs?.poId ?? ""}`,
    cueKeys: cues("S12", 5),
  },
]
