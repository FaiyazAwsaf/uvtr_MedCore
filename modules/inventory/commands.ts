import { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import { nextTransferNo } from "@/core/engine/docNumbers"
import { defineCommand } from "@/core/engine/defineCommand"

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
