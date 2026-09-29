import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { HERO, SEED_REFS } from "@/core/seed/content"
import {
  notifyBalanceReady,
  recordBoughtElsewhere,
  requestSubstitution,
  dispense,
} from "@/modules/pharmacy/commands"

import { dropDb, seededDb, shirin, signedRx } from "./fixtures"

const B = SEED_REFS.brand

let db: MedcoreDb
beforeAll(async () => {
  db = await seededDb("pharmacy-lines-test")
})
afterAll(async () => {
  await dropDb(db)
})

describe("pharmacy.recordBoughtElsewhere", () => {
  it("closes the line as bought elsewhere and removes its open basket line", async () => {
    const { rxId, lineIds } = await signedRx(db, [
      { brandId: B.napa500, dosePattern: "1+1+1", days: 3, paid: false },
      { brandId: B.fexo120, dosePattern: "0+0+1", days: 7, paid: false },
    ])
    const { events } = await commit(
      recordBoughtElsewhere,
      { rxLineId: lineIds[0], reason: "Patient has it at home" },
      { db, actor: shirin }
    )
    expect((await db.rxLines.get(lineIds[0]))?.status).toBe("bought-elsewhere")
    const basket = await db.basketLines.where("sourceId").equals(lineIds[0]).toArray()
    expect(basket.map((b) => b.status)).toEqual(["removed"])
    // The other line keeps its basket line.
    const other = await db.basketLines.where("sourceId").equals(lineIds[1]).toArray()
    expect(other.map((b) => b.status)).toEqual(["open"])
    expect((await db.pharmacyQueue.where("rxId").equals(rxId).first())?.status).toBe(
      "in-progress"
    )
    expect(events.map((e) => e.type)).toEqual(["BoughtElsewhereRecorded"])

    await commit(recordBoughtElsewhere, { rxLineId: lineIds[1] }, { db, actor: shirin })
    expect((await db.pharmacyQueue.where("rxId").equals(rxId).first())?.status).toBe("done")
    await expect(
      commit(recordBoughtElsewhere, { rxLineId: lineIds[1] }, { db, actor: shirin })
    ).rejects.toMatchObject({ code: "LINE_NOT_OPEN" })
  })
})

describe("pharmacy.requestSubstitution", () => {
  it("asks the prescriber through the doctor inbox and holds the line (never a silent swap)", async () => {
    const { rxId, rxNo, lineIds } = await signedRx(db, [
      { brandId: B.monas10, dosePattern: "0+0+1", days: 14 },
    ])
    const { result, events } = await commit(
      requestSubstitution,
      { rxLineId: lineIds[0], proposedBrandId: B.montair10, reason: "Out of stock at B1" },
      { db, actor: shirin }
    )
    const request = await db.substitutionRequests.get(result.substitutionId)
    expect(request).toMatchObject({
      rxId,
      rxLineId: lineIds[0],
      doctorId: HERO.doctor.kamal,
      proposedBrandId: B.montair10,
      status: "pending",
      requestedBy: "stf_shirin_sultana",
    })
    const inbox = await db.inboxItems.where("doctorId").equals(HERO.doctor.kamal).toArray()
    const item = inbox.find((i) => i.refs.substitutionId === result.substitutionId)
    expect(item).toMatchObject({
      kind: "substitution",
      status: "unread",
      titleKey: "pharmacy.inbox.substitution",
      params: { rxNo, from: "Monas 10 mg", to: "Montair 10 mg" },
    })
    const line = await db.rxLines.get(lineIds[0])
    expect(line).toMatchObject({ status: "awaiting-prescriber", brandId: B.monas10 })
    expect((await db.pharmacyQueue.where("rxId").equals(rxId).first())?.status).toBe(
      "in-progress"
    )
    expect(events.map((e) => e.type)).toEqual(["SubstitutionRequested"])

    // The held line cannot be dispensed or asked about again.
    await expect(
      commit(
        dispense,
        { rxId, lines: [{ rxLineId: lineIds[0], qty: 14 }], verifiedBy: "dob" },
        { db, actor: shirin }
      )
    ).rejects.toMatchObject({ code: "LINE_NOT_DISPENSABLE" })
    await expect(
      commit(
        requestSubstitution,
        { rxLineId: lineIds[0], proposedBrandId: B.lumona10, reason: "Again" },
        { db, actor: shirin }
      )
    ).rejects.toMatchObject({ code: "LINE_NOT_OPEN" })
  })

  it("proposes only another brand of the same medicine and strength that is in stock here", async () => {
    const montair5 = (await db.brands.where("genericId").equals(SEED_REFS.generic.montelukast).toArray())
      .find((b) => b.name === "Montair" && b.strength === "5 mg")!
    const { lineIds } = await signedRx(db, [
      { brandId: B.monas10, dosePattern: "0+0+1", days: 14 },
      { brandId: B.azithrocin500, dosePattern: "1+0+0", days: 3 },
    ])
    const ask = (rxLineId: string, proposedBrandId: string) =>
      commit(
        requestSubstitution,
        { rxLineId, proposedBrandId, reason: "Out of stock at B1" },
        { db, actor: shirin }
      )
    // Another strength changes the dose; another generic is another medicine.
    await expect(ask(lineIds[0], montair5.id)).rejects.toMatchObject({
      code: "SUBSTITUTE_NOT_EQUIVALENT",
    })
    await expect(ask(lineIds[0], B.fexo120)).rejects.toMatchObject({
      code: "SUBSTITUTE_NOT_EQUIVALENT",
    })
    // Zimax 500 is the same medicine and strength, but out at Dhanmondi.
    await expect(ask(lineIds[1], B.zimax500)).rejects.toMatchObject({
      code: "SUBSTITUTE_OUT_OF_STOCK",
    })
    // Nothing was held for the doctor.
    const lines = await db.rxLines.bulkGet(lineIds)
    expect(lines.map((l) => l?.status)).toEqual(["open", "open"])
  })
})

describe("pharmacy.notifyBalanceReady", () => {
  it("sends the medicine-ready SMS and an app notice without naming the medicine", async () => {
    const { rxId, lineIds } = await signedRx(db, [
      { brandId: B.alatrol10, dosePattern: "0+0+1", days: 10 },
    ])
    await commit(
      dispense,
      { rxId, lines: [{ rxLineId: lineIds[0], qty: 4 }], verifiedBy: "dob" },
      { db, actor: shirin }
    )
    const { result } = await commit(
      notifyBalanceReady,
      { rxLineId: lineIds[0], smsLang: "en" },
      { db, actor: shirin }
    )
    expect(result.smsSent).toBe(true)
    const sms = (await db.sms.where("patientId").equals(HERO.patient.abdulKarim).toArray()).filter(
      (s) => s.templateId === "medicine-ready"
    )
    expect(sms).toHaveLength(1)
    expect(sms[0].text).toContain("Dhanmondi")
    expect(sms[0].text).not.toMatch(/alatrol/i)
    const notices = await db.notifications.where("patientId").equals(HERO.patient.abdulKarim).toArray()
    expect(
      notices.some(
        (n) => n.titleKey === "pharmacy.notify.medicineReady" && n.refs.rxLineId === lineIds[0]
      )
    ).toBe(true)
  })
})
