import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { HERO } from "@/core/seed/content"
import { checkout, confirmMfs } from "@/modules/billing/commands"

import {
  expectBalanced,
  heroBasket,
  RAFIQ,
  resetClock,
  seededDb,
  type HeroBasket,
} from "./fixtures"

let db: MedcoreDb
let hero: HeroBasket

beforeAll(async () => {
  db = await seededDb("billing-checkout")
  hero = await heroBasket(db)
})
afterAll(async () => {
  resetClock()
  await db.delete()
})

const BKASH_P = 1_500_00

async function specimensOf(labOrderId: string) {
  return db.specimens.where("labOrderId").equals(labOrderId).toArray()
}

describe("hero pays bKash plus cash (plan §7.2 accept)", () => {
  let invoiceId = ""
  let bkashId = ""

  it("issues one balanced invoice; cash counts at once, bKash waits and unlocks nothing", async () => {
    const before = await db.labOrderItems.bulkGet(hero.labItemIds)
    expect(before.every((item) => item!.paymentCleared === false)).toBe(true)
    expect(await specimensOf(hero.labOrderId)).toHaveLength(0)

    const cashP = hero.totalP - BKASH_P
    const { result } = await commit(
      checkout,
      {
        patientId: hero.patientId,
        basketLineIds: hero.lineIds,
        tenders: [
          { tender: "bkash", amountP: BKASH_P },
          { tender: "cash", amountP: cashP, tenderedP: cashP + 5_000 },
        ],
        idempotencyKey: "hero-checkout-0001",
      },
      { db, actor: RAFIQ }
    )
    invoiceId = result.invoiceId
    bkashId = result.pendingPaymentIds[0]
    expect(result.status).toBe("partial")
    expect(result.pendingPaymentIds).toHaveLength(1)
    expect(result.changeDueP).toBe(5_000)
    expect(result.receiptNo).toBeUndefined()
    expect(result.invoiceNo).toMatch(/^C1-B1-\d{4}-\d{6}$/)

    const invoice = (await db.invoices.get(invoiceId))!
    expect(invoice).toMatchObject({
      companyId: "C1",
      branchId: "B1",
      patientId: HERO.patient.abdulKarim,
      subtotalP: hero.totalP,
      discountP: 0,
      totalP: hero.totalP,
      paidP: cashP,
      status: "partial",
      shiftId: "shf_B1_rafiq_today",
      cashierId: RAFIQ.staffId,
    })
    await expectBalanced(db, invoiceId)
    const lines = await db.invoiceLines.where("invoiceId").equals(invoiceId).toArray()
    expect(lines).toHaveLength(hero.lineIds.length)

    // Every basket line is billed exactly once.
    const basket = await db.basketLines.bulkGet(hero.lineIds)
    expect(basket.every((line) => line!.status === "invoiced")).toBe(true)

    // INV-09: the pending push unlocks nothing.
    const bkash = (await db.payments.get(bkashId))!
    expect(bkash).toMatchObject({ tender: "bkash", status: "pending", amountP: BKASH_P })
    const items = await db.labOrderItems.bulkGet(hero.labItemIds)
    expect(items.map((item) => [item!.paymentCleared, item!.status])).toEqual([
      [false, "ordered"],
      [false, "ordered"],
    ])
    expect(items.every((item) => !!item!.invoiceLineId)).toBe(true)
    expect(await specimensOf(hero.labOrderId)).toHaveLength(0)
    const rxLines = await db.rxLines.bulkGet(hero.rxLineIds)
    expect(rxLines.every((line) => line!.paymentCleared === false)).toBe(true)
    expect((await db.imagingOrders.get(hero.imagingOrderId))!.paymentCleared).toBe(false)
    expect(await db.receipts.where("invoiceId").equals(invoiceId).count()).toBe(0)
    expect(await db.feeShareAccruals.where("invoiceId").equals(invoiceId).count()).toBe(0)

    const types = (await db.events.toArray()).map((e) => e.type)
    expect(types).toContain("InvoiceIssued")
    expect(types).toContain("PaymentPending")
    expect(types.filter((type) => type === "PaymentReceived")).toHaveLength(1)
    expect(types).not.toContain("SampleUnlocked")
    expect(types).not.toContain("DispenseUnlocked")
  })

  it("the customer's approval settles the invoice and unlocks lab, imaging and pharmacy in one commit", async () => {
    const eventsBefore = await db.events.count()
    const { result, commitId } = await commit(
      confirmMfs,
      { paymentId: bkashId, idempotencyKey: `mfs-confirm:${bkashId}` },
      { db, actor: RAFIQ }
    )
    expect(result.invoiceStatus).toBe("paid")
    expect(result.receiptNo).toMatch(/^RC-B1-\d{6}$/)

    const invoice = (await db.invoices.get(invoiceId))!
    expect(invoice.status).toBe("paid")
    expect(invoice.paidP).toBe(invoice.totalP)
    await expectBalanced(db, invoiceId)
    const bkash = (await db.payments.get(bkashId))!
    expect(bkash.status).toBe("confirmed")
    expect(bkash.ref).toMatch(/^BK[A-Z0-9]{8}$/)

    // Lab items paid and cleared, with specimens awaiting collection (EDTA for CBC, plain for CRP).
    const items = await db.labOrderItems.bulkGet(hero.labItemIds)
    expect(items.every((item) => item!.paymentCleared && item!.status === "paid")).toBe(true)
    const specimens = await specimensOf(hero.labOrderId)
    expect(specimens.map((s) => s.container).sort()).toEqual(["EDTA", "plain"])
    expect(specimens.every((s) => s.status === "awaiting-collection")).toBe(true)
    expect(items.every((item) => specimens.some((s) => s.id === item!.specimenId))).toBe(true)
    expect((await db.labOrders.get(hero.labOrderId))!.status).toBe("in-progress")

    // Imaging paid; every Rx line cleared for dispensing.
    expect(await db.imagingOrders.get(hero.imagingOrderId)).toMatchObject({
      paymentCleared: true,
      status: "paid",
    })
    const rxLines = await db.rxLines.bulkGet(hero.rxLineIds)
    expect(rxLines.every((line) => line!.paymentCleared)).toBe(true)

    // Fee share on collection: Dr. Kamal's contract v2, 70% of the net, 10% withholding tax,
    // and the reporting radiologist's 30% of the chest X-ray.
    const accruals = await db.feeShareAccruals.where("invoiceId").equals(invoiceId).toArray()
    expect(accruals).toHaveLength(2)
    const consultLine = (await db.invoiceLines.where("basketLineId").equals(hero.consultLineId).first())!
    const xrayLine = (await db.invoiceLines.where("sourceId").equals(hero.imagingOrderId).first())!
    expect(accruals.find((a) => a.invoiceLineId === xrayLine.id)).toMatchObject({
      doctorId: "doc_enamul_kabir",
      serviceType: "imaging",
      shareP: Math.round(xrayLine.netP * 0.3),
    })
    expect(accruals.find((a) => a.invoiceLineId === consultLine.id)).toMatchObject({
      doctorId: HERO.doctor.kamal,
      invoiceLineId: consultLine.id,
      contractVersion: 2,
      basis: "pct-net",
      grossP: consultLine.amountP,
      netP: consultLine.netP,
      shareP: Math.round(consultLine.netP * 0.7),
      whtP: Math.round(Math.round(consultLine.netP * 0.7) * 0.1),
    })

    // One receipt for all confirmed payments; SMS to the verified phone; app notice.
    const receipts = await db.receipts.where("invoiceId").equals(invoiceId).toArray()
    expect(receipts).toHaveLength(1)
    expect(receipts[0].amountP).toBe(invoice.totalP)
    expect(receipts[0].paymentIds).toHaveLength(2)
    const sms = await db.sms.where("patientId").equals(HERO.patient.abdulKarim).toArray()
    const paid = sms.filter((m) => m.templateId === "payment-received")
    expect(paid).toHaveLength(1)
    expect(paid[0].to).toBe(HERO.karimPhone)
    expect(paid[0].text).toContain(result.receiptNo!)
    const notices = await db.notifications.where("patientId").equals(HERO.patient.abdulKarim).toArray()
    expect(notices.some((n) => n.titleKey === "patientApp.notifications.paymentReceived")).toBe(true)

    // Everything above happened in the one approving commit.
    const events = (await db.events.toArray()).slice(eventsBefore)
    expect(new Set(events.map((e) => e.commitId))).toEqual(new Set([commitId]))
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        "PaymentReceived",
        "SampleUnlocked",
        "ImagingUnlocked",
        "DispenseUnlocked",
        "FeeShareAccrued",
      ])
    )
    const pharmacy = events.find((e) => e.type === "DispenseUnlocked")!
    expect(pharmacy.consumers).toContain("billing.consumers.pharmacy")
    expect(pharmacy.params.count).toBe(3)
  })

  it("the whole payment is in the audit chain", async () => {
    const audit = await db.audit.where("entity").equals("payments").toArray()
    expect(audit.filter((row) => row.entityId === bkashId).map((row) => row.action)).toEqual([
      "insert",
      "update",
    ])
  })
})

describe("double submit (HAZ-16)", () => {
  it("the same idempotency key pays once", async () => {
    const basket = await heroBasket(db, HERO.patient.rokeyaBegum, { viaBooking: false })
    const input = {
      patientId: basket.patientId,
      basketLineIds: basket.lineIds,
      tenders: [{ tender: "cash" as const, amountP: basket.totalP }],
      idempotencyKey: "double-click-0001",
    }
    const [first, second] = await Promise.all([
      commit(checkout, input, { db, actor: RAFIQ }),
      commit(checkout, input, { db, actor: RAFIQ }),
    ])
    expect([first.deduplicated, second.deduplicated].sort()).toEqual([false, true])
    expect(second.result.invoiceId).toBe(first.result.invoiceId)
    const invoices = await db.invoices.where("patientId").equals(basket.patientId).toArray()
    const today = invoices.filter((i) => i.id === first.result.invoiceId)
    expect(today).toHaveLength(1)
    expect(await db.payments.where("invoiceId").equals(first.result.invoiceId).count()).toBe(1)
    expect(first.result.status).toBe("paid")
    await expectBalanced(db, first.result.invoiceId)

    // A new key cannot bill the same lines again.
    await expect(
      commit(checkout, { ...input, idempotencyKey: "double-click-0002" }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "LINE_NOT_OPEN" })
  })

  it("the same approval twice confirms once", async () => {
    const basket = await heroBasket(db, HERO.patient.tanvirKarim, { viaBooking: false })
    const { result } = await commit(
      checkout,
      {
        patientId: basket.patientId,
        basketLineIds: basket.lineIds,
        tenders: [{ tender: "nagad", amountP: basket.totalP }],
        idempotencyKey: "nagad-push-0001",
      },
      { db, actor: RAFIQ }
    )
    expect(result.status).toBe("unpaid")
    const paymentId = result.pendingPaymentIds[0]
    const key = `mfs-confirm:${paymentId}`
    const first = await commit(confirmMfs, { paymentId, idempotencyKey: key }, { db, actor: RAFIQ })
    const again = await commit(confirmMfs, { paymentId, idempotencyKey: key }, { db, actor: RAFIQ })
    expect(again.deduplicated).toBe(true)
    expect(again.result).toEqual(first.result)
    expect(await db.receipts.where("invoiceId").equals(result.invoiceId).count()).toBe(1)
    await expect(
      commit(confirmMfs, { paymentId, idempotencyKey: "other-window-key" }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_PENDING" })
  })
})

describe("what checkout refuses", () => {
  it("rejects tenders that do not add up, an unapproved card and short cash, writing nothing", async () => {
    const basket = await heroBasket(db, HERO.patient.nusratKarim, { viaBooking: false })
    const base = {
      patientId: basket.patientId,
      basketLineIds: basket.lineIds,
      idempotencyKey: "refusals-0001",
    }
    const invoicesBefore = await db.invoices.count()
    await expect(
      commit(checkout, { ...base, tenders: [{ tender: "cash", amountP: basket.totalP - 100 }] }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "TENDER_MISMATCH" })
    await expect(
      commit(checkout, { ...base, tenders: [{ tender: "card", amountP: basket.totalP }] }, { db, actor: RAFIQ })
    ).rejects.toMatchObject({ code: "CARD_NOT_APPROVED" })
    await expect(
      commit(
        checkout,
        { ...base, tenders: [{ tender: "cash", amountP: basket.totalP, tenderedP: basket.totalP - 1 }] },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "CASH_SHORT" })
    expect(await db.invoices.count()).toBe(invoicesBefore)
    const lines = await db.basketLines.bulkGet(basket.lineIds)
    expect(lines.every((line) => line!.status === "open")).toBe(true)
  })

  it("refuses a line whose order was cancelled, naming it", async () => {
    const basket = await heroBasket(db, "pat_0010", { viaBooking: false })
    await db.labOrderItems.update(basket.labItemIds[1], { status: "cancelled" })
    await expect(
      commit(
        checkout,
        {
          patientId: basket.patientId,
          basketLineIds: basket.lineIds,
          tenders: [{ tender: "cash", amountP: basket.totalP }],
          idempotencyKey: "stale-0001",
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", params: { item: "C-reactive protein (CRP)" } })

    // Paying the rest works, and a card with its terminal approval counts at once.
    const rest = basket.lineIds.filter((id) => !id.endsWith("lt_crp"))
    const restLines = await db.basketLines.bulkGet(rest)
    const restP = restLines.reduce((sum, line) => sum + line!.qty * line!.unitPriceP, 0)
    const { result } = await commit(
      checkout,
      {
        patientId: basket.patientId,
        basketLineIds: rest,
        tenders: [{ tender: "card", amountP: restP, ref: "POS-123456" }],
        idempotencyKey: "stale-0002",
      },
      { db, actor: RAFIQ }
    )
    expect(result.status).toBe("paid")
    expect(result.receiptNo).toBeDefined()
    const cbc = (await db.labOrderItems.get(basket.labItemIds[0]))!
    expect(cbc.paymentCleared).toBe(true)
    expect((await db.labOrderItems.get(basket.labItemIds[1]))!.paymentCleared).toBe(false)
  })

  it("refuses lines of another patient or a role that is not a cashier", async () => {
    const basket = await heroBasket(db, "pat_0011", { viaBooking: false })
    await expect(
      commit(
        checkout,
        {
          patientId: HERO.patient.abdulKarim,
          basketLineIds: basket.lineIds,
          tenders: [{ tender: "cash", amountP: basket.totalP }],
          idempotencyKey: "wrong-patient-0001",
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "LINE_WRONG_PATIENT" })
    await expect(
      commit(
        checkout,
        {
          patientId: basket.patientId,
          basketLineIds: basket.lineIds,
          tenders: [{ tender: "cash", amountP: basket.totalP }],
          idempotencyKey: "wrong-role-0001",
        },
        { db, actor: { ...RAFIQ, role: "receptionist" } }
      )
    ).rejects.toMatchObject({ kind: "denied" })
  })
})
