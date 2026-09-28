import type { Ms, PrescriptionRow, RxLineRow } from "@/core/db/schema"

/**
 * What the patient has collected against a prescription and what is still
 * owed (HAZ-06: outstanding quantity on the label and in the app). A partial
 * dispense keeps its balance open until `balanceUntil` (7 days); after that
 * the balance is closed, derived on read from the demo clock.
 */

/** Line statuses that still owe medicine to the patient. */
const OWING: RxLineRow["status"][] = ["open", "partial", "awaiting-prescriber"]

export type LineFulfilment = {
  prescribed: number
  dispensed: number
  outstanding: number
  /** Collect-by moment for a partly dispensed line */
  deadline?: Ms
  /** The collect-by moment has passed */
  expired: boolean
}

export function lineFulfilment(line: RxLineRow, nowMs: Ms): LineFulfilment {
  const outstanding = OWING.includes(line.status)
    ? Math.max(0, line.qtyPrescribed - line.dispensedQty)
    : 0
  const deadline = line.status === "partial" ? line.balanceUntil : undefined
  return {
    prescribed: line.qtyPrescribed,
    dispensed: line.dispensedQty,
    outstanding,
    deadline,
    expired: deadline !== undefined && nowMs > deadline,
  }
}

export type RxSummary = "all" | "balance" | "expired" | "none"

/** One word for the whole prescription: all collected, a balance, a closed balance or nothing yet. */
export function rxSummary(lines: RxLineRow[], nowMs: Ms): RxSummary {
  const live = lines.filter((l) => l.status !== "cancelled")
  if (!live.length) return "none"
  const fulfilment = live.map((l) => lineFulfilment(l, nowMs))
  const owing = fulfilment.filter((f) => f.outstanding > 0)
  if (!owing.length) return "all"
  if (owing.some((f) => f.dispensed > 0 && !f.expired)) return "balance"
  if (owing.some((f) => f.expired)) return "expired"
  return fulfilment.some((f) => f.dispensed > 0) ? "balance" : "none"
}

/** Signed prescriptions and their earlier versions (never drafts), newest first. */
export function visiblePrescriptions(
  prescriptions: PrescriptionRow[]
): PrescriptionRow[] {
  return prescriptions
    .filter((rx) => rx.status !== "draft" && rx.signedAt !== undefined)
    .sort((a, b) => (b.signedAt ?? 0) - (a.signedAt ?? 0))
}

/** The version or new prescription that took over from `rx`, if any. */
export function newerPrescription(
  rx: PrescriptionRow,
  all: PrescriptionRow[]
): PrescriptionRow | undefined {
  if (rx.status !== "superseded" && rx.status !== "replaced") return undefined
  return all.find(
    (other) => other.supersedesId === rx.id || other.replacesId === rx.id
  )
}
