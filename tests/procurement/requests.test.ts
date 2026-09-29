import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import type { PurchaseRequestRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { ConflictError } from "@/core/engine/errors"
import { SEED_REFS } from "@/core/seed/content"
import { decidePr, issuePo, savePr, submitPr } from "@/modules/procurement/commands"

import { dropDb, seededDb } from "../pharmacy/fixtures"
import { anisur, DEPOT, habibur, inDays, NAPA, napaBox, sabrina, tariq } from "./fixtures"

let db: MedcoreDb
beforeAll(async () => {
  db = await seededDb("procurement-requests-test")
}, 60_000)
afterAll(async () => {
  await dropDb(db)
})

const submitted = async (branch: string, tier: PurchaseRequestRow["approvalTier"]) =>
  (await db.purchaseRequests.where("status").equals("submitted").toArray()).find(
    (pr) => pr.branchId === branch && pr.approvalTier === tier
  )!

describe("procurement.savePr", () => {
  it("saves a draft for the store manager's branch with pack quantities and the provisional tier", async () => {
    const { pack, costP } = await napaBox(db)
    const { result, events } = await commit(
      savePr,
      { lines: [{ brandId: NAPA, qty: 100, pack, estUnitCostP: costP }], vendorId: DEPOT },
      { db, actor: habibur }
    )
    expect(result.prNo).toMatch(/^PR-\d{4}$/)
    const pr = (await db.purchaseRequests.get(result.prId))!
    expect(pr).toMatchObject({
      branchId: "B1",
      requestedBy: habibur.staffId,
      status: "draft",
      totalP: 100 * costP,
      vendorId: DEPOT,
      // His own ৳9,100 request: his tier, so one up (strict two-person rule).
      approvalTier: "procurement-head",
    })
    const [line] = await db.prLines.where("prId").equals(pr.id).toArray()
    expect(line).toMatchObject({ qty: 100, pack: { units: 100 }, lineTotalP: 100 * costP })
    expect(events.map((e) => e.type)).toEqual(["PurchaseRequestSaved"])
  })

  it("replaces a draft's lines, keeping a removed line with quantity 0", async () => {
    const { pack, costP } = await napaBox(db)
    const seclo = (await db.brands.get(SEED_REFS.brand.seclo20))!
    const first = await commit(
      savePr,
      {
        lines: [
          { brandId: NAPA, qty: 10, pack, estUnitCostP: costP },
          { brandId: seclo.id, qty: 5, pack: seclo.packSizes[0], estUnitCostP: 1_000 },
        ],
      },
      { db, actor: habibur }
    )
    const again = await commit(
      savePr,
      {
        prId: first.result.prId,
        lines: [{ brandId: NAPA, qty: 12, pack, estUnitCostP: costP }],
        expectedVersion: first.result.version,
      },
      { db, actor: habibur }
    )
    expect(again.result.totalP).toBe(12 * costP)
    const lines = await db.prLines.where("prId").equals(first.result.prId).toArray()
    expect(lines.map((l) => l.qty).sort((a, b) => a - b)).toEqual([0, 12])
    await expect(
      commit(savePr, { prId: first.result.prId, lines: [{ brandId: NAPA, qty: 1, pack, estUnitCostP: 1 }], expectedVersion: first.result.version }, { db, actor: habibur })
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      commit(savePr, { prId: first.result.prId, branchId: "B1", lines: [{ brandId: NAPA, qty: 1, pack, estUnitCostP: 1 }] }, { db, actor: tariq })
    ).rejects.toMatchObject({ code: "PR_NOT_YOURS" })
  })

  it("refuses empty, zero, unknown-pack, duplicate and other-branch requests", async () => {
    const { pack, costP } = await napaBox(db)
    const line = { brandId: NAPA, qty: 1, pack, estUnitCostP: costP }
    await expect(commit(savePr, { lines: [] }, { db, actor: habibur })).rejects.toMatchObject({
      code: "PR_EMPTY",
    })
    await expect(
      commit(savePr, { lines: [{ ...line, qty: 0 }] }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PR_ZERO_QTY" })
    await expect(
      commit(savePr, { lines: [{ ...line, pack: { label: "Crate", units: 999 } }] }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PR_PACK_UNKNOWN" })
    await expect(
      commit(savePr, { lines: [line, line] }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PR_DUPLICATE_LINE" })
    await expect(
      commit(savePr, { branchId: "B2", lines: [line] }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PR_OTHER_BRANCH" })
    await expect(commit(savePr, { lines: [line] }, { db, actor: tariq })).rejects.toMatchObject({
      code: "BRANCH_REQUIRED",
    })
    const hq = await commit(savePr, { branchId: "B2", lines: [line] }, { db, actor: tariq })
    const pr = (await db.purchaseRequests.get(hq.result.prId))!
    expect(pr.branchId).toBe("B2")
    // Tariq's own small request goes above his ৳5 lakh limit: the CFO.
    expect(pr.approvalTier).toBe("cfo")
  })
})

describe("procurement.submitPr and decidePr", () => {
  it("submits by value and routes the store manager's own request to the procurement head", async () => {
    const { pack, costP } = await napaBox(db)
    const draft = await commit(
      savePr,
      { lines: [{ brandId: NAPA, qty: 100, pack, estUnitCostP: costP }] },
      { db, actor: habibur }
    )
    await expect(
      commit(submitPr, { prId: draft.result.prId }, { db, actor: tariq })
    ).rejects.toMatchObject({ code: "PR_NOT_YOURS" })
    const { result, events } = await commit(
      submitPr,
      { prId: draft.result.prId },
      { db, actor: habibur }
    )
    expect(result.approvalTier).toBe("procurement-head")
    const pr = (await db.purchaseRequests.get(draft.result.prId))!
    expect(pr.status).toBe("submitted")
    expect(pr.submittedAt).toBeGreaterThan(0)
    expect(events[0]).toMatchObject({
      type: "PurchaseRequestSubmitted",
      params: { prNo: pr.prNo, tier: "Procurement head", tierBn: "ক্রয় প্রধান" },
    })
    await expect(
      commit(submitPr, { prId: pr.id }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PR_NOT_DRAFT" })
    await expect(
      commit(savePr, { prId: pr.id, lines: [{ brandId: NAPA, qty: 1, pack, estUnitCostP: 1 }] }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PR_NOT_DRAFT" })
  })

  it("never lets the requester, another branch or a lower tier decide", async () => {
    const own = await submitted("B1", "procurement-head")
    await expect(
      commit(decidePr, { prId: own.id, decision: "approve" }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PR_OWN_REQUEST" })
    const big = await submitted("B2", "cfo")
    await expect(
      commit(decidePr, { prId: big.id, decision: "approve" }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PR_OTHER_BRANCH" })
    await expect(
      commit(decidePr, { prId: big.id, decision: "approve" }, { db, actor: tariq })
    ).rejects.toMatchObject({ code: "PR_NOT_YOUR_TIER" })
    await expect(
      commit(decidePr, { prId: big.id, decision: "approve" }, { db, actor: anisur })
    ).rejects.toMatchObject({ code: "PR_OWN_REQUEST" })
  })

  it("approves with an approvals row, and the second of two approvers gets a conflict", async () => {
    const pr = await submitted("B1", "procurement-head")
    const { result, events } = await commit(
      decidePr,
      { prId: pr.id, decision: "approve", note: "Within plan", expectedVersion: pr.version },
      { db, actor: tariq }
    )
    const after = (await db.purchaseRequests.get(pr.id))!
    expect(after).toMatchObject({
      status: "approved",
      approvalId: result.approvalId,
      decidedBy: tariq.staffId,
      decisionNote: "Within plan",
    })
    expect(await db.approvals.get(result.approvalId!)).toMatchObject({
      kind: "pr",
      refs: { prId: pr.id },
      requestedBy: pr.requestedBy,
      approverId: tariq.staffId,
      status: "approved",
      pinVerified: false,
      amountP: pr.totalP,
    })
    expect(events[0]).toMatchObject({ type: "PurchaseRequestApproved" })
    await expect(
      commit(
        decidePr,
        { prId: pr.id, decision: "approve", expectedVersion: pr.version },
        { db, actor: sabrina }
      )
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      commit(decidePr, { prId: pr.id, decision: "reject", note: "late" }, { db, actor: sabrina })
    ).rejects.toMatchObject({ code: "PR_NOT_SUBMITTED" })
  })

  it("lets the CFO decide above ৳5 lakh, and a rejection needs a reason", async () => {
    const big = await submitted("B2", "cfo")
    await expect(
      commit(decidePr, { prId: big.id, decision: "reject" }, { db, actor: sabrina })
    ).rejects.toMatchObject({ code: "PR_REASON_REQUIRED" })
    const { events } = await commit(
      decidePr,
      { prId: big.id, decision: "reject", note: "Split it over two quarters" },
      { db, actor: sabrina }
    )
    expect((await db.purchaseRequests.get(big.id))!).toMatchObject({
      status: "rejected",
      decidedBy: sabrina.staffId,
      decisionNote: "Split it over two quarters",
    })
    expect(events[0]).toMatchObject({ type: "PurchaseRequestRejected" })
  })
})

describe("procurement.issuePo", () => {
  it("issues PO-1042 next on a fresh demo, one order per supplier, and marks the request ordered", async () => {
    const { pack, costP } = await napaBox(db)
    const seclo = (await db.brands.get(SEED_REFS.brand.seclo20))!
    const pr = await commit(
      savePr,
      {
        lines: [
          { brandId: NAPA, qty: 100, pack, estUnitCostP: costP },
          { brandId: seclo.id, qty: 4, pack: seclo.packSizes[0], estUnitCostP: 2_000 },
        ],
      },
      { db, actor: habibur }
    )
    await expect(
      commit(issuePo, { prId: pr.result.prId }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PR_NOT_APPROVED" })
    await commit(submitPr, { prId: pr.result.prId }, { db, actor: habibur })
    await commit(decidePr, { prId: pr.result.prId, decision: "approve" }, { db, actor: tariq })
    await expect(
      commit(issuePo, { prId: pr.result.prId, expectedDate: inDays(-1) }, { db, actor: habibur })
    ).rejects.toMatchObject({ code: "PO_DATE_PAST" })
    await expect(
      commit(issuePo, { prId: pr.result.prId }, { db, actor: anisur })
    ).rejects.toMatchObject({ code: "PO_OTHER_BRANCH" })

    const { result, events } = await commit(
      issuePo,
      { prId: pr.result.prId, expectedDate: inDays(2) },
      { db, actor: habibur }
    )
    expect(result.pos.map((p) => p.poNo)).toEqual(["PO-1042", "PO-1043"])
    expect(result.pos.map((p) => p.vendorId)).toEqual([DEPOT, "ven_square"])
    const po = (await db.purchaseOrders.get(result.pos[0].poId))!
    expect(po).toMatchObject({ status: "issued", branchId: "B1", totalP: 100 * costP })
    const [line] = await db.poLines.where("poId").equals(po.id).toArray()
    expect(line).toMatchObject({
      qtyOrdered: 100,
      unitCostP: costP,
      qtyReceived: 0,
      qtyRejected: 0,
      pack: { label: "10 x 10 strip", units: 100 },
    })
    expect((await db.purchaseRequests.get(pr.result.prId))!.status).toBe("ordered")
    expect(events.filter((e) => e.type === "PurchaseOrderIssued")).toHaveLength(2)
  })
})
