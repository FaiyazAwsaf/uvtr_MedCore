import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import type { Actor } from "@/core/engine/types"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { checkout } from "@/modules/billing/commands"
import { dispense, sendToCashier } from "@/modules/pharmacy/commands"

import { dropDb, seededDb, shirin, signedRx } from "./fixtures"

const RAFIQ: Actor = {
  staffId: "stf_rafiq_ahmed",
  personaId: "per_cashier_rafiq",
  role: "cashier",
  branchId: "B1",
  name: "Rafiq Ahmed",
  authorities: ["discount:5"],
}

let db: MedcoreDb
beforeAll(async () => {
  db = await seededDb("pharmacy-billing-test")
})
afterAll(async () => {
  await dropDb(db)
})

describe("payment gate across billing and pharmacy", () => {
  it("unlocks dispensing only once the cashier's checkout pays the Rx lines", async () => {
    const { rxId, lineIds } = await signedRx(db, [
      { brandId: SEED_REFS.brand.alatrol10, dosePattern: "0+0+1", days: 7, paid: false },
    ])
    await expect(
      commit(
        dispense,
        { rxId, lines: [{ rxLineId: lineIds[0], qty: 7 }], verifiedBy: "dob" },
        { db, actor: shirin }
      )
    ).rejects.toMatchObject({ code: "PAYMENT_GATE" })

    const basket = await db.basketLines.where("sourceId").equals(lineIds[0]).toArray()
    const totalP = basket.reduce((sum, b) => sum + b.qty * b.unitPriceP, 0)
    await commit(
      checkout,
      {
        patientId: HERO.patient.abdulKarim,
        basketLineIds: basket.map((b) => b.id),
        tenders: [{ tender: "cash", amountP: totalP }],
        idempotencyKey: "pharmacy-gate-0001",
      },
      { db, actor: RAFIQ }
    )
    expect((await db.rxLines.get(lineIds[0]))?.paymentCleared).toBe(true)

    await commit(
      dispense,
      { rxId, lines: [{ rxLineId: lineIds[0], qty: 7 }], verifiedBy: "dob" },
      { db, actor: shirin }
    )
    const rows = await db.dispenses.where("rxId").equals(rxId).toArray()
    expect(rows.reduce((sum, r) => sum + r.qty, 0)).toBe(7)
    // The dispense points at the invoice line it was billed on.
    const invoiceLines = await db.invoiceLines.where("sourceId").equals(lineIds[0]).toArray()
    expect(rows[0].invoiceLineId).toBe(invoiceLines[0]?.id)
    expect((await db.pharmacyQueue.where("rxId").equals(rxId).first())?.status).toBe("done")
  })

  it("sends a line that was out of stock at signing to the cashier once stock is here", async () => {
    const { rxId, lineIds } = await signedRx(db, [
      {
        brandId: SEED_REFS.brand.fexo120,
        dosePattern: "0+0+1",
        days: 10,
        paid: false,
        billed: false,
      },
    ])
    expect(await db.basketLines.where("sourceId").equals(lineIds[0]).count()).toBe(0)

    const { result, events } = await commit(
      sendToCashier,
      { rxLineId: lineIds[0] },
      { db, actor: shirin }
    )
    expect(result.qty).toBe(10)
    expect(events.map((e) => e.type)).toEqual(["MedicineSentToCashier"])
    const basket = await db.basketLines.get(result.basketLineId)
    expect(basket).toMatchObject({ sourceType: "rx-line", sourceId: lineIds[0], qty: 10, status: "open" })
    expect(basket!.unitPriceP).toBeLessThanOrEqual(basket!.mrpP!)
    await expect(
      commit(sendToCashier, { rxLineId: lineIds[0] }, { db, actor: shirin })
    ).rejects.toMatchObject({ code: "LINE_ALREADY_BILLED" })

    await commit(
      checkout,
      {
        patientId: HERO.patient.abdulKarim,
        basketLineIds: [result.basketLineId],
        tenders: [{ tender: "cash", amountP: basket!.qty * basket!.unitPriceP }],
        idempotencyKey: "pharmacy-gate-0002",
      },
      { db, actor: RAFIQ }
    )
    await commit(
      dispense,
      { rxId, lines: [{ rxLineId: lineIds[0], qty: 10 }], verifiedBy: "phone" },
      { db, actor: shirin }
    )
    expect((await db.rxLines.get(lineIds[0]))?.status).toBe("dispensed")
  })
})
