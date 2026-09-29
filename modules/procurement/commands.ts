import { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import { addDaysISO, atDhaka } from "@/core/clock/dates"
import type {
  BatchRow,
  GrnLineRow,
  Id,
  PackSize,
  PoLineRow,
  Poisha,
  PrLineRow,
  PurchaseOrderRow,
  PurchaseRequestRow,
  StockLevelRow,
} from "@/core/db/schema"
import {
  nextGrnNo,
  nextPurchaseOrderNo,
  nextPurchaseRequestNo,
  nextVendorInvoiceNo,
} from "@/core/engine/docNumbers"
import { defineCommand } from "@/core/engine/defineCommand"
import type { NewRow, Tx } from "@/core/engine/types"
import { createPayable } from "@/core/finance/payables"
import { approvalTierFor, mayApprovePr, threeWayMatch, type PrTier } from "@/core/procurement/rules"
import { formatMoney } from "@/lib/i18n/format"
import { brandLabel, levelFor, moveStock, watchReorder } from "@/modules/inventory/stock"

import {
  acceptedNotInvoiced,
  costPerBaseUnitP,
  isSettled,
  isShortExpiry,
  liveLines,
  minExpiryFor,
  pendingOf,
  poProgress,
  suggestedVendorId,
  unitsPer,
} from "./calc"
import { procurementBn } from "./i18n/bn"
import { procurementEn } from "./i18n/en"

/**
 * Procurement commands (plan §6, Phase 4 WS-H; objective §3D): purchase
 * request, value-based approval, purchase order, goods receipt with batch,
 * expiry, rejection and quarantine, and the vendor invoice with its
 * three-way match. Each is one atomic commit with every consequence.
 */

const branch = z.enum(["B1", "B2", "B3", "B4", "B5"])
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const idempotencyKey = z.string().optional()
const pack = z.object({
  label: z.string().trim().min(1).max(60),
  units: z.number().int().positive(),
  stripSize: z.number().int().positive().optional(),
})

/** Event params for money: English and Bangla figures. */
function money(poisha: Poisha, key = "amount"): Record<string, string> {
  return { [key]: formatMoney(poisha, "en"), [`${key}Bn`]: formatMoney(poisha, "bn") }
}

/** Event params for a tier: its name in both languages. */
function tierParams(tier: PrTier): Record<string, string> {
  return {
    tier: procurementEn.procurement.tier[tier],
    tierBn: procurementBn.procurement.tier[tier],
  }
}

/**
 * The branch a store action is for. Branch staff act only for their own
 * branch; network-level staff (the head of procurement, finance) and the
 * system must say which branch.
 */
function actingBranch(tx: Tx, requested: BranchCode | undefined, code: string): BranchCode {
  const own = tx.actor.branchId
  if (own) {
    if (requested && requested !== own) tx.reject(code, { branch: requested })
    return own
  }
  if (!requested) tx.reject("BRANCH_REQUIRED", {})
  return requested
}

/** Branch staff may act only at their own branch; network-level staff anywhere. */
function assertAt(tx: Tx, expected: BranchCode, code: string): void {
  if (tx.actor.role === "system" || !tx.actor.branchId) return
  if (tx.actor.branchId !== expected) tx.reject(code, { branch: expected })
}

function samePack(a: PackSize | undefined, b: PackSize | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.label === b.label && a.units === b.units
}

/**
 * Row ids for a document's lines that sort in the order the lines were
 * entered (random ids made within one commit would not).
 */
function lineId(prefix: string, parentId: Id, index: number): Id {
  const tail = parentId.slice(parentId.indexOf("_") + 1)
  return `${prefix}_${tail}_${String(index + 1).padStart(3, "0")}`
}

/** A request's lines in the order they were added. */
async function linesOf(tx: Tx, prId: Id): Promise<PrLineRow[]> {
  return (await tx.list("prLines", "prId", prId)).sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  )
}

/* ================================================================== *
 * Purchase requests
 * ================================================================== */

/**
 * Create or update a draft purchase request (plan Phase 4 WS-H): brands from
 * the library, a quantity in packs of one of the brand's pack sizes, the
 * estimated cost per pack and the suggested supplier. The approval tier is
 * shown as the request stands; it is fixed when the request is submitted.
 * A line taken off a draft keeps its row with quantity 0 (rows are never deleted).
 */
export const savePr = defineCommand({
  name: "procurement.savePr",
  roles: ["store"],
  input: z.object({
    prId: z.string().optional(),
    /** For network-level staff (branch staff always order for their branch) */
    branchId: branch.optional(),
    lines: z.array(
      z.object({
        brandId: z.string(),
        qty: z.number().int(),
        pack: pack.optional(),
        estUnitCostP: z.number().int().nonnegative(),
      })
    ),
    vendorId: z.string().optional(),
    note: z.string().trim().max(300).optional(),
    expectedVersion: z.number().int().optional(),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    if (!input.lines.length) tx.reject("PR_EMPTY", {})
    const seen = new Set<string>()
    for (const line of input.lines) {
      const brand = await tx.get("brands", line.brandId)
      const item = brandLabel(brand)
      if (line.qty <= 0) tx.reject("PR_ZERO_QTY", { item })
      if (line.pack && !brand.packSizes.some((p) => samePack(p, line.pack))) {
        tx.reject("PR_PACK_UNKNOWN", { item, pack: line.pack.label })
      }
      const key = `${line.brandId}|${line.pack?.label ?? ""}`
      if (seen.has(key)) tx.reject("PR_DUPLICATE_LINE", { item })
      seen.add(key)
    }
    if (input.vendorId) await tx.get("vendors", input.vendorId)
    const totalP = input.lines.reduce((sum, l) => sum + l.qty * l.estUnitCostP, 0)
    const approvalTier = approvalTierFor(totalP, tx.actor.authorities)

    let pr: PurchaseRequestRow
    if (input.prId) {
      const current = await tx.get("purchaseRequests", input.prId, {
        expectedVersion: input.expectedVersion,
      })
      if (current.status !== "draft") {
        tx.reject("PR_NOT_DRAFT", { prNo: current.prNo })
      }
      if (current.requestedBy !== tx.actor.staffId && tx.actor.role !== "system") {
        tx.reject("PR_NOT_YOURS", { prNo: current.prNo })
      }
      const branchId = actingBranch(tx, input.branchId ?? current.branchId, "PR_OTHER_BRANCH")
      pr = await tx.update("purchaseRequests", current.id, {
        branchId,
        totalP,
        approvalTier,
        vendorId: input.vendorId,
        note: input.note || undefined,
      })
    } else {
      const branchId = actingBranch(tx, input.branchId, "PR_OTHER_BRANCH")
      pr = tx.insert("purchaseRequests", {
        prNo: await nextPurchaseRequestNo(tx),
        branchId,
        requestedBy: tx.actor.staffId,
        status: "draft",
        totalP,
        approvalTier,
        vendorId: input.vendorId,
        note: input.note || undefined,
      })
    }

    const existing = input.prId ? await linesOf(tx, pr.id) : []
    for (const [index, line] of input.lines.entries()) {
      const row = {
        prId: pr.id,
        brandId: line.brandId,
        qty: line.qty,
        estUnitCostP: line.estUnitCostP,
        lineTotalP: line.qty * line.estUnitCostP,
        pack: line.pack,
      }
      const old = existing[index]
      if (old) await tx.update("prLines", old.id, row)
      else tx.insert("prLines", { ...row, id: lineId("prl", pr.id, index) })
    }
    for (const old of existing.slice(input.lines.length)) {
      if (old.qty !== 0) await tx.update("prLines", old.id, { qty: 0, lineTotalP: 0 })
    }

    tx.emit("PurchaseRequestSaved", {
      branchId: pr.branchId,
      refs: { prId: pr.id },
      params: { prNo: pr.prNo, lines: input.lines.length, ...money(totalP) },
    })
    return { prId: pr.id, prNo: pr.prNo, totalP, approvalTier, version: pr.version }
  },
})

/**
 * Send a draft for approval (PRD §11). The tier is fixed now, by value and
 * the strict two-person rule: a requester who holds the value's tier sends
 * it one tier up, so nobody approves their own request.
 */
export const submitPr = defineCommand({
  name: "procurement.submitPr",
  roles: ["store"],
  input: z.object({
    prId: z.string(),
    expectedVersion: z.number().int().optional(),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const pr = await tx.get("purchaseRequests", input.prId, {
      expectedVersion: input.expectedVersion,
    })
    if (pr.status !== "draft") tx.reject("PR_NOT_DRAFT", { prNo: pr.prNo })
    if (pr.requestedBy !== tx.actor.staffId && tx.actor.role !== "system") {
      tx.reject("PR_NOT_YOURS", { prNo: pr.prNo })
    }
    const lines = await linesOf(tx, pr.id)
    const live = liveLines(lines)
    if (!live.length) tx.reject("PR_EMPTY", {})
    const totalP = live.reduce((sum, l) => sum + l.lineTotalP, 0)
    const approvalTier = approvalTierFor(totalP, tx.actor.authorities)
    await tx.update("purchaseRequests", pr.id, {
      status: "submitted",
      submittedAt: tx.now(),
      totalP,
      approvalTier,
    })
    tx.emit("PurchaseRequestSubmitted", {
      branchId: pr.branchId,
      refs: { prId: pr.id },
      params: { prNo: pr.prNo, ...money(totalP), ...tierParams(approvalTier) },
    })
    return { prId: pr.id, prNo: pr.prNo, approvalTier, totalP }
  },
})

/**
 * Approve or reject a submitted request (the approvals inbox, plan §9). Only
 * a second person whose limit covers the request's tier may decide; a
 * rejection needs a reason. Two approvers acting at once: the second gets the
 * conflict dialog (expectedVersion).
 */
export const decidePr = defineCommand({
  name: "procurement.decidePr",
  roles: ["store", "finance"],
  input: z.object({
    prId: z.string(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(300).optional(),
    expectedVersion: z.number().int().optional(),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const pr = await tx.get("purchaseRequests", input.prId, {
      expectedVersion: input.expectedVersion,
    })
    if (pr.status !== "submitted") {
      tx.reject("PR_NOT_SUBMITTED", { prNo: pr.prNo })
    }
    if (tx.actor.branchId && tx.actor.branchId !== pr.branchId) {
      tx.reject("PR_OTHER_BRANCH", { branch: pr.branchId })
    }
    if (pr.requestedBy === tx.actor.staffId) tx.reject("PR_OWN_REQUEST", { prNo: pr.prNo })
    if (!mayApprovePr({ id: tx.actor.staffId, authorities: tx.actor.authorities }, pr)) {
      tx.reject("PR_NOT_YOUR_TIER", { prNo: pr.prNo, totalP: pr.totalP })
    }
    const note = input.note?.trim() || undefined
    if (input.decision === "reject" && !note) tx.reject("PR_REASON_REQUIRED", {})
    const approver = await tx.find("staff", tx.actor.staffId)
    const refs = { prId: pr.id }

    if (input.decision === "approve") {
      const approval = tx.insert("approvals", {
        kind: "pr",
        refs,
        requestedBy: pr.requestedBy,
        approverId: tx.actor.staffId,
        status: "approved",
        pinVerified: false,
        reason: note ?? "",
        amountP: pr.totalP,
        decidedAt: tx.now(),
      })
      await tx.update("purchaseRequests", pr.id, {
        status: "approved",
        approvalId: approval.id,
        decidedBy: tx.actor.staffId,
        decidedAt: tx.now(),
        decisionNote: note,
      })
      tx.auditContext({ reason: note, approvedBy: tx.actor.staffId })
      tx.emit("PurchaseRequestApproved", {
        branchId: pr.branchId,
        refs: { ...refs, approvalId: approval.id },
        params: {
          prNo: pr.prNo,
          approver: approver?.nameEn ?? tx.actor.name,
          approverBn: approver?.nameBn ?? tx.actor.name,
          ...money(pr.totalP),
        },
      })
      return { prId: pr.id, status: "approved" as const, approvalId: approval.id }
    }

    await tx.update("purchaseRequests", pr.id, {
      status: "rejected",
      decidedBy: tx.actor.staffId,
      decidedAt: tx.now(),
      decisionNote: note,
    })
    tx.auditContext({ reason: note })
    tx.emit("PurchaseRequestRejected", {
      branchId: pr.branchId,
      refs,
      params: {
        prNo: pr.prNo,
        approver: approver?.nameEn ?? tx.actor.name,
        approverBn: approver?.nameBn ?? tx.actor.name,
        reason: note ?? "",
      },
    })
    return { prId: pr.id, status: "rejected" as const, approvalId: undefined }
  },
})

/* ================================================================== *
 * Purchase orders
 * ================================================================== */

/**
 * Turn an approved request into purchase orders, one per supplier (PO-1042 on
 * a fresh demo). Each line's supplier is the one chosen for it, else the
 * order's, else the request's, else the brand's manufacturer depot. Lines
 * copy the quantity, pack and cost. Sending to the vendor is simulated.
 */
export const issuePo = defineCommand({
  name: "procurement.issuePo",
  roles: ["store"],
  input: z.object({
    prId: z.string(),
    /** One supplier for every line */
    vendorId: z.string().optional(),
    /** A supplier per request line (wins over `vendorId`) */
    vendors: z.array(z.object({ prLineId: z.string(), vendorId: z.string() })).optional(),
    /** Expected delivery day (default: in three days) */
    expectedDate: isoDate.optional(),
    expectedVersion: z.number().int().optional(),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const pr = await tx.get("purchaseRequests", input.prId, {
      expectedVersion: input.expectedVersion,
    })
    if (pr.status !== "approved") tx.reject("PR_NOT_APPROVED", { prNo: pr.prNo })
    assertAt(tx, pr.branchId, "PO_OTHER_BRANCH")
    const today = tx.today()
    const expectedDate = input.expectedDate ?? addDaysISO(today, 3)
    if (expectedDate < today) tx.reject("PO_DATE_PAST", { date: expectedDate })

    const lines = liveLines(await linesOf(tx, pr.id))
    if (!lines.length) tx.reject("PR_EMPTY", {})
    const groups = new Map<Id, PrLineRow[]>()
    for (const line of lines) {
      const brand = await tx.get("brands", line.brandId)
      const vendorId =
        input.vendors?.find((v) => v.prLineId === line.id)?.vendorId ??
        input.vendorId ??
        pr.vendorId ??
        suggestedVendorId(brand)
      groups.set(vendorId, [...(groups.get(vendorId) ?? []), line])
    }

    const pos: { poId: Id; poNo: string; vendorId: Id; totalP: Poisha }[] = []
    for (const [vendorId, group] of groups) {
      const vendor = await tx.get("vendors", vendorId)
      const totalP = group.reduce((sum, l) => sum + l.lineTotalP, 0)
      const po = tx.insert("purchaseOrders", {
        poNo: await nextPurchaseOrderNo(tx),
        prId: pr.id,
        vendorId,
        branchId: pr.branchId,
        status: "issued",
        issuedAt: tx.now(),
        expectedAt: atDhaka(expectedDate, "17:00"),
        totalP,
      })
      for (const [index, line] of group.entries()) {
        tx.insert("poLines", {
          id: lineId("pol", po.id, index),
          poId: po.id,
          brandId: line.brandId,
          qtyOrdered: line.qty,
          unitCostP: line.estUnitCostP,
          qtyReceived: 0,
          qtyRejected: 0,
          pack: line.pack,
        })
      }
      tx.emit("PurchaseOrderIssued", {
        branchId: pr.branchId,
        refs: { prId: pr.id, poId: po.id },
        params: { poNo: po.poNo, prNo: pr.prNo, vendor: vendor.name, ...money(totalP) },
      })
      pos.push({ poId: po.id, poNo: po.poNo, vendorId, totalP })
    }
    await tx.update("purchaseRequests", pr.id, { status: "ordered" })
    return { prId: pr.id, pos }
  },
})

/* ================================================================== *
 * Goods receipt
 * ================================================================== */

const REJECT_REASONS = ["damaged", "short-expiry", "wrong-item", "other"] as const

/** How a refused lot's reason reads on its stock movement (stored text, English). */
const REASON_TEXT: Record<(typeof REJECT_REASONS)[number], string> = {
  damaged: "Damaged on delivery",
  "short-expiry": "Short expiry on delivery",
  "wrong-item": "Wrong item delivered",
  other: "Refused on delivery",
}

/**
 * Receive a delivery against a purchase order (GRN; objective §3D, S12):
 * one or more lots per order line with batch, expiry, the quantity received
 * and any rejected with a reason. Accepted units become a new batch on the
 * shelf (cost per base unit from the PO price). Rejected units held for the
 * vendor go in as their own batch and straight into quarantine; the rest go
 * back with the driver. A lot expiring within the minimum shelf life must be
 * refused in full as short expiry. Accepted may never exceed what is pending.
 */
export const receiveGoods = defineCommand({
  name: "procurement.receiveGoods",
  roles: ["store"],
  input: z.object({
    poId: z.string(),
    lots: z
      .array(
        z.object({
          poLineId: z.string(),
          batchNo: z.string().trim().min(1).max(30),
          expiry: isoDate,
          /** In the PO line's unit (packs when the line has a pack) */
          received: z.number().int().nonnegative(),
          rejected: z.number().int().nonnegative().default(0),
          rejectReason: z.enum(REJECT_REASONS).optional(),
          quarantine: z.boolean().default(false),
        })
      )
      .min(1),
    note: z.string().trim().max(300).optional(),
    expectedVersion: z.number().int().optional(),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const po = await tx.get("purchaseOrders", input.poId, {
      expectedVersion: input.expectedVersion,
    })
    if (po.status !== "issued" && po.status !== "partial") {
      tx.reject("PO_NOT_OPEN", { poNo: po.poNo })
    }
    assertAt(tx, po.branchId, "GRN_OTHER_BRANCH")
    const today = tx.today()
    const poLines = await tx.list("poLines", "poId", po.id)
    const lineById = new Map(poLines.map((l) => [l.id, l]))
    const lots = input.lots.filter((lot) => lot.received > 0 || lot.rejected > 0)
    if (!lots.length) tx.reject("GRN_EMPTY", { poNo: po.poNo })

    const acceptedByLine = new Map<Id, number>()
    for (const lot of lots) {
      const line = lineById.get(lot.poLineId)
      if (!line) tx.reject("GRN_LINE_NOT_ON_PO", { poNo: po.poNo })
      if (lot.rejected > lot.received) {
        tx.reject("GRN_REJECTED_ABOVE_RECEIVED", { batchNo: lot.batchNo })
      }
      if (lot.rejected > 0 && !lot.rejectReason) {
        tx.reject("GRN_REASON_REQUIRED", { batchNo: lot.batchNo })
      }
      if (
        isShortExpiry(lot.expiry, today) &&
        (lot.rejected < lot.received || lot.rejectReason !== "short-expiry")
      ) {
        tx.reject("GRN_SHORT_EXPIRY", { batchNo: lot.batchNo, minDate: minExpiryFor(today) })
      }
      acceptedByLine.set(
        line.id,
        (acceptedByLine.get(line.id) ?? 0) + lot.received - lot.rejected
      )
    }
    for (const [poLineId, accepted] of acceptedByLine) {
      const line = lineById.get(poLineId)!
      if (accepted > pendingOf(line)) {
        const brand = await tx.get("brands", line.brandId)
        tx.reject("GRN_ABOVE_PENDING", { item: brandLabel(brand), pending: pendingOf(line) })
      }
    }

    const grnNo = await nextGrnNo(tx)
    const grn = tx.insert("grns", {
      grnNo,
      poId: po.id,
      branchId: po.branchId,
      receivedBy: tx.actor.staffId,
      receivedAt: tx.now(),
      status: "partial",
      note: input.note || undefined,
    })
    const refs = { poId: po.id, grnId: grn.id }
    const branchId = po.branchId

    const watchers = new Map<Id, () => Promise<void>>()
    let quarantinedLots = 0
    for (const [index, lot] of lots.entries()) {
      const line = lineById.get(lot.poLineId)!
      const brand = await tx.get("brands", line.brandId)
      if (!watchers.has(brand.id)) watchers.set(brand.id, await watchReorder(tx, branchId, brand))
      const per = unitsPer(line.pack)
      const accepted = lot.received - lot.rejected
      const lotRow = {
        brandId: brand.id,
        batchNo: lot.batchNo,
        expiry: lot.expiry,
        costP: costPerBaseUnitP(line.unitCostP, line.pack),
        mrpP: brand.mrpP,
        vendorId: po.vendorId,
      }
      let okBatch: BatchRow | undefined
      let heldBatch: BatchRow | undefined
      if (accepted > 0) {
        okBatch = tx.insert("batches", { ...lotRow, status: "ok" })
        const level = await levelFor(tx, branchId, brand.id, okBatch.id)
        await moveStock(tx, level, { type: "grn", qty: accepted * per, refs, reason: grnNo })
      }
      if (lot.rejected > 0 && lot.quarantine) {
        // Held for the vendor: its own lot, received and moved straight into quarantine.
        heldBatch = tx.insert("batches", { ...lotRow, status: "quarantine" })
        const level: StockLevelRow = await levelFor(tx, branchId, brand.id, heldBatch.id)
        const units = lot.rejected * per
        await moveStock(tx, level, { type: "grn", qty: units, refs, reason: grnNo })
        await moveStock(tx, level, {
          type: "quarantine",
          qty: -units,
          quarantined: units,
          refs,
          reason: REASON_TEXT[lot.rejectReason!],
        })
        quarantinedLots += 1
        tx.emit("BatchQuarantined", {
          branchId,
          refs,
          params: {
            item: brandLabel(brand),
            batchNo: lot.batchNo,
            qty: lot.rejected,
            units,
            grnNo,
          },
        })
      }
      const grnLine: NewRow<"grnLines"> = {
        grnId: grn.id,
        poLineId: line.id,
        brandId: brand.id,
        batchNo: lot.batchNo,
        expiry: lot.expiry,
        qtyReceived: lot.received,
        qtyAccepted: accepted,
        qtyRejected: lot.rejected,
        rejectReason: lot.rejected > 0 ? lot.rejectReason : undefined,
        quarantine: lot.rejected > 0 && lot.quarantine,
        batchId: okBatch?.id ?? heldBatch?.id,
      }
      tx.insert("grnLines", { ...grnLine, id: lineId("grl", grn.id, index) })
    }

    let received = 0
    let rejected = 0
    for (const line of poLines) {
      const own = lots.filter((lot) => lot.poLineId === line.id)
      if (!own.length) continue
      const got = own.reduce((sum, lot) => sum + lot.received, 0)
      const refused = own.reduce((sum, lot) => sum + lot.rejected, 0)
      received += got
      rejected += refused
      await tx.update("poLines", line.id, {
        qtyReceived: line.qtyReceived + got,
        qtyRejected: line.qtyRejected + refused,
      })
    }
    for (const watch of watchers.values()) await watch()

    const after = await tx.list("poLines", "poId", po.id)
    const progress = poProgress(after)
    const complete = progress.pending === 0
    await tx.update("grns", grn.id, { status: complete ? "complete" : "partial" })
    await tx.update("purchaseOrders", po.id, { status: complete ? "received" : "partial" })
    const accepted = received - rejected
    tx.emit("GoodsReceived", {
      branchId,
      refs,
      params: {
        grnNo,
        poNo: po.poNo,
        received,
        accepted,
        rejected,
        pending: progress.pending,
      },
    })
    return {
      grnId: grn.id,
      grnNo,
      poNo: po.poNo,
      received,
      accepted,
      rejected,
      pending: progress.pending,
      quarantinedLots,
      status: complete ? ("complete" as const) : ("partial" as const),
    }
  },
})

/* ================================================================== *
 * Vendor invoice and three-way match
 * ================================================================== */

/**
 * Close an order once every line is fully received and billed on invoices
 * that passed the match. Exported so a mismatch resolved by finance can
 * close its order in the same commit.
 */
export async function closePoIfSettled(tx: Tx, po: PurchaseOrderRow): Promise<boolean> {
  const current = await tx.get("purchaseOrders", po.id)
  if (current.status !== "received") return false
  const lines = await tx.list("poLines", "poId", po.id)
  const invoices = await tx.list("vendorInvoices", "poId", po.id)
  if (!isSettled(lines, invoices)) return false
  await tx.update("purchaseOrders", po.id, { status: "closed" })
  tx.emit("PurchaseOrderClosed", {
    branchId: po.branchId,
    refs: { poId: po.id },
    params: { poNo: po.poNo },
  })
  return true
}

/**
 * Record the supplier's invoice for an order and match it in the same commit
 * (PRD §8.7): per line, the quantity must equal what was accepted and not yet
 * billed, and the price must be within ±2% of the PO price. A match creates
 * the payable (finance sees it under payables); a mismatch goes to the
 * finance worklist with its differences. Quantities and prices are in the
 * PO line's unit.
 */
export const recordVendorInvoice = defineCommand({
  name: "procurement.recordVendorInvoice",
  roles: ["store", "finance"],
  input: z.object({
    poId: z.string(),
    vendorRef: z.string().trim().min(1).max(40),
    invoiceDate: isoDate,
    lines: z
      .array(
        z.object({
          poLineId: z.string(),
          qty: z.number().int().nonnegative(),
          unitCostP: z.number().int().nonnegative(),
        })
      )
      .min(1),
    idempotencyKey,
  }),
  async run(tx: Tx, input) {
    const po = await tx.get("purchaseOrders", input.poId)
    assertAt(tx, po.branchId, "VI_OTHER_BRANCH")
    if (po.status === "cancelled") tx.reject("PO_NOT_OPEN", { poNo: po.poNo })
    const grns = await tx.list("grns", "poId", po.id)
    if (!grns.length) tx.reject("VI_NOTHING_RECEIVED", { poNo: po.poNo })
    if (input.invoiceDate > tx.today()) tx.reject("VI_DATE_FUTURE", { date: input.invoiceDate })
    const poLines: PoLineRow[] = await tx.list("poLines", "poId", po.id)
    const lines = input.lines.filter((line) => line.qty > 0)
    if (!lines.length) tx.reject("VI_EMPTY", { poNo: po.poNo })
    for (const line of lines) {
      if (!poLines.some((l) => l.id === line.poLineId)) {
        tx.reject("VI_LINE_NOT_ON_PO", { poNo: po.poNo })
      }
    }
    const earlier = await tx.list("vendorInvoices", "poId", po.id)
    const sameRef = (await tx.list("vendorInvoices", "vendorId", po.vendorId)).find(
      (vi) =>
        vi.status !== "rejected" &&
        vi.vendorRef?.trim().toLowerCase() === input.vendorRef.toLowerCase()
    )
    if (sameRef) {
      tx.reject("VI_DUPLICATE_REF", {
        vendorRef: input.vendorRef,
        vendorInvoiceNo: sameRef.vendorInvoiceNo,
      })
    }

    const grnLines: GrnLineRow[] = []
    for (const grn of grns) grnLines.push(...(await tx.list("grnLines", "grnId", grn.id)))
    const acceptedQty = acceptedNotInvoiced(grnLines, earlier)
    const match = threeWayMatch(poLines, acceptedQty, lines)

    const vendorInvoiceNo = await nextVendorInvoiceNo(tx)
    const amountP = lines.reduce((sum, l) => sum + l.qty * l.unitCostP, 0)
    const invoice = tx.insert("vendorInvoices", {
      vendorInvoiceNo,
      vendorId: po.vendorId,
      poId: po.id,
      amountP,
      lines,
      receivedAt: tx.now(),
      status: match.status,
      vendorRef: input.vendorRef,
      invoiceDate: input.invoiceDate,
    })
    const matchRow = tx.insert("threeWayMatches", {
      poId: po.id,
      grnIds: grns.map((g) => g.id),
      vendorInvoiceId: invoice.id,
      status: match.status,
      diffs: match.diffs,
    })
    const refs = { poId: po.id, vendorInvoiceId: invoice.id, matchId: matchRow.id }
    const params = { vendorInvoiceNo, poNo: po.poNo }

    let payable: { id: Id; dueDate: string } | undefined
    if (match.status === "matched") {
      tx.emit("ThreeWayMatched", { branchId: po.branchId, refs, params })
      const row = await createPayable(tx, { vendorInvoice: invoice, amountP })
      payable = { id: row.id, dueDate: row.dueDate }
    } else {
      tx.emit("ThreeWayMismatch", { branchId: po.branchId, refs, params })
    }
    const closed = await closePoIfSettled(tx, po)
    return {
      vendorInvoiceId: invoice.id,
      vendorInvoiceNo,
      matchId: matchRow.id,
      status: match.status,
      diffs: match.diffs,
      amountP,
      payableId: payable?.id,
      dueDate: payable?.dueDate,
      poClosed: closed,
    }
  },
})
