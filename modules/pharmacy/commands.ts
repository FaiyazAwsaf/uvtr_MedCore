import { z } from "zod"

import { getBranch, type BranchCode } from "@/config/brand.config"
import { notifyPatient, queueSms } from "@/core/comms/sms"
import type {
  BrandRow,
  DispenseRow,
  Id,
  PharmacyQueueRow,
  RxLineRow,
} from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import {
  allocateFefo,
  brandLabel,
  brandStockAt,
  levelFor,
  moveStock,
  watchReorder,
} from "@/modules/inventory/stock"

import {
  balanceDeadline,
  balanceExpired,
  dispenseBlock,
  isFinalLine,
  outstandingOf,
  queueStatusFor,
} from "./rules"

/* ================================================================== *
 * Shared helpers
 * ================================================================== */

/** The branch a pharmacist works at: pharmacy commands act on its stock. */
function actorBranch(tx: Tx): BranchCode {
  const branch = tx.actor.branchId
  if (!branch) tx.reject("BRANCH_REQUIRED", {})
  return branch
}

/** The acting pharmacist and their Pharmacy Council number (PRD §10.5: on each dispense). */
async function pharmacistOf(tx: Tx): Promise<{ id: Id; councilNo: string }> {
  const staff = await tx.find("staff", tx.actor.staffId)
  if (!staff?.regNo) tx.reject("PHARMACIST_REG_REQUIRED", {})
  return { id: staff.id, councilNo: staff.regNo }
}

function mayDispenseControlled(tx: Tx): boolean {
  const authorities = tx.actor.authorities
  return authorities.includes("*") || authorities.includes("dispense:controlled")
}

/** Keep the pharmacy queue entry in step with its lines; returns the new status. */
async function syncQueue(tx: Tx, rxId: Id): Promise<PharmacyQueueRow["status"]> {
  const lines = await tx.list("rxLines", "rxId", rxId)
  const status = queueStatusFor(lines)
  for (const entry of await tx.list("pharmacyQueue", "rxId", rxId)) {
    if (entry.status !== "cancelled" && entry.status !== status) {
      await tx.update("pharmacyQueue", entry.id, { status })
    }
  }
  return status
}

/** The billed unit price of an Rx line (its basket line), or the brand's price. */
async function linePrice(tx: Tx, line: RxLineRow, brand: BrandRow): Promise<number> {
  const basket = (await tx.list("basketLines", "sourceId", line.id)).find(
    (b) => b.sourceType === "rx-line" && b.status !== "removed"
  )
  return basket?.unitPriceP ?? brand.unitPriceP
}

async function invoiceLineOf(tx: Tx, lineId: Id): Promise<Id | undefined> {
  const lines = await tx.list("invoiceLines", "sourceId", lineId)
  return lines.find((l) => l.status === "active")?.id
}

/** Units of a controlled brand in custody at a branch (on the shelf or quarantined). */
async function custodyBalance(tx: Tx, branch: BranchCode, brandId: Id): Promise<number> {
  const levels = await tx.list("stockLevels", "[branchId+brandId]", [branch, brandId])
  return levels.reduce((sum, l) => sum + Math.max(0, l.qty) + Math.max(0, l.quarantinedQty), 0)
}

const idempotencyKey = z.string().min(1).optional()

/* ================================================================== *
 * pharmacy.dispense (plan §6)
 * ================================================================== */

export type DispensedLine = {
  rxLineId: Id
  qty: number
  outstanding: number
  status: RxLineRow["status"]
  dispenseIds: Id[]
}

/**
 * Dispense paid Rx lines the patient takes (plan §6 `pharmacy.dispense`):
 * FEFO batches (expired and quarantined never used), a dispense row per batch
 * with the pharmacist's Pharmacy Council number, stock levels and movements,
 * the line's dispensed quantity and status, a balance kept open for
 * `rules.dispenseBalanceDays` on partials, a controlled-drug register row with
 * the running balance (INV-07), and the queue entry. One atomic commit.
 */
export const dispense = defineCommand({
  name: "pharmacy.dispense",
  roles: ["pharmacist"],
  input: z.object({
    rxId: z.string(),
    lines: z
      .array(
        z.object({
          rxLineId: z.string(),
          qty: z.number().int().positive(),
          /** A batch the pharmacist picked (scanned) instead of the FEFO suggestion */
          batchId: z.string().optional(),
        })
      )
      .min(1),
    /** The second identifier checked before handover (HAZ-01) */
    verifiedBy: z.enum(["dob", "phone"]),
    counselled: z.boolean().default(true),
    /** Witness for a controlled-drug dispense, when present */
    witnessId: z.string().optional(),
    idempotencyKey,
  }),
  async run(tx, input) {
    const branch = actorBranch(tx)
    const pharmacist = await pharmacistOf(tx)
    const rx = await tx.get("prescriptions", input.rxId)
    if (rx.status !== "signed") tx.reject("RX_NOT_SIGNED", { rxNo: rx.rxNo })
    const now = tx.now()
    const today = tx.today()

    const done: DispensedLine[] = []
    let units = 0
    for (const request of input.lines) {
      if (done.some((d) => d.rxLineId === request.rxLineId)) {
        tx.reject("DUPLICATE_LINE", { rxNo: rx.rxNo })
      }
      const line = await tx.get("rxLines", request.rxLineId)
      if (line.rxId !== rx.id) tx.reject("LINE_NOT_ON_RX", { rxNo: rx.rxNo })
      const block = dispenseBlock(line, now)
      if (block === "unpaid") tx.reject("PAYMENT_GATE", { step: "dispense" })
      if (block === "balance-expired") tx.reject("BALANCE_EXPIRED", { rxNo: rx.rxNo })
      if (block) tx.reject("LINE_NOT_DISPENSABLE", { status: line.status })
      const outstanding = outstandingOf(line)
      if (request.qty > outstanding) {
        tx.reject("QTY_ABOVE_OUTSTANDING", { qty: request.qty, outstanding })
      }

      const brand = await tx.get("brands", line.brandId!)
      if (brand.category === "controlled" && !mayDispenseControlled(tx)) {
        tx.reject("CONTROLLED_AUTHORITY_REQUIRED", { item: brandLabel(brand) })
      }
      const stock = await brandStockAt(tx, branch, brand.id)
      const { picks, shortfall } = allocateFefo(
        request.qty,
        branch,
        brand.id,
        stock,
        today,
        request.batchId
      )
      if (shortfall > 0) tx.reject("STOCK_NEGATIVE", { brandId: brand.id, branch })

      const reorder = await watchReorder(tx, branch, brand)
      const price = await linePrice(tx, line, brand)
      const invoiceLineId = await invoiceLineOf(tx, line.id)
      const outstandingAfter = outstanding - request.qty
      const dispenseIds: Id[] = []
      for (const pick of picks) {
        const row: DispenseRow = tx.insert("dispenses", {
          rxId: rx.id,
          rxLineId: line.id,
          patientId: rx.patientId,
          branchId: branch,
          saleType: "rx",
          brandId: brand.id,
          batchId: pick.batch.id,
          qty: pick.take,
          // Never above MRP (INV-05): the lower of the billed price and both MRPs.
          unitPriceP: Math.min(price, brand.mrpP, pick.batch.mrpP),
          pharmacistId: pharmacist.id,
          pharmacyCouncilNo: pharmacist.councilNo,
          labelPrinted: true,
          counselled: input.counselled,
          outstandingQty: outstandingAfter,
          invoiceLineId,
          at: now,
        })
        dispenseIds.push(row.id)
        await moveStock(tx, pick.level, {
          type: "dispense",
          qty: -pick.take,
          refs: { rxId: rx.id, rxLineId: line.id, patientId: rx.patientId, dispenseId: row.id },
        })
        if (brand.category === "controlled") {
          // INV-07: the register row lands in the same commit as the dispense.
          tx.insert("controlledRegister", {
            dispenseId: row.id,
            branchId: branch,
            brandId: brand.id,
            qty: pick.take,
            runningBalance: await custodyBalance(tx, branch, brand.id),
            rxId: rx.id,
            witnessId: input.witnessId,
            at: now,
          })
        }
      }
      await reorder()

      const dispensedQty = line.dispensedQty + request.qty
      const complete = dispensedQty >= line.qtyPrescribed
      // A balance stays open from the first partial dispense; later partials keep that deadline.
      const keepDeadline = line.balanceUntil !== undefined && line.balanceUntil > now
      const updated = await tx.update("rxLines", line.id, {
        dispensedQty,
        status: complete ? "dispensed" : "partial",
        balanceUntil: complete
          ? line.balanceUntil
          : keepDeadline
            ? line.balanceUntil
            : balanceDeadline(now),
      })
      units += request.qty
      done.push({
        rxLineId: line.id,
        qty: request.qty,
        outstanding: outstandingAfter,
        status: updated.status,
        dispenseIds,
      })
    }

    tx.auditContext({ reason: `Second identifier checked: ${input.verifiedBy === "dob" ? "date of birth" : "phone"}` })
    const status = await syncQueue(tx, rx.id)
    const lines = await tx.list("rxLines", "rxId", rx.id)
    const outstanding = lines
      .filter((l) => !isFinalLine(l))
      .reduce((sum, l) => sum + outstandingOf(l), 0)
    const refs = { rxId: rx.id, patientId: rx.patientId }
    if (status === "done") {
      tx.emit("DispenseCompleted", { branchId: branch, refs, params: { rxNo: rx.rxNo, units } })
    } else {
      tx.emit("DispensePartial", {
        branchId: branch,
        refs,
        params: { rxNo: rx.rxNo, units, outstanding },
      })
    }
    if (done.some((d) => d.status === "partial")) {
      // No medicine names or quantities in the app notice (plan §11).
      notifyPatient(tx, {
        patientId: rx.patientId,
        kind: "pharmacy-balance",
        titleKey: "pharmacy.notify.balanceOpen",
        refs,
      })
    }
    return { rxId: rx.id, status, lines: done }
  },
})

/* ================================================================== *
 * pharmacy.recordBoughtElsewhere (plan §6)
 * ================================================================== */

/**
 * The patient buys a line elsewhere (PRD §9: recorded, never blocked): the
 * line is closed as bought elsewhere and its open basket line is removed so
 * the cashier no longer charges for it.
 */
export const recordBoughtElsewhere = defineCommand({
  name: "pharmacy.recordBoughtElsewhere",
  roles: ["pharmacist"],
  input: z.object({
    rxLineId: z.string(),
    reason: z.string().trim().max(200).optional(),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    const line = await tx.get("rxLines", input.rxLineId, {
      expectedVersion: input.expectedVersion,
    })
    if (!["open", "partial", "awaiting-prescriber"].includes(line.status)) {
      tx.reject("LINE_NOT_OPEN", { status: line.status })
    }
    const rx = await tx.get("prescriptions", line.rxId)
    await tx.update("rxLines", line.id, { status: "bought-elsewhere" })
    let removed = 0
    for (const basket of await tx.list("basketLines", "sourceId", line.id)) {
      if (basket.sourceType === "rx-line" && basket.status === "open") {
        await tx.update("basketLines", basket.id, { status: "removed" })
        removed += 1
      }
    }
    if (input.reason) tx.auditContext({ reason: input.reason })
    const status = await syncQueue(tx, rx.id)
    const brand = line.brandId ? await tx.find("brands", line.brandId) : undefined
    tx.emit("BoughtElsewhereRecorded", {
      branchId: tx.actor.branchId ?? line.branchId,
      refs: { rxId: rx.id, rxLineId: line.id, patientId: line.patientId },
      params: {
        rxNo: rx.rxNo,
        item: brand ? brandLabel(brand) : (line.nonDictionaryName ?? ""),
      },
    })
    return { rxLineId: line.id, basketLinesRemoved: removed, queueStatus: status }
  },
})

/* ================================================================== *
 * pharmacy.requestSubstitution (plan §6)
 * ================================================================== */

/**
 * Ask the prescriber to change a line to another brand (PRD §9: never a
 * silent substitution). Creates the request and a doctor inbox item, and
 * holds the line as awaiting the prescriber. WS-B's inbox decides it.
 */
export const requestSubstitution = defineCommand({
  name: "pharmacy.requestSubstitution",
  roles: ["pharmacist"],
  input: z.object({
    rxLineId: z.string(),
    proposedBrandId: z.string(),
    reason: z.string().trim().min(2).max(300),
    idempotencyKey,
  }),
  async run(tx, input) {
    const line = await tx.get("rxLines", input.rxLineId)
    if (line.status !== "open" && line.status !== "partial") {
      tx.reject("LINE_NOT_OPEN", { status: line.status })
    }
    const rx = await tx.get("prescriptions", line.rxId)
    if (rx.status !== "signed") tx.reject("RX_NOT_SIGNED", { rxNo: rx.rxNo })
    if (input.proposedBrandId === line.brandId) tx.reject("SUBSTITUTE_SAME_BRAND", {})
    const proposed = await tx.get("brands", input.proposedBrandId)
    const current = line.brandId ? await tx.find("brands", line.brandId) : undefined
    const pending = (await tx.list("substitutionRequests", "rxLineId", line.id)).some(
      (s) => s.status === "pending"
    )
    if (pending) tx.reject("SUBSTITUTION_PENDING", { rxNo: rx.rxNo })

    const branch = tx.actor.branchId ?? line.branchId
    const from = current ? brandLabel(current) : (line.nonDictionaryName ?? "")
    const to = brandLabel(proposed)
    const request = tx.insert("substitutionRequests", {
      rxId: rx.id,
      rxLineId: line.id,
      patientId: rx.patientId,
      doctorId: rx.doctorId,
      branchId: branch,
      proposedBrandId: proposed.id,
      reason: input.reason,
      requestedBy: tx.actor.staffId,
      status: "pending",
    })
    const refs = {
      rxId: rx.id,
      rxLineId: line.id,
      patientId: rx.patientId,
      substitutionId: request.id,
    }
    tx.insert("inboxItems", {
      doctorId: rx.doctorId,
      patientId: rx.patientId,
      kind: "substitution",
      refs,
      titleKey: "consultation.inbox.kind.substitution",
      params: { rxNo: rx.rxNo, from, to },
      status: "unread",
    })
    await tx.update("rxLines", line.id, { status: "awaiting-prescriber" })
    const status = await syncQueue(tx, rx.id)
    tx.emit("SubstitutionRequested", {
      branchId: branch,
      refs,
      params: { rxNo: rx.rxNo, from, to },
    })
    return { substitutionId: request.id, queueStatus: status }
  },
})

/* ================================================================== *
 * pharmacy.counterSale
 * ================================================================== */

/**
 * An over-the-counter cash sale: FEFO batches, dispenses with sale type
 * `otc`, stock movements. Prescription-only medicines and antibiotics are
 * refused and the attempt is audited (INV-06); the price may never exceed
 * MRP (INV-05). Payment is a simple, simulated cash tender.
 */
export const counterSale = defineCommand({
  name: "pharmacy.counterSale",
  roles: ["pharmacist"],
  input: z.object({
    items: z
      .array(
        z.object({
          brandId: z.string(),
          qty: z.number().int().positive(),
          unitPriceP: z.number().int().nonnegative().optional(),
        })
      )
      .min(1),
    /** Cash handed over; must cover the total when given */
    tenderedP: z.number().int().nonnegative().optional(),
    idempotencyKey,
  }),
  async run(tx, input) {
    const branch = actorBranch(tx)
    const pharmacist = await pharmacistOf(tx)
    const today = tx.today()
    const now = tx.now()

    // INV-06 before anything else, so the refusal (and its audit row) does not depend on stock.
    const brands: BrandRow[] = []
    for (const item of input.items) {
      const brand = await tx.get("brands", item.brandId)
      if (brand.category !== "otc" || brand.isAntibiotic) {
        tx.reject("RX_REQUIRED", { item: brandLabel(brand), rule: "INV-06" }, { audit: true })
      }
      const price = item.unitPriceP ?? brand.unitPriceP
      if (price > brand.mrpP) {
        tx.reject("PRICE_ABOVE_MRP", { item: brandLabel(brand), rule: "INV-05" }, { audit: true })
      }
      brands.push(brand)
    }

    let totalP = 0
    let units = 0
    const dispenseIds: Id[] = []
    for (const [index, item] of input.items.entries()) {
      const brand = brands[index]
      const price = item.unitPriceP ?? brand.unitPriceP
      const stock = await brandStockAt(tx, branch, brand.id)
      const { picks, shortfall } = allocateFefo(item.qty, branch, brand.id, stock, today)
      if (shortfall > 0) tx.reject("STOCK_NEGATIVE", { brandId: brand.id, branch })
      const reorder = await watchReorder(tx, branch, brand)
      for (const pick of picks) {
        const row = tx.insert("dispenses", {
          branchId: branch,
          saleType: "otc",
          brandId: brand.id,
          batchId: pick.batch.id,
          qty: pick.take,
          unitPriceP: price,
          pharmacistId: pharmacist.id,
          pharmacyCouncilNo: pharmacist.councilNo,
          labelPrinted: false,
          counselled: true,
          outstandingQty: 0,
          at: now,
        })
        dispenseIds.push(row.id)
        await moveStock(tx, pick.level, {
          type: "dispense",
          qty: -pick.take,
          refs: { dispenseId: row.id },
          reason: "OTC counter sale",
        })
        totalP += pick.take * price
      }
      units += item.qty
      await reorder()
    }
    if (input.tenderedP !== undefined && input.tenderedP < totalP) {
      tx.reject("TENDER_SHORT", { totalP })
    }
    tx.emit("CounterSaleCompleted", {
      branchId: branch,
      params: { items: input.items.length, units },
    })
    return {
      dispenseIds,
      totalP,
      changeP: input.tenderedP !== undefined ? input.tenderedP - totalP : 0,
    }
  },
})

/* ================================================================== *
 * Returns: to quarantine, then accepted or discarded
 * ================================================================== */

/** What happened to the units returned against one dispense (from its movements). */
export async function returnState(
  tx: Tx,
  dispense: DispenseRow
): Promise<{ returned: number; inQuarantine: number; accepted: number; discarded: number }> {
  const movements = (await tx.list("stockMovements", "batchId", dispense.batchId)).filter(
    (m) => m.refs.dispenseId === dispense.id && m.branchId === dispense.branchId
  )
  const sum = (type: string) =>
    movements.filter((m) => m.type === type).reduce((total, m) => total + m.qty, 0)
  const returned = sum("return")
  const released = sum("release")
  const discarded = -sum("write-off")
  return {
    returned,
    inQuarantine: returned - released,
    accepted: released - discarded,
    discarded,
  }
}

/**
 * Units a patient brings back go to quarantine, never straight back on the
 * shelf (PRD §9: "returns to quarantine until pharmacist accepts").
 */
export const returnToQuarantine = defineCommand({
  name: "pharmacy.returnToQuarantine",
  roles: ["pharmacist"],
  input: z.object({
    dispenseId: z.string(),
    qty: z.number().int().positive(),
    reason: z.string().trim().min(2).max(200),
    idempotencyKey,
  }),
  async run(tx, input) {
    const branch = actorBranch(tx)
    const dispense = await tx.get("dispenses", input.dispenseId)
    if (dispense.branchId !== branch) {
      tx.reject("RETURN_OTHER_BRANCH", { branch: dispense.branchId })
    }
    const state = await returnState(tx, dispense)
    const returnable = dispense.qty - state.returned
    if (input.qty > returnable) tx.reject("RETURN_ABOVE_DISPENSED", { qty: returnable })

    const brand = await tx.get("brands", dispense.brandId)
    const batch = await tx.get("batches", dispense.batchId)
    const level = await levelFor(tx, branch, brand.id, batch.id)
    const refs = {
      dispenseId: dispense.id,
      rxId: dispense.rxId,
      rxLineId: dispense.rxLineId,
      patientId: dispense.patientId,
    }
    // Back into the building (return), then straight into quarantine: the
    // shelf quantity is unchanged and the quarantined count goes up.
    await moveStock(tx, level, { type: "return", qty: input.qty, refs, reason: input.reason })
    await moveStock(tx, level, {
      type: "quarantine",
      qty: -input.qty,
      quarantined: input.qty,
      refs,
      reason: input.reason,
    })
    tx.emit("ReturnQuarantined", {
      branchId: branch,
      refs: { dispenseId: dispense.id, patientId: dispense.patientId, rxId: dispense.rxId },
      params: { item: brandLabel(brand), qty: input.qty, batchNo: batch.batchNo },
    })
    return { dispenseId: dispense.id, inQuarantine: state.inQuarantine + input.qty }
  },
})

/**
 * The pharmacist checks returned units in quarantine: accept them back to
 * stock (only if the batch is still usable) or discard them (written off).
 */
export const resolveReturn = defineCommand({
  name: "pharmacy.resolveReturn",
  roles: ["pharmacist"],
  input: z.object({
    dispenseId: z.string(),
    action: z.enum(["accept", "discard"]),
    idempotencyKey,
  }),
  async run(tx, input) {
    const branch = actorBranch(tx)
    const dispense = await tx.get("dispenses", input.dispenseId)
    if (dispense.branchId !== branch) {
      tx.reject("RETURN_OTHER_BRANCH", { branch: dispense.branchId })
    }
    const state = await returnState(tx, dispense)
    if (state.inQuarantine <= 0) tx.reject("NOTHING_IN_QUARANTINE", {})
    const brand = await tx.get("brands", dispense.brandId)
    const batch = await tx.get("batches", dispense.batchId)
    if (input.action === "accept" && (batch.status !== "ok" || batch.expiry < tx.today())) {
      tx.reject("BATCH_BLOCKED", { batch: batch.batchNo, status: batch.status })
    }
    const level = await levelFor(tx, branch, brand.id, batch.id)
    const refs = { dispenseId: dispense.id, rxId: dispense.rxId, patientId: dispense.patientId }
    const qty = state.inQuarantine
    await moveStock(tx, level, {
      type: "release",
      qty,
      quarantined: -qty,
      refs,
      reason: input.action === "accept" ? "Return checked and accepted" : "Return discarded",
    })
    if (input.action === "discard") {
      await moveStock(tx, level, { type: "write-off", qty: -qty, refs, reason: "Return discarded" })
    }
    tx.emit(input.action === "accept" ? "ReturnAccepted" : "ReturnDiscarded", {
      branchId: branch,
      refs,
      params: { item: brandLabel(brand), qty, batchNo: batch.batchNo },
    })
    return { dispenseId: dispense.id, qty }
  },
})

/* ================================================================== *
 * Balances: patient notice, and expiry (sweeper)
 * ================================================================== */

/**
 * Tell the patient the rest of their medicine is ready (SMS `medicine-ready`
 * and an app notice). Neither names the medicine (plan §11).
 */
export const notifyBalanceReady = defineCommand({
  name: "pharmacy.notifyBalanceReady",
  roles: ["pharmacist"],
  input: z.object({
    rxLineId: z.string(),
    smsLang: z.enum(["en", "bn"]).default("bn"),
    idempotencyKey,
  }),
  async run(tx, input) {
    const branch = actorBranch(tx)
    const line = await tx.get("rxLines", input.rxLineId)
    if (line.status !== "partial" || balanceExpired(line, tx.now())) {
      tx.reject("LINE_NOT_OPEN", { status: line.status })
    }
    const rx = await tx.get("prescriptions", line.rxId)
    const patient = await tx.get("patients", line.patientId)
    const smsConsent = patient.consents.find((c) => c.purpose === "sms")
    let smsSent = false
    if (patient.phone && smsConsent?.granted !== false) {
      queueSms(tx, {
        to: patient.phone,
        patientId: patient.id,
        lang: input.smsLang,
        templateId: "medicine-ready",
        params: { branch: getBranch(branch).name[input.smsLang] },
      })
      smsSent = true
    }
    const refs = { rxId: rx.id, rxLineId: line.id, patientId: patient.id }
    notifyPatient(tx, {
      patientId: patient.id,
      kind: "pharmacy-ready",
      titleKey: "pharmacy.notify.medicineReady",
      refs,
    })
    tx.emit("BalanceReadyNotified", { branchId: branch, refs, params: { rxNo: rx.rxNo } })
    return { smsSent }
  },
})

/** Queue entries whose only remaining lines are expired balances. */
export function closableAfterExpiry(lines: RxLineRow[], now: number): boolean {
  return (
    lines.some((l) => balanceExpired(l, now)) &&
    lines.every((l) => isFinalLine(l) || balanceExpired(l, now))
  )
}

/**
 * Sweeper (plan §3.8): a partial dispense whose balance passed its deadline
 * closes the queue entry. The line keeps its history; "expired" is derived
 * from `balanceUntil` on read.
 */
export const closeExpiredBalances = defineCommand({
  name: "pharmacy.closeExpiredBalances",
  roles: [],
  input: z.object({ queueIds: z.array(z.string()).min(1) }),
  async run(tx, input) {
    const closed: Id[] = []
    for (const id of input.queueIds) {
      const entry = await tx.get("pharmacyQueue", id)
      if (entry.status !== "partial") continue
      const lines = await tx.list("rxLines", "rxId", entry.rxId)
      if (!closableAfterExpiry(lines, tx.now())) continue
      await tx.update("pharmacyQueue", entry.id, { status: "done" })
      tx.emit("BalanceExpired", {
        branchId: entry.branchId,
        refs: { rxId: entry.rxId, patientId: entry.patientId },
        params: { rxNo: entry.rxNo },
      })
      closed.push(entry.id)
    }
    return { closed }
  },
})
