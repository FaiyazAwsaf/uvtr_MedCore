import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { companies } from "@/config/brand.config"
import { addDaysISO } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { PermissionDenied } from "@/core/engine/errors"
import { checkout } from "@/modules/billing/commands"
import { issueCorporateCreditNote, payPayable, recordExport, resolveMismatch } from "@/modules/finance/commands"
import {
  accountNameEn,
  buildJournal,
  journalCsv,
  journalFileName,
  type JournalRecords,
} from "@/modules/finance/journal"
import { corporateClients, corporateStatement, journalPreview } from "@/modules/finance/queries"
import { loadJournalRecords, readerOf } from "@/modules/finance/records"

import { heroBasket } from "../billing/fixtures"
import { dropDb, expectRule, IMRAN, key, RAFIQ, SABRINA, seededDb, today, yesterday } from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("finance-journal")
})
afterAll(async () => {
  await dropDb(db)
})

function empty(date: string): JournalRecords {
  return {
    date,
    invoices: [],
    payments: [],
    creditNotes: [],
    accruals: [],
    deposits: [],
    payablesCreated: [],
    payablesPaid: [],
  }
}

async function expectAllBalanced(date: string) {
  for (const company of companies) {
    const journal = await journalPreview(db, date, company.code)
    expect(journal.totalDebitP, `${company.code} on ${date}`).toBe(journal.totalCreditP)
    expect(journal.balanced).toBe(true)
    for (const row of journal.rows) {
      expect(row.debitP === 0 || row.creditP === 0).toBe(true)
      expect(row.debitP + row.creditP).toBeGreaterThan(0)
    }
  }
}

describe("the journal (pure)", () => {
  it("posts receipts, revenue, refunds, fee share, deposits and vendor payables in balance", () => {
    const records: JournalRecords = {
      ...empty("2026-09-28"),
      invoices: [
        {
          companyId: "C1",
          invoiceNo: "C1-B1-2627-000001",
          lines: [
            { serviceType: "consultation", netP: 1_000_00 },
            { serviceType: "lab", netP: 500_00 },
          ],
        },
        { companyId: "C2", invoiceNo: "C2-B3-2627-000001", lines: [{ serviceType: "lab", netP: 999_00 }] },
      ],
      payments: [
        { companyId: "C1", tender: "cash", amountP: 700_00 },
        { companyId: "C1", tender: "bkash", amountP: 500_00 },
        { companyId: "C1", tender: "corporate", amountP: 200_00 },
      ],
      creditNotes: [
        {
          companyId: "C1",
          creditNoteNo: "CN-C1-2627-000001",
          kind: "refund",
          lines: [{ serviceType: "lab", amountP: 500_00 }],
          refunds: [{ tender: "cash", amountP: 500_00 }],
        },
        {
          companyId: "C1",
          creditNoteNo: "CN-C1-2627-000002",
          kind: "corporate-dispute",
          lines: [{ serviceType: "consultation", amountP: 50_00 }],
          refunds: [],
        },
      ],
      accruals: [
        { companyId: "C1", shareP: 700_00, whtP: 70_00 },
        { companyId: "C1", shareP: -70_00, whtP: -7_00 },
      ],
      deposits: [{ companyId: "C1", tender: "card", amountP: 10_000_00 }],
      payablesCreated: [{ companyId: "C1", amountP: 50_000_00 }],
      payablesPaid: [{ companyId: "C1", amountP: 20_000_00 }],
    }
    const journal = buildJournal(records, "C1")
    expect(journal.balanced).toBe(true)
    const row = (section: string, account: string) =>
      journal.rows.find((r) => r.section === section && r.account === account)
    expect(row("receipts", "cash")).toMatchObject({ debitP: 700_00 })
    expect(row("receipts", "corporateReceivable")).toMatchObject({ debitP: 200_00 })
    expect(row("revenue", "revenue.consultation")).toMatchObject({ creditP: 1_000_00 })
    expect(row("revenue", "revenue.lab")).toMatchObject({ creditP: 500_00 })
    // Billed 1,500, received 1,400: 100 still owed by the patient.
    expect(row("receivable", "patientReceivable")).toMatchObject({ debitP: 100_00 })
    expect(row("refunds", "revenue.lab")).toMatchObject({ debitP: 500_00 })
    expect(row("refunds", "cash")).toMatchObject({ creditP: 500_00 })
    expect(row("refunds", "corporateReceivable")).toMatchObject({ creditP: 50_00 })
    expect(row("feeShare", "feeShareExpense")).toMatchObject({ debitP: 630_00 })
    expect(row("feeShare", "consultantPayable")).toMatchObject({ creditP: 567_00 })
    expect(row("feeShare", "whtPayable")).toMatchObject({ creditP: 63_00 })
    expect(row("deposits", "card")).toMatchObject({ debitP: 10_000_00 })
    expect(row("deposits", "patientDeposits")).toMatchObject({ creditP: 10_000_00 })
    expect(row("purchases", "inventory")).toMatchObject({ debitP: 50_000_00 })
    expect(row("vendorPayments", "bank")).toMatchObject({ creditP: 20_000_00 })
    // The other company's invoice is not in C1's journal.
    expect(journal.counts.invoices).toBe(1)
    expect(buildJournal(records, "C2")).toMatchObject({ totalDebitP: 999_00, totalCreditP: 999_00 })
    expect(buildJournal(records, "C3").rows).toEqual([])
  })

  it("writes a CSV with English account names, DD-MM-YYYY dates and a totals row", () => {
    const journal = buildJournal(
      {
        ...empty("2026-09-28"),
        invoices: [{ companyId: "C1", invoiceNo: "x", lines: [{ serviceType: "consultation", netP: 1_234_50 }] }],
        payments: [{ companyId: "C1", tender: "cash", amountP: 1_234_50 }],
      },
      "C1"
    )
    const csv = journalCsv(journal).trim().split("\n")
    expect(csv[0]).toBe("Date,Company,Account code,Account,Memo,Debit,Credit")
    expect(csv).toContain("28-09-2026,C1,1110,Cash in hand,Money received,1234.50,")
    expect(csv).toContain("28-09-2026,C1,4110,Revenue: Consultation,Invoices issued,,1234.50")
    expect(csv.at(-1)).toBe("28-09-2026,C1,,,Total,1234.50,1234.50")
    expect(journalFileName("C1", "2026-09-28")).toBe("C1-journal-2026-09-28.csv")
    expect(accountNameEn("revenue.lab")).toBe("Revenue: Laboratory")
  })
})

describe("the seeded books", () => {
  it("yesterday's and today's journals balance for every company", async () => {
    await expectAllBalanced(yesterday())
    await expectAllBalanced(today())
    const c1 = await journalPreview(db, yesterday(), "C1")
    expect(c1.rows.length).toBeGreaterThan(3)
    expect(c1.counts.invoices).toBeGreaterThan(0)
    expect(c1.counts.payments).toBeGreaterThan(0)
  })

  it("the records a day posts are those of that day only", async () => {
    const records = await loadJournalRecords(readerOf(db), yesterday())
    const invoices = await db.invoices.where("date").equals(yesterday()).toArray()
    expect(records.invoices.length).toBe(invoices.filter((i) => i.status !== "void").length)
    expect(records.date).toBe(yesterday())
  })

  it("a payment taken at the cashier shows in today's journal at once, still balanced", async () => {
    const before = await journalPreview(db, today(), "C1")
    const cashBefore = before.rows.find((r) => r.section === "receipts" && r.account === "cash")?.debitP ?? 0
    const basket = await heroBasket(db)
    const { result } = await commit(
      checkout,
      {
        patientId: basket.patientId,
        basketLineIds: basket.lineIds,
        tenders: [{ tender: "cash", amountP: basket.totalP, tenderedP: basket.totalP }],
        idempotencyKey: key("checkout"),
      },
      { db, actor: RAFIQ }
    )
    expect(result.status).toBe("paid")
    const after = await journalPreview(db, today(), "C1")
    const cashAfter = after.rows.find((r) => r.section === "receipts" && r.account === "cash")!.debitP
    expect(cashAfter - cashBefore).toBe(basket.totalP)
    expect(after.balanced).toBe(true)
    expect(after.counts.invoices).toBe(before.counts.invoices + 1)
    expect(after.counts.accruals).toBeGreaterThan(before.counts.accruals)
  })

  it("resolutions, credit notes and vendor payments keep every company's books balanced", async () => {
    const po = (await db.purchaseOrders.where("poNo").equals("PO-1038").first())!
    const match = (await db.threeWayMatches.where("poId").equals(po.id).first())!
    const resolved = await commit(
      resolveMismatch,
      { matchId: match.id, expectedVersion: match.version, resolution: "pay-po-price", idempotencyKey: key() },
      { db, actor: SABRINA }
    )
    const payable = (await db.payables.get(resolved.result.payableId!))!
    await commit(payPayable, { payableId: payable.id, expectedVersion: payable.version, idempotencyKey: key() }, { db, actor: SABRINA })
    const clients = await corporateClients(db)
    const view = clients.find((c) => c.months.length > 0)!
    const statement = await corporateStatement(db, view.client.id, view.months[0])
    await commit(
      issueCorporateCreditNote,
      { invoiceId: statement.lines[0].invoice.id, amountP: 100_00, reason: "Disputed line", idempotencyKey: key() },
      { db, actor: IMRAN }
    )
    await expectAllBalanced(today())
    const c1 = await journalPreview(db, today(), "C1")
    expect(c1.rows.some((r) => r.section === "purchases" && r.account === "inventory" && r.debitP === payable.amountP)).toBe(true)
    expect(c1.rows.some((r) => r.section === "vendorPayments" && r.account === "bank")).toBe(true)
  })
})

describe("finance.recordExport", () => {
  it("records a balanced export of the previewed journal", async () => {
    const journal = await journalPreview(db, yesterday(), "C1")
    const { result, events } = await commit(
      recordExport,
      {
        date: yesterday(),
        companyId: "C1",
        totalDebitP: journal.totalDebitP,
        totalCreditP: journal.totalCreditP,
        rows: journal.rows.length,
        idempotencyKey: key("export"),
      },
      { db, actor: IMRAN }
    )
    expect(result.fileName).toBe(`C1-journal-${yesterday()}.csv`)
    const row = (await db.accountingExports.get(result.exportId))!
    expect(row).toMatchObject({
      date: yesterday(),
      companyId: "C1",
      rows: journal.rows.length,
      totalDebitP: journal.totalDebitP,
      totalCreditP: journal.totalCreditP,
      exportedBy: IMRAN.staffId,
    })
    expect(events.map((e) => e.type)).toEqual(["AccountingExported"])
  })

  it("refuses a stale preview, a future day and a cashier", async () => {
    const journal = await journalPreview(db, yesterday(), "C2")
    const input = {
      date: yesterday(),
      companyId: "C2" as const,
      totalDebitP: journal.totalDebitP + 1,
      totalCreditP: journal.totalCreditP + 1,
      rows: journal.rows.length,
      idempotencyKey: key("export"),
    }
    await expectRule(commit(recordExport, input, { db, actor: IMRAN }), "EXPORT_STALE")
    await expectRule(
      commit(recordExport, { ...input, date: addDaysISO(today(), 1) }, { db, actor: IMRAN }),
      "EXPORT_FUTURE_DATE"
    )
    await expect(commit(recordExport, input, { db, actor: RAFIQ })).rejects.toBeInstanceOf(PermissionDenied)
  })
})
