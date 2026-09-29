/**
 * Executive dashboard figures (plan §9 `/ceo`, §12 WS-K). Pure functions over
 * rows, shared by the screen and the tests: no IndexedDB, no clock. Callers
 * pass the day, its window and "now".
 *
 * The unit every figure is built from is a `DayRow`: one branch, one day, one
 * department, with its services. History rows come straight from `dailyStats`.
 * Today's rows are the seeded baseline row (the hospital's activity up to the
 * seed moment, outside the demo's itemised records) plus every live record
 * dated today, mapped onto the same departments and service keys. Totals,
 * branch figures, the drill-down and the charts all sum the same rows, so
 * every level adds up to its parent by construction.
 *
 * Definitions (money is integer poisha):
 * - Billed: invoice lines net of discount (so an invoice's lines add up to its
 *   total), less refund credit notes issued that day; plus OTC counter sales
 *   (quantity x unit price). Corporate shares are billed too.
 * - Collected: money received that day: confirmed payments (including MFS
 *   once confirmed, never while pending; a payment later refunded still
 *   counted as received) by cash, card, bKash, Nagad or an applied deposit,
 *   less completed refunds to those tenders; plus OTC cash sales. The company
 *   share of a corporate bill (tender "corporate") is a receivable, not cash.
 * - Outstanding: billed minus collected for the same rows.
 * - Collection rate: collected / billed.
 * - Visits: per department. OPD: patients checked in. Lab, imaging and
 *   pharmacy: items billed (tests, scans, medicine lines, OTC items).
 *   Inpatient: admissions (the history rows carry the bed census).
 * - Average OPD wait: minutes from token issue to call, weighted by the
 *   number of waits behind each average (the history rows: their visits).
 * - Lab TAT: minutes from specimen collection to report release (first
 *   release only, corrections excluded), weighted by tests.
 */

import {
  branches,
  getBranch,
  type BranchCode,
} from "@/config/brand.config"
import { addDaysISO, HOUR, MINUTE, startOfDhakaDay } from "@/core/clock/dates"
import type {
  AdmissionRow,
  AppointmentRow,
  BatchRow,
  BrandRow,
  CreditNoteRow,
  CriticalCallRow,
  DailyStatRow,
  DispenseRow,
  Id,
  InvoiceLineRow,
  InvoiceRow,
  ISODate,
  LabOrderItemRow,
  LabReportRow,
  LabTestRow,
  Modality,
  Ms,
  NetworkRow,
  PayableRow,
  PaymentRow,
  Poisha,
  QueueTokenRow,
  RefundRow,
  ReorderLevelRow,
  ResultRow,
  RxLineRow,
  SpecimenRow,
  StockLevelRow,
  ThreeWayMatchRow,
  WardRow,
} from "@/core/db/schema"

/* ================================================================== *
 * Departments, branches and periods
 * ================================================================== */

export type Dept = DailyStatRow["dept"]
export const DEPTS: readonly Dept[] = [
  "opd",
  "lab",
  "imaging",
  "pharmacy",
  "inpatient",
]

export const BRANCH_CODES: readonly BranchCode[] = branches.map((b) => b.code)

export function isBranchCode(value: unknown): value is BranchCode {
  return BRANCH_CODES.includes(value as BranchCode)
}

export function isDept(value: unknown): value is Dept {
  return DEPTS.includes(value as Dept)
}

/** The departments a branch runs (its services in brand.config). */
export function deptsOf(branch: BranchCode): Dept[] {
  const services = getBranch(branch).services
  return DEPTS.filter((d) => services.includes(d))
}

/** Service key for a live record that fits no finer key (registration card, sundries). */
export const OTHER = "other"
/** Service key for a billed procedure (OPD). */
export const PROCEDURE = "procedure"

export type Period = "today" | "7d" | "30d" | "90d"
export const PERIODS: readonly Period[] = ["today", "7d", "30d", "90d"]
export const PERIOD_DAYS: Record<Exclude<Period, "today">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
}

export function isPeriod(value: unknown): value is Period {
  return PERIODS.includes(value as Period)
}

export type PeriodWindow = {
  /** The days the figures cover */
  dates: ISODate[]
  /** The previous equivalent period, for the delta chips */
  prevDates: ISODate[]
  /** The days the trend and TAT charts plot */
  chartDates: ISODate[]
}

/** `count` consecutive days ending on `last`, oldest first. */
export function daysEnding(last: ISODate, count: number): ISODate[] {
  const out: ISODate[] = []
  for (let i = count - 1; i >= 0; i--) out.push(addDaysISO(last, -i))
  return out
}

/** Charts on the Today view: the last 13 days plus today, highlighted. */
export const TODAY_CHART_DAYS = 14

/**
 * The days behind a period. Today is today (compared with yesterday by the
 * same time). "7 / 30 / 90 days" are the last N complete days, ending
 * yesterday, compared with the N days before them; they come from the daily
 * history only, so they do not move during the demo.
 */
export function periodWindow(period: Period, today: ISODate): PeriodWindow {
  if (period === "today") {
    return {
      dates: [today],
      prevDates: [addDaysISO(today, -1)],
      chartDates: daysEnding(today, TODAY_CHART_DAYS),
    }
  }
  const n = PERIOD_DAYS[period]
  const dates = daysEnding(addDaysISO(today, -1), n)
  return {
    dates,
    prevDates: daysEnding(addDaysISO(today, -(n + 1)), n),
    chartDates: dates,
  }
}

/* ================================================================== *
 * Day rows
 * ================================================================== */

export type ServiceFigures = { visits: number; billedP: Poisha }

export type DayRow = {
  branch: BranchCode
  date: ISODate
  dept: Dept
  visits: number
  billedP: Poisha
  collectedP: Poisha
  /** Average wait (minutes) and the number of waits it averages */
  waitMin: number
  waitN: number
  /** Average TAT (minutes) and the number of tests it averages */
  tatMin: number
  tatN: number
  /** Visits and billing by service key; the parts add up to the row */
  services: Record<string, ServiceFigures>
}

/**
 * A history (or baseline) row as a day row. Its services add up to the row;
 * should a row ever lack them, the remainder sits under "other".
 */
export function dayRowOf(row: DailyStatRow): DayRow {
  const services: Record<string, ServiceFigures> = {}
  let visits = 0
  let billedP = 0
  for (const s of row.services ?? []) {
    const into = (services[s.key] ??= { visits: 0, billedP: 0 })
    into.visits += s.visits
    into.billedP += s.billedP
    visits += s.visits
    billedP += s.billedP
  }
  if (visits !== row.visits || billedP !== row.billedP) {
    const into = (services[OTHER] ??= { visits: 0, billedP: 0 })
    into.visits += row.visits - visits
    into.billedP += row.billedP - billedP
  }
  return {
    branch: row.branchId,
    date: row.date,
    dept: row.dept,
    visits: row.visits,
    billedP: row.billedP,
    collectedP: row.collectedP,
    waitMin: row.avgWaitMin,
    waitN: row.avgWaitMin > 0 ? row.visits : 0,
    tatMin: row.labTatMin,
    tatN: row.labTatMin > 0 ? row.visits : 0,
    services,
  }
}

function emptyRow(branch: BranchCode, date: ISODate, dept: Dept): DayRow {
  return {
    branch,
    date,
    dept,
    visits: 0,
    billedP: 0,
    collectedP: 0,
    waitMin: 0,
    waitN: 0,
    tatMin: 0,
    tatN: 0,
    services: {},
  }
}

/* ================================================================== *
 * Live records: service mapping
 * ================================================================== */

export type WardKind = WardRow["kind"]

/** Reference data that maps a live record to its department and service key. */
export type Lookups = {
  /** doctor id to specialty code (MED, CARD, ...) */
  specialtyOfDoctor: Map<Id, string>
  /** lab order item id to its test id */
  testOfLabItem: Map<Id, Id>
  labTests: Map<Id, Pick<LabTestRow, "section" | "kind" | "modality">>
  /** imaging order id to modality */
  modalityOfImagingOrder: Map<Id, Modality>
  /** Rx line id to brand id */
  brandOfRxLine: Map<Id, Id | undefined>
  categoryOfBrand: Map<Id, BrandRow["category"]>
  /** bed id to its ward kind */
  wardKindOfBed: Map<Id, WardKind>
  /** admission id to its bed id */
  bedOfAdmission: Map<Id, Id>
}

export function emptyLookups(): Lookups {
  return {
    specialtyOfDoctor: new Map(),
    testOfLabItem: new Map(),
    labTests: new Map(),
    modalityOfImagingOrder: new Map(),
    brandOfRxLine: new Map(),
    categoryOfBrand: new Map(),
    wardKindOfBed: new Map(),
    bedOfAdmission: new Map(),
  }
}

export type ServiceRef = { dept: Dept; service: string }

function wardKindOf(id: Id, lookups: Lookups): WardKind | undefined {
  return (
    lookups.wardKindOfBed.get(id) ??
    lookups.wardKindOfBed.get(lookups.bedOfAdmission.get(id) ?? "")
  )
}

/**
 * The department and service key of a billed line, the same keys the daily
 * history uses: a consultation goes to OPD under the doctor's specialty
 * code; a test to the lab under its section (an imaging test under its
 * modality); an imaging order to imaging under its modality; an Rx line to
 * the pharmacy under its brand's category (rx / otc / controlled); a bed
 * line to inpatient under its ward kind. Procedures and sundries (such as
 * the registration card) are OPD "procedure" and "other".
 */
export function serviceOfLine(
  line: Pick<InvoiceLineRow, "sourceType" | "sourceId" | "doctorId">,
  lookups: Lookups
): ServiceRef {
  switch (line.sourceType) {
    case "consult":
      return {
        dept: "opd",
        service:
          (line.doctorId && lookups.specialtyOfDoctor.get(line.doctorId)) ||
          OTHER,
      }
    case "test": {
      const testId = lookups.testOfLabItem.get(line.sourceId)
      const test = testId ? lookups.labTests.get(testId) : undefined
      if (test?.kind === "imaging")
        return { dept: "imaging", service: test.modality ?? OTHER }
      return { dept: "lab", service: test?.section ?? OTHER }
    }
    case "imaging":
      return {
        dept: "imaging",
        service: lookups.modalityOfImagingOrder.get(line.sourceId) ?? OTHER,
      }
    case "rx-line": {
      const brandId = lookups.brandOfRxLine.get(line.sourceId)
      return {
        dept: "pharmacy",
        service: (brandId && lookups.categoryOfBrand.get(brandId)) || "rx",
      }
    }
    case "bed":
      return {
        dept: "inpatient",
        service: wardKindOf(line.sourceId, lookups) ?? "general",
      }
    case "procedure":
      return { dept: "opd", service: PROCEDURE }
    default:
      return { dept: "opd", service: OTHER }
  }
}

/* ================================================================== *
 * Live records: facts
 * ================================================================== */

/** One live contribution to a branch, department and service. */
export type Fact = {
  branch: BranchCode
  dept: Dept
  service: string
  visits: number
  billedP: Poisha
  collectedP: Poisha
}

export type Sample = { branch: BranchCode; minutes: number }

export type LiveFacts = {
  facts: Fact[]
  /** OPD waits: token issue to call */
  waits: Sample[]
  /** Lab TAT per test: collection to first release */
  tats: Sample[]
}

export type LiveInput = {
  /** The day, and its window in demo-clock milliseconds [start, end) */
  date: ISODate
  start: Ms
  end: Ms
  /** Today's invoices plus any invoice paid, refunded or credited today */
  invoices: InvoiceRow[]
  /** The lines of those invoices */
  lines: InvoiceLineRow[]
  payments: PaymentRow[]
  refunds: RefundRow[]
  creditNotes: CreditNoteRow[]
  /** Pharmacy dispenses (OTC counter sales are picked out) */
  dispenses: DispenseRow[]
  appointments: AppointmentRow[]
  tokens: QueueTokenRow[]
  /** Lab reports, their items and specimens (for TAT) */
  reports: LabReportRow[]
  labItems: LabOrderItemRow[]
  specimens: SpecimenRow[]
  admissions: AdmissionRow[]
}

/** Tenders that bring money in. A corporate share is billed to the company, not collected. */
export const CASH_TENDERS = new Set<PaymentRow["tender"]>([
  "cash",
  "card",
  "bkash",
  "nagad",
  "deposit",
])

/** Split a whole amount over weights exactly (largest remainder, ties by position). */
export function allocate(total: number, weights: readonly number[]): number[] {
  if (!weights.length) return []
  const sign = total < 0 ? -1 : 1
  const amount = Math.abs(total)
  const positive = weights.map((w) => Math.max(0, w))
  const sum = positive.reduce((s, w) => s + w, 0)
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0))
  const exact = positive.map((w) => (amount * w) / sum)
  const out = exact.map((x) => Math.floor(x))
  let left = amount - out.reduce((s, x) => s + x, 0)
  const order = exact
    .map((x, i) => ({ i, f: x - Math.floor(x) }))
    .sort((a, b) => b.f - a.f || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out.map((x) => x * sign)
}

const inWindow = (ms: Ms | undefined, start: Ms, end: Ms): boolean =>
  ms !== undefined && ms >= start && ms < end

/**
 * Every live record of the day as facts on (branch, department, service),
 * plus the wait and TAT samples. See the file header for the definitions.
 */
export function liveFacts(input: LiveInput, lookups: Lookups): LiveFacts {
  const { start, end } = input
  const facts: Fact[] = []
  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]))
  const linesOf = new Map<Id, InvoiceLineRow[]>()
  for (const line of [...input.lines].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    const list = linesOf.get(line.invoiceId) ?? []
    list.push(line)
    linesOf.set(line.invoiceId, list)
  }
  const lineById = new Map(input.lines.map((l) => [l.id, l]))
  const push = (
    branch: BranchCode,
    ref: ServiceRef,
    values: Partial<Pick<Fact, "visits" | "billedP" | "collectedP">>
  ) =>
    facts.push({
      branch,
      dept: ref.dept,
      service: ref.service,
      visits: values.visits ?? 0,
      billedP: values.billedP ?? 0,
      collectedP: values.collectedP ?? 0,
    })

  /* Billed: today's invoices, line by line (net of discount) */
  for (const invoice of input.invoices) {
    if (invoice.date !== input.date || invoice.status === "void") continue
    for (const line of linesOf.get(invoice.id) ?? []) {
      const ref = serviceOfLine(line, lookups)
      // Visits for items; OPD visits come from check-ins, not fee lines.
      const counts =
        line.status === "active" &&
        (line.sourceType === "test" ||
          line.sourceType === "imaging" ||
          line.sourceType === "rx-line")
      push(invoice.branchId, ref, {
        billedP: line.netP,
        visits: counts ? 1 : 0,
      })
    }
  }

  /* Refund credit notes issued today reduce billing, on the lines they credit */
  for (const note of input.creditNotes) {
    if (note.kind === "corporate-dispute") continue
    if (!inWindow(note.createdAt, start, end)) continue
    const invoice = invoiceById.get(note.invoiceId)
    if (!invoice) continue
    let left = note.amountP
    const first = linesOf.get(invoice.id)?.[0]
    for (const part of note.lines) {
      const line = lineById.get(part.invoiceLineId)
      const ref = line
        ? serviceOfLine(line, lookups)
        : { dept: "opd" as Dept, service: OTHER }
      push(invoice.branchId, ref, { billedP: -part.amountP })
      left -= part.amountP
    }
    if (left !== 0) {
      const ref = first
        ? serviceOfLine(first, lookups)
        : { dept: "opd" as Dept, service: OTHER }
      push(invoice.branchId, ref, { billedP: -left })
    }
  }

  /* Collected: money received today, spread over the invoice's lines by value */
  const spread = (invoice: InvoiceRow, lines: InvoiceLineRow[], amountP: number) => {
    if (!lines.length) {
      push(invoice.branchId, { dept: "opd", service: OTHER }, { collectedP: amountP })
      return
    }
    const parts = allocate(
      amountP,
      lines.map((l) => l.netP)
    )
    lines.forEach((line, i) => {
      if (parts[i]) push(invoice.branchId, serviceOfLine(line, lookups), { collectedP: parts[i] })
    })
  }
  for (const payment of input.payments) {
    if (payment.status !== "confirmed" && payment.status !== "refunded") continue
    if (!CASH_TENDERS.has(payment.tender)) continue
    if (!inWindow(payment.confirmedAt, start, end)) continue
    const invoice = invoiceById.get(payment.invoiceId)
    if (!invoice) continue
    spread(invoice, linesOf.get(invoice.id) ?? [], payment.amountP)
  }
  for (const refund of input.refunds) {
    if (refund.status !== "completed") continue
    if (!CASH_TENDERS.has(refund.tender)) continue
    if (!inWindow(refund.completedAt, start, end)) continue
    const invoice = invoiceById.get(refund.invoiceId)
    if (!invoice) continue
    const credited = refund.invoiceLineIds
      .map((id) => lineById.get(id))
      .filter((l): l is InvoiceLineRow => !!l)
    spread(invoice, credited.length ? credited : linesOf.get(invoice.id) ?? [], -refund.amountP)
  }

  /* OTC counter sales: billed and paid in cash at once, no invoice */
  const otcItems = new Set<string>()
  for (const d of input.dispenses) {
    if (d.saleType !== "otc" || !inWindow(d.at, start, end)) continue
    const valueP = d.qty * d.unitPriceP
    // One item per brand per sale, though FEFO may split it over batches.
    const key = `${d.branchId}|${d.at}|${d.brandId}`
    const visits = otcItems.has(key) ? 0 : 1
    otcItems.add(key)
    push(d.branchId, { dept: "pharmacy", service: "otc" }, {
      billedP: valueP,
      collectedP: valueP,
      visits,
    })
  }

  /* OPD visits: patients checked in today, by the doctor's specialty */
  for (const a of input.appointments) {
    if (!inWindow(a.checkedInAt, start, end)) continue
    if (a.status === "cancelled" || a.status === "rebooked") continue
    push(a.branchId, {
      dept: "opd",
      service: lookups.specialtyOfDoctor.get(a.doctorId) ?? OTHER,
    }, { visits: 1 })
  }

  /* Inpatient: admissions today, by ward kind */
  for (const adm of input.admissions) {
    if (!inWindow(adm.admittedAt, start, end)) continue
    push(adm.branchId, {
      dept: "inpatient",
      service: wardKindOf(adm.bedId, lookups) ?? "general",
    }, { visits: 1 })
  }

  /* Waits: tokens called today */
  const waits: Sample[] = []
  for (const token of input.tokens) {
    if (!inWindow(token.calledAt, start, end)) continue
    waits.push({
      branch: token.branchId,
      minutes: Math.max(0, (token.calledAt! - token.issuedAt) / MINUTE),
    })
  }

  return { facts, waits, tats: tatSamples(input) }
}

/** Lab TAT per test for reports first released in the window (corrections excluded). */
export function tatSamples(
  input: Pick<LiveInput, "start" | "end" | "reports" | "labItems" | "specimens">
): Sample[] {
  const items = new Map(input.labItems.map((i) => [i.id, i]))
  const specimens = new Map(input.specimens.map((s) => [s.id, s]))
  const out: Sample[] = []
  for (const report of input.reports) {
    if (report.supersedesId) continue
    if (!inWindow(report.releasedAt, input.start, input.end)) continue
    for (const itemId of report.itemIds) {
      const item = items.get(itemId)
      const collectedAt = item?.specimenId
        ? specimens.get(item.specimenId)?.collectedAt
        : undefined
      if (collectedAt === undefined || collectedAt > report.releasedAt!) continue
      out.push({
        branch: report.branchId,
        minutes: (report.releasedAt! - collectedAt) / MINUTE,
      })
    }
  }
  return out
}

/* ================================================================== *
 * Today = baseline + live
 * ================================================================== */

/**
 * Today's day rows: each branch's baseline rows (when the seed moment was
 * today) plus the live facts, with averages merged by weight. Every
 * department a branch runs gets a row, so an empty day still shows zeros.
 */
export function todayRows(
  baseline: DailyStatRow[],
  live: LiveFacts,
  date: ISODate
): DayRow[] {
  const rows = new Map<string, DayRow>()
  const keyOf = (branch: BranchCode, dept: Dept) => `${branch}|${dept}`
  const rowFor = (branch: BranchCode, dept: Dept) => {
    const key = keyOf(branch, dept)
    let row = rows.get(key)
    if (!row) {
      row = emptyRow(branch, date, dept)
      rows.set(key, row)
    }
    return row
  }
  for (const code of BRANCH_CODES) for (const dept of deptsOf(code)) rowFor(code, dept)
  for (const b of baseline) {
    if (b.date !== date) continue
    const base = dayRowOf(b)
    rows.set(keyOf(b.branchId, b.dept), base)
  }
  for (const f of live.facts) {
    const row = rowFor(f.branch, f.dept)
    row.visits += f.visits
    row.billedP += f.billedP
    row.collectedP += f.collectedP
    const s = (row.services[f.service] ??= { visits: 0, billedP: 0 })
    s.visits += f.visits
    s.billedP += f.billedP
  }
  const addSamples = (samples: Sample[], dept: Dept, field: "wait" | "tat") => {
    for (const code of BRANCH_CODES) {
      const mine = samples.filter((s) => s.branch === code)
      if (!mine.length) continue
      const row = rowFor(code, dept)
      const n = field === "wait" ? row.waitN : row.tatN
      const avg = field === "wait" ? row.waitMin : row.tatMin
      const sum = avg * n + mine.reduce((t, s) => t + s.minutes, 0)
      const total = n + mine.length
      if (field === "wait") {
        row.waitMin = sum / total
        row.waitN = total
      } else {
        row.tatMin = sum / total
        row.tatN = total
      }
    }
  }
  addSamples(live.waits, "opd", "wait")
  addSamples(live.tats, "lab", "tat")
  return [...rows.values()]
}

/** True when a baseline row exists for the day (the seed moment was that day). */
export function hasBaseline(baseline: DailyStatRow[], date: ISODate): boolean {
  return baseline.some((b) => b.date === date && b.asAt !== undefined)
}

/** The baseline's cut-off time for the day, if any. */
export function baselineAsAt(
  baseline: DailyStatRow[],
  date: ISODate
): Ms | undefined {
  let at: Ms | undefined
  for (const b of baseline) {
    if (b.date === date && b.asAt !== undefined) at = Math.max(at ?? 0, b.asAt)
  }
  return at
}

/* ================================================================== *
 * Same time yesterday
 * ================================================================== */

/** Opening hours (Dhaka) over which a department's day accumulates. */
export const OPEN_HOURS: Record<Dept, readonly [number, number]> = {
  opd: [8, 21],
  lab: [7, 22],
  imaging: [8, 21],
  pharmacy: [8, 23],
  inpatient: [0, 24],
}

/** The share of a department's opening hours passed at `hour` (0 to 24). */
export function dayFraction(dept: Dept, hour: number): number {
  const [open, close] = OPEN_HOURS[dept]
  return Math.min(1, Math.max(0, (hour - open) / (close - open)))
}

/** Hours since midnight (Dhaka) at a moment on a day. */
export function hourOfDay(at: Ms, date: ISODate): number {
  return (at - startOfDhakaDay(date)) / HOUR
}

/**
 * A full day's rows cut to a time of day, for "today so far" versus
 * "yesterday by the same time": flows scale by the share of opening hours
 * passed, averages stay (they are levels), and the inpatient census stays.
 */
export function scaleToHour(rows: DayRow[], hour: number): DayRow[] {
  return rows.map((row) => {
    const f = dayFraction(row.dept, hour)
    const census = row.dept === "inpatient"
    const services: Record<string, ServiceFigures> = {}
    for (const [key, s] of Object.entries(row.services)) {
      services[key] = {
        visits: census ? s.visits : Math.round(s.visits * f),
        billedP: Math.round(s.billedP * f),
      }
    }
    return {
      ...row,
      visits: census ? row.visits : Math.round(row.visits * f),
      billedP: Math.round(row.billedP * f),
      collectedP: Math.round(row.collectedP * f),
      services,
    }
  })
}

/* ================================================================== *
 * Totals, parts and series
 * ================================================================== */

export type Figures = {
  billedP: Poisha
  collectedP: Poisha
  outstandingP: Poisha
  /** Collected / billed, 0 to 1; null when nothing was billed */
  rate: number | null
  visits: number
  opdVisits: number
  /** Weighted average OPD wait; null without data */
  waitMin: number | null
  /** Weighted average lab TAT; null without data */
  tatMin: number | null
}

export type RowFilter = {
  dates?: ReadonlySet<ISODate> | readonly ISODate[]
  branch?: BranchCode | null
  dept?: Dept | null
}

export function filterRows(rows: readonly DayRow[], filter: RowFilter): DayRow[] {
  const dates = filter.dates
    ? filter.dates instanceof Set
      ? filter.dates
      : new Set(filter.dates as readonly ISODate[])
    : null
  return rows.filter(
    (r) =>
      (!dates || dates.has(r.date)) &&
      (!filter.branch || r.branch === filter.branch) &&
      (!filter.dept || r.dept === filter.dept)
  )
}

export function sumRows(rows: readonly DayRow[]): Figures {
  let billedP = 0
  let collectedP = 0
  let visits = 0
  let opdVisits = 0
  let waitSum = 0
  let waitN = 0
  let tatSum = 0
  let tatN = 0
  for (const r of rows) {
    billedP += r.billedP
    collectedP += r.collectedP
    visits += r.visits
    if (r.dept === "opd") {
      opdVisits += r.visits
      waitSum += r.waitMin * r.waitN
      waitN += r.waitN
    }
    if (r.dept === "lab") {
      tatSum += r.tatMin * r.tatN
      tatN += r.tatN
    }
  }
  return {
    billedP,
    collectedP,
    outstandingP: billedP - collectedP,
    rate: billedP > 0 ? collectedP / billedP : null,
    visits,
    opdVisits,
    waitMin: waitN > 0 ? waitSum / waitN : null,
    tatMin: tatN > 0 ? tatSum / tatN : null,
  }
}

/** Percentage change; undefined when there is nothing to compare with. */
export function pctChange(
  current: number | null | undefined,
  previous: number | null | undefined
): number | undefined {
  if (current === null || current === undefined) return undefined
  if (previous === null || previous === undefined || !(previous > 0))
    return undefined
  return ((current - previous) / previous) * 100
}

/** Difference in percentage points between two rates (0 to 1). */
export function pointsChange(
  current: number | null,
  previous: number | null | undefined
): number | undefined {
  if (current === null || previous === null || previous === undefined)
    return undefined
  return (current - previous) * 100
}

export type Part = {
  key: string
  visits: number
  billedP: Poisha
  collectedP: Poisha
  /** Share of the parent's billing, 0 to 1 */
  share: number
}

function withShares(parts: Omit<Part, "share">[]): Part[] {
  const total = parts.reduce((s, p) => s + p.billedP, 0)
  return parts.map((p) => ({ ...p, share: total > 0 ? p.billedP / total : 0 }))
}

/** Branch figures (every branch, in code order). */
export function branchParts(rows: readonly DayRow[]): Part[] {
  return withShares(
    BRANCH_CODES.map((code) => {
      const f = sumRows(rows.filter((r) => r.branch === code))
      return { key: code, visits: f.visits, billedP: f.billedP, collectedP: f.collectedP }
    })
  )
}

/** A branch's departments (the ones it runs, plus any with live figures). */
export function deptParts(rows: readonly DayRow[], branch: BranchCode): Part[] {
  const mine = rows.filter((r) => r.branch === branch)
  const depts = DEPTS.filter(
    (d) => deptsOf(branch).includes(d) || mine.some((r) => r.dept === d)
  )
  return withShares(
    depts.map((dept) => {
      const f = sumRows(mine.filter((r) => r.dept === dept))
      return { key: dept, visits: f.visits, billedP: f.billedP, collectedP: f.collectedP }
    })
  )
}

/** A department's services at a branch, highest billing first. */
export function serviceParts(
  rows: readonly DayRow[],
  branch: BranchCode,
  dept: Dept
): Part[] {
  const byKey = new Map<string, Omit<Part, "share">>()
  for (const r of rows) {
    if (r.branch !== branch || r.dept !== dept) continue
    for (const [key, s] of Object.entries(r.services)) {
      const into = byKey.get(key) ?? { key, visits: 0, billedP: 0, collectedP: 0 }
      into.visits += s.visits
      into.billedP += s.billedP
      byKey.set(key, into)
    }
  }
  return withShares(
    [...byKey.values()]
      .filter((p) => p.visits !== 0 || p.billedP !== 0)
      .sort((a, b) => b.billedP - a.billedP || a.key.localeCompare(b.key))
  )
}

export type TrendPoint = { date: ISODate; billedP: Poisha; collectedP: Poisha }

/** Billed and collected per day (optionally one branch). */
export function dailyTotals(
  rows: readonly DayRow[],
  dates: readonly ISODate[],
  branch?: BranchCode | null
): TrendPoint[] {
  const byDate = new Map<ISODate, TrendPoint>(
    dates.map((d) => [d, { date: d, billedP: 0, collectedP: 0 }])
  )
  for (const r of rows) {
    if (branch && r.branch !== branch) continue
    const p = byDate.get(r.date)
    if (!p) continue
    p.billedP += r.billedP
    p.collectedP += r.collectedP
  }
  return dates.map((d) => byDate.get(d)!)
}

/** Billed per day for one branch and department (the drill sparklines). */
export function billedSeries(
  rows: readonly DayRow[],
  dates: readonly ISODate[],
  branch: BranchCode,
  dept?: Dept,
  service?: string
): number[] {
  const byDate = new Map<ISODate, number>(dates.map((d) => [d, 0]))
  for (const r of rows) {
    if (r.branch !== branch || (dept && r.dept !== dept)) continue
    if (!byDate.has(r.date)) continue
    const value = service ? (r.services[service]?.billedP ?? 0) : r.billedP
    byDate.set(r.date, byDate.get(r.date)! + value)
  }
  return dates.map((d) => byDate.get(d)!)
}

export type TatPoint = { date: ISODate } & Partial<Record<BranchCode, number | null>>

/** Lab TAT per branch per day (null where a branch has no lab data that day). */
export function tatByBranch(
  rows: readonly DayRow[],
  dates: readonly ISODate[]
): TatPoint[] {
  return dates.map((date) => {
    const point: TatPoint = { date }
    for (const code of BRANCH_CODES) {
      if (!deptsOf(code).includes("lab")) continue
      const f = sumRows(
        rows.filter((r) => r.date === date && r.branch === code && r.dept === "lab")
      )
      point[code] = f.tatMin === null ? null : Math.round(f.tatMin)
    }
    return point
  })
}

/** The highest daily TAT in a series: which branch, which day, how long. */
export function tatPeak(
  points: readonly TatPoint[],
  branch?: BranchCode | null
): { branch: BranchCode; date: ISODate; minutes: number } | undefined {
  let peak: { branch: BranchCode; date: ISODate; minutes: number } | undefined
  for (const p of points) {
    for (const code of BRANCH_CODES) {
      if (branch && code !== branch) continue
      const v = p[code]
      if (typeof v === "number" && (!peak || v > peak.minutes))
        peak = { branch: code, date: p.date, minutes: v }
    }
  }
  return peak
}

/* ================================================================== *
 * Balances: stock, receivables, payables
 * ================================================================== */

export type StockFigures = {
  /** On-hand dispensable units at batch cost */
  valueP: Poisha
  /** Items (brand at a branch) at or below their reorder level */
  lowCount: number
}

/**
 * Stock at cost and low-stock items per branch. Value counts dispensable
 * units (quarantined units excluded) at their batch's cost. An item is low
 * when on-hand units are at or below its reorder level (including out).
 */
export function stockByBranch(
  levels: readonly StockLevelRow[],
  batches: readonly BatchRow[],
  reorderLevels: readonly ReorderLevelRow[]
): Record<BranchCode, StockFigures> {
  const cost = new Map(batches.map((b) => [b.id, b.costP]))
  const out = Object.fromEntries(
    BRANCH_CODES.map((c) => [c, { valueP: 0, lowCount: 0 }])
  ) as Record<BranchCode, StockFigures>
  const onHand = new Map<string, number>()
  for (const l of levels) {
    const qty = Math.max(0, l.qty)
    out[l.branchId].valueP += qty * (cost.get(l.batchId) ?? 0)
    const key = `${l.branchId}|${l.brandId}`
    onHand.set(key, (onHand.get(key) ?? 0) + qty)
  }
  for (const r of reorderLevels) {
    if ((onHand.get(`${r.branchId}|${r.brandId}`) ?? 0) <= r.reorderLevel)
      out[r.branchId].lowCount += 1
  }
  return out
}

export type ReceivableFigures = {
  /** Company shares of corporate bills, less refunds to them and dispute credit notes */
  corporateP: Poisha
  /** Unpaid balances of unpaid and part-paid invoices */
  unpaidP: Poisha
  totalP: Poisha
}

export type ReceivableInput = {
  /** Invoices with status unpaid or partial */
  openInvoices: InvoiceRow[]
  /** Payments with tender "corporate" */
  corporatePayments: PaymentRow[]
  /** Refunds (the corporate ones are picked out) */
  refunds: RefundRow[]
  /** Credit notes (the corporate-dispute ones are picked out) */
  creditNotes: CreditNoteRow[]
  /** Branch of every invoice those refunds and credit notes point at */
  invoiceBranch: Map<Id, BranchCode>
}

/**
 * Receivables as at now, per branch: what companies owe for their share of
 * corporate bills (less corporate refunds and corporate-dispute credit
 * notes), plus what patients still owe on unpaid or part-paid invoices.
 * Pending MFS payments are not money received, so they stay owed.
 */
export function receivablesByBranch(
  input: ReceivableInput
): Record<BranchCode, ReceivableFigures> {
  const out = Object.fromEntries(
    BRANCH_CODES.map((c) => [c, { corporateP: 0, unpaidP: 0, totalP: 0 }])
  ) as Record<BranchCode, ReceivableFigures>
  for (const p of input.corporatePayments) {
    if (p.tender !== "corporate") continue
    if (p.status !== "confirmed" && p.status !== "refunded") continue
    out[p.branchId].corporateP += p.amountP
  }
  for (const r of input.refunds) {
    if (r.tender !== "corporate" || r.status !== "completed") continue
    const branch = input.invoiceBranch.get(r.invoiceId)
    if (branch) out[branch].corporateP -= r.amountP
  }
  for (const n of input.creditNotes) {
    if (n.kind !== "corporate-dispute") continue
    const branch = input.invoiceBranch.get(n.invoiceId)
    if (branch) out[branch].corporateP -= n.amountP
  }
  for (const i of input.openInvoices) {
    if (i.status !== "unpaid" && i.status !== "partial") continue
    out[i.branchId].unpaidP += Math.max(0, i.totalP - i.paidP)
  }
  for (const code of BRANCH_CODES) {
    const f = out[code]
    f.corporateP = Math.max(0, f.corporateP)
    f.totalP = f.corporateP + f.unpaidP
  }
  return out
}

export type PayableFigures = { dueP: Poisha; count: number; overdue: number }

/** Supplier payables not yet paid, per branch of their purchase order. */
export function payablesByBranch(
  payables: readonly PayableRow[],
  branchOfPo: Map<Id, BranchCode>,
  today: ISODate
): Record<BranchCode, PayableFigures> {
  const out = Object.fromEntries(
    BRANCH_CODES.map((c) => [c, { dueP: 0, count: 0, overdue: 0 }])
  ) as Record<BranchCode, PayableFigures>
  for (const p of payables) {
    if (p.status === "paid") continue
    const branch = branchOfPo.get(p.poId)
    if (!branch) continue
    out[branch].dueP += p.amountP
    out[branch].count += 1
    if (p.dueDate < today) out[branch].overdue += 1
  }
  return out
}

/** Sum per-branch figures over all branches, or pick one. */
export function pickBranches<T extends Record<string, number>>(
  byBranch: Record<BranchCode, T>,
  branch: BranchCode | null | undefined
): T {
  if (branch) return byBranch[branch]
  const out: Record<string, number> = {}
  for (const code of BRANCH_CODES) {
    for (const [key, value] of Object.entries(byBranch[code])) {
      out[key] = (out[key] ?? 0) + value
    }
  }
  return out as T
}

/* ================================================================== *
 * Exceptions (counts, branches and ages only: never values or diagnoses)
 * ================================================================== */

export type ExceptionKind =
  | "criticals"
  | "held"
  | "awaiting"
  | "mismatch"
  | "deposit"

export const EXCEPTION_KINDS: readonly ExceptionKind[] = [
  "criticals",
  "held",
  "awaiting",
  "mismatch",
  "deposit",
]

export type ExceptionItem = {
  kind: ExceptionKind
  id: Id
  branch: BranchCode
  /** Since when it has been open (demo clock) */
  since: Ms
  /** Reference numbers (Latin): order, report, Rx, PO, admission */
  refs: string[]
}

export type ExceptionInput = {
  calls: CriticalCallRow[]
  /** Validated critical results */
  criticalResults: ResultRow[]
  /** Lab order item id to its branch and order number */
  labItemInfo: Map<Id, { branch: BranchCode; orderNo?: string }>
  reports: LabReportRow[]
  rxLines: RxLineRow[]
  rxNoOf: Map<Id, string>
  /** Rx line id to when its substitution request was raised */
  requestedAt: Map<Id, Ms>
  matches: ThreeWayMatchRow[]
  poInfo: Map<Id, { poNo: string; branch: BranchCode }>
  vendorInvoiceNo: Map<Id, string>
  admissions: AdmissionRow[]
}

/**
 * Everything that needs a person, per kind:
 * - criticals: critical calls not yet acknowledged (open or escalated), plus
 *   validated critical results with no call logged yet;
 * - held: signed lab reports held for payment;
 * - awaiting: Rx lines waiting for the prescriber's substitution decision;
 * - mismatch: three-way matches in mismatch (not yet resolved);
 * - deposit: admitted stays whose deposit fell below the alert threshold.
 */
export function exceptionItems(input: ExceptionInput): ExceptionItem[] {
  const out: ExceptionItem[] = []
  const called = new Set(input.calls.map((c) => c.resultId))
  for (const call of input.calls) {
    if (call.status === "acknowledged") continue
    const info = input.labItemInfo.get(call.labOrderItemId)
    out.push({
      kind: "criticals",
      id: call.id,
      branch: call.branchId,
      since: call.calledAt,
      refs: info?.orderNo ? [info.orderNo] : [],
    })
  }
  for (const r of input.criticalResults) {
    if (!r.critical || r.status !== "validated" || called.has(r.id)) continue
    const info = input.labItemInfo.get(r.labOrderItemId)
    if (!info) continue
    out.push({
      kind: "criticals",
      id: r.id,
      branch: info.branch,
      since: r.validatedAt ?? r.updatedAt,
      refs: info.orderNo ? [info.orderNo] : [],
    })
  }
  for (const report of input.reports) {
    if (report.status !== "signed" || !report.heldForPayment) continue
    out.push({
      kind: "held",
      id: report.id,
      branch: report.branchId,
      since: report.signedAt ?? report.updatedAt,
      refs: report.reportNo ? [report.reportNo] : [],
    })
  }
  for (const line of input.rxLines) {
    if (line.status !== "awaiting-prescriber") continue
    const rxNo = input.rxNoOf.get(line.rxId)
    out.push({
      kind: "awaiting",
      id: line.id,
      branch: line.branchId,
      since: input.requestedAt.get(line.id) ?? line.updatedAt,
      refs: rxNo ? [rxNo] : [],
    })
  }
  for (const m of input.matches) {
    if (m.status !== "mismatch") continue
    const po = input.poInfo.get(m.poId)
    if (!po) continue
    const vi = input.vendorInvoiceNo.get(m.vendorInvoiceId)
    out.push({
      kind: "mismatch",
      id: m.id,
      branch: po.branch,
      since: m.createdAt,
      refs: [po.poNo, ...(vi ? [vi] : [])],
    })
  }
  for (const a of input.admissions) {
    if (a.status !== "admitted" || a.depositAlertAt === undefined) continue
    out.push({
      kind: "deposit",
      id: a.id,
      branch: a.branchId,
      since: a.depositAlertAt,
      refs: [a.admissionNo],
    })
  }
  return out
}

export type ExceptionSummary = {
  kind: ExceptionKind
  count: number
  /** The longest-open item */
  oldest?: ExceptionItem
  items: ExceptionItem[]
}

/** One tile: the kind's items at the branch (or the network), oldest first. */
export function summarise(
  items: readonly ExceptionItem[],
  kind: ExceptionKind,
  branch?: BranchCode | null
): ExceptionSummary {
  const mine = items
    .filter((i) => i.kind === kind && (!branch || i.branch === branch))
    .sort((a, b) => a.since - b.since || a.id.localeCompare(b.id))
  return { kind, count: mine.length, oldest: mine[0], items: mine }
}

/* ================================================================== *
 * Network state (HAZ-15)
 * ================================================================== */

export type BranchNet = { status: NetworkRow["status"]; since?: Ms }

/** A branch's network state; a branch not listed is online. */
export function netOf(network: readonly NetworkRow[], branch: BranchCode): BranchNet {
  const row = network.find((n) => n.branchId === branch)
  if (!row || row.status === "online") return { status: "online" }
  return { status: row.status, since: row.since }
}

/** Branches not online (offline or replaying), in code order. */
export function offlineBranches(
  network: readonly NetworkRow[]
): { branch: BranchCode; status: NetworkRow["status"]; since?: Ms }[] {
  return BRANCH_CODES.flatMap((code) => {
    const net = netOf(network, code)
    return net.status === "online" ? [] : [{ branch: code, ...net }]
  })
}

/** Minutes as whole hours and minutes, for "2 h 23 min". */
export function splitMinutes(minutes: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(minutes))
  return { h: Math.floor(total / 60), m: total % 60 }
}
