import { rules } from "@/config/rules.config"
import { MINUTE } from "@/core/clock/dates"
import type { SweepJob } from "@/core/clock/types"

import { escalateCritical } from "./commands"

/**
 * Whether unacknowledged critical calls escalate on their own. Off in
 * Release 1 (the pathologist escalates by hand); the Tier 2 toggle switches
 * `rules.criticalAutoEscalation` on.
 */
export function autoEscalationEnabled(): boolean {
  return rules.criticalAutoEscalation
}

/**
 * Auto-escalation of critical calls (plan §3.8, HAZ-05): when enabled, every
 * open call older than `rules.criticalEscalationMin` minutes of demo time
 * goes to the duty doctor, as the System actor (recorded as automatic).
 * Idempotent: a call escalated or acknowledged in the meantime is skipped.
 * Runs on offline branch stores too, since the branch keeps working.
 */
export function criticalEscalationJob(
  enabled: () => boolean = autoEscalationEnabled
): SweepJob {
  return {
    id: "lab.criticalEscalation",
    async run({ db, now, commitSystem }) {
      if (!enabled()) return
      const cutoff = now - rules.criticalEscalationMin * MINUTE
      const due = (
        await db.criticalCalls.where("status").equals("open").toArray()
      ).filter((call) => call.calledAt <= cutoff)
      for (const call of due) {
        try {
          await commitSystem(escalateCritical, { callId: call.id })
        } catch {
          // Acknowledged or escalated by someone else meanwhile: nothing to do.
        }
      }
    },
  }
}

/** Time-driven jobs owned by this module (plan §3.8). */
export const labJobs: SweepJob[] = [criticalEscalationJob()]
