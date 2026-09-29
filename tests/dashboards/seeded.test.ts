import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { branches } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate, startOfDhakaDay } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { HERO } from "@/core/seed/content"
import { checkout, confirmMfs } from "@/modules/billing/commands"
import {
  BRANCH_CODES,
  dayRowOf,
  deptParts,
  deptsOf,
  serviceParts,
  sumRows,
  tatPeak,
  todayRows,
  type DayRow,
} from "@/modules/dashboards/metrics"
import {
  loadBalances,
  loadDailyStats,
  loadLiveFacts,
  loadStock,
} from "@/modules/dashboards/queries"
import { buildView } from "@/modules/dashboards/view"

import { heroBasket, RAFIQ, resetClock, seededDb } from "../billing/fixtures"

/**
 * The dashboard on a seeded database (demo clock at 09:30): today is the
 * baseline plus today's live records, a checkout moves Billed and Collected,
 * every drill level adds up to its parent, yesterday's B3 lab TAT spike
 * shows, and receivables and stock come from the records.
 */

let db: MedcoreDb
let today: string

beforeAll(async () => {
  db = await seededDb("dashboards-seeded")
  today = dhakaDate(now())
}, 60_000)

afterAll(async () => {
  resetClock()
  await db.delete()
})

async function rowsNow(): Promise<{
  rows: DayRow[]
  asAt: number | undefined
}> {
  const stats = await loadDailyStats(db, today)
  const live = await loadLiveFacts(db, today)
  const history = stats.filter((s) => s.date !== today).map(dayRowOf)
  const baseline = stats.filter((s) => s.date === today)
  return {
    rows: [...history, ...todayRows(baseline, live, today)],
    asAt: baseline[0]?.asAt,
  }
}

async function todayFigures(branch: "B1" | null = null) {
  const { rows } = await rowsNow()
  return sumRows(
    rows.filter((r) => r.date === today && (!branch || r.branch === branch))
  )
}

describe("today = baseline + live records", () => {
  it("has one baseline row per branch and department, cut at the seed moment", async () => {
    const stats = await loadDailyStats(db, today)
    const baseline = stats.filter((s) => s.date === today)
    const expected = branches.reduce((n, b) => n + deptsOf(b.code).length, 0)
    expect(baseline).toHaveLength(expected)
    // Every row is cut at the same seed moment (09:30 here; the clock has run on since).
    const cuts = new Set(baseline.map((b) => b.asAt))
    expect(cuts.size).toBe(1)
    const [cut] = [...cuts]
    expect(now() - cut!).toBeGreaterThanOrEqual(0)
    expect(now() - cut!).toBeLessThan(60_000)
  })

  it("adds every live record dated today on top of the baseline", async () => {
    const stats = await loadDailyStats(db, today)
    const baseline = stats.filter((s) => s.date === today)
    const start = startOfDhakaDay(today)
    const inDay = (ms?: number) =>
      ms !== undefined && ms >= start && ms < start + 86_400_000

    const invoices = (
      await db.invoices.where("date").equals(today).toArray()
    ).filter((i) => i.status !== "void")
    expect(invoices.length).toBeGreaterThan(0)
    const credited = (await db.creditNotes.toArray())
      .filter((n) => inDay(n.createdAt) && n.kind !== "corporate-dispute")
      .reduce((s, n) => s + n.amountP, 0)
    const received = (await db.payments.toArray())
      .filter(
        (p) =>
          (p.status === "confirmed" || p.status === "refunded") &&
          p.tender !== "corporate" &&
          inDay(p.confirmedAt)
      )
      .reduce((s, p) => s + p.amountP, 0)
    const refunded = (await db.refunds.toArray())
      .filter(
        (r) =>
          r.status === "completed" &&
          r.tender !== "corporate" &&
          inDay(r.completedAt)
      )
      .reduce((s, r) => s + r.amountP, 0)
    const checkedIn = (
      await db.appointments.where("date").equals(today).toArray()
    ).filter((a) => inDay(a.checkedInAt) && a.status !== "cancelled").length

    const sum = (key: "billedP" | "collectedP" | "visits", dept?: string) =>
      baseline
        .filter((b) => !dept || b.dept === dept)
        .reduce((s, b) => s + b[key], 0)
    const figures = await todayFigures()
    expect(figures.billedP).toBe(
      sum("billedP") + invoices.reduce((s, i) => s + i.totalP, 0) - credited
    )
    expect(figures.collectedP).toBe(sum("collectedP") + received - refunded)
    expect(figures.opdVisits).toBe(sum("visits", "opd") + checkedIn)
    expect(figures.outstandingP).toBe(figures.billedP - figures.collectedP)
  })

  it("rises with a checkout: billed at once, collected by what is confirmed", async () => {
    const before = await todayFigures("B1")
    const beforeReceivables = (await loadBalances(db, today)).receivables.B1
    const hero = await heroBasket(db)
    const lines = await db.basketLines.bulkGet(hero.lineIds)
    const bkashP = 1_000_00
    const cashP = hero.totalP - bkashP
    const { result } = await commit(
      checkout,
      {
        patientId: hero.patientId,
        basketLineIds: hero.lineIds,
        tenders: [
          { tender: "bkash", amountP: bkashP },
          { tender: "cash", amountP: cashP, tenderedP: cashP },
        ],
        idempotencyKey: "dash-checkout-1",
      },
      { db, actor: RAFIQ }
    )

    const afterPay = await todayFigures("B1")
    expect(afterPay.billedP - before.billedP).toBe(hero.totalP)
    // The bKash push is still pending: only the cash counts.
    expect(afterPay.collectedP - before.collectedP).toBe(cashP)
    const pendingReceivables = (await loadBalances(db, today)).receivables.B1
    expect(pendingReceivables.unpaidP - beforeReceivables.unpaidP).toBe(bkashP)

    await commit(
      confirmMfs,
      { paymentId: result.pendingPaymentIds[0] },
      { db, actor: RAFIQ }
    )
    const confirmed = await todayFigures("B1")
    expect(confirmed.collectedP - before.collectedP).toBe(hero.totalP)
    expect((await loadBalances(db, today)).receivables.B1.unpaidP).toBe(
      beforeReceivables.unpaidP
    )

    // Each line lands on its service: consultation (Medicine), lab section,
    // X-ray, and the medicines' categories.
    const { rows } = await rowsNow()
    const b1 = rows.filter((r) => r.date === today && r.branch === "B1")
    const opd = b1.find((r) => r.dept === "opd")!
    const consult = lines.find((l) => l!.sourceType === "consult")!
    expect(opd.services.MED.billedP).toBeGreaterThanOrEqual(consult.unitPriceP)
    const imaging = b1.find((r) => r.dept === "imaging")!
    expect(imaging.services.xray.billedP).toBeGreaterThan(0)
    const lab = b1.find((r) => r.dept === "lab")!
    expect(lab.services.haematology.billedP).toBeGreaterThan(0)
  })
})

describe("drill-down", () => {
  it("adds services up to departments and departments up to branches, for history and today", async () => {
    const { rows, asAt } = await rowsNow()
    for (const period of ["today", "30d"] as const) {
      const view = buildView({ rows, asAt, period, today, branch: null })
      const network = sumRows(view.periodRows)
      let branchSum = 0
      for (const code of BRANCH_CODES) {
        const branch = sumRows(view.periodRows.filter((r) => r.branch === code))
        branchSum += branch.billedP
        const depts = deptParts(view.periodRows, code)
        expect(
          depts.reduce((s, d) => s + d.billedP, 0),
          `${period} ${code}`
        ).toBe(branch.billedP)
        expect(depts.reduce((s, d) => s + d.visits, 0)).toBe(branch.visits)
        for (const dept of depts) {
          const services = serviceParts(
            view.periodRows,
            code,
            dept.key as "lab"
          )
          expect(
            services.reduce((s, x) => s + x.billedP, 0),
            `${period} ${code} ${dept.key}`
          ).toBe(dept.billedP)
          expect(services.reduce((s, x) => s + x.visits, 0)).toBe(dept.visits)
        }
      }
      expect(branchSum).toBe(network.billedP)
    }
  })

  it("splits Dhanmondi's lab into sections that add up to the department", async () => {
    const { rows, asAt } = await rowsNow()
    const view = buildView({ rows, asAt, period: "30d", today, branch: "B1" })
    const lab = deptParts(view.periodRows, "B1").find((d) => d.key === "lab")!
    const sections = serviceParts(view.periodRows, "B1", "lab")
    expect(sections.map((s) => s.key)).toEqual(
      expect.arrayContaining(["haematology", "biochemistry", "hormones"])
    )
    expect(sections.reduce((s, x) => s + x.billedP, 0)).toBe(lab.billedP)
    expect(view.current.billedP).toBe(
      deptParts(view.periodRows, "B1").reduce((s, d) => s + d.billedP, 0)
    )
  })
})

describe("trends", () => {
  it("shows yesterday's B3 analyser downtime as the lab TAT peak", async () => {
    const { rows, asAt } = await rowsNow()
    const yesterday = addDaysISO(today, -1)
    for (const period of ["today", "7d", "30d", "90d"] as const) {
      const view = buildView({ rows, asAt, period, today, branch: null })
      expect(tatPeak(view.tat), period).toMatchObject({
        branch: "B3",
        date: yesterday,
      })
      expect(view.tat.find((p) => p.date === yesterday)!.B3).toBeGreaterThan(
        390
      )
    }
    const month = buildView({ rows, asAt, period: "30d", today, branch: null })
    expect(month.trend).toHaveLength(30)
    expect(month.comparison).toEqual({ kind: "previous", days: 30 })
    // Collections run at about 85% of billing.
    expect(month.current.rate!).toBeGreaterThan(0.8)
    expect(month.current.rate!).toBeLessThan(0.9)
  })
})

describe("balances", () => {
  it("values stock at cost from the stock levels and flags the planted low stock at B1", async () => {
    const stock = await loadStock(db)
    const levels = await db.stockLevels.where("branchId").equals("B1").toArray()
    const batches = new Map(
      (await db.batches.toArray()).map((b) => [b.id, b.costP])
    )
    const value = levels.reduce(
      (s, l) => s + Math.max(0, l.qty) * (batches.get(l.batchId) ?? 0),
      0
    )
    expect(stock.B1.valueP).toBe(value)
    expect(stock.B1.lowCount).toBeGreaterThan(0)
    expect(stock.B4.valueP).toBe(0)
  })

  it("counts the companies' shares of corporate bills as receivables", async () => {
    const { receivables, payables } = await loadBalances(db, today)
    const corporate = await db.payments
      .where("tender")
      .equals("corporate")
      .toArray()
    const byBranch = (code: string) =>
      corporate
        .filter(
          (p) =>
            p.branchId === code &&
            (p.status === "confirmed" || p.status === "refunded")
        )
        .reduce((s, p) => s + p.amountP, 0)
    const total = BRANCH_CODES.reduce(
      (s, c) => s + receivables[c].corporateP,
      0
    )
    expect(total).toBeGreaterThan(0)
    expect(receivables.B1.corporateP).toBe(byBranch("B1"))
    // One seeded payable is still open.
    expect(BRANCH_CODES.reduce((s, c) => s + payables[c].count, 0)).toBe(1)
    expect(HERO.patient.abdulKarim).toBeTruthy()
  })
})
