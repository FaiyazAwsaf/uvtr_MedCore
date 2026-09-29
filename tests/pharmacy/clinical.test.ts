import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import type { Actor } from "@/core/engine/types"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { checkout } from "@/modules/billing/commands"
import {
  dispense,
  requestSubstitution,
  sendToCashier,
} from "@/modules/pharmacy/commands"
import { queueStatusFor, shownQueueStatus } from "@/modules/pharmacy/rules"
import {
  addRxLine,
  decideSubstitution,
  removeRxLine,
  signRx,
} from "@/modules/prescribing/commands"

import { kamal, startVisit } from "../clinical/helpers"
import { dropDb, seededDb, shirin } from "./fixtures"

const B = SEED_REFS.brand

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
  db = await seededDb("pharmacy-clinical-test")
}, 60_000)
afterAll(async () => {
  await dropDb(db)
})

describe("pharmacy on WS-B's signed prescriptions", () => {
  it("dispenses what the doctor signed and billed, ignores removed lines, and follows the substitution decision", async () => {
    const { encounterId } = await startVisit(db, HERO.patient.abdulKarim)
    const add = async (brandId: string, dosePattern: string, durationDays: number) =>
      (
        await commit(
          addRxLine,
          { encounterId, line: { brandId, dosePattern, mealTiming: "before", durationDays } },
          { db, actor: kamal }
        )
      ).result
    const seclo = await add(B.seclo20, "1+0+1", 14)
    await add(B.zimax500, "1+0+0", 3)
    const dropped = await add(B.fexo120, "0+0+1", 7)
    const rxId = seclo.rxId
    const draft = await db.rxLines.where("rxId").equals(rxId).toArray()
    const droppedLine = draft.find((l) => l.brandId === B.fexo120)!
    await commit(removeRxLine, { lineId: droppedLine.id }, { db, actor: kamal })
    expect(dropped.rxId).toBe(rxId)
    await commit(signRx, { rxId }, { db, actor: kamal })

    const lines = await db.rxLines.where("rxId").equals(rxId).toArray()
    const secloLine = lines.find((l) => l.brandId === B.seclo20)!
    const zimaxLine = lines.find((l) => l.brandId === B.zimax500)!
    expect(lines.find((l) => l.id === droppedLine.id)?.status).toBe("cancelled")
    const queue = await db.pharmacyQueue.where("rxId").equals(rxId).first()
    expect(queue?.status).toBe("waiting")
    expect(queueStatusFor(lines)).toBe("waiting")

    // rx.sign billed the 14 Seclo on the shelf and nothing for Zimax (out at B1).
    const secloBasket = await db.basketLines.where("sourceId").equals(secloLine.id).toArray()
    expect(secloBasket.map((b) => b.qty)).toEqual([14])
    expect(await db.basketLines.where("sourceId").equals(zimaxLine.id).count()).toBe(0)
    await expect(
      commit(sendToCashier, { rxLineId: zimaxLine.id }, { db, actor: shirin })
    ).rejects.toMatchObject({ code: "STOCK_NEGATIVE" })

    await commit(
      checkout,
      {
        patientId: HERO.patient.abdulKarim,
        basketLineIds: secloBasket.map((b) => b.id),
        tenders: [{ tender: "cash", amountP: 14 * secloBasket[0].unitPriceP }],
        idempotencyKey: "pharmacy-clinical-0001",
      },
      { db, actor: RAFIQ }
    )
    const { result } = await commit(
      dispense,
      { rxId, lines: [{ rxLineId: secloLine.id, qty: 14 }], verifiedBy: "dob" },
      { db, actor: shirin }
    )
    expect(result.status).toBe("partial")
    expect(await db.rxLines.get(secloLine.id)).toMatchObject({
      status: "partial",
      dispensedQty: 14,
    })

    // Zimax: the pharmacy asks, the doctor rejects, the line is back with the pharmacy.
    const { result: sub } = await commit(
      requestSubstitution,
      { rxLineId: zimaxLine.id, proposedBrandId: B.azithrocin500, reason: "Out of stock at B1" },
      { db, actor: shirin }
    )
    const inbox = (await db.inboxItems.where("doctorId").equals(HERO.doctor.kamal).toArray()).find(
      (i) => i.refs.substitutionId === sub.substitutionId
    )
    expect(inbox).toMatchObject({
      kind: "substitution",
      titleKey: "consultation.inbox.kind.substitution",
    })
    await commit(
      decideSubstitution,
      { substitutionId: sub.substitutionId, decision: "reject", note: "Keep azithromycin" },
      { db, actor: kamal }
    )
    const after = await db.rxLines.where("rxId").equals(rxId).toArray()
    expect(after.find((l) => l.id === zimaxLine.id)?.status).toBe("open")
    const entry = await db.pharmacyQueue.where("rxId").equals(rxId).first()
    expect(shownQueueStatus(entry!.status, after)).toBe("partial")
  })
})
