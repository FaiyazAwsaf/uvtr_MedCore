import type { SweepJob } from "@/core/clock/types"

import { closableAfterExpiry, closeExpiredBalances } from "./commands"

/** Time-driven jobs owned by this module (plan §3.8). */
export const pharmacyJobs: SweepJob[] = [
  {
    /** Partial-dispense balances past their deadline close the queue entry. */
    id: "pharmacy.balance-expiry",
    run: async ({ db, now, commitSystem }) => {
      const partial = await db.pharmacyQueue.where("status").equals("partial").toArray()
      const due: string[] = []
      for (const entry of partial) {
        const lines = await db.rxLines.where("rxId").equals(entry.rxId).toArray()
        if (closableAfterExpiry(lines, now)) due.push(entry.id)
      }
      if (due.length) await commitSystem(closeExpiredBalances, { queueIds: due })
    },
  },
]
