import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { issueCorporateCreditNote } from "@/modules/finance/commands"
import { corporateClients, corporateStatement } from "@/modules/finance/queries"
import { CORPORATE_CN_CFO_LIMIT_P, corporateMoney, creditNoteRoomP } from "@/modules/finance/rules"

import {
  dropDb,
  expectRule,
  IMRAN,
  key,
  plantCorporateInvoice,
  SABRINA,
  SABRINA_APPROVAL,
  seededDb,
  today,
} from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("finance-corporate")
})
afterAll(async () => {
  await dropDb(db)
})

/** A client and month that have corporate invoices in this seed (they vary by weekday). */
async function someStatement() {
  const clients = await corporateClients(db)
  const view = clients.find((c) => c.months.length > 0)!
  const month = view.months[0]
  return { view, month, statement: await corporateStatement(db, view.client.id, month) }
}

describe("corporate statement rules (pure)", () => {
  it("splits an invoice into co-pay at the counter, company share and credit notes", () => {
    const money = corporateMoney({
      totalP: 1_000_00,
      payments: [
        { tender: "cash", amountP: 200_00, status: "confirmed" },
        { tender: "corporate", amountP: 800_00, status: "confirmed" },
        { tender: "bkash", amountP: 50_00, status: "pending" },
      ],
      refunds: [{ tender: "corporate", amountP: 100_00, status: "completed" }],
      disputes: [{ amountP: 150_00 }],
    })
    expect(money).toEqual({
      totalP: 1_000_00,
      coPayP: 200_00,
      companyShareP: 700_00,
      creditNotesP: 150_00,
      dueP: 550_00,
    })
    expect(creditNoteRoomP(money)).toBe(550_00)
  })
})

describe("the monthly company statement", () => {
  it("shows the co-pay and company share of every corporate invoice, and the amount due", async () => {
    const { view, statement } = await someStatement()
    expect(view.contract?.coPayPct).toBe(20)
    expect(view.roster.length).toBeGreaterThan(0)
    expect(statement.lines.length).toBeGreaterThan(0)
    for (const line of statement.lines) {
      expect(line.invoice.corporateClientId).toBe(view.client.id)
      expect(line.money.coPayP + line.money.companyShareP).toBe(line.invoice.totalP - line.invoice.refundedP)
      // The co-pay is 20% of the contract price (the seed bills consultations and tests only).
      expect(line.money.coPayP).toBe(Math.round((line.invoice.totalP * 20) / 100))
      expect(line.employee?.clientId).toBe(view.client.id)
      expect(line.services.length).toBeGreaterThan(0)
    }
    const shares = statement.lines.reduce((s, l) => s + l.money.companyShareP, 0)
    expect(statement.totals.companyShareP).toBe(shares)
    expect(statement.totals.dueP).toBe(shares - statement.totals.creditNotesP)
  })
})

describe("finance.issueCorporateCreditNote", () => {
  it("a credit note reduces the amount due and restores the employee's limit, in one commit", async () => {
    const { view, month, statement } = await someStatement()
    const line = statement.lines[0]
    const employee = line.employee!
    const amountP = Math.min(200_00, line.money.companyShareP)
    const invoiceBefore = (await db.invoices.get(line.invoice.id))!
    const paymentsBefore = await db.payments.where("invoiceId").equals(line.invoice.id).toArray()

    const { result, events } = await commit(
      issueCorporateCreditNote,
      { invoiceId: line.invoice.id, amountP, reason: "Service disputed by the company", idempotencyKey: key() },
      { db, actor: IMRAN }
    )
    expect(result.creditNoteNo).toMatch(/^CN-C\d-\d{4}-\d{6}$/)
    const note = (await db.creditNotes.get(result.creditNoteId))!
    expect(note).toMatchObject({
      kind: "corporate-dispute",
      corporateClientId: view.client.id,
      invoiceId: line.invoice.id,
      amountP,
    })
    expect(note.lines.reduce((s, l) => s + l.amountP, 0)).toBe(amountP)
    expect(note.approvalId).toBeUndefined()

    const after = await corporateStatement(db, view.client.id, month)
    expect(after.totals.dueP).toBe(statement.totals.dueP - amountP)
    const afterLine = after.lines.find((l) => l.invoice.id === line.invoice.id)!
    expect(afterLine.money.creditNotesP).toBe(line.money.creditNotesP + amountP)
    expect((await db.corporateEmployees.get(employee.id))!.usedP).toBe(Math.max(0, employee.usedP - amountP))

    // Invoices and payments are not touched: the credit note is on the statement.
    expect((await db.invoices.get(line.invoice.id))!).toEqual(invoiceBefore)
    expect(await db.payments.where("invoiceId").equals(line.invoice.id).toArray()).toEqual(paymentsBefore)
    expect(events.map((e) => e.type)).toEqual(["CreditNoteIssued", "CorporateCreditNoteIssued"])
    expect(events[0].params).toMatchObject({ creditNoteNo: result.creditNoteNo, invoiceNo: line.invoice.invoiceNo })
  })

  it("never credits more than the company share left, nor a zero amount or a self-pay invoice", async () => {
    const { statement } = await someStatement()
    const line = statement.lines[0]
    const room = creditNoteRoomP(line.money)
    const violation = await expectRule(
      commit(
        issueCorporateCreditNote,
        { invoiceId: line.invoice.id, amountP: room + 1, reason: "Too much", idempotencyKey: key() },
        { db, actor: IMRAN }
      ),
      "CN_ABOVE_SHARE"
    )
    expect(violation.params.maxP).toBe(room)
    await expectRule(
      commit(issueCorporateCreditNote, { invoiceId: line.invoice.id, amountP: 0, reason: "Nothing", idempotencyKey: key() }, { db, actor: IMRAN }),
      "CN_AMOUNT_INVALID"
    )
    const selfPay = (await db.invoices.filter((i) => i.payerType === "self").first())!
    await expectRule(
      commit(issueCorporateCreditNote, { invoiceId: selfPay.id, amountP: 100, reason: "Not corporate", idempotencyKey: key() }, { db, actor: IMRAN }),
      "CN_NOT_CORPORATE"
    )
  })

  it("above ৳5,000 the CFO decides: Imran needs her inline approval, Sabrina issues it herself", async () => {
    const { view } = await someStatement()
    const member = view.roster.find((r) => r.patient && r.employee.status === "active")!
    const { invoice } = await plantCorporateInvoice(db, {
      patientId: member.patient!.id,
      clientId: view.client.id,
      totalP: 20_000_00,
      coPayP: 4_000_00,
      day: today(),
    })
    const amountP = CORPORATE_CN_CFO_LIMIT_P + 500_00
    const input = { invoiceId: invoice.id, amountP, reason: "Procedure not covered by the contract", idempotencyKey: key() }
    const violation = await expectRule(commit(issueCorporateCreditNote, input, { db, actor: IMRAN }), "CN_NEEDS_CFO")
    expect(violation.params.limitP).toBe(CORPORATE_CN_CFO_LIMIT_P)

    const { result, events } = await commit(issueCorporateCreditNote, { ...input, approval: SABRINA_APPROVAL }, { db, actor: IMRAN })
    const approval = (await db.approvals.get(result.approvalId!))!
    expect(approval).toMatchObject({ kind: "credit-note", requestedBy: IMRAN.staffId, approverId: SABRINA.staffId, amountP })
    expect((await db.creditNotes.get(result.creditNoteId))!.approvalId).toBe(approval.id)
    expect(events.map((e) => e.type)).toEqual(["CfoApproved", "CreditNoteIssued", "CorporateCreditNoteIssued"])

    const own = await commit(
      issueCorporateCreditNote,
      { ...input, amountP: CORPORATE_CN_CFO_LIMIT_P + 100_00, idempotencyKey: key() },
      { db, actor: SABRINA }
    )
    expect(own.result.approvalId).toBeUndefined()
    // ৳16,000 company share: 5,500 + 5,100 credited, 5,400 left.
    await expectRule(
      commit(issueCorporateCreditNote, { ...input, amountP: 5_401_00, idempotencyKey: key() }, { db, actor: SABRINA }),
      "CN_ABOVE_SHARE"
    )
  })
})
