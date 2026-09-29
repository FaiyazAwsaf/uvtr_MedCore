import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { rules } from "@/config/rules.config"
import { applyClockOffset, now } from "@/core/clock/clock"
import { DAY } from "@/core/clock/dates"
import { getCentralDb } from "@/core/db/database"
import { resetDemo } from "@/core/demo/reset"
import { commit } from "@/core/engine/commit"
import { payLines } from "@/core/scenarios/fixtures"
import { SCENARIOS } from "@/core/scenarios/registry"
import { createKit, runScenario } from "@/core/scenarios/runner"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"
import { plantUsableStock } from "@/modules/inventory/stock"
import { buildLabel } from "@/modules/pharmacy/label"
import {
  dispense,
  requestSubstitution,
  sendToCashier,
} from "@/modules/pharmacy/commands"
import { decideSubstitution } from "@/modules/prescribing/commands"
import { lineFulfilment } from "@/modules/patient-app/lib/rx"

import { usableAt } from "./fixtures"

/**
 * S3 and S4 launchers (plan §10, P3.3): each one prepares its state twice in
 * a row through the real commands, and the presenter's key action commits
 * after each run.
 */

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!
const db = getCentralDb()
const B = SEED_REFS.brand
const shirin = actorFor(findPersona("per_pharmacist_shirin")!)
const kamal = actorFor(findPersona("per_doctor_kamal")!)

const usableQty = async (brandId: string) =>
  (await usableAt(db, "B1", brandId)).reduce((sum, u) => sum + u.level.qty, 0)

/** Every B1 level of a brand equals the sum of its movements (ledger and levels agree). */
async function ledgerAgrees(brandId: string): Promise<boolean> {
  const levels = await db.stockLevels
    .where("[branchId+brandId]")
    .equals(["B1", brandId])
    .toArray()
  for (const level of levels) {
    const moved = (
      await db.stockMovements.where("batchId").equals(level.batchId).toArray()
    )
      .filter((m) => m.branchId === "B1")
      .reduce((sum, m) => sum + m.qty, 0)
    if (moved !== level.qty) return false
  }
  return true
}

beforeAll(async () => {
  await resetDemo()
}, 60_000)

afterAll(async () => {
  await resetDemo()
  applyClockOffset(0)
})

describe("S3 partial dispense", () => {
  it("puts 14 Seclo 20 back on the shelf, signs and pays Tanvir's Rx for 28, and dispensing 14 leaves a 7-day balance, twice", async () => {
    for (let run = 1; run <= 2; run++) {
      const { outcome, route } = await runScenario(scenario("S3"))
      const rxId = outcome.refs!.rxId!
      expect(route).toBe(`/pharmacy/dispense/${rxId}`)

      // Prepared state: exactly 14 usable at Dhanmondi, on the ledger too.
      expect(await usableQty(B.seclo20)).toBe(14)
      expect(await ledgerAgrees(B.seclo20)).toBe(true)
      const adjustments = (
        await db.stockMovements.where("brandId").equals(B.seclo20).toArray()
      ).filter(
        (m) => m.type === "adjust" && m.reason?.startsWith("Demo setup S3")
      )
      // The seed plants 14; after the first run the second run puts the shelf back to 14.
      expect(adjustments.length > 0).toBe(run > 1)

      const rx = (await db.prescriptions.get(rxId))!
      expect(rx).toMatchObject({
        status: "signed",
        patientId: HERO.patient.tanvirKarim,
      })
      expect(outcome.params).toMatchObject({ rxNo: rx.rxNo, phoneTail: "3418" })
      const line = (await db.rxLines.get(outcome.refs!.rxLineId!))!
      expect(line).toMatchObject({
        brandId: B.seclo20,
        qtyPrescribed: 28,
        dispensedQty: 0,
        paymentCleared: true,
        status: "open",
      })
      const basket = await db.basketLines
        .where("sourceId")
        .equals(line.id)
        .toArray()
      expect(basket.map((b) => [b.qty, b.status])).toEqual([[14, "invoiced"]])

      // Key action: the presenter dispenses the 14 on the shelf.
      const at = now()
      const { result, events } = await commit(
        dispense,
        { rxId, lines: [{ rxLineId: line.id, qty: 14 }], verifiedBy: "phone" },
        { db, actor: shirin }
      )
      expect(result.status).toBe("partial")
      expect(events.map((e) => e.type)).toContain("DispensePartial")
      const after = (await db.rxLines.get(line.id))!
      expect(after).toMatchObject({ status: "partial", dispensedQty: 14 })
      expect(after.balanceUntil! - at).toBeGreaterThanOrEqual(
        rules.dispenseBalanceDays * DAY
      )
      expect(after.balanceUntil! - at).toBeLessThan(
        rules.dispenseBalanceDays * DAY + DAY
      )
      expect(await usableQty(B.seclo20)).toBe(0)

      // The label shows what was given and what is still owed (HAZ-06).
      const rows = await db.dispenses
        .where("rxLineId")
        .equals(line.id)
        .toArray()
      expect(rows.reduce((sum, r) => sum + r.qty, 0)).toBe(14)
      expect(rows.every((r) => r.outstandingQty === 14)).toBe(true)
      const brand = (await db.brands.get(B.seclo20))!
      const patient = (await db.patients.get(HERO.patient.tanvirKarim))!
      const label = buildLabel(
        {
          rxNo: rx.rxNo,
          patient,
          brand,
          genericName: "Omeprazole",
          dosePattern: after.dosePattern,
          mealTiming: after.mealTiming,
          durationDays: after.durationDays,
          dispensedQty: 14,
          outstandingQty: rows[0].outstandingQty,
          balanceUntil: after.balanceUntil,
          batches: [],
          pharmacist: {
            nameEn: "Shirin Sultana",
            nameBn: "",
            councilNo: "PCB",
          },
          at,
        },
        "en"
      )
      expect(label.given).toBe("Given: 14 capsules")
      expect(label.outstanding).toMatch(
        /^Still to collect: 14 capsules \(by \d{2}-\d{2}-\d{4}\)$/
      )

      // Tanvir's own app shows the balance and its collect-by day.
      const shown = lineFulfilment(after, now())
      expect(shown).toMatchObject({
        dispensed: 14,
        outstanding: 14,
        expired: false,
      })
      expect(shown.deadline).toBe(after.balanceUntil)

      if (run === 1) {
        // Later the rest arrives (a transfer): the balance is billed, paid, then handed over.
        const kit = createKit(scenario("S3"))
        await kit.fixture("Seclo arrives", (tx) =>
          plantUsableStock(tx, "B1", B.seclo20, 30, {
            reason: "Test: transfer received",
          })
        )
        await expect(
          commit(
            dispense,
            {
              rxId,
              lines: [{ rxLineId: line.id, qty: 14 }],
              verifiedBy: "phone",
            },
            { db, actor: shirin }
          )
        ).rejects.toMatchObject({ code: "PAYMENT_GATE" })
        const billed = await commit(
          sendToCashier,
          { rxLineId: line.id },
          { db, actor: shirin }
        )
        expect(billed.result.qty).toBe(14)
        await payLines(kit, {
          patientId: rx.patientId,
          basketLineIds: [billed.result.basketLineId],
        })
        const rest = await commit(
          dispense,
          {
            rxId,
            lines: [{ rxLineId: line.id, qty: 14 }],
            verifiedBy: "phone",
          },
          { db, actor: shirin }
        )
        expect(rest.result.status).toBe("done")
        expect((await db.rxLines.get(line.id))!.status).toBe("dispensed")
      }
    }
  }, 60_000)
})

describe("S4 doctor substitution request", () => {
  it("keeps Monas 10 out at Dhanmondi with a paid Rx waiting, and the request, the approval, payment and dispensing of version 2 work, twice", async () => {
    for (let run = 1; run <= 2; run++) {
      const { outcome, route } = await runScenario(scenario("S4"))
      const rxId = outcome.refs!.rxId!
      expect(route).toBe(`/pharmacy/dispense/${rxId}`)

      // Prepared state: Monas out, the same-strength brands on the shelf.
      expect(await usableQty(B.monas10)).toBe(0)
      expect(await usableQty(B.lumona10)).toBeGreaterThanOrEqual(30)
      expect(await usableQty(B.montair10)).toBeGreaterThanOrEqual(30)
      for (const brandId of [B.monas10, B.lumona10, B.montair10]) {
        expect(await ledgerAgrees(brandId)).toBe(true)
      }
      const rx = (await db.prescriptions.get(rxId))!
      expect(rx.status).toBe("signed")
      const lines = await db.rxLines.where("rxId").equals(rxId).sortBy("lineNo")
      const [fexo, monas] = lines
      expect(monas.id).toBe(outcome.refs!.rxLineId)
      expect(fexo).toMatchObject({
        brandId: B.fexo120,
        paymentCleared: true,
        status: "open",
      })
      expect(monas).toMatchObject({
        brandId: B.monas10,
        paymentCleared: false,
        status: "open",
      })
      // Out of stock when signed: nothing billed for Monas.
      expect(
        await db.basketLines.where("sourceId").equals(monas.id).count()
      ).toBe(0)

      // Key action 1: the pharmacist asks for Lumona 10 (same generic and strength).
      const { result: sub } = await commit(
        requestSubstitution,
        {
          rxLineId: monas.id,
          proposedBrandId: B.lumona10,
          reason: "Out of stock at Dhanmondi",
        },
        { db, actor: shirin }
      )
      const inbox = (
        await db.inboxItems
          .where("doctorId")
          .equals(HERO.doctor.kamal)
          .toArray()
      ).find((i) => i.refs.substitutionId === sub.substitutionId)
      expect(inbox).toMatchObject({
        kind: "substitution",
        status: "unread",
        titleKey: "pharmacy.inbox.substitution",
        params: { rxNo: rx.rxNo, from: "Monas 10 mg", to: "Lumona 10 mg" },
      })

      // Key action 2 (doctor window): Dr. Kamal approves; v2 takes over in the queue.
      const { result: decided } = await commit(
        decideSubstitution,
        { substitutionId: sub.substitutionId, decision: "approve" },
        { db, actor: kamal }
      )
      expect(decided).toMatchObject({
        decision: "approved",
        rxNo: rx.rxNo,
        rxVersion: 2,
      })
      const v2Id = decided.rxId
      expect((await db.prescriptions.get(rxId))!.status).toBe("superseded")
      const queue = await db.pharmacyQueue.where("rxId").equals(v2Id).toArray()
      expect(queue).toHaveLength(1)
      const v2Lines = await db.rxLines
        .where("rxId")
        .equals(v2Id)
        .sortBy("lineNo")
      const lumona = v2Lines.find((l) => l.brandId === B.lumona10)!
      expect(lumona).toMatchObject({
        status: "open",
        paymentCleared: false,
        substitutedFromLineId: monas.id,
      })
      expect(v2Lines.find((l) => l.brandId === B.fexo120)?.paymentCleared).toBe(
        true
      )

      // Version 2 is billed for the new brand, paid at the cashier, then dispensed.
      const open = (
        await db.basketLines.where("sourceId").equals(lumona.id).toArray()
      ).filter((b) => b.status === "open")
      expect(open.map((b) => b.qty)).toEqual([30])
      await payLines(createKit(scenario("S4")), {
        patientId: rx.patientId,
        basketLineIds: open.map((b) => b.id),
      })
      expect((await db.rxLines.get(lumona.id))!.paymentCleared).toBe(true)
      const { result: given } = await commit(
        dispense,
        {
          rxId: v2Id,
          lines: v2Lines.map((l) => ({ rxLineId: l.id, qty: l.qtyPrescribed })),
          verifiedBy: "dob",
        },
        { db, actor: shirin }
      )
      expect(given.status).toBe("done")

      // Between runs, stock arrives for Monas (a transfer): the next run takes it out again.
      if (run === 1) {
        await createKit(scenario("S4")).fixture("Monas arrives", (tx) =>
          plantUsableStock(tx, "B1", B.monas10, 20, {
            reason: "Test: transfer received",
          })
        )
        expect(await usableQty(B.monas10)).toBe(20)
      }
    }
  }, 60_000)
})
