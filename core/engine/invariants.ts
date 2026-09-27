import { rules } from "@/config/rules.config"
import { canonicalJson } from "@/core/audit/chain"
import type { BaseRow, Id } from "@/core/db/schema"
import type { Row, TableName } from "@/core/db/tables"
import { ageOn } from "@/core/clock/dates"

import { RuleViolation } from "./errors"
import type { Actor, Change, Tx } from "./types"

/**
 * Engine-enforced business rules (plan §3.3.1). They run on every buffered
 * insert and update before anything is written, whichever command made the
 * change, so the database can never hold a state that breaks them. Commands
 * still check the same rules early to give precise messages; these are the
 * safety net that makes Consistency hold.
 */

type InvariantContext<T extends TableName> = {
  kind: "insert" | "update"
  before?: Row<T>
  after: Row<T>
  tx: Tx
  fail: (
    code: string,
    params?: Record<string, string | number>,
    audit?: boolean
  ) => never
}

type Invariant<T extends TableName = TableName> = {
  /** Plan rule id, e.g. "INV-02" */
  id: string
  table: T
  check: (ctx: InvariantContext<T>) => void | Promise<void>
}

function define<T extends TableName>(inv: Invariant<T>): Invariant {
  return inv as unknown as Invariant
}

/** Fields that changed between two rows, ignoring engine-owned fields. */
export function changedFields(before: BaseRow, after: BaseRow): string[] {
  const ignore = new Set(["version", "updatedAt", "updatedBy"])
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out: string[] = []
  for (const key of keys) {
    if (ignore.has(key)) continue
    const a = (before as Record<string, unknown>)[key]
    const b = (after as Record<string, unknown>)[key]
    // Canonical form: key order inside nested objects must not count as a change.
    if (canonicalJson(a ?? null) !== canonicalJson(b ?? null)) out.push(key)
  }
  return out
}

/** Highest discount % an actor may give without approval (INV-16). */
export function maxDiscountPct(actor: Actor): number {
  if (actor.authorities.includes("*")) return 100
  let max = 0
  for (const authority of actor.authorities) {
    const match = /^discount:(\d+)$/.exec(authority)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max
}

/** Status of a row as committed before this transaction (undefined if inserted here). */
function committedStatus(
  tx: Tx,
  table: TableName,
  id: Id,
  fallback: string | undefined
): string | undefined {
  const change = tx.changes().find((c) => c.table === table && c.id === id)
  if (change?.kind === "insert") return undefined
  if (change?.before) return (change.before as unknown as { status: string }).status
  return fallback
}

/** Signed documents: statuses that freeze content, and the fields that may still change. */
const IMMUTABLE_DOCS: Partial<
  Record<TableName, { frozen: string[]; mutable: string[] }>
> = {
  prescriptions: {
    frozen: ["signed", "superseded", "replaced"],
    mutable: ["status"],
  },
  notes: { frozen: ["signed", "amended"], mutable: ["status"] },
  labReports: {
    frozen: ["signed", "released", "superseded"],
    mutable: ["status", "releasedAt", "heldForPayment"],
  },
  imagingReports: {
    frozen: ["uploaded", "released", "superseded"],
    mutable: ["status", "releasedAt"],
  },
}

const RX_LINE_CONTENT = [
  "rxId",
  "lineNo",
  "brandId",
  "genericId",
  "nonDictionaryName",
  "strength",
  "form",
  "dosePattern",
  "mealTiming",
  "durationDays",
  "qtyPrescribed",
  "instructionsEn",
  "instructionsBn",
  "isAntibiotic",
  "isControlled",
]

const INVARIANTS: Invariant[] = [
  /* INV-01: stock never negative (replay excepted: it logs a sync exception) */
  define({
    id: "INV-01",
    table: "stockLevels",
    check: ({ after, tx, fail }) => {
      if (tx.isReplay) return
      const fields = ["qty", "quarantinedQty", "inTransitIn", "inTransitOut"] as const
      for (const field of fields) {
        if (after[field] < 0) {
          fail("STOCK_NEGATIVE", { brandId: after.brandId, branch: after.branchId })
        }
      }
    },
  }),

  /* INV-02: one NID (and one BRN) per active person, attempts audited */
  define({
    id: "INV-02",
    table: "patients",
    check: async ({ after, tx, fail }) => {
      if (after.identityStatus !== "active") return
      for (const field of ["nid", "brn"] as const) {
        const value = after[field]
        if (!value) continue
        const others = (await tx.list("patients", field, value)).filter(
          (p) => p.id !== after.id && p.identityStatus === "active"
        )
        if (others.length) {
          fail(
            field === "nid" ? "NID_EXISTS" : "BRN_EXISTS",
            { uhid: others[0].uhid },
            true
          )
        }
      }
    },
  }),

  /* INV-11: under 18 requires a guardian */
  define({
    id: "INV-11",
    table: "patients",
    check: ({ after, tx, fail }) => {
      if (after.unidentified || after.identityStatus === "merged") return
      if (ageOn(after.dob, tx.today()) < 18 && !after.guardianPatientId) {
        fail("GUARDIAN_REQUIRED", { name: after.nameEn })
      }
    },
  }),

  /* INV-03: invoices balance */
  define({
    id: "INV-03",
    table: "invoices",
    check: ({ after, fail }) => {
      if (after.totalP !== after.subtotalP - after.discountP + after.taxP) {
        fail("INVOICE_UNBALANCED", { invoiceNo: after.invoiceNo })
      }
      if (after.paidP < 0 || after.paidP > after.totalP) {
        fail("INVOICE_OVERPAID", { invoiceNo: after.invoiceNo })
      }
      if (after.status === "paid" && after.paidP !== after.totalP) {
        fail("INVOICE_STATUS", { invoiceNo: after.invoiceNo })
      }
      if (
        (after.status === "unpaid" || after.status === "partial") &&
        after.totalP > 0 &&
        after.paidP === after.totalP
      ) {
        fail("INVOICE_STATUS", { invoiceNo: after.invoiceNo })
      }
    },
  }),
  define({
    id: "INV-03",
    table: "invoiceLines",
    check: ({ after, fail }) => {
      if (
        after.amountP !== after.qty * after.unitPriceP ||
        after.netP !== after.amountP - after.discountP ||
        after.netP < 0
      ) {
        fail("INVOICE_LINE_UNBALANCED", { line: after.description })
      }
    },
  }),

  /* INV-16: discount above the actor's authority needs an approval */
  define({
    id: "INV-16",
    table: "invoices",
    check: ({ after, before, tx, fail }) => {
      if (before && before.discountPct === after.discountPct) return
      if (after.discountPct > maxDiscountPct(tx.actor) && !after.discountApprovalId) {
        fail("DISCOUNT_APPROVAL_REQUIRED", { pct: after.discountPct })
      }
    },
  }),

  /* INV-04: signed documents are immutable (new versions instead) */
  ...(["prescriptions", "notes", "labReports", "imagingReports"] as const).map(
    (table) =>
      define({
        id: "INV-04",
        table,
        check: ({ kind, before, after, fail }) => {
          if (kind !== "update" || !before) return
          const rule = IMMUTABLE_DOCS[table]!
          const beforeStatus = (before as unknown as { status: string }).status
          if (!rule.frozen.includes(beforeStatus)) return
          const afterStatus = (after as unknown as { status: string }).status
          const illegal = changedFields(before, after).filter(
            (field) => !rule.mutable.includes(field)
          )
          if (illegal.length || afterStatus === "draft") {
            fail("SIGNED_IMMUTABLE", { table, fields: illegal.join(", ") })
          }
        },
      })
  ),
  define({
    id: "INV-04",
    table: "rxLines",
    check: async ({ kind, before, after, tx, fail }) => {
      if (kind === "update" && before) {
        const touched = changedFields(before, after).filter((f) =>
          RX_LINE_CONTENT.includes(f)
        )
        if (!touched.length) return
      }
      const rx = await tx.find("prescriptions", after.rxId)
      const status = rx
        ? committedStatus(tx, "prescriptions", rx.id, rx.status)
        : undefined
      // Lines may be written while the Rx is a draft or created in this commit.
      if (status !== undefined && status !== "draft") {
        fail("SIGNED_IMMUTABLE", { table: "rxLines", fields: "content" })
      }
    },
  }),

  /* INV-05: never above MRP (audited) */
  define({
    id: "INV-05",
    table: "basketLines",
    check: ({ after, fail }) => {
      if (after.mrpP !== undefined && after.unitPriceP > after.mrpP) {
        fail("PRICE_ABOVE_MRP", { item: after.description }, true)
      }
    },
  }),

  /* INV-05, 06, 07, 08: dispensing rules */
  define({
    id: "INV-05/06/07/08",
    table: "dispenses",
    check: async ({ kind, after, tx, fail }) => {
      if (kind !== "insert") return
      const brand = await tx.get("brands", after.brandId)
      const batch = await tx.get("batches", after.batchId)
      if (after.unitPriceP > Math.min(brand.mrpP, batch.mrpP)) {
        fail("PRICE_ABOVE_MRP", { item: brand.name }, true)
      }
      if (batch.status !== "ok") {
        fail("BATCH_BLOCKED", { batch: batch.batchNo, status: batch.status })
      }
      if (batch.expiry < tx.today()) {
        fail("BATCH_EXPIRED", { batch: batch.batchNo, expiry: batch.expiry })
      }
      const needsRx = brand.category !== "otc" || brand.isAntibiotic
      if (needsRx) {
        if (after.saleType !== "rx" || !after.rxLineId) {
          fail("RX_REQUIRED", { item: brand.name }, true)
        }
        const line = await tx.get("rxLines", after.rxLineId!)
        const rx = await tx.get("prescriptions", line.rxId)
        if (rx.status !== "signed") {
          fail("RX_NOT_SIGNED", { rxNo: rx.rxNo })
        }
      }
      if (brand.category === "controlled") {
        const registered = tx
          .changes()
          .some(
            (c: Change) =>
              c.table === "controlledRegister" &&
              c.kind === "insert" &&
              (c.after as unknown as { dispenseId: string }).dispenseId === after.id
          )
        if (!registered) {
          fail("CONTROLLED_REGISTER_REQUIRED", { item: brand.name })
        }
      }
    },
  }),

  /* INV-10: payment gate for collection, dispensing and report release */
  define({
    id: "INV-10",
    table: "labOrderItems",
    check: ({ before, after, fail }) => {
      const entering = after.status === "collected" && before?.status !== "collected"
      if (entering && !after.paymentCleared) {
        fail("PAYMENT_GATE", { step: "collection" })
      }
    },
  }),
  define({
    id: "INV-10",
    table: "rxLines",
    check: ({ before, after, fail }) => {
      if (after.dispensedQty > (before?.dispensedQty ?? 0) && !after.paymentCleared) {
        fail("PAYMENT_GATE", { step: "dispense" })
      }
    },
  }),
  define({
    id: "INV-10",
    table: "labReports",
    check: async ({ before, after, tx, fail }) => {
      if (after.status !== "released" || before?.status === "released") return
      for (const itemId of after.itemIds) {
        const item = await tx.get("labOrderItems", itemId)
        if (!item.paymentCleared) fail("PAYMENT_GATE", { step: "release" })
      }
    },
  }),

  /* INV-15: no cancellation after validation */
  define({
    id: "INV-15",
    table: "labOrderItems",
    check: ({ before, after, fail }) => {
      if (
        after.status === "cancelled" &&
        before &&
        ["validated", "signed", "released"].includes(before.status)
      ) {
        fail("CANCEL_AFTER_VALIDATION", {})
      }
    },
  }),

  /* INV-12: shift close rules */
  define({
    id: "INV-12",
    table: "shifts",
    check: ({ before, after, fail }) => {
      if (before?.status === "closed") fail("SHIFT_CLOSED", {})
      if (
        after.status === "closed" &&
        Math.abs(after.varianceP ?? 0) > rules.cashVarianceThresholdP &&
        !after.varianceApprovalId
      ) {
        fail("VARIANCE_APPROVAL_REQUIRED", { varianceP: after.varianceP ?? 0 })
      }
    },
  }),
]

/** Run every invariant against every buffered insert and update. */
export async function runInvariants(tx: Tx): Promise<void> {
  for (const change of tx.changes()) {
    if (change.kind === "delete" || !change.after) continue
    for (const invariant of INVARIANTS) {
      if (invariant.table !== change.table) continue
      await invariant.check({
        kind: change.kind,
        before: change.before as Row<TableName> | undefined,
        after: change.after as Row<TableName>,
        tx,
        fail: (code, params = {}, audit = false) => {
          throw new RuleViolation(code, { ...params, rule: invariant.id }, audit)
        },
      })
    }
  }
}
