import { describe, expect, it } from "vitest"

import { atDhaka, MINUTE } from "@/core/clock/dates"
import { seedRow } from "@/core/db/base"
import type {
  AdmissionRow,
  AppointmentRow,
  BaseRow,
  BatchRow,
  CreditNoteRow,
  CriticalCallRow,
  DailyStatRow,
  DispenseRow,
  InvoiceLineRow,
  InvoiceRow,
  LabOrderItemRow,
  LabReportRow,
  NetworkRow,
  PayableRow,
  PaymentRow,
  QueueTokenRow,
  RefundRow,
  ReorderLevelRow,
  ResultRow,
  RxLineRow,
  SpecimenRow,
  StockLevelRow,
  ThreeWayMatchRow,
} from "@/core/db/schema"
import {
  allocate,
  BRANCH_CODES,
  branchParts,
  dayRowOf,
  deptParts,
  emptyLookups,
  exceptionItems,
  liveFacts,
  netOf,
  offlineBranches,
  payablesByBranch,
  pctChange,
  periodWindow,
  pickBranches,
  pointsChange,
  receivablesByBranch,
  scaleToHour,
  serviceOfLine,
  serviceParts,
  stockByBranch,
  sumRows,
  summarise,
  tatByBranch,
  tatPeak,
  todayRows,
  type LiveInput,
  type Lookups,
} from "@/modules/dashboards/metrics"
import { buildView } from "@/modules/dashboards/view"

/**
 * The executive dashboard's maths on hand-made rows: the service mapping,
 * today = baseline + live, money received versus billed, deltas, drill
 * sums, balances and the exception tiles.
 */

const DAY = "2026-09-29"
const START = atDhaka(DAY, "00:00")
const END = START + 24 * 60 * MINUTE
const at = (hhmm: string) => atDhaka(DAY, hhmm)

let seq = 0
function row<T extends BaseRow>(data: Omit<T, keyof BaseRow>, id?: string, when = at("10:00")): T {
  return seedRow<T>(id ?? `x${++seq}`, when, data)
}

function lookups(): Lookups {
  const l = emptyLookups()
  l.specialtyOfDoctor.set("doc_med", "MED")
  l.specialtyOfDoctor.set("doc_card", "CARD")
  l.testOfLabItem.set("loi_cbc", "lt_cbc")
  l.testOfLabItem.set("loi_usg", "lt_usg")
  l.labTests.set("lt_cbc", { section: "haematology", kind: "lab" })
  l.labTests.set("lt_usg", { section: "imaging", kind: "imaging", modality: "usg" })
  l.modalityOfImagingOrder.set("io_xray", "xray")
  l.brandOfRxLine.set("rxl_napa", "brd_napa")
  l.brandOfRxLine.set("rxl_seclo", "brd_seclo")
  l.categoryOfBrand.set("brd_napa", "otc")
  l.categoryOfBrand.set("brd_seclo", "rx")
  l.wardKindOfBed.set("bed_1", "cabin")
  l.bedOfAdmission.set("adm_1", "bed_1")
  return l
}

function invoice(id: string, data: Partial<InvoiceRow> = {}): InvoiceRow {
  return row<InvoiceRow>(
    {
      invoiceNo: `INV-${id}`,
      companyId: "C1",
      branchId: "B1",
      patientId: "pat_1",
      date: DAY,
      payerType: "self",
      subtotalP: 0,
      discountP: 0,
      discountPct: 0,
      taxP: 0,
      totalP: 0,
      paidP: 0,
      refundedP: 0,
      status: "paid",
      cashierId: "stf_rafiq",
      ...data,
    },
    id
  )
}

function line(
  id: string,
  invoiceId: string,
  sourceType: InvoiceLineRow["sourceType"],
  sourceId: string,
  netP: number,
  extra: Partial<InvoiceLineRow> = {}
): InvoiceLineRow {
  return row<InvoiceLineRow>(
    {
      invoiceId,
      sourceType,
      sourceId,
      serviceType: "other",
      description: id,
      qty: 1,
      unitPriceP: netP,
      amountP: netP,
      discountP: 0,
      netP,
      status: "active",
      ...extra,
    },
    id
  )
}

function payment(
  id: string,
  invoiceId: string,
  tender: PaymentRow["tender"],
  amountP: number,
  status: PaymentRow["status"] = "confirmed",
  confirmedAt: number | undefined = at("10:05"),
  branchId: PaymentRow["branchId"] = "B1"
): PaymentRow {
  return row<PaymentRow>(
    {
      invoiceId,
      patientId: "pat_1",
      branchId,
      tender,
      amountP,
      status,
      idempotencyKey: id,
      requestedAt: at("10:04"),
      confirmedAt: status === "pending" ? undefined : confirmedAt,
    },
    id
  )
}

function emptyInput(): LiveInput {
  return {
    date: DAY,
    start: START,
    end: END,
    invoices: [],
    lines: [],
    payments: [],
    refunds: [],
    creditNotes: [],
    dispenses: [],
    appointments: [],
    tokens: [],
    reports: [],
    labItems: [],
    specimens: [],
    admissions: [],
  }
}

function stat(
  branch: DailyStatRow["branchId"],
  date: string,
  dept: DailyStatRow["dept"],
  values: Partial<DailyStatRow> = {}
): DailyStatRow {
  const billedP = values.billedP ?? 100_000
  const visits = values.visits ?? 10
  return row<DailyStatRow>(
    {
      branchId: branch,
      date,
      dept,
      visits,
      newPatients: 1,
      billedP,
      collectedP: values.collectedP ?? Math.round(billedP * 0.8),
      outstandingP: billedP - (values.collectedP ?? Math.round(billedP * 0.8)),
      avgWaitMin: values.avgWaitMin ?? (dept === "opd" ? 20 : 0),
      labTatMin: values.labTatMin ?? (dept === "lab" ? 140 : 0),
      expensesP: 0,
      stockValueP: 0,
      services: values.services ?? [
        { key: "a", visits: visits - 4, billedP: billedP - 40_000 },
        { key: "b", visits: 4, billedP: 40_000 },
      ],
      asAt: values.asAt,
    },
    `ds_${branch}_${dept}_${date}`
  )
}

describe("allocate", () => {
  it("splits exactly by weight, including negatives and zero weights", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33])
    expect(allocate(10, [0, 0])).toEqual([10, 0])
    const parts = allocate(123_457, [50_000, 30_000, 20_001])
    expect(parts.reduce((s, x) => s + x, 0)).toBe(123_457)
  })
})

describe("service mapping (live records onto the history's keys)", () => {
  const l = lookups()
  const map = (sourceType: InvoiceLineRow["sourceType"], sourceId: string, doctorId?: string) =>
    serviceOfLine({ sourceType, sourceId, doctorId }, l)

  it("maps each kind of line to its department and service key", () => {
    expect(map("consult", "apt_1", "doc_card")).toEqual({ dept: "opd", service: "CARD" })
    expect(map("consult", "apt_1")).toEqual({ dept: "opd", service: "other" })
    expect(map("test", "loi_cbc")).toEqual({ dept: "lab", service: "haematology" })
    expect(map("test", "loi_usg")).toEqual({ dept: "imaging", service: "usg" })
    expect(map("imaging", "io_xray")).toEqual({ dept: "imaging", service: "xray" })
    expect(map("rx-line", "rxl_napa")).toEqual({ dept: "pharmacy", service: "otc" })
    expect(map("rx-line", "rxl_seclo")).toEqual({ dept: "pharmacy", service: "rx" })
    expect(map("bed", "adm_1")).toEqual({ dept: "inpatient", service: "cabin" })
    expect(map("bed", "bed_1")).toEqual({ dept: "inpatient", service: "cabin" })
    expect(map("procedure", "p")).toEqual({ dept: "opd", service: "procedure" })
    expect(map("other", "card")).toEqual({ dept: "opd", service: "other" })
  })
})

describe("live facts", () => {
  it("bills lines net of discount, counts only money received, and never a pending MFS or a company share", () => {
    const input = emptyInput()
    input.invoices = [
      invoice("inv_a", { totalP: 250_000, status: "partial" }),
      invoice("inv_old", { date: "2026-09-27", totalP: 50_000, status: "partial" }),
    ]
    input.lines = [
      line("l1", "inv_a", "consult", "apt_1", 100_000, { doctorId: "doc_med" }),
      line("l2", "inv_a", "test", "loi_cbc", 60_000),
      line("l3", "inv_a", "imaging", "io_xray", 40_000),
      line("l4", "inv_a", "rx-line", "rxl_seclo", 50_000),
      line("l5", "inv_old", "test", "loi_cbc", 50_000),
    ]
    input.payments = [
      payment("p_cash", "inv_a", "cash", 100_000),
      payment("p_bkash", "inv_a", "bkash", 50_000, "pending"),
      payment("p_corp", "inv_a", "corporate", 50_000),
      payment("p_yday", "inv_a", "cash", 1_000, "confirmed", at("00:00") - MINUTE),
      // Balance collected today on an invoice from two days ago.
      payment("p_old", "inv_old", "card", 50_000),
    ]
    const live = liveFacts(input, lookups())
    const billed = live.facts.reduce((s, f) => s + f.billedP, 0)
    const collected = live.facts.reduce((s, f) => s + f.collectedP, 0)
    expect(billed).toBe(250_000)
    expect(collected).toBe(150_000)
    // Items count as visits; the consultation fee does not (check-ins do).
    const visits = live.facts.reduce((s, f) => s + f.visits, 0)
    expect(visits).toBe(3)
    const lab = live.facts.filter((f) => f.dept === "lab")
    expect(lab.reduce((s, f) => s + f.billedP, 0)).toBe(60_000)
    expect(lab.every((f) => f.service === "haematology")).toBe(true)
  })

  it("takes refunds out of both billing and collections, so outstanding does not move", () => {
    const input = emptyInput()
    input.invoices = [invoice("inv_r", { totalP: 80_000, refundedP: 30_000 })]
    input.lines = [
      line("r1", "inv_r", "test", "loi_cbc", 50_000),
      line("r2", "inv_r", "imaging", "io_xray", 30_000, { status: "refunded" }),
    ]
    input.payments = [payment("p_r", "inv_r", "cash", 80_000, "refunded")]
    input.refunds = [
      row<RefundRow>({
        refundNo: "RF-1",
        invoiceId: "inv_r",
        invoiceLineIds: ["r2"],
        paymentId: "p_r",
        tender: "cash",
        amountP: 30_000,
        reason: "cancelled",
        status: "completed",
        completedAt: at("11:00"),
      }),
    ]
    input.creditNotes = [
      row<CreditNoteRow>(
        {
          creditNoteNo: "CN-1",
          invoiceId: "inv_r",
          amountP: 30_000,
          reason: "cancelled",
          lines: [{ invoiceLineId: "r2", amountP: 30_000 }],
        },
        "cn_1",
        at("11:00")
      ),
    ]
    const live = liveFacts(input, lookups())
    const sum = (key: "billedP" | "collectedP") => live.facts.reduce((s, f) => s + f[key], 0)
    expect(sum("billedP")).toBe(50_000)
    expect(sum("collectedP")).toBe(50_000)
    const imaging = live.facts.filter((f) => f.dept === "imaging")
    expect(imaging.reduce((s, f) => s + f.billedP, 0)).toBe(0)
    // The refunded scan is not a visit.
    expect(imaging.reduce((s, f) => s + f.visits, 0)).toBe(0)
  })

  it("adds OTC counter sales, check-ins, admissions, waits and first-release TAT", () => {
    const input = emptyInput()
    const otc = (id: string, brandId: string, qty: number, when: number) =>
      row<DispenseRow>({
        branchId: "B3",
        saleType: "otc",
        brandId,
        batchId: `bt_${id}`,
        qty,
        unitPriceP: 250,
        pharmacistId: "stf_jahid",
        pharmacyCouncilNo: "PCB",
        labelPrinted: false,
        counselled: true,
        outstandingQty: 0,
        at: when,
      }, id)
    // One item split over two batches, plus a second item.
    input.dispenses = [otc("d1", "brd_napa", 6, at("09:00")), otc("d2", "brd_napa", 4, at("09:00")), otc("d3", "brd_ace", 10, at("09:00"))]
    input.appointments = [
      row<AppointmentRow>({
        sessionId: "s",
        patientId: "p",
        doctorId: "doc_card",
        branchId: "B2",
        date: DAY,
        slotStart: "10:00",
        source: "counter",
        visitType: "first",
        status: "checked-in",
        bookedBy: "x",
        qrCode: "q",
        checkedInAt: at("09:40"),
      }),
      row<AppointmentRow>({
        sessionId: "s",
        patientId: "p2",
        doctorId: "doc_card",
        branchId: "B2",
        date: DAY,
        slotStart: "10:10",
        source: "counter",
        visitType: "first",
        status: "booked",
        bookedBy: "x",
        qrCode: "q",
      }),
    ]
    input.admissions = [
      row<AdmissionRow>({
        admissionNo: "ADM-1",
        patientId: "p",
        branchId: "B1",
        consultantId: "doc_med",
        bedId: "bed_1",
        admittedAt: at("08:00"),
        status: "admitted",
        reason: "r",
      }),
    ]
    input.tokens = [
      row<QueueTokenRow>({
        sessionId: "s",
        appointmentId: "a",
        patientId: "p",
        branchId: "B2",
        roomId: "r",
        number: 1,
        label: "C-01",
        kind: "booked",
        status: "called",
        issuedAt: at("09:40"),
        calledAt: at("10:10"),
        position: 1,
      }),
    ]
    input.labItems = [
      row<LabOrderItemRow>({ labOrderId: "lo", patientId: "p", branchId: "B1", testId: "lt_cbc", status: "released", specimenId: "sp1", paymentCleared: true }, "i1"),
      row<LabOrderItemRow>({ labOrderId: "lo", patientId: "p", branchId: "B1", testId: "lt_cbc", status: "released", specimenId: "sp1", paymentCleared: true }, "i2"),
    ]
    input.specimens = [
      row<SpecimenRow>({ accessionNo: "A1", barcode: "A1", patientId: "p", branchId: "B1", labOrderId: "lo", itemIds: ["i1", "i2"], container: "EDTA", status: "received", collectedAt: at("08:00"), volumeRemainingMl: 1 }, "sp1"),
    ]
    const report = (id: string, supersedesId?: string) =>
      row<LabReportRow>({ reportNo: id, reportVersion: supersedesId ? 2 : 1, patientId: "p", branchId: "B1", labOrderId: "lo", itemIds: ["i1", "i2"], status: "released", releasedAt: at("10:00"), supersedesId }, id)
    input.reports = [report("R1"), report("R2", "R1")]
    const live = liveFacts(input, lookups())
    const pharmacy = live.facts.filter((f) => f.dept === "pharmacy")
    expect(pharmacy.reduce((s, f) => s + f.billedP, 0)).toBe(5_000)
    expect(pharmacy.reduce((s, f) => s + f.collectedP, 0)).toBe(5_000)
    expect(pharmacy.reduce((s, f) => s + f.visits, 0)).toBe(2)
    const opd = live.facts.filter((f) => f.dept === "opd")
    expect(opd).toHaveLength(1)
    expect(opd[0]).toMatchObject({ branch: "B2", service: "CARD", visits: 1 })
    expect(live.facts.find((f) => f.dept === "inpatient")).toMatchObject({ service: "cabin", visits: 1 })
    expect(live.waits).toEqual([{ branch: "B2", minutes: 30 }])
    // Two tests, 120 minutes each; the correction (v2) is not a turnaround.
    expect(live.tats).toEqual([
      { branch: "B1", minutes: 120 },
      { branch: "B1", minutes: 120 },
    ])
  })
})

describe("today = baseline + live", () => {
  it("adds live facts onto the baseline and merges averages by weight", () => {
    const baseline = [
      stat("B1", DAY, "opd", { visits: 30, avgWaitMin: 20, asAt: at("11:30") }),
      stat("B1", DAY, "lab", { visits: 40, labTatMin: 140, asAt: at("11:30") }),
    ]
    const rows = todayRows(
      baseline,
      {
        facts: [
          { branch: "B1", dept: "opd", service: "MED", visits: 1, billedP: 70_000, collectedP: 70_000 },
          { branch: "B1", dept: "lab", service: "a", visits: 2, billedP: 5_000, collectedP: 0 },
        ],
        waits: [{ branch: "B1", minutes: 50 }],
        tats: [{ branch: "B1", minutes: 180 }, { branch: "B1", minutes: 180 }],
      },
      DAY
    )
    const opd = rows.find((r) => r.branch === "B1" && r.dept === "opd")!
    expect(opd.visits).toBe(31)
    expect(opd.billedP).toBe(170_000)
    expect(opd.services.MED).toEqual({ visits: 1, billedP: 70_000 })
    expect(opd.waitN).toBe(31)
    expect(opd.waitMin).toBeCloseTo((20 * 30 + 50) / 31)
    const lab = rows.find((r) => r.branch === "B1" && r.dept === "lab")!
    expect(lab.tatMin).toBeCloseTo((140 * 40 + 360) / 42)
    // Every branch's departments exist, even with nothing yet.
    expect(rows.filter((r) => r.branch === "B4").map((r) => r.dept).sort()).toEqual(["imaging", "lab"])
    // Services still add up to their department.
    for (const r of rows) {
      const s = Object.values(r.services)
      expect(s.reduce((t, x) => t + x.billedP, 0)).toBe(r.billedP)
      expect(s.reduce((t, x) => t + x.visits, 0)).toBe(r.visits)
    }
  })

  it("puts any gap between a row and its services under 'other'", () => {
    const r = dayRowOf(stat("B2", DAY, "opd", { billedP: 100_000, visits: 10, services: [{ key: "MED", visits: 6, billedP: 60_000 }] }))
    expect(r.services.other).toEqual({ visits: 4, billedP: 40_000 })
  })
})

describe("periods and deltas", () => {
  it("covers today, or the last N complete days and the N days before", () => {
    const today = periodWindow("today", DAY)
    expect(today.dates).toEqual([DAY])
    expect(today.prevDates).toEqual(["2026-09-28"])
    expect(today.chartDates).toHaveLength(14)
    expect(today.chartDates.at(-1)).toBe(DAY)
    const month = periodWindow("30d", DAY)
    expect(month.dates).toHaveLength(30)
    expect(month.dates.at(-1)).toBe("2026-09-28")
    expect(month.dates[0]).toBe("2026-08-30")
    expect(month.prevDates.at(-1)).toBe("2026-08-29")
    expect(month.prevDates).toHaveLength(30)
  })

  it("compares today with yesterday cut to the baseline's time of day", () => {
    const yesterday = [stat("B1", "2026-09-28", "opd", { billedP: 1_300_000, visits: 130, collectedP: 1_000_000 })]
    const scaled = scaleToHour(yesterday.map(dayRowOf), 11.5)
    // OPD runs 08:00 to 21:00: 3.5 of 13 hours have passed.
    expect(scaled[0].billedP).toBe(Math.round((1_300_000 * 3.5) / 13))
    expect(scaled[0].visits).toBe(35)
    const rows = [
      ...yesterday.map(dayRowOf),
      ...todayRows([stat("B1", DAY, "opd", { billedP: 400_000, asAt: at("11:30") })], { facts: [], waits: [], tats: [] }, DAY),
    ]
    const view = buildView({ rows, asAt: at("11:30"), period: "today", today: DAY, branch: null })
    expect(view.comparison).toEqual({ kind: "yesterday", asAt: at("11:30") })
    expect(view.prev?.billedP).toBe(350_000)
    expect(pctChange(view.current.billedP, view.prev?.billedP)).toBeCloseTo((400_000 / 350_000 - 1) * 100)
    // Past midnight there is no baseline: live records only, no comparison.
    const live = buildView({ rows, asAt: undefined, period: "today", today: DAY, branch: null })
    expect(live.comparison).toEqual({ kind: "live-only" })
    expect(live.prev).toBeUndefined()
    // No history before the period: no delta.
    const quarter = buildView({ rows, asAt: at("11:30"), period: "90d", today: DAY, branch: null })
    expect(quarter.comparison).toEqual({ kind: "no-earlier" })
  })

  it("reports percentage and point changes only when there is a base", () => {
    expect(pctChange(110, 100)).toBeCloseTo(10)
    expect(pctChange(5, 0)).toBeUndefined()
    expect(pctChange(5, undefined)).toBeUndefined()
    expect(pointsChange(0.86, 0.84)).toBeCloseTo(2)
    expect(pointsChange(null, 0.84)).toBeUndefined()
  })
})

describe("drill-down sums", () => {
  it("adds services up to departments, departments to branches, branches to the network", () => {
    const rows = [
      ...["2026-09-27", "2026-09-28"].flatMap((d) =>
        BRANCH_CODES.flatMap((b) =>
          (["opd", "lab", "imaging", "pharmacy"] as const).map((dept, i) =>
            dayRowOf(stat(b, d, dept, { billedP: 100_000 * (i + 1), visits: 10 + i }))
          )
        )
      ),
    ]
    const network = sumRows(rows)
    const branches = branchParts(rows)
    expect(branches.reduce((s, p) => s + p.billedP, 0)).toBe(network.billedP)
    expect(branches.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1)
    for (const b of BRANCH_CODES) {
      const branch = sumRows(rows.filter((r) => r.branch === b))
      const depts = deptParts(rows, b)
      expect(depts.reduce((s, p) => s + p.billedP, 0)).toBe(branch.billedP)
      expect(depts.reduce((s, p) => s + p.visits, 0)).toBe(branch.visits)
      for (const d of depts) {
        const services = serviceParts(rows, b, d.key as "opd")
        expect(services.reduce((s, p) => s + p.billedP, 0)).toBe(d.billedP)
        expect(services.reduce((s, p) => s + p.visits, 0)).toBe(d.visits)
      }
    }
  })

  it("weights OPD wait and lab TAT by volume, and finds the TAT peak", () => {
    const rows = [
      dayRowOf(stat("B1", "2026-09-28", "lab", { visits: 100, labTatMin: 100 })),
      dayRowOf(stat("B3", "2026-09-28", "lab", { visits: 300, labTatMin: 400 })),
      dayRowOf(stat("B3", "2026-09-27", "lab", { visits: 300, labTatMin: 150 })),
    ]
    expect(sumRows(rows.filter((r) => r.date === "2026-09-28")).tatMin).toBeCloseTo(325)
    const points = tatByBranch(rows, ["2026-09-27", "2026-09-28"])
    expect(points[1].B3).toBe(400)
    expect(tatPeak(points)).toEqual({ branch: "B3", date: "2026-09-28", minutes: 400 })
    expect(tatPeak(points, "B1")).toEqual({ branch: "B1", date: "2026-09-28", minutes: 100 })
  })
})

describe("balances", () => {
  it("values stock at batch cost and counts items at or below reorder", () => {
    const level = (i: number, branchId: "B1" | "B3", brandId: string, batchId: string, qty: number) =>
      row<StockLevelRow>({ branchId, brandId, batchId, qty, quarantinedQty: 0, inTransitIn: 0, inTransitOut: 0, asAt: 0 }, `sl${i}`)
    const batch = (id: string, costP: number) =>
      row<BatchRow>({ brandId: "napa", batchNo: id, expiry: "2027-01-01", costP, mrpP: costP * 2, status: "ok" }, id)
    const reorder = (id: string, brandId: string, reorderLevel: number) =>
      row<ReorderLevelRow>({ branchId: "B1", brandId, reorderLevel, reorderQty: 20 }, id)
    const stock = stockByBranch(
      [
        level(1, "B1", "napa", "b1", 100),
        level(2, "B1", "napa", "b2", -3),
        level(3, "B1", "seclo", "b2", 5),
        level(4, "B3", "napa", "b1", 40),
      ],
      [batch("b1", 150), batch("b2", 1_000)],
      [reorder("r1", "napa", 100), reorder("r2", "seclo", 4), reorder("r3", "zimax", 10)]
    )
    expect(stock.B1.valueP).toBe(100 * 150 + 5 * 1_000)
    expect(stock.B1.lowCount).toBe(2)
    expect(stock.B3).toEqual({ valueP: 6_000, lowCount: 0 })
    expect(pickBranches(stock, null).valueP).toBe(26_000)
  })

  it("counts company shares less disputes and refunds, plus patients' unpaid balances", () => {
    const r = receivablesByBranch({
      openInvoices: [invoice("o1", { totalP: 90_000, paidP: 20_000, status: "partial", branchId: "B2" }), invoice("o2", { totalP: 10_000, paidP: 10_000, status: "paid" })],
      corporatePayments: [payment("c1", "i1", "corporate", 80_000), payment("c2", "i2", "corporate", 20_000, "confirmed", undefined, "B2")],
      refunds: [row<RefundRow>({ refundNo: "RF", invoiceId: "i1", invoiceLineIds: [], paymentId: "c1", tender: "corporate", amountP: 5_000, reason: "x", status: "completed" })],
      creditNotes: [row<CreditNoteRow>({ creditNoteNo: "CN", invoiceId: "i1", amountP: 10_000, reason: "dispute", lines: [], kind: "corporate-dispute" })],
      invoiceBranch: new Map([["i1", "B1"], ["i2", "B2"]]),
    })
    expect(r.B1).toEqual({ corporateP: 65_000, unpaidP: 0, totalP: 65_000 })
    expect(r.B2).toEqual({ corporateP: 20_000, unpaidP: 70_000, totalP: 90_000 })
  })

  it("sums unpaid supplier payables by the purchase order's branch", () => {
    const pay = (id: string, status: PayableRow["status"], dueDate: string, poId = "po1") =>
      row<PayableRow>({ vendorId: "v", vendorInvoiceId: "vi", poId, amountP: 1_000, dueDate, status }, id)
    const p = payablesByBranch([pay("a", "open", "2026-09-20"), pay("b", "scheduled", "2026-10-20"), pay("c", "paid", "2026-09-01")], new Map([["po1", "B1"]]), DAY)
    expect(p.B1).toEqual({ dueP: 2_000, count: 2, overdue: 1 })
  })
})

describe("exception tiles", () => {
  it("counts each kind with branch and age, oldest first, and no clinical values", () => {
    const items = exceptionItems({
      calls: [
        row<CriticalCallRow>({ resultId: "res_1", labOrderItemId: "loi_1", patientId: "p", branchId: "B1", valueText: "Potassium 6.8", calledPerson: "Dr", calledRole: "ordering-doctor", calledAt: at("09:00"), readBack: true, status: "open", loggedBy: "x" }, "cc1"),
        row<CriticalCallRow>({ resultId: "res_2", labOrderItemId: "loi_1", patientId: "p", branchId: "B1", valueText: "x", calledPerson: "Dr", calledRole: "ordering-doctor", calledAt: at("08:00"), readBack: true, status: "acknowledged", loggedBy: "x" }, "cc2"),
      ],
      criticalResults: [
        row<ResultRow>({ labOrderItemId: "loi_2", patientId: "p", testId: "t", analyteCode: "K", value: 6.9, flag: "HH", critical: true, source: "analyser", status: "validated", validatedAt: at("07:00") }, "res_3"),
        row<ResultRow>({ labOrderItemId: "loi_1", patientId: "p", testId: "t", analyteCode: "K", value: 6.8, flag: "HH", critical: true, source: "analyser", status: "validated", validatedAt: at("06:00") }, "res_1"),
      ],
      labItemInfo: new Map([["loi_1", { branch: "B1" as const, orderNo: "LO-B1-1" }], ["loi_2", { branch: "B3" as const, orderNo: "LO-B3-2" }]]),
      reports: [row<LabReportRow>({ reportNo: "RPT-1", reportVersion: 1, patientId: "p", branchId: "B2", labOrderId: "lo", itemIds: [], status: "signed", heldForPayment: true, signedAt: at("08:30") }, "rp1")],
      rxLines: [row<RxLineRow>({ rxId: "rx1", patientId: "p", branchId: "B1", lineNo: 1, strength: "10", form: "tablet", dosePattern: "0+0+1", mealTiming: "after", durationDays: 30, qtyPrescribed: 30, instructionsEn: "", instructionsBn: "", isAntibiotic: false, isControlled: false, paymentCleared: false, dispensedQty: 0, status: "awaiting-prescriber" }, "rxl1")],
      rxNoOf: new Map([["rx1", "RX-B1-1"]]),
      requestedAt: new Map([["rxl1", at("10:30")]]),
      matches: [row<ThreeWayMatchRow>({ poId: "po3", grnIds: [], vendorInvoiceId: "vi3", status: "mismatch", diffs: [] }, "m1"), row<ThreeWayMatchRow>({ poId: "po1", grnIds: [], vendorInvoiceId: "vi1", status: "matched", diffs: [] }, "m2")],
      poInfo: new Map([["po3", { poNo: "PO-1038", branch: "B1" as const }]]),
      vendorInvoiceNo: new Map([["vi3", "VI-03301"]]),
      admissions: [row<AdmissionRow>({ admissionNo: "ADM-B1-1", patientId: "p", branchId: "B1", consultantId: "d", bedId: "b", admittedAt: 0, status: "admitted", reason: "r", depositAlertAt: at("09:30") }, "adm1")],
    })
    const criticals = summarise(items, "criticals")
    expect(criticals.count).toBe(2)
    expect(criticals.oldest).toMatchObject({ branch: "B3", refs: ["LO-B3-2"] })
    expect(summarise(items, "criticals", "B1").count).toBe(1)
    expect(summarise(items, "held").oldest).toMatchObject({ branch: "B2", refs: ["RPT-1"] })
    expect(summarise(items, "awaiting").oldest).toMatchObject({ since: at("10:30"), refs: ["RX-B1-1"] })
    expect(summarise(items, "mismatch").oldest?.refs).toEqual(["PO-1038", "VI-03301"])
    expect(summarise(items, "deposit").count).toBe(1)
    // References only: no result value or text reaches a tile.
    expect(JSON.stringify(items)).not.toContain("6.8")
    expect(JSON.stringify(items)).not.toContain("Potassium")
  })
})

describe("network state (HAZ-15)", () => {
  it("reads offline branches and their cut time", () => {
    const network: NetworkRow[] = [
      { branchId: "B1", status: "offline", since: at("10:42"), queuedCount: 2 },
      { branchId: "B2", status: "online", queuedCount: 0 },
      { branchId: "B3", status: "syncing", since: at("10:00"), queuedCount: 1 },
    ]
    expect(netOf(network, "B1")).toEqual({ status: "offline", since: at("10:42") })
    expect(netOf(network, "B5")).toEqual({ status: "online" })
    expect(offlineBranches(network).map((o) => o.branch)).toEqual(["B1", "B3"])
  })
})
