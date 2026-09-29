import type { BranchCode } from "@/config/brand.config"
import type { SweepJob } from "@/core/clock/types"
import type { MedcoreDb } from "@/core/db/database"
import type { Id, Ms } from "@/core/db/schema"
import { offlineBranches } from "@/core/sync/network"

import { raiseDepositAlert } from "./commands"
import { alertDue, stayBill } from "./stay"

/**
 * Stays in a database whose deposit alert is due now (admitted, below the
 * threshold, not raised yet), limited to the branches this store speaks for.
 */
export async function staysDueForAlert(
  db: MedcoreDb,
  now: Ms,
  branches: (branch: BranchCode) => boolean
): Promise<Id[]> {
  const admitted = (await db.admissions.where("status").equals("admitted").toArray()).filter(
    (a) => a.depositAlertAt === undefined && branches(a.branchId)
  )
  if (!admitted.length) return []
  const [beds, deposits] = await Promise.all([
    db.beds.bulkGet(admitted.map((a) => a.bedId)),
    db.deposits.where("admissionId").anyOf(admitted.map((a) => a.id)).toArray(),
  ])
  const wards = await db.wards.bulkGet(beds.map((bed) => bed?.wardId ?? ""))
  const doctors = await db.doctors.bulkGet(admitted.map((a) => a.consultantId))
  const due: Id[] = []
  admitted.forEach((admission, index) => {
    const ward = wards[index]
    if (!ward) return
    const bill = stayBill({
      admission,
      ward,
      consultant: doctors[index],
      deposits: deposits.filter((d) => d.admissionId === admission.id),
      at: now,
    })
    if (alertDue(admission, bill)) due.push(admission.id)
  })
  return due
}

async function offlineNow(): Promise<BranchCode[]> {
  try {
    return await offlineBranches()
  } catch {
    return []
  }
}

/**
 * The deposit threshold alert (plan §3.8, PRD §8.8): every admitted stay whose
 * deposit left fell below `rules.depositThresholdP` gets one DepositLow alert
 * per crossing, raised as the System actor. It runs every couple of seconds
 * and right after the demo clock moves, so "+1 day" raises the alerts of the
 * stays it pushes below the threshold in every window.
 *
 * Offline branches: the alert is purely local arithmetic, so a branch's own
 * store raises it. An offline branch's edge store sweeps only that branch's
 * stays (they are its to change), and central skips the stays of branches
 * that are offline or syncing. Each alert is therefore raised in exactly one
 * store and replayed once on reconnect; central never raises a second copy
 * from its stale view of the branch (it has not seen the branch's top-ups).
 * The command re-checks inside the commit, so a racing top-up wins.
 */
export const depositAlertJob: SweepJob = {
  id: "inpatient.depositAlert",
  async run({ db, now, commitSystem }) {
    const edgeBranch = db.kind === "edge" ? db.edgeBranch : null
    if (db.kind === "edge" && !edgeBranch) return
    const offline = edgeBranch ? [] : await offlineNow()
    const inScope = (branch: BranchCode) =>
      edgeBranch ? branch === edgeBranch : !offline.includes(branch)
    const due = await staysDueForAlert(db, now, inScope)
    for (const admissionId of due) {
      try {
        await commitSystem(raiseDepositAlert, { admissionId })
      } catch {
        // Discharged or changed by another window meanwhile: nothing to do.
      }
    }
  },
}

/** Time-driven jobs owned by this module (plan §3.8). */
export const inpatientJobs: SweepJob[] = [depositAlertJob]
