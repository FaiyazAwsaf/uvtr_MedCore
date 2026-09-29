import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import type { Id, InvoiceLineRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { HERO, SEED_REFS } from "@/core/seed/content"
import {
  cancelLine,
  checkout,
  confirmMfs,
  refund,
} from "@/modules/billing/commands"
import { applyDelayChoice, recordDelay } from "@/modules/scheduling/commands"
import {
  openShiftFor,
  refundRequestsAt,
  refundView,
  shiftSummary,
} from "@/modules/billing/queries"
import {
  allocateRefund,
  CASHIER_REFUND_LIMIT_P,
} from "@/modules/billing/refunds"
import {
  collectSpecimen,
  importAnalyserResults,
  receiveSpecimen,
  validateItem,
} from "@/modules/lab/commands"

import { labtech } from "../lab/fixtures"
import {
  heroBasket,
  NASRIN,
  RAFIQ,
  RECEPTION,
  resetClock,
  seededDb,
  type HeroBasket,
} from "./fixtures"

/**
 * Cancellation after payment by stage and refund to the original tender
 * (plan §9, PRD §9): `billing.cancelLine` and `billing.refund`.
 */

let db: MedcoreDb

const NASRIN_OK = {
  approverStaffId: NASRIN.staffId,
  reason: "Checked with the patient at the counter",
  pinVerified: true as const,
}

beforeAll(async () => {
  db = await seededDb("billing-refund")
})
afterAll(async () => {
  resetClock()
  await db.delete()
})

async function lineOf(invoiceId: Id, sourceId: Id): Promise<InvoiceLineRow> {
  const line = await db.invoiceLines
    .where("invoiceId")
    .equals(invoiceId)
    .filter((l) => l.sourceId === sourceId)
    .first()
  if (!line) throw new Error(`no invoice line for ${sourceId}`)
  return line
}

async function specimenOf(itemId: Id) {
  const item = (await db.labOrderItems.get(itemId))!
  return (await db.specimens.get(item.specimenId!))!
}

async function eventsOf(commitId: string): Promise<string[]> {
  return (await db.events.toArray())
    .filter((e) => e.commitId === commitId)
    .map((e) => e.type)
}

describe("refund allocation", () => {
  it("splits pro rata to how the invoice was paid and always adds up", () => {
    const pay = [
      { id: "p1", tender: "bkash" as const, amountP: 60_000, refundedP: 0 },
      { id: "p2", tender: "cash" as const, amountP: 40_000, refundedP: 0 },
    ]
    expect(allocateRefund(10_000, pay)).toEqual([
      { paymentId: "p1", tender: "bkash", amountP: 6_000 },
      { paymentId: "p2", tender: "cash", amountP: 4_000 },
    ])
    const three = [
      { id: "a", tender: "cash" as const, amountP: 100, refundedP: 0 },
      { id: "b", tender: "card" as const, amountP: 100, refundedP: 0 },
      { id: "c", tender: "nagad" as const, amountP: 100, refundedP: 0 },
    ]
    const split = allocateRefund(101, three)
    expect(split.reduce((s, x) => s + x.amountP, 0)).toBe(101)
    expect(
      Math.max(...split.map((x) => x.amountP)) -
        Math.min(...split.map((x) => x.amountP))
    ).toBeLessThanOrEqual(1)
    // A payment already given back in full cannot take more: the others do.
    const capped = allocateRefund(5_000, [
      { id: "p1", tender: "bkash", amountP: 5_000, refundedP: 5_000 },
      { id: "p2", tender: "cash", amountP: 5_000, refundedP: 0 },
    ])
    expect(capped).toEqual([
      { paymentId: "p2", tender: "cash", amountP: 5_000 },
    ])
    expect(
      allocateRefund(20_000, [
        { id: "p", tender: "cash", amountP: 10_000, refundedP: 0 },
      ])
    ).toEqual([{ paymentId: "p", tender: "cash", amountP: 10_000 }])
  })
})

describe("cancellation after payment by stage", () => {
  let abdul: HeroBasket
  let invoiceId: Id
  let bkashP: number
  let totalP: number

  beforeAll(async () => {
    abdul = await heroBasket(db, HERO.patient.abdulKarim, { viaBooking: false })
    totalP = abdul.totalP
    bkashP = Math.round((totalP * 0.4) / 100) * 100
    const { result } = await commit(
      checkout,
      {
        patientId: abdul.patientId,
        basketLineIds: abdul.lineIds,
        tenders: [
          { tender: "bkash", amountP: bkashP },
          { tender: "cash", amountP: totalP - bkashP },
        ],
        idempotencyKey: "refund-abdul-0001",
      },
      { db, actor: RAFIQ }
    )
    invoiceId = result.invoiceId
    await commit(
      confirmMfs,
      { paymentId: result.pendingPaymentIds[0] },
      { db, actor: RAFIQ }
    )
    expect((await db.invoices.get(invoiceId))!.status).toBe("paid")
  })

  it("the refunds screen reads each line's stage", async () => {
    const view = (await refundView(db, invoiceId))!
    const stage = (sourceId: Id) =>
      view.lines.find((l) => l.line.sourceId === sourceId)!.info
    expect(stage(abdul.labItemIds[0])).toEqual({
      stage: "lab-awaiting",
      action: "cancel",
      rule: "auto",
    })
    expect(stage(abdul.imagingOrderId)).toEqual({
      stage: "imaging-pending",
      action: "cancel",
      rule: "auto",
    })
    expect(stage(abdul.appointmentId).stage).toBe("consult-open")
    expect(stage(abdul.rxLineIds[0])).toEqual({
      stage: "medicine",
      action: "none",
    })
  })

  it("before collection: cancelled and refunded at once, pro rata over bKash and cash", async () => {
    const shift = (await openShiftFor(db, RAFIQ.staffId, "B1"))!
    const before = await shiftSummary(db, shift)
    const cbcItem = abdul.labItemIds[0]
    const line = await lineOf(invoiceId, cbcItem)
    const { result, commitId } = await commit(
      cancelLine,
      {
        invoiceLineId: line.id,
        reason: "Patient no longer needs it",
        idempotencyKey: "cancel-cbc-0001",
      },
      { db, actor: RAFIQ }
    )
    expect(result.stage).toBe("lab-awaiting")
    expect(result.approvalId).toBeUndefined()
    expect(result.amountP).toBe(line.netP)
    expect(result.creditNoteNo).toMatch(/^CN-C1-\d{4}-000001$/)
    const byTender = Object.fromEntries(
      result.refunds.map((r) => [r.tender, r.amountP])
    )
    expect(byTender.bkash + byTender.cash).toBe(line.netP)
    expect(
      Math.abs(byTender.bkash - (line.netP * bkashP) / totalP)
    ).toBeLessThanOrEqual(1)
    expect(result.refunds.find((r) => r.tender === "bkash")!.ref).toMatch(
      /^BKR[A-Z0-9]{8}$/
    )
    expect(result.refunds.find((r) => r.tender === "cash")!.ref).toBeUndefined()

    // The work stops: item cancelled, its own tube retired, the order goes on (CRP is live).
    const item = (await db.labOrderItems.get(cbcItem))!
    expect(item).toMatchObject({ status: "cancelled", paymentCleared: false })
    expect((await specimenOf(cbcItem)).status).toBe("cancelled")
    expect((await db.labOrders.get(abdul.labOrderId))!.status).not.toBe(
      "cancelled"
    )

    // Billing records: line, invoice, credit note, one refund per tender.
    expect((await db.invoiceLines.get(line.id))!.status).toBe("cancelled")
    const invoice = (await db.invoices.get(invoiceId))!
    expect(invoice).toMatchObject({
      status: "paid",
      refundedP: line.netP,
      paidP: totalP,
    })
    const note = (await db.creditNotes.get(result.creditNoteId))!
    expect(note.lines).toEqual([{ invoiceLineId: line.id, amountP: line.netP }])
    const refunds = await db.refunds
      .where("invoiceId")
      .equals(invoiceId)
      .toArray()
    expect(refunds).toHaveLength(2)
    expect(
      refunds.every(
        (r) => r.creditNoteId === note.id && r.status === "completed"
      )
    ).toBe(true)

    // The cash part came out of Rafiq's drawer.
    const after = await shiftSummary(db, shift)
    expect(after.cashRefundsP - before.cashRefundsP).toBe(byTender.cash)
    expect(before.expectedCashP - after.expectedCashP).toBe(byTender.cash)

    // SMS and app notice carry an amount and a document number only.
    const sms = (
      await db.sms.where("patientId").equals(abdul.patientId).toArray()
    ).filter((m) => m.templateId === "refund-issued")
    expect(sms).toHaveLength(1)
    expect(sms[0].to).toBe(HERO.karimPhone)
    expect(sms[0].text).toContain(result.creditNoteNo)
    expect(sms[0].text).not.toMatch(/CBC|blood|count/i)
    const notices = await db.notifications
      .where("patientId")
      .equals(abdul.patientId)
      .toArray()
    expect(
      notices.some((n) => n.titleKey === "billing.notices.refundIssued")
    ).toBe(true)

    expect(await eventsOf(commitId)).toEqual(
      expect.arrayContaining([
        "ServiceCancelled",
        "CreditNoteIssued",
        "RefundIssued",
      ])
    )
  })

  it("after collection: refused without a supervisor, then cancelled with one", async () => {
    const crpItem = abdul.labItemIds[1]
    const patient = (await db.patients.get(abdul.patientId))!
    await commit(
      collectSpecimen,
      {
        specimenId: (await specimenOf(crpItem)).id,
        secondIdentifier: patient.dob,
      },
      { db, actor: labtech }
    )
    const line = await lineOf(invoiceId, crpItem)
    expect(
      (await refundView(db, invoiceId))!.lines.find(
        (l) => l.line.id === line.id
      )!.info
    ).toEqual({
      stage: "lab-collected",
      action: "cancel",
      rule: "approval",
    })
    const input = {
      invoiceLineId: line.id,
      reason: "Duplicate order",
      idempotencyKey: "cancel-crp-0001",
    }
    await expect(
      commit(cancelLine, input, { db, actor: RAFIQ })
    ).rejects.toMatchObject({
      code: "CANCEL_APPROVAL_REQUIRED",
    })
    await expect(
      commit(
        cancelLine,
        {
          ...input,
          approval: { ...NASRIN_OK, approverStaffId: RAFIQ.staffId },
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "APPROVAL_SAME_PERSON" })
    await expect(
      commit(
        cancelLine,
        {
          ...input,
          approval: { ...NASRIN_OK, approverStaffId: labtech.staffId },
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "APPROVER_NOT_ALLOWED" })

    const { result, commitId } = await commit(
      cancelLine,
      { ...input, approval: NASRIN_OK },
      { db, actor: RAFIQ }
    )
    expect(result.stage).toBe("lab-collected")
    expect(result.creditNoteNo).toMatch(/-000002$/)
    const approval = (await db.approvals.get(result.approvalId!))!
    expect(approval).toMatchObject({
      kind: "cancel-after-collection",
      approverId: NASRIN.staffId,
      requestedBy: RAFIQ.staffId,
      pinVerified: true,
      amountP: line.netP,
    })
    // Every item on the order is off now: the tube and the order are retired too.
    expect((await specimenOf(crpItem)).status).toBe("cancelled")
    expect((await db.labOrders.get(abdul.labOrderId))!.status).toBe("cancelled")
    const audit = (
      await db.audit.where("commitId").equals(commitId).toArray()
    ).filter((row) => row.entity === "labOrderItems")
    expect(audit[0]).toMatchObject({ approvedBy: NASRIN.staffId })
    expect(await eventsOf(commitId)).toContain("RefundApproved")
  })

  it("imaging not done: cancelled and refunded, the radiologist's fee share reversed", async () => {
    const line = await lineOf(invoiceId, abdul.imagingOrderId)
    const [accrual] = await db.feeShareAccruals
      .where("invoiceLineId")
      .equals(line.id)
      .toArray()
    expect(accrual).toMatchObject({
      doctorId: "doc_enamul_kabir",
      serviceType: "imaging",
    })
    expect(accrual.shareP).toBe(Math.round(line.netP * 0.3))

    const { result, commitId } = await commit(
      cancelLine,
      {
        invoiceLineId: line.id,
        reason: "Done elsewhere",
        idempotencyKey: "cancel-xray-0001",
      },
      { db, actor: RAFIQ }
    )
    expect(result.stage).toBe("imaging-pending")
    expect((await db.imagingOrders.get(abdul.imagingOrderId))!).toMatchObject({
      status: "cancelled",
      paymentCleared: false,
    })
    expect(result.reversals).toHaveLength(1)
    const reversal = (await db.feeShareAccruals.get(
      result.reversals[0].accrualId
    ))!
    expect(reversal).toMatchObject({
      reversalOfId: accrual.id,
      doctorId: accrual.doctorId,
      shareP: -accrual.shareP,
      whtP: -accrual.whtP,
      netP: -accrual.netP,
      grossP: -accrual.grossP,
    })
    expect(await eventsOf(commitId)).toContain("FeeShareReversed")
    // Reversed once only: the refunds screen no longer lists it as live.
    const view = (await refundView(db, invoiceId))!
    expect(view.reversals.some((r) => r.id === reversal.id)).toBe(true)
    expect(
      view.lines.find((l) => l.line.id === line.id)!.accruals
    ).toHaveLength(0)
  })

  it("a consultation is refunded only once the appointment is cancelled (refund requested)", async () => {
    const line = await lineOf(invoiceId, abdul.appointmentId)
    const input = {
      invoiceLineIds: [line.id],
      kind: "refund" as const,
      reason: "Doctor delay: the patient chose a refund",
      idempotencyKey: "refund-consult-0001",
    }
    await expect(
      commit(refund, input, { db, actor: RAFIQ })
    ).rejects.toMatchObject({
      code: "CONSULT_CANCEL_AT_RECEPTION",
    })
    expect(await refundRequestsAt(db, "B1")).toHaveLength(0)

    // What the front desk's doctor-delay flow writes (WS-A): cancelled, choice "refund".
    const appointment = (await db.appointments.get(abdul.appointmentId))!
    await db.appointments.put({
      ...appointment,
      status: "cancelled",
      delayChoice: "refund",
      version: appointment.version + 1,
    })
    const requests = await refundRequestsAt(db, "B1")
    expect(requests.map((r) => r.appointment.id)).toEqual([abdul.appointmentId])
    expect(requests[0].line.id).toBe(line.id)
    expect(line.netP).toBeLessThanOrEqual(CASHIER_REFUND_LIMIT_P)

    const { result } = await commit(refund, input, { db, actor: RAFIQ })
    expect(result.approvalId).toBeUndefined()
    expect(result.amountP).toBe(line.netP)
    expect((await db.invoiceLines.get(line.id))!.status).toBe("refunded")
    // Dr. Kamal's consultation share is reversed with the fee.
    expect(result.reversals.map((r) => r.doctorId)).toEqual([HERO.doctor.kamal])
    expect(await refundRequestsAt(db, "B1")).toHaveLength(0)
  })

  it("medicines go back through the pharmacy, not the cashier", async () => {
    const line = await lineOf(invoiceId, abdul.rxLineIds[0])
    await expect(
      commit(
        cancelLine,
        {
          invoiceLineId: line.id,
          reason: "Not needed",
          idempotencyKey: "cancel-med-0001",
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "MEDICINE_RETURN_AT_PHARMACY" })
  })
})

describe("after validation: blocked, goodwill refund only", () => {
  let rokeya: HeroBasket
  let invoiceId: Id

  beforeAll(async () => {
    rokeya = await heroBasket(db, HERO.patient.rokeyaBegum, {
      viaBooking: false,
    })
    const { result } = await commit(
      checkout,
      {
        patientId: rokeya.patientId,
        basketLineIds: rokeya.lineIds,
        tenders: [{ tender: "cash", amountP: rokeya.totalP }],
        idempotencyKey: "refund-rokeya-0001",
      },
      { db, actor: RAFIQ }
    )
    invoiceId = result.invoiceId
    const patient = (await db.patients.get(rokeya.patientId))!
    const cbc = rokeya.labItemIds[0]
    const specimenId = (await specimenOf(cbc)).id
    await commit(
      collectSpecimen,
      { specimenId, secondIdentifier: patient.dob },
      { db, actor: labtech }
    )
    await commit(receiveSpecimen, { specimenId }, { db, actor: labtech })
    await commit(importAnalyserResults, { specimenId }, { db, actor: labtech })
    await commit(validateItem, { itemId: cbc }, { db, actor: labtech })
    expect((await db.labOrderItems.get(cbc))!.status).toBe("validated")
  })

  it("a cash refund needs the cashier's own open shift", async () => {
    const line = await lineOf(invoiceId, rokeya.labItemIds[1])
    await expect(
      commit(
        cancelLine,
        {
          invoiceLineId: line.id,
          reason: "Not needed",
          idempotencyKey: "cancel-nasrin-0001",
        },
        { db, actor: NASRIN }
      )
    ).rejects.toMatchObject({ code: "NO_OPEN_SHIFT_REFUND" })
  })

  it("cancelling is blocked and the attempt audited; the result stays", async () => {
    const line = await lineOf(invoiceId, rokeya.labItemIds[0])
    const view = (await refundView(db, invoiceId))!
    expect(view.lines.find((l) => l.line.id === line.id)!.info).toEqual({
      stage: "lab-validated",
      action: "cancel",
      rule: "blocked",
    })
    await expect(
      commit(
        cancelLine,
        {
          invoiceLineId: line.id,
          reason: "Patient unhappy",
          approval: NASRIN_OK,
          idempotencyKey: "cancel-val-0001",
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "CANCEL_AFTER_VALIDATION" })
    const blocked = await db.audit.where("entity").equals("command").toArray()
    expect(
      blocked.some(
        (row) =>
          row.entityId === "billing.cancelLine" &&
          row.action === "blocked" &&
          row.code === "CANCEL_AFTER_VALIDATION"
      )
    ).toBe(true)
    expect((await db.labOrderItems.get(rokeya.labItemIds[0]))!.status).toBe(
      "validated"
    )
    // A plain refund is refused too: only goodwill is left.
    await expect(
      commit(
        refund,
        {
          invoiceLineIds: [line.id],
          kind: "refund",
          reason: "Patient unhappy",
          idempotencyKey: "refund-val-0001",
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "GOODWILL_ONLY" })
  })

  it("a goodwill refund always needs a supervisor, and the result stays", async () => {
    const line = await lineOf(invoiceId, rokeya.labItemIds[0])
    const input = {
      invoiceLineIds: [line.id],
      kind: "goodwill" as const,
      reason: "Long wait for the report",
      idempotencyKey: "goodwill-0001",
    }
    await expect(
      commit(refund, input, { db, actor: RAFIQ })
    ).rejects.toMatchObject({
      code: "GOODWILL_APPROVAL_REQUIRED",
    })
    const { result } = await commit(
      refund,
      { ...input, approval: NASRIN_OK },
      { db, actor: RAFIQ }
    )
    expect((await db.approvals.get(result.approvalId!))!.kind).toBe("goodwill")
    expect(result.refunds).toEqual([
      expect.objectContaining({ tender: "cash", amountP: line.netP }),
    ])
    expect((await db.invoiceLines.get(line.id))!.status).toBe("refunded")
    expect((await db.labOrderItems.get(rokeya.labItemIds[0]))!.status).toBe(
      "validated"
    )
  })

  it("the whole invoice refunded marks it and its payment refunded", async () => {
    const view = (await refundView(db, invoiceId))!
    const open = view.lines
      .filter((l) => l.line.status === "active")
      .map((l) => l.line.id)
    await commit(
      refund,
      {
        invoiceLineIds: open,
        kind: "goodwill",
        reason: "Service complaint settled",
        approval: NASRIN_OK,
        idempotencyKey: "goodwill-all-0001",
      },
      { db, actor: RAFIQ }
    )
    const invoice = (await db.invoices.get(invoiceId))!
    expect(invoice).toMatchObject({
      status: "refunded",
      refundedP: invoice.paidP,
    })
    const payments = await db.payments
      .where("invoiceId")
      .equals(invoiceId)
      .toArray()
    expect(payments.every((p) => p.status === "refunded")).toBe(true)
    await expect(
      commit(
        refund,
        {
          invoiceLineIds: [open[0]],
          kind: "goodwill",
          reason: "Again",
          approval: NASRIN_OK,
          idempotencyKey: "goodwill-again-01",
        },
        { db, actor: RAFIQ }
      )
    ).rejects.toMatchObject({ code: "INVOICE_NOT_PAID" })
  })

  it("a paid fee cancelled with the doctor-delay refund choice is listed and refunded in one step", async () => {
    // The front desk's real flow (WS-A): a paid booking, the doctor runs late, the patient picks "refund".
    const session = SEED_REFS.session.arifToday
    const booked = (
      await db.appointments.where("sessionId").equals(session).toArray()
    ).filter((a) => a.status === "booked" && a.feeBasketLineId)
    let appointment = undefined as (typeof booked)[number] | undefined
    for (const candidate of booked) {
      const fee = await db.basketLines.get(candidate.feeBasketLineId!)
      const patient = await db.patients.get(candidate.patientId)
      if (fee?.status === "open" && !patient?.corporateEmployeeId) {
        appointment = candidate
        break
      }
    }
    expect(appointment).toBeDefined()
    const fee = (await db.basketLines.get(appointment!.feeBasketLineId!))!
    await commit(
      checkout,
      {
        patientId: appointment!.patientId,
        basketLineIds: [fee.id],
        tenders: [{ tender: "cash", amountP: fee.qty * fee.unitPriceP }],
        idempotencyKey: `delay-fee-${appointment!.id}`,
      },
      { db, actor: RAFIQ }
    )
    await commit(
      recordDelay,
      { sessionId: session, minutes: 45, reason: "traffic" },
      { db, actor: RECEPTION }
    )
    const choice = await commit(
      applyDelayChoice,
      { appointmentId: appointment!.id, choice: "refund" },
      { db, actor: RECEPTION }
    )
    expect(choice.result.feePaid).toBe(true)

    const requests = await refundRequestsAt(db, "B1")
    const request = requests.find((r) => r.appointment.id === appointment!.id)!
    expect(request.line.basketLineId).toBe(fee.id)
    expect(request.doctor?.en).toBe("Dr. Arif Rahman")
    const { result } = await commit(
      refund,
      {
        invoiceLineIds: [request.line.id],
        kind: "refund",
        reason: "Doctor delay: the patient chose a refund",
        idempotencyKey: `delay-refund-${appointment!.id}`,
      },
      { db, actor: RAFIQ }
    )
    expect(result.amountP).toBe(fee.qty * fee.unitPriceP)
    expect(result.refunds.map((r) => r.tender)).toEqual(["cash"])
    expect(result.reversals.map((r) => r.doctorId)).toEqual([HERO.doctor.arif])
    expect(
      (await refundRequestsAt(db, "B1")).some(
        (r) => r.appointment.id === appointment!.id
      )
    ).toBe(false)
  })

  it("credit notes are numbered per company and fiscal year, one after another", async () => {
    const numbers = (await db.creditNotes.toArray())
      .map((note) => note.creditNoteNo)
      .filter((no) => /^CN-C1-\d{4}-\d{6}$/.test(no))
      .sort()
    expect(numbers.length).toBeGreaterThanOrEqual(6)
    numbers.forEach((no, index) =>
      expect(no.endsWith(String(index + 1).padStart(6, "0"))).toBe(true)
    )
  })
})
