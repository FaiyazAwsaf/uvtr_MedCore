import { rules } from "@/config/rules.config"
import type { SweepJob } from "@/core/clock/types"
import { MINUTE } from "@/core/clock/dates"

import { timeoutMfs } from "./commands"
import { isMfs } from "./pricing"

/**
 * bKash and Nagad pushes the customer never approved time out after
 * `rules.mfsPendingTimeoutMin` minutes of demo time (PRD §19, plan §3.8), so
 * fast-forwarding the demo clock expires them in every window. A timeout
 * unlocks nothing. While a branch is offline its pushes stay "pending
 * verification" (PRD §16) and are not swept until it reconnects.
 */
export const mfsTimeoutJob: SweepJob = {
  id: "billing.mfsTimeout",
  async run({ db, now, commitSystem }) {
    if (db.kind === "edge") return
    const cutoff = now - rules.mfsPendingTimeoutMin * MINUTE
    const due = (await db.payments.where("status").equals("pending").toArray()).filter(
      (payment) => isMfs(payment.tender) && payment.requestedAt <= cutoff
    )
    for (const payment of due) {
      try {
        await commitSystem(timeoutMfs, { paymentId: payment.id })
      } catch {
        // Confirmed or timed out by someone else in the meantime: nothing to do.
      }
    }
  },
}

/** Time-driven jobs owned by this module (plan §3.8). */
export const billingJobs: SweepJob[] = [mfsTimeoutJob]
