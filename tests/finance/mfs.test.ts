import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { ConflictError, PermissionDenied } from "@/core/engine/errors"
import { importSettlement, matchSettlementLine, noteSettlementLine } from "@/modules/finance/commands"
import { settlementDetail, settlementFiles } from "@/modules/finance/queries"
import {
  autoMatchLines,
  candidateProblem,
  handMatchCandidates,
  matchedPaymentIds,
  settlementStatus,
} from "@/modules/finance/rules"

import {
  dropDb,
  expectRule,
  IMRAN,
  key,
  plantPayment,
  RAFIQ,
  SABRINA,
  seededDb,
  yesterday,
} from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("finance-mfs")
})
afterAll(async () => {
  await dropDb(db)
})

const BKASH = "mfs_bkash_yesterday"
const NAGAD = "mfs_nagad_yesterday"

async function file(id: string) {
  return (await db.mfsSettlements.get(id))!
}

describe("MFS settlement rules (pure)", () => {
  const settlement = { provider: "bkash" as const, date: "2026-09-28" }
  const pay = (over: Partial<Parameters<typeof candidateProblem>[2]> = {}) => ({
    id: "p1",
    tender: "bkash" as const,
    amountP: 650_00,
    status: "confirmed" as const,
    ref: "BKAAAA",
    requestedAt: Date.parse("2026-09-28T06:00:00Z"),
    confirmedAt: Date.parse("2026-09-28T06:00:10Z"),
    ...over,
  })

  it("auto-matches by exact reference and amount, once per payment", () => {
    const lines = [
      { ref: "BKAAAA", amountP: 650_00, at: 1 },
      { ref: "BKAAAA", amountP: 650_00, at: 2 },
      { ref: "BKBBBB", amountP: 100_00, at: 3 },
    ]
    const out = autoMatchLines("bkash", lines, [pay(), pay({ id: "p2", ref: "BKBBBB" })], new Set())
    expect(out.matched).toBe(1)
    expect(out.unmatched).toBe(2)
    expect(out.lines[0]).toMatchObject({ matchedPaymentId: "p1", matchedBy: "auto" })
    expect(out.lines[1].matchedPaymentId).toBeUndefined()
    // BKBBBB has the right reference but a different amount.
    expect(out.lines[2].matchedPaymentId).toBeUndefined()
    expect(settlementStatus(out.lines)).toBe("imported")
    expect(settlementStatus(out.lines.slice(0, 1))).toBe("reconciled")
  })

  it("skips payments another line already matched, and other providers", () => {
    const lines = [{ ref: "BKAAAA", amountP: 650_00, at: 1 }]
    expect(autoMatchLines("bkash", lines, [pay()], new Set(["p1"])).matched).toBe(0)
    expect(autoMatchLines("nagad", lines, [pay()], new Set()).matched).toBe(0)
  })

  it("hand-match candidates: same provider or cash, same amount, that day, not matched", () => {
    const line = { amountP: 650_00 }
    expect(candidateProblem(settlement, line, pay(), new Set())).toBeNull()
    expect(candidateProblem(settlement, line, pay({ tender: "cash" }), new Set())).toBeNull()
    expect(candidateProblem(settlement, line, pay({ tender: "card" }), new Set())).toBe("MATCH_WRONG_TENDER")
    expect(candidateProblem(settlement, line, pay({ amountP: 651_00 }), new Set())).toBe("MATCH_AMOUNT_DIFFERS")
    expect(
      candidateProblem(settlement, line, pay({ confirmedAt: Date.parse("2026-09-29T06:00:00Z") }), new Set())
    ).toBe("MATCH_WRONG_DAY")
    expect(candidateProblem(settlement, line, pay({ status: "pending" }), new Set())).toBe("MATCH_NOT_RECEIVED")
    expect(candidateProblem(settlement, line, pay(), new Set(["p1"]))).toBe("PAYMENT_ALREADY_MATCHED")
    const ranked = handMatchCandidates(settlement, line, [pay({ id: "c", tender: "cash" }), pay()], new Set())
    expect(ranked.map((c) => [c.payment.id, c.kind])).toEqual([
      ["p1", "mfs"],
      ["c", "cash"],
    ])
  })
})

describe("finance.importSettlement", () => {
  it("the seeded bKash file is imported with its 2 unmatched lines", async () => {
    const bkash = await file(BKASH)
    expect(bkash.status).toBe("imported")
    const unmatched = bkash.lines.filter((l) => !l.matchedPaymentId)
    expect(unmatched.map((l) => [l.ref, l.amountP])).toEqual([
      ["BK7QM2K9TD", 650_00],
      ["BK3XH8PLZW", 1_200_00],
    ])
    const files = await settlementFiles(db)
    expect(files.find((f) => f.file.id === BKASH)?.unmatched).toBe(2)
  })

  it("a cashier cannot import a settlement file", async () => {
    const nagad = await file(NAGAD)
    await expect(
      commit(importSettlement, { settlementId: NAGAD, expectedVersion: nagad.version, idempotencyKey: key() }, { db, actor: RAFIQ })
    ).rejects.toBeInstanceOf(PermissionDenied)
  })

  it("a line of a file still to import cannot be matched or noted", async () => {
    const nagad = await file(NAGAD)
    const [line] = nagad.lines
    await expectRule(
      commit(
        matchSettlementLine,
        { settlementId: NAGAD, expectedVersion: nagad.version, ref: line.ref, paymentId: "x", idempotencyKey: key() },
        { db, actor: IMRAN }
      ),
      "SETTLEMENT_NOT_IMPORTED"
    )
    await expectRule(
      commit(noteSettlementLine, { settlementId: NAGAD, expectedVersion: nagad.version, ref: line.ref, note: "x" }, { db, actor: IMRAN }),
      "SETTLEMENT_NOT_IMPORTED"
    )
  })

  it("importing the Nagad file auto-matches every line and reconciles it, in one commit", async () => {
    const before = await file(NAGAD)
    expect(before.status).toBe("pending-import")
    const { result, events } = await commit(
      importSettlement,
      { settlementId: NAGAD, expectedVersion: before.version, idempotencyKey: key() },
      { db, actor: IMRAN }
    )
    expect(result).toMatchObject({ status: "reconciled", matched: before.lines.length, unmatched: 0 })
    const after = await file(NAGAD)
    expect(after.status).toBe("reconciled")
    expect(after.importedAt).toBeGreaterThan(0)
    for (const line of after.lines) {
      expect(line.matchedBy).toBe("auto")
      const payment = (await db.payments.get(line.matchedPaymentId!))!
      expect(payment).toMatchObject({ tender: "nagad", ref: line.ref, amountP: line.amountP })
    }
    // Every payment matches at most one line across all files.
    const all = await db.mfsSettlements.toArray()
    const ids = all.flatMap((f) => f.lines.map((l) => l.matchedPaymentId).filter(Boolean))
    expect(new Set(ids).size).toBe(ids.length)
    expect(events.map((e) => e.type)).toEqual(["SettlementImported", "SettlementReconciled"])
    expect(events[0].params).toMatchObject({ provider: "Nagad", providerBn: "নগদ", matched: before.lines.length, unmatched: 0 })
  })

  it("a file cannot be imported twice, and a stale version conflicts", async () => {
    const nagad = await file(NAGAD)
    await expectRule(
      commit(importSettlement, { settlementId: NAGAD, expectedVersion: nagad.version, idempotencyKey: key() }, { db, actor: IMRAN }),
      "SETTLEMENT_ALREADY_IMPORTED"
    )
    await expect(
      commit(importSettlement, { settlementId: NAGAD, expectedVersion: nagad.version - 1, idempotencyKey: key() }, { db, actor: IMRAN })
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe("finance.matchSettlementLine and finance.noteSettlementLine", () => {
  it("an unmatched line only offers payments of its amount received that day, by bKash or cash", async () => {
    const detail = (await settlementDetail(db, BKASH))!
    const bkash = await file(BKASH)
    const taken = matchedPaymentIds(await db.mfsSettlements.toArray())
    const line = detail.lines.find((l) => l.line.ref === "BK3XH8PLZW")!
    expect(line.payment).toBeUndefined()
    for (const candidate of line.candidates) {
      expect(candidateProblem(bkash, line.line, candidate.payment, taken)).toBeNull()
      expect(candidate.kind).toBe(candidate.payment.tender === "cash" ? "cash" : "mfs")
    }
    // Matched lines offer nothing.
    expect(detail.lines.filter((l) => l.payment).every((l) => l.candidates.length === 0)).toBe(true)
  })

  it("a note marks a line under investigation without matching it", async () => {
    const bkash = await file(BKASH)
    const { events } = await commit(
      noteSettlementLine,
      { settlementId: BKASH, expectedVersion: bkash.version, ref: "BK3XH8PLZW", note: "Under investigation" },
      { db, actor: IMRAN }
    )
    const after = await file(BKASH)
    const line = after.lines.find((l) => l.ref === "BK3XH8PLZW")!
    expect(line).toMatchObject({ note: "Under investigation" })
    expect(line.matchedPaymentId).toBeUndefined()
    expect(after.status).toBe("imported")
    expect(events.map((e) => e.type)).toEqual(["SettlementLineNoted"])
  })

  it("a bKash line recorded as cash at the counter is matched by hand to that cash payment", async () => {
    // A ৳650 cash payment taken yesterday at B1 (the customer had in fact paid by bKash).
    const invoice = (await db.invoices.where("date").equals(yesterday()).filter((i) => i.branchId === "B1").first())!
    const cash = await plantPayment(db, { invoice, tender: "cash", amountP: 650_00, day: yesterday(), time: "13:40" })
    const wrongDay = await plantPayment(db, { invoice, tender: "cash", amountP: 650_00, day: "2026-01-01" })
    const card = await plantPayment(db, { invoice, tender: "card", amountP: 650_00, day: yesterday(), ref: "POS-100001" })

    const detail = (await settlementDetail(db, BKASH))!
    const view = detail.lines.find((l) => l.line.ref === "BK7QM2K9TD")!
    const offered = view.candidates.map((c) => c.payment.id)
    expect(offered).toContain(cash.id)
    expect(offered).not.toContain(wrongDay.id)
    expect(offered).not.toContain(card.id)
    expect(view.candidates.find((c) => c.payment.id === cash.id)?.kind).toBe("cash")

    const bkash = await file(BKASH)
    const input = { settlementId: BKASH, expectedVersion: bkash.version, ref: "BK7QM2K9TD", idempotencyKey: key() }
    await expectRule(commit(matchSettlementLine, { ...input, paymentId: wrongDay.id }, { db, actor: IMRAN }), "MATCH_WRONG_DAY")
    await expectRule(commit(matchSettlementLine, { ...input, paymentId: card.id }, { db, actor: IMRAN }), "MATCH_WRONG_TENDER")
    await expectRule(commit(matchSettlementLine, { ...input, paymentId: "pay_missing" }, { db, actor: IMRAN }), "PAYMENT_NOT_FOUND")
    await expectRule(
      commit(matchSettlementLine, { ...input, ref: "BKNOTHERE", paymentId: cash.id }, { db, actor: IMRAN }),
      "LINE_NOT_FOUND"
    )
    const matchedElsewhere = bkash.lines.find((l) => l.matchedPaymentId)!
    await expectRule(
      commit(matchSettlementLine, { ...input, ref: matchedElsewhere.ref, paymentId: cash.id }, { db, actor: IMRAN }),
      "LINE_ALREADY_MATCHED"
    )
    await expectRule(
      commit(matchSettlementLine, { ...input, ref: "BK3XH8PLZW", paymentId: cash.id }, { db, actor: IMRAN }),
      "MATCH_AMOUNT_DIFFERS"
    )

    const { result, events } = await commit(matchSettlementLine, { ...input, paymentId: cash.id }, { db, actor: IMRAN })
    expect(result.status).toBe("imported")
    const after = await file(BKASH)
    expect(after.lines.find((l) => l.ref === "BK7QM2K9TD")).toMatchObject({
      matchedPaymentId: cash.id,
      matchedBy: IMRAN.staffId,
    })
    expect(events.map((e) => e.type)).toEqual(["SettlementLineMatched"])
    expect(events[0].params).toMatchObject({ ref: "BK7QM2K9TD", invoiceNo: invoice.invoiceNo })
    // The payment row itself is not changed.
    expect((await db.payments.get(cash.id))!.version).toBe(1)

    // The same payment cannot explain a second line.
    expect(matchedPaymentIds(await db.mfsSettlements.toArray()).has(cash.id)).toBe(true)
  })

  it("matching the last unmatched line reconciles the file", async () => {
    const invoice = (await db.invoices.where("date").equals(yesterday()).filter((i) => i.branchId === "B1").first())!
    const bkashPay = await plantPayment(db, {
      invoice,
      tender: "bkash",
      amountP: 1_200_00,
      day: yesterday(),
      time: "18:10",
      ref: "BK3XH8PLZX",
    })
    const bkash = await file(BKASH)
    const { result, events } = await commit(
      matchSettlementLine,
      { settlementId: BKASH, expectedVersion: bkash.version, ref: "BK3XH8PLZW", paymentId: bkashPay.id, idempotencyKey: key() },
      { db, actor: SABRINA }
    )
    expect(result.status).toBe("reconciled")
    expect((await file(BKASH)).status).toBe("reconciled")
    expect(events.map((e) => e.type)).toEqual(["SettlementLineMatched", "SettlementReconciled"])
    // A noted line keeps its note once matched.
    expect((await file(BKASH)).lines.find((l) => l.ref === "BK3XH8PLZW")?.note).toBe("Under investigation")
    await expectRule(
      commit(noteSettlementLine, { settlementId: BKASH, expectedVersion: (await file(BKASH)).version, ref: "BK3XH8PLZW", note: "x" }, { db, actor: IMRAN }),
      "LINE_ALREADY_MATCHED"
    )
  })
})
