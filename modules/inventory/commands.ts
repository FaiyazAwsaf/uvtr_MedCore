import { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import { nextTransferNo } from "@/core/engine/docNumbers"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"

import {
  adjustInTransit,
  allocateFefo,
  brandStockAt,
  levelFor,
  moveStock,
  watchReorder,
} from "./stock"

const branch = z.enum(["B1", "B2", "B3", "B4", "B5"])

/**
 * Request stock from another branch (plan §6 `transfer.requestFromRxPrompt`,
 * objective §3D). Raised from the doctor's out-of-stock prompt, the pharmacy
 * or the store. Owned by WS-E (pharmacy and inventory), which adds dispatch
 * and receipt.
 */
export const requestTransfer = defineCommand({
  name: "inventory.requestTransfer",
  roles: ["doctor", "pharmacist", "store"],
  input: z.object({
    fromBranchId: branch,
    toBranchId: branch,
    lines: z.array(z.object({ brandId: z.string(), qty: z.number().int().positive() })).min(1),
    requestedFrom: z.enum(["doctor-prompt", "pharmacy", "store"]),
    note: z.string().optional(),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    if (input.fromBranchId === input.toBranchId) tx.reject("TRANSFER_SAME_BRANCH", {})
    const transferNo = await nextTransferNo(tx)
    const transfer = tx.insert("transfers", {
      transferNo,
      fromBranchId: input.fromBranchId as BranchCode,
      toBranchId: input.toBranchId as BranchCode,
      status: "requested",
      requestedFrom: input.requestedFrom,
      requestedBy: tx.actor.staffId,
      note: input.note,
    })
    for (const line of input.lines) {
      await tx.get("brands", line.brandId)
      tx.insert("transferLines", {
        transferId: transfer.id,
        brandId: line.brandId,
        qtyRequested: line.qty,
        qtyDispatched: 0,
        qtyReceived: 0,
      })
    }
    tx.emit("TransferRequested", {
      branchId: input.toBranchId as BranchCode,
      refs: { transferId: transfer.id },
      params: { transferNo, from: input.fromBranchId, to: input.toBranchId },
    })
    return { transferId: transfer.id, transferNo }
  },
})

/** Branch staff act only for their own branch; network-level staff and the system may act for any. */
function assertAt(tx: Tx, expected: BranchCode, code: string): void {
  if (tx.actor.role === "system" || !tx.actor.branchId) return
  if (tx.actor.branchId !== expected) tx.reject(code, { branch: expected })
}

/** The stored text for a short receipt when the receiver gave no note. */
export const autoShortNote = (short: number) => `Short by ${short}`

/**
 * Dispatch a requested transfer at the source branch (objective §3D, plan
 * Phase 4 transfer loop). Batches are picked first-expiry-first-out from
 * usable stock; stock leaves the source shelf (transfer-out) and shows as in
 * transit at both ends until the destination receives it. A line needing two
 * batches is split into one line per batch, so each batch is received and
 * checked on its own. Whatever the shelf cannot cover stays as a shortfall
 * (requested minus dispatched).
 */
export const dispatchTransfer = defineCommand({
  name: "inventory.dispatchTransfer",
  roles: ["pharmacist", "store"],
  input: z.object({
    transferId: z.string(),
    /** Quantities to send per line (defaults to what was requested) */
    lines: z
      .array(z.object({ transferLineId: z.string(), qty: z.number().int().nonnegative() }))
      .optional(),
    expectedVersion: z.number().int().optional(),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const transfer = await tx.get("transfers", input.transferId, {
      expectedVersion: input.expectedVersion,
    })
    if (transfer.status !== "requested" && transfer.status !== "approved") {
      tx.reject("TRANSFER_STATE", { transferNo: transfer.transferNo, status: transfer.status })
    }
    const from = transfer.fromBranchId
    const to = transfer.toBranchId
    assertAt(tx, from, "TRANSFER_NOT_SOURCE")
    const today = tx.today()
    const refs = { transferId: transfer.id }

    let units = 0
    let short = 0
    for (const line of await tx.list("transferLines", "transferId", transfer.id)) {
      const wanted =
        input.lines?.find((l) => l.transferLineId === line.id)?.qty ?? line.qtyRequested
      if (wanted <= 0) continue
      const brand = await tx.get("brands", line.brandId)
      const stock = await brandStockAt(tx, from, brand.id)
      const { picks, shortfall } = allocateFefo(wanted, from, brand.id, stock, today)
      short += shortfall
      const reorder = await watchReorder(tx, from, brand)
      for (const [index, pick] of picks.entries()) {
        await moveStock(tx, pick.level, {
          type: "transfer-out",
          qty: -pick.take,
          inTransitOut: pick.take,
          refs,
          reason: transfer.transferNo,
        })
        const arriving = await levelFor(tx, to, brand.id, pick.batch.id)
        await adjustInTransit(tx, arriving, { inTransitIn: pick.take })
        if (index === 0) {
          await tx.update("transferLines", line.id, {
            batchId: pick.batch.id,
            qtyDispatched: pick.take,
          })
        } else {
          tx.insert("transferLines", {
            transferId: transfer.id,
            brandId: brand.id,
            batchId: pick.batch.id,
            qtyRequested: 0,
            qtyDispatched: pick.take,
            qtyReceived: 0,
          })
        }
        units += pick.take
      }
      await reorder()
    }
    if (units === 0) tx.reject("NOTHING_TO_DISPATCH", { transferNo: transfer.transferNo })

    await tx.update("transfers", transfer.id, { status: "dispatched", dispatchedAt: tx.now() })
    tx.emit("TransferDispatched", {
      branchId: from,
      refs,
      params: { transferNo: transfer.transferNo, from, to, units },
    })
    return { transferId: transfer.id, units, short }
  },
})

/**
 * Receive a dispatched transfer at the destination: stock goes on the shelf
 * (transfer-in), in-transit clears at both ends, and any shortfall is kept as
 * the line's discrepancy with the receiver's note.
 */
export const receiveTransfer = defineCommand({
  name: "inventory.receiveTransfer",
  roles: ["pharmacist", "store"],
  input: z.object({
    transferId: z.string(),
    /** Units counted per line (defaults to what was dispatched) */
    lines: z
      .array(
        z.object({
          transferLineId: z.string(),
          qtyReceived: z.number().int().nonnegative(),
          note: z.string().trim().max(200).optional(),
        })
      )
      .optional(),
    expectedVersion: z.number().int().optional(),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const transfer = await tx.get("transfers", input.transferId, {
      expectedVersion: input.expectedVersion,
    })
    if (transfer.status !== "dispatched") {
      tx.reject("TRANSFER_STATE", { transferNo: transfer.transferNo, status: transfer.status })
    }
    const from = transfer.fromBranchId
    const to = transfer.toBranchId
    assertAt(tx, to, "TRANSFER_NOT_DESTINATION")
    const refs = { transferId: transfer.id }

    let units = 0
    let short = 0
    for (const line of await tx.list("transferLines", "transferId", transfer.id)) {
      if (line.qtyDispatched <= 0 || !line.batchId) continue
      const counted = input.lines?.find((l) => l.transferLineId === line.id)
      const received = counted?.qtyReceived ?? line.qtyDispatched
      if (received > line.qtyDispatched) {
        tx.reject("RECEIVED_ABOVE_DISPATCHED", { qty: line.qtyDispatched })
      }
      const arriving = await levelFor(tx, to, line.brandId, line.batchId)
      if (received > 0) {
        await moveStock(tx, arriving, {
          type: "transfer-in",
          qty: received,
          inTransitIn: -line.qtyDispatched,
          refs,
          reason: transfer.transferNo,
        })
      } else {
        await adjustInTransit(tx, arriving, { inTransitIn: -line.qtyDispatched })
      }
      const [leaving] = await tx.list("stockLevels", "[branchId+batchId]", [from, line.batchId])
      if (leaving) await adjustInTransit(tx, leaving, { inTransitOut: -line.qtyDispatched })

      const lineShort = line.qtyDispatched - received
      await tx.update("transferLines", line.id, {
        qtyReceived: received,
        discrepancy:
          lineShort > 0 ? counted?.note || autoShortNote(lineShort) : counted?.note || undefined,
      })
      units += received
      short += lineShort
    }

    await tx.update("transfers", transfer.id, { status: "received", receivedAt: tx.now() })
    tx.emit("TransferReceived", {
      branchId: to,
      refs,
      params: { transferNo: transfer.transferNo, from, to, units, short },
    })
    return { transferId: transfer.id, units, short }
  },
})
