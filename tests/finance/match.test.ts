import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { rules } from "@/config/rules.config"
import { seedRow } from "@/core/db/base"
import type { MedcoreDb } from "@/core/db/database"
import type { ThreeWayMatchRow, VendorInvoiceRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { ConflictError } from "@/core/engine/errors"
import { resolveMismatch } from "@/modules/finance/commands"
import { matchWorklist } from "@/modules/finance/queries"
import {
  acceptedByPoLine,
  acceptNeedsCfo,
  diffPct,
  payAtPoPriceP,
  resolutionAmountP,
} from "@/modules/finance/rules"

import { dropDb, expectRule, IMRAN, key, SABRINA, SABRINA_APPROVAL, seededDb, TARIQ } from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("finance-match")
})
afterAll(async () => {
  await dropDb(db)
})

/** PO-1038's mismatch as the seed leaves it. */
async function po1038() {
  const po = (await db.purchaseOrders.where("poNo").equals("PO-1038").first())!
  const match = (await db.threeWayMatches.where("poId").equals(po.id).first())!
  return { po, match }
}

let cloneCounter = 0

/**
 * Another copy of PO-1038's mismatch (a second invoice for the same receipt)
 * so each resolution starts from an open mismatch.
 */
async function cloneMismatch(): Promise<{ match: ThreeWayMatchRow; invoice: VendorInvoiceRow }> {
  const { match } = await po1038()
  const original = (await db.vendorInvoices.get(match.vendorInvoiceId))!
  cloneCounter += 1
  const invoice: VendorInvoiceRow = {
    ...original,
    id: `vi_fx_${cloneCounter}`,
    vendorInvoiceNo: `VI-9${String(cloneCounter).padStart(4, "0")}`,
    status: "mismatch",
    version: 1,
  }
  await db.vendorInvoices.add(invoice)
  const clone = seedRow<ThreeWayMatchRow>(`twm_fx_${cloneCounter}`, match.createdAt, {
    poId: match.poId,
    grnIds: match.grnIds,
    vendorInvoiceId: invoice.id,
    status: "mismatch",
    diffs: match.diffs,
    note: match.note,
  })
  await db.threeWayMatches.add(clone)
  return { match: clone, invoice }
}

describe("mismatch rules (pure)", () => {
  const diffs: ThreeWayMatchRow["diffs"] = [{ poLineId: "a", field: "price", po: 100, grn: 100, invoice: 106 }]

  it("pay at the PO price counts what was invoiced but no more than was accepted", () => {
    const accepted = acceptedByPoLine(
      [
        { grnId: "g1", poLineId: "a", qtyAccepted: 80 },
        { grnId: "g2", poLineId: "a", qtyAccepted: 10 },
        { grnId: "g9", poLineId: "a", qtyAccepted: 500 },
      ],
      ["g1", "g2"]
    )
    expect(accepted).toEqual({ a: 90 })
    const lines = [
      { poLineId: "a", qty: 100, unitCostP: 106 },
      { poLineId: "b", qty: 5, unitCostP: 50 },
    ]
    expect(payAtPoPriceP(lines, [{ id: "a", unitCostP: 100 }, { id: "b", unitCostP: 40 }], { ...accepted, b: 5 })).toBe(
      90 * 100 + 5 * 40
    )
    expect(
      resolutionAmountP("accept-invoice", {
        vendorInvoice: { amountP: 12_345, lines },
        poLines: [],
        accepted,
      })
    ).toBe(12_345)
    expect(resolutionAmountP("reject-invoice", { vendorInvoice: { amountP: 1, lines }, poLines: [], accepted })).toBeNull()
  })

  it("accepting outside the tolerance needs the CFO", () => {
    expect(acceptNeedsCfo(diffs)).toBe(true)
    expect(acceptNeedsCfo([{ ...diffs[0], invoice: 101 }])).toBe(false)
    expect(acceptNeedsCfo([{ poLineId: "a", field: "qty", po: 10, grn: 8, invoice: 10 }])).toBe(true)
    expect(diffPct(diffs[0])).toBeCloseTo(6, 5)
    expect(rules.threeWayMatch.priceTolerancePct).toBe(2)
  })
})

describe("finance.resolveMismatch", () => {
  it("the worklist shows PO-1038's mismatch first, with its price difference", async () => {
    const { open } = await matchWorklist(db, null)
    const view = open.find((v) => v.poNo === "PO-1038")!
    expect(view).toBeDefined()
    expect(view.diffs).toHaveLength(1)
    expect(view.diffs[0].field).toBe("price")
    expect(diffPct(view.diffs[0])!).toBeGreaterThan(rules.threeWayMatch.priceTolerancePct)
    expect(view.atPoPriceP).toBeLessThan(view.vendorInvoice!.amountP)
    // Only B1's worklist has it.
    expect((await matchWorklist(db, "B3")).open.find((v) => v.poNo === "PO-1038")).toBeUndefined()
  })

  it("pay at the PO price: the payable is what was accepted at the ordered price", async () => {
    const { po, match } = await po1038()
    const vendorInvoice = (await db.vendorInvoices.get(match.vendorInvoiceId))!
    const poLines = await db.poLines.where("poId").equals(po.id).toArray()
    const grnLines = await db.grnLines.where("grnId").anyOf(match.grnIds).toArray()
    const expected = vendorInvoice.lines.reduce((sum, line) => {
      const poLine = poLines.find((l) => l.id === line.poLineId)!
      const accepted = grnLines
        .filter((g) => g.poLineId === line.poLineId)
        .reduce((s, g) => s + g.qtyAccepted, 0)
      return sum + Math.min(line.qty, accepted) * poLine.unitCostP
    }, 0)
    expect(expected).toBeLessThan(vendorInvoice.amountP)
    const poBefore = (await db.purchaseOrders.get(po.id))!

    const { result, events } = await commit(
      resolveMismatch,
      {
        matchId: match.id,
        expectedVersion: match.version,
        resolution: "pay-po-price",
        note: "Paid at the agreed PO price; vendor to credit the difference",
        idempotencyKey: key(),
      },
      { db, actor: IMRAN }
    )
    expect(result).toMatchObject({ resolution: "pay-po-price", amountP: expected })
    const payable = (await db.payables.get(result.payableId!))!
    expect(payable).toMatchObject({ amountP: expected, status: "open", vendorInvoiceId: vendorInvoice.id, poId: po.id })
    const resolved = (await db.threeWayMatches.get(match.id))!
    expect(resolved).toMatchObject({ status: "resolved", resolution: "pay-po-price", resolvedBy: IMRAN.staffId })
    expect(resolved.resolvedAt).toBeGreaterThan(0)
    expect(resolved.approvalId).toBeUndefined()
    expect((await db.vendorInvoices.get(vendorInvoice.id))!.status).toBe("payable")
    // Fully received and now billed: procurement's rule closes the order in the same commit.
    expect(poBefore.status).toBe("received")
    expect((await db.purchaseOrders.get(po.id))!.status).toBe("closed")
    expect(events.map((e) => e.type).sort()).toEqual([
      "MismatchResolved",
      "PayableCreated",
      "PurchaseOrderClosed",
    ])

    await expectRule(
      commit(
        resolveMismatch,
        { matchId: match.id, expectedVersion: resolved.version, resolution: "pay-po-price", idempotencyKey: key() },
        { db, actor: IMRAN }
      ),
      "MATCH_NOT_OPEN"
    )
    await expect(
      commit(
        resolveMismatch,
        { matchId: match.id, expectedVersion: match.version, resolution: "pay-po-price", idempotencyKey: key() },
        { db, actor: IMRAN }
      )
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("accepting the invoice price outside tolerance needs the CFO: Imran asks, Sabrina approves inline", async () => {
    const { match, invoice } = await cloneMismatch()
    const input = { matchId: match.id, expectedVersion: 1, resolution: "accept-invoice" as const, idempotencyKey: key() }
    await expectRule(commit(resolveMismatch, input, { db, actor: IMRAN }), "MISMATCH_NEEDS_CFO")
    await expectRule(
      commit(resolveMismatch, { ...input, approval: { ...SABRINA_APPROVAL, approverStaffId: IMRAN.staffId } }, { db, actor: IMRAN }),
      "APPROVAL_SAME_PERSON"
    )
    // The procurement head approves up to ৳5,00,000 of purchase requests, not this.
    await expectRule(
      commit(resolveMismatch, { ...input, approval: { ...SABRINA_APPROVAL, approverStaffId: TARIQ.staffId } }, { db, actor: IMRAN }),
      "APPROVER_NOT_CFO"
    )
    const { result, events } = await commit(
      resolveMismatch,
      { ...input, approval: SABRINA_APPROVAL },
      { db, actor: IMRAN }
    )
    expect(result.amountP).toBe(invoice.amountP)
    expect((await db.payables.get(result.payableId!))!.amountP).toBe(invoice.amountP)
    const approval = (await db.approvals.get(result.approvalId!))!
    expect(approval).toMatchObject({
      kind: "mismatch",
      requestedBy: IMRAN.staffId,
      approverId: SABRINA.staffId,
      status: "approved",
      pinVerified: true,
      amountP: invoice.amountP,
    })
    expect((await db.threeWayMatches.get(match.id))!.approvalId).toBe(approval.id)
    expect(events.map((e) => e.type).sort()).toEqual(["CfoApproved", "MismatchResolved", "PayableCreated"])
  })

  it("the CFO accepts the invoice price herself, with no separate approval", async () => {
    const { match, invoice } = await cloneMismatch()
    const { result } = await commit(
      resolveMismatch,
      { matchId: match.id, expectedVersion: 1, resolution: "accept-invoice", idempotencyKey: key() },
      { db, actor: SABRINA }
    )
    expect(result.approvalId).toBeUndefined()
    expect(result.amountP).toBe(invoice.amountP)
  })

  it("rejecting the invoice needs a reason, creates no payable and marks the invoice rejected", async () => {
    const { match, invoice } = await cloneMismatch()
    const input = { matchId: match.id, expectedVersion: 1, resolution: "reject-invoice" as const, idempotencyKey: key() }
    await expectRule(commit(resolveMismatch, input, { db, actor: IMRAN }), "MATCH_NOTE_REQUIRED")
    const payablesBefore = await db.payables.count()
    const { result, events } = await commit(
      resolveMismatch,
      { ...input, note: "Price not agreed; vendor to reissue at the PO price" },
      { db, actor: IMRAN }
    )
    expect(result.payableId).toBeUndefined()
    expect(await db.payables.count()).toBe(payablesBefore)
    expect((await db.vendorInvoices.get(invoice.id))!.status).toBe("rejected")
    expect((await db.threeWayMatches.get(match.id))!).toMatchObject({ status: "resolved", resolution: "reject-invoice" })
    expect(events.map((e) => e.type)).toEqual(["MismatchResolved"])
  })

  it("refuses a vendor invoice settled elsewhere and nothing accepted into stock", async () => {
    const { match, invoice } = await cloneMismatch()
    await db.vendorInvoices.update(invoice.id, { status: "payable" })
    await expectRule(
      commit(resolveMismatch, { matchId: match.id, expectedVersion: 1, resolution: "pay-po-price", idempotencyKey: key() }, { db, actor: SABRINA }),
      "VENDOR_INVOICE_SETTLED"
    )
    const second = await cloneMismatch()
    await db.threeWayMatches.update(second.match.id, { grnIds: [] })
    await expectRule(
      commit(resolveMismatch, { matchId: second.match.id, expectedVersion: 1, resolution: "pay-po-price", idempotencyKey: key() }, { db, actor: SABRINA }),
      "NOTHING_TO_PAY"
    )
  })
})
