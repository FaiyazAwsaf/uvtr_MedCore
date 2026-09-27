import { HOUR } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"

/**
 * The demo panel's "Tamper test" (plan §3.5). It deliberately bypasses the
 * engine and backdates one middle audit row by an hour, directly in
 * IndexedDB, so the stored hash no longer matches the row and "Verify chain"
 * reports the break at that seq. Nothing else writes audit rows outside the
 * engine; a demo reset repairs the chain. Returns the tampered seq, or null
 * when there is no audit row yet.
 */
export async function tamperMiddleAuditRow(
  db: MedcoreDb
): Promise<number | null> {
  const count = await db.audit.count()
  if (!count) return null
  const row = await db.audit
    .orderBy("seq")
    .offset(Math.floor((count - 1) / 2))
    .first()
  if (!row) return null
  await db.audit.update(row.seq, { at: row.at - HOUR })
  return row.seq
}
