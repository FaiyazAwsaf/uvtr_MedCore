/**
 * IndexedDB reads behind the executive dashboard. Each loader is one
 * `useLiveQuery` on the screen, split so that a change re-runs only what it
 * touches (a checkout re-reads today's billing, a dispense the stock). Today's
 * records are read by index (invoices by date, dispenses by time, daily
 * stats by date); the maths lives in ./metrics.ts.
 */

import type { BranchCode } from "@/config/brand.config"
import { addDaysISO, DAY, startOfDhakaDay } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import type {
  DailyStatRow,
  Id,
  InvoiceRow,
  ISODate,
  Ms,
  SpecialtyRow,
} from "@/core/db/schema"

import {
  exceptionItems,
  liveFacts,
  payablesByBranch,
  receivablesByBranch,
  stockByBranch,
  type ExceptionItem,
  type LiveFacts,
  type LiveInput,
  type Lookups,
  type PayableFigures,
  type ReceivableFigures,
  type StockFigures,
} from "./metrics"

const uniq = <T>(values: Iterable<T>): T[] => [...new Set(values)]

/** Rows by id from a bulkGet, skipping the missing ones. */
function present<T>(rows: (T | undefined)[]): T[] {
  return rows.filter((r): r is T => r !== undefined)
}

/* ------------------------------------------------------------------ *
 * History: daily stats (including today's baseline rows)
 * ------------------------------------------------------------------ */

/** Daily stats from `days` days before `today` up to and including today. */
export async function loadDailyStats(
  db: MedcoreDb,
  today: ISODate,
  days = 181
): Promise<DailyStatRow[]> {
  return db.dailyStats
    .where("date")
    .between(addDaysISO(today, -days), today, true, true)
    .toArray()
}

/* ------------------------------------------------------------------ *
 * Today's live records
 * ------------------------------------------------------------------ */

export type SpecialtyNames = Map<string, SpecialtyRow["name"]>

/** Every live record dated `today`, with what it takes to map it to a service. */
export async function loadLiveInput(
  db: MedcoreDb,
  today: ISODate
): Promise<{ input: LiveInput; lookups: Lookups }> {
  const start = startOfDhakaDay(today)
  const end = start + DAY
  const inDay = (ms: Ms | undefined) => ms !== undefined && ms >= start && ms < end

  const [todays, payments, refunds, creditNotes, dispenses, appointments] =
    await Promise.all([
      db.invoices.where("date").equals(today).toArray(),
      db.payments.toArray(),
      db.refunds.where("status").equals("completed").toArray(),
      db.creditNotes.toArray(),
      db.dispenses.where("at").between(start, end, true, false).toArray(),
      db.appointments.where("date").equals(today).toArray(),
    ])
  const paidToday = payments.filter((p) => inDay(p.confirmedAt))
  const refundedToday = refunds.filter((r) => inDay(r.completedAt))
  const creditedToday = creditNotes.filter((n) => inDay(n.createdAt))

  // Money received or returned today on an earlier invoice needs that invoice too.
  const have = new Set(todays.map((i) => i.id))
  const moreIds = uniq(
    [...paidToday, ...refundedToday, ...creditedToday]
      .map((r) => r.invoiceId)
      .filter((id) => !have.has(id))
  )
  const invoices: InvoiceRow[] = [
    ...todays,
    ...present(await db.invoices.bulkGet(moreIds)),
  ]
  const lines = invoices.length
    ? await db.invoiceLines
        .where("invoiceId")
        .anyOf(invoices.map((i) => i.id))
        .toArray()
    : []

  const [tokens, reports, admissions] = await Promise.all([
    db.queueTokens.toArray(),
    db.labReports.toArray(),
    db.admissions.toArray(),
  ])
  const released = reports.filter((r) => inDay(r.releasedAt))
  const labItems = present(
    await db.labOrderItems.bulkGet(uniq(released.flatMap((r) => r.itemIds)))
  )
  const specimens = present(
    await db.specimens.bulkGet(
      uniq(labItems.map((i) => i.specimenId).filter((id): id is Id => !!id))
    )
  )

  const lookups = await loadLookups(db, {
    labItemIds: lines.filter((l) => l.sourceType === "test").map((l) => l.sourceId),
    imagingOrderIds: lines
      .filter((l) => l.sourceType === "imaging")
      .map((l) => l.sourceId),
    rxLineIds: lines.filter((l) => l.sourceType === "rx-line").map((l) => l.sourceId),
  })

  return {
    input: {
      date: today,
      start,
      end,
      invoices,
      lines,
      payments: paidToday,
      refunds: refundedToday,
      creditNotes: creditedToday,
      dispenses,
      appointments: appointments.filter((a) => inDay(a.checkedInAt)),
      tokens: tokens.filter((t) => inDay(t.calledAt)),
      reports: released,
      labItems,
      specimens,
      admissions: admissions.filter((a) => inDay(a.admittedAt)),
    },
    lookups,
  }
}

/** Reference data for the service keys of the given live records. */
export async function loadLookups(
  db: MedcoreDb,
  refs: { labItemIds: Id[]; imagingOrderIds: Id[]; rxLineIds: Id[] }
): Promise<Lookups> {
  const [doctors, specialties, wards, beds, admissions, labItems, imaging, rxLines] =
    await Promise.all([
      db.doctors.toArray(),
      db.specialties.toArray(),
      db.wards.toArray(),
      db.beds.toArray(),
      db.admissions.toArray(),
      db.labOrderItems.bulkGet(uniq(refs.labItemIds)),
      db.imagingOrders.bulkGet(uniq(refs.imagingOrderIds)),
      db.rxLines.bulkGet(uniq(refs.rxLineIds)),
    ])
  const items = present(labItems)
  const tests = present(await db.labTests.bulkGet(uniq(items.map((i) => i.testId))))
  const lines = present(rxLines)
  const brands = present(
    await db.brands.bulkGet(
      uniq(lines.map((l) => l.brandId).filter((id): id is Id => !!id))
    )
  )
  const specialtyCode = new Map(specialties.map((s) => [s.id, s.code]))
  const wardKind = new Map(wards.map((w) => [w.id, w.kind]))
  return {
    specialtyOfDoctor: new Map(
      doctors.flatMap((d) => {
        const code = specialtyCode.get(d.specialtyId)
        return code ? [[d.id, code] as const] : []
      })
    ),
    testOfLabItem: new Map(items.map((i) => [i.id, i.testId])),
    labTests: new Map(
      tests.map((t) => [t.id, { section: t.section, kind: t.kind, modality: t.modality }])
    ),
    modalityOfImagingOrder: new Map(present(imaging).map((o) => [o.id, o.modality])),
    brandOfRxLine: new Map(lines.map((l) => [l.id, l.brandId])),
    categoryOfBrand: new Map(brands.map((b) => [b.id, b.category])),
    wardKindOfBed: new Map(
      beds.flatMap((b) => {
        const kind = wardKind.get(b.wardId)
        return kind ? [[b.id, kind] as const] : []
      })
    ),
    bedOfAdmission: new Map(admissions.map((a) => [a.id, a.bedId])),
  }
}

/** Today's live facts, ready to merge onto the baseline. */
export async function loadLiveFacts(
  db: MedcoreDb,
  today: ISODate
): Promise<LiveFacts> {
  const { input, lookups } = await loadLiveInput(db, today)
  return liveFacts(input, lookups)
}

/** Specialty names by code (OPD service labels come from the table, EN and BN). */
export async function loadSpecialtyNames(db: MedcoreDb): Promise<SpecialtyNames> {
  const rows = await db.specialties.toArray()
  return new Map(rows.map((s) => [s.code, s.name]))
}

/* ------------------------------------------------------------------ *
 * Balances as at now
 * ------------------------------------------------------------------ */

/** Stock at cost and low-stock items per branch. */
export async function loadStock(
  db: MedcoreDb
): Promise<Record<BranchCode, StockFigures>> {
  const [levels, batches, reorder] = await Promise.all([
    db.stockLevels.toArray(),
    db.batches.toArray(),
    db.reorderLevels.toArray(),
  ])
  return stockByBranch(levels, batches, reorder)
}

export type Balances = {
  receivables: Record<BranchCode, ReceivableFigures>
  payables: Record<BranchCode, PayableFigures>
}

/** Receivables and supplier payables per branch. */
export async function loadBalances(
  db: MedcoreDb,
  today: ISODate
): Promise<Balances> {
  const [openInvoices, corporatePayments, refunds, creditNotes, payables] =
    await Promise.all([
      db.invoices.where("status").anyOf(["unpaid", "partial"]).toArray(),
      db.payments.where("tender").equals("corporate").toArray(),
      db.refunds.where("status").equals("completed").toArray(),
      db.creditNotes.toArray(),
      db.payables.toArray(),
    ])
  const corporateRefunds = refunds.filter((r) => r.tender === "corporate")
  const disputes = creditNotes.filter((n) => n.kind === "corporate-dispute")
  const invoiceIds = uniq(
    [...corporateRefunds, ...disputes].map((r) => r.invoiceId)
  )
  const invoiceBranch = new Map(
    present(await db.invoices.bulkGet(invoiceIds)).map((i) => [i.id, i.branchId])
  )
  const pos = present(await db.purchaseOrders.bulkGet(uniq(payables.map((p) => p.poId))))
  return {
    receivables: receivablesByBranch({
      openInvoices,
      corporatePayments,
      refunds: corporateRefunds,
      creditNotes: disputes,
      invoiceBranch,
    }),
    payables: payablesByBranch(
      payables,
      new Map(pos.map((p) => [p.id, p.branchId])),
      today
    ),
  }
}

/* ------------------------------------------------------------------ *
 * Exceptions
 * ------------------------------------------------------------------ */

/** Every open exception across the network (counts, branches, ages, references). */
export async function loadExceptions(db: MedcoreDb): Promise<ExceptionItem[]> {
  const [calls, validated, signed, awaiting, matches, admitted] = await Promise.all([
    db.criticalCalls.toArray(),
    db.results.where("status").equals("validated").toArray(),
    db.labReports.where("status").equals("signed").toArray(),
    db.rxLines.where("status").equals("awaiting-prescriber").toArray(),
    db.threeWayMatches.where("status").equals("mismatch").toArray(),
    db.admissions.where("status").equals("admitted").toArray(),
  ])
  const criticalResults = validated.filter((r) => r.critical)
  const itemIds = uniq([
    ...calls.map((c) => c.labOrderItemId),
    ...criticalResults.map((r) => r.labOrderItemId),
  ])
  const items = present(await db.labOrderItems.bulkGet(itemIds))
  const orders = present(
    await db.labOrders.bulkGet(uniq(items.map((i) => i.labOrderId)))
  )
  const orderNo = new Map(orders.map((o) => [o.id, o.orderNo]))

  const rx = present(await db.prescriptions.bulkGet(uniq(awaiting.map((l) => l.rxId))))
  const requests = awaiting.length
    ? await db.substitutionRequests
        .where("rxLineId")
        .anyOf(awaiting.map((l) => l.id))
        .toArray()
    : []
  const requestedAt = new Map<Id, Ms>()
  for (const r of requests) {
    if (r.status !== "pending") continue
    requestedAt.set(r.rxLineId, Math.max(requestedAt.get(r.rxLineId) ?? 0, r.createdAt))
  }

  const pos = present(await db.purchaseOrders.bulkGet(uniq(matches.map((m) => m.poId))))
  const vis = present(
    await db.vendorInvoices.bulkGet(uniq(matches.map((m) => m.vendorInvoiceId)))
  )

  return exceptionItems({
    calls,
    criticalResults,
    labItemInfo: new Map(
      items.map((i) => [i.id, { branch: i.branchId, orderNo: orderNo.get(i.labOrderId) }])
    ),
    reports: signed,
    rxLines: awaiting,
    rxNoOf: new Map(rx.map((p) => [p.id, p.rxNo])),
    requestedAt,
    matches,
    poInfo: new Map(pos.map((p) => [p.id, { poNo: p.poNo, branch: p.branchId }])),
    vendorInvoiceNo: new Map(vis.map((v) => [v.id, v.vendorInvoiceNo])),
    admissions: admitted,
  })
}
