import type { MedcoreDb } from "@/core/db/database"

import { GENESIS_HASH, hashAuditRow } from "./chain"

export type ChainStatus = {
  ok: boolean
  count: number
  /** seq of the first row whose link or hash does not verify */
  brokenAt?: number
}

/** Recompute the whole audit chain (plan §3.5, "Verify chain"). */
export async function verifyChain(db: MedcoreDb): Promise<ChainStatus> {
  let prevHash = GENESIS_HASH
  let count = 0
  let brokenAt: number | undefined
  await db.audit.orderBy("seq").each((row) => {
    if (brokenAt !== undefined) return
    count += 1
    const { hash, ...rest } = row
    if (row.prevHash !== prevHash || hashAuditRow(rest) !== hash) {
      brokenAt = row.seq
      return
    }
    prevHash = hash
  })
  return brokenAt === undefined
    ? { ok: true, count }
    : { ok: false, count, brokenAt }
}
