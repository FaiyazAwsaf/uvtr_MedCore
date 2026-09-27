import { branches, type BranchCode } from "@/config/brand.config"
import { getControlDb } from "@/core/db/control"
import type { NetworkRow } from "@/core/db/schema"

export function onlineRow(branchId: BranchCode): NetworkRow {
  return { branchId, status: "online", queuedCount: 0 }
}

/** Make sure every branch has a network row (all online by default). */
export async function ensureNetworkRows(): Promise<void> {
  const control = getControlDb()
  const existing = new Set((await control.network.toArray()).map((r) => r.branchId))
  const missing = branches.filter((b) => !existing.has(b.code)).map((b) => onlineRow(b.code))
  if (missing.length) await control.network.bulkPut(missing)
}

export async function getNetworkRow(branchId: BranchCode): Promise<NetworkRow> {
  return (await getControlDb().network.get(branchId)) ?? onlineRow(branchId)
}

export async function offlineBranches(): Promise<BranchCode[]> {
  const rows = await getControlDb().network.toArray()
  return rows.filter((r) => r.status !== "online").map((r) => r.branchId as BranchCode)
}
