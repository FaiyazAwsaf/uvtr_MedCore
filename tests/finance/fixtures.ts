/**
 * Finance test fixtures: a seeded database with the demo clock at 09:30 Dhaka
 * (the pharmacy suite's `seededDb`), the two finance personas as actors, and
 * small helpers for rows a test needs that the seed does not plant (written
 * directly, the way the billing fixtures prepare a basket).
 */

import { expect } from "vitest"

import { now } from "@/core/clock/clock"
import { addDaysISO, atDhaka, dhakaDate } from "@/core/clock/dates"
import { seedRow } from "@/core/db/base"
import type { MedcoreDb } from "@/core/db/database"
import type { Id, InvoiceLineRow, InvoiceRow, PaymentRow, Tender } from "@/core/db/schema"
import { RuleViolation } from "@/core/engine/errors"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"

export { dropDb, seededDb } from "../pharmacy/fixtures"

export const SABRINA = actorFor(findPersona("per_finance_sabrina")!)
export const IMRAN = actorFor(findPersona("per_finance_imran")!)
export const TARIQ = actorFor(findPersona("per_store_tariq")!)
export const RAFIQ = actorFor(findPersona("per_cashier_rafiq")!)

/** Sabrina's inline approval as the override dialog resolves it (PIN verified, simulated). */
export const SABRINA_APPROVAL = {
  approverStaffId: SABRINA.staffId,
  reason: "Checked with the vendor and the company",
  pinVerified: true as const,
}

export function today(): string {
  return dhakaDate(now())
}

export function yesterday(): string {
  return addDaysISO(today(), -1)
}

let keyCounter = 0
/** A fresh idempotency key. */
export function key(prefix = "fin"): string {
  keyCounter += 1
  return `${prefix}-${keyCounter.toString().padStart(6, "0")}-${Math.floor(now())}`
}

/** Expects a promise to be refused with a rule code (and returns the violation). */
export async function expectRule(promise: Promise<unknown>, code: string): Promise<RuleViolation> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(RuleViolation)
    expect((error as RuleViolation).code).toBe(code)
    return error as RuleViolation
  }
  throw new Error(`expected rule ${code}, but the command succeeded`)
}

let rowCounter = 0

/**
 * A received payment planted directly (test setup only): on an existing
 * invoice, at a given Dhaka day and time, with a tender and amount.
 */
export async function plantPayment(
  db: MedcoreDb,
  opts: {
    invoice: InvoiceRow
    tender: Tender
    amountP: number
    day: string
    time?: string
    ref?: string
    status?: PaymentRow["status"]
  }
): Promise<PaymentRow> {
  rowCounter += 1
  const at = atDhaka(opts.day, opts.time ?? "12:00")
  const row = seedRow<PaymentRow>(`pay_fx_fin_${rowCounter}`, at, {
    invoiceId: opts.invoice.id,
    patientId: opts.invoice.patientId,
    branchId: opts.invoice.branchId,
    tender: opts.tender,
    amountP: opts.amountP,
    status: opts.status ?? "confirmed",
    ref: opts.ref,
    idempotencyKey: `fx:${rowCounter}`,
    requestedAt: at,
    confirmedAt: opts.status === "pending" ? undefined : at + 5_000,
  })
  await db.payments.add(row)
  return row
}

/**
 * A corporate invoice planted directly for an employee: one line of a given
 * service at `amountP` after the contract price, the company's share on its
 * account and the co-pay in cash.
 */
export async function plantCorporateInvoice(
  db: MedcoreDb,
  opts: { patientId: Id; clientId: Id; totalP: number; coPayP: number; day: string }
): Promise<{ invoice: InvoiceRow; line: InvoiceLineRow }> {
  rowCounter += 1
  const at = atDhaka(opts.day, "11:00")
  const invoice = seedRow<InvoiceRow>(`inv_fx_fin_${rowCounter}`, at, {
    invoiceNo: `C1-B1-2627-9${String(rowCounter).padStart(5, "0")}`,
    companyId: "C1",
    branchId: "B1",
    patientId: opts.patientId,
    date: opts.day,
    payerType: "corporate",
    corporateClientId: opts.clientId,
    subtotalP: opts.totalP,
    discountP: 0,
    discountPct: 0,
    taxP: 0,
    totalP: opts.totalP,
    paidP: opts.totalP,
    refundedP: 0,
    status: "paid",
    cashierId: RAFIQ.staffId,
  })
  const line = seedRow<InvoiceLineRow>(`invl_fx_fin_${rowCounter}`, at, {
    invoiceId: invoice.id,
    sourceType: "procedure",
    sourceId: `proc_fx_${rowCounter}`,
    serviceType: "procedure",
    description: "Day-care procedure",
    qty: 1,
    unitPriceP: opts.totalP,
    amountP: opts.totalP,
    discountP: 0,
    netP: opts.totalP,
    status: "active",
  })
  await db.invoices.add(invoice)
  await db.invoiceLines.add(line)
  await plantPayment(db, { invoice, tender: "cash", amountP: opts.coPayP, day: opts.day, time: "11:01" })
  await plantPayment(db, {
    invoice,
    tender: "corporate",
    amountP: opts.totalP - opts.coPayP,
    day: opts.day,
    time: "11:01",
  })
  return { invoice, line }
}
