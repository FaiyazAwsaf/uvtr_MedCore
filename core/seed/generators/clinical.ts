/**
 * Clinical building blocks for the seeded history and today's live state:
 * encounters with signed notes, prescriptions with Rx lines and pharmacy
 * queue entries, dispensing (FEFO through the stock ledger), the lab
 * pipeline from order to released report, imaging orders and reports, and
 * doctor inbox items. Everything follows the atomic effects of plan §6 so
 * the data looks exactly like what the commands would have written.
 */

import type { BranchCode } from "@/config/brand.config"
import { counterKey, docNo } from "@/core/db/numbering"
import type {
  Container,
  Diagnosis,
  EncounterRow,
  Id,
  ImagingOrderRow,
  ImagingReportRow,
  InboxItemRow,
  LabItemStatus,
  LabOrderItemRow,
  LabOrderRow,
  LabReportRow,
  LabTestRow,
  MealTiming,
  Ms,
  NoteRow,
  NoteSections,
  PatientRow,
  PharmacyQueueRow,
  PrescriptionRow,
  ResultRow,
  RxLineRow,
  SpecimenRow,
  Vitals,
} from "@/core/db/schema"

import { sha256Hex, type SeedCtx } from "../context"
import { defaultAnalyserValue, flagFor } from "../content/analyser-scripts"
import { courseQuantity, doseInstruction } from "../content/dose"
import { ACTOR } from "../content/staff"
import { DAY, dhakaDate, MINUTE } from "../time"
import {
  createPaidInvoice,
  openBasketLine,
  type InvoiceOut,
  type LineInput,
  type TenderSplit,
} from "./billing"
import type { StockLedger } from "./stock"

/* ---------------- Encounters and notes ---------------- */

export type EncounterInput = {
  appointmentId?: Id
  patient: PatientRow
  doctorId: Id
  doctorStaffId: Id
  branch: BranchCode
  startedAt: Ms
  endedAt: Ms
  type: EncounterRow["type"]
  vitals: Omit<Vitals, "recordedAt" | "recordedBy">
  templateId: string
  sections: NoteSections
  diagnoses: Diagnosis[]
}

export function createEncounter(
  ctx: SeedCtx,
  input: EncounterInput
): { encounter: EncounterRow; note: NoteRow } {
  const { bag } = ctx
  const encounter = bag.put("encounters", ctx.seq("enc"), input.startedAt, {
    appointmentId: input.appointmentId,
    patientId: input.patient.id,
    doctorId: input.doctorId,
    branchId: input.branch,
    mode: "in-person",
    type: input.type,
    status: "closed",
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    vitals: {
      ...input.vitals,
      recordedAt: input.startedAt - 8 * MINUTE,
      recordedBy: ACTOR.farhana,
    },
    templateId: input.templateId,
  })
  encounter.updatedAt = input.endedAt
  const note = bag.put("notes", ctx.seq("note"), input.startedAt + MINUTE, {
    encounterId: encounter.id,
    patientId: input.patient.id,
    doctorId: input.doctorId,
    noteVersion: 1,
    status: "signed",
    templateId: input.templateId,
    lang: "en",
    sections: input.sections,
    diagnoses: input.diagnoses,
    signedAt: input.endedAt - MINUTE,
  })
  note.updatedAt = input.endedAt - MINUTE
  return { encounter, note }
}

/* ---------------- Prescriptions ---------------- */

export type RxLineInput = {
  brandId: Id
  dosePattern: string
  meal: MealTiming
  days: number
  qty?: number
}

export type RxOut = {
  rx: PrescriptionRow
  lines: RxLineRow[]
  queue: PharmacyQueueRow
}

export function createPrescription(
  ctx: SeedCtx,
  ledger: StockLedger,
  input: {
    encounter: EncounterRow
    doctorStaffId: Id
    signedAt: Ms
    lines: RxLineInput[]
    advice: string
    followUpDays?: number
    tests?: string[]
  }
): RxOut {
  const { bag } = ctx
  const e = input.encounter
  const rx = bag.put(
    "prescriptions",
    ctx.seq("rx"),
    input.signedAt - 3 * MINUTE,
    {
      rxNo: "",
      rxVersion: 1,
      encounterId: e.id,
      patientId: e.patientId,
      doctorId: e.doctorId,
      branchId: e.branchId,
      status: "signed",
      mode: "in-person",
      advice: input.advice,
      followUpDate: input.followUpDays
        ? dhakaDate(input.signedAt + input.followUpDays * DAY)
        : undefined,
      tests: input.tests ?? [],
      vitalsSnapshot: e.vitals,
      signedAt: input.signedAt,
    }
  )
  const queue = bag.put("pharmacyQueue", ctx.seq("pq"), input.signedAt, {
    rxId: rx.id,
    rxNo: "",
    patientId: e.patientId,
    branchId: e.branchId,
    status: "waiting",
    receivedAt: input.signedAt,
  })
  ctx.numbers.request(counterKey.rx(e.branchId), input.signedAt, (n) => {
    rx.rxNo = docNo.rx(e.branchId, n)
    queue.rxNo = rx.rxNo
  })

  const lines = input.lines.map((l, i) => {
    const brand = ledger.brand(l.brandId)
    const generic = bag.get("generics", brand.genericId)
    const instructions = doseInstruction(l.dosePattern, l.meal, l.days)
    return bag.put("rxLines", ctx.seq("rxl"), input.signedAt - 2 * MINUTE, {
      rxId: rx.id,
      patientId: e.patientId,
      branchId: e.branchId,
      lineNo: i + 1,
      brandId: brand.id,
      genericId: generic.id,
      strength: brand.strength,
      form: brand.form,
      dosePattern: l.dosePattern,
      mealTiming: l.meal,
      durationDays: l.days,
      qtyPrescribed: l.qty ?? courseQuantity(l.dosePattern, l.days),
      instructionsEn: instructions.en,
      instructionsBn: instructions.bn,
      isAntibiotic: brand.isAntibiotic,
      isControlled: brand.category === "controlled",
      paymentCleared: false,
      dispensedQty: 0,
      status: "open",
    })
  })
  return { rx, lines, queue }
}

/** Rx lines as billing lines (quantity prescribed, unit price never above MRP). */
export function rxBillingLines(
  ledger: StockLedger,
  lines: RxLineRow[]
): LineInput[] {
  return lines.map((l) => {
    const brand = ledger.brand(l.brandId!)
    return {
      sourceType: "rx-line",
      sourceId: l.id,
      serviceType: "medicine",
      description: `${brand.name} ${brand.strength}`,
      qty: l.qtyPrescribed,
      unitPriceP: brand.unitPriceP,
      mrpP: brand.mrpP,
    }
  })
}

/** Dispense every paid line in full (FEFO), close the queue entry. */
export function dispenseRx(
  ctx: SeedCtx,
  ledger: StockLedger,
  rxOut: RxOut,
  at: Ms,
  pharmacist: { id: Id; councilNo: string }
): void {
  const { bag } = ctx
  for (const line of rxOut.lines) {
    const brand = ledger.brand(line.brandId!)
    const splits = ledger.dispense(
      line.branchId,
      brand.id,
      line.qtyPrescribed,
      at,
      { rxId: rxOut.rx.id, rxLineId: line.id }
    )
    for (const s of splits) {
      bag.put("dispenses", ctx.seq("dsp"), at, {
        rxId: rxOut.rx.id,
        rxLineId: line.id,
        patientId: line.patientId,
        branchId: line.branchId,
        saleType: "rx",
        brandId: brand.id,
        batchId: s.batchId,
        qty: s.qty,
        unitPriceP: brand.unitPriceP,
        pharmacistId: pharmacist.id,
        pharmacyCouncilNo: pharmacist.councilNo,
        labelPrinted: true,
        counselled: true,
        outstandingQty: 0,
        at,
      })
    }
    line.dispensedQty = line.qtyPrescribed
    line.status = "dispensed"
    line.updatedAt = at
  }
  rxOut.queue.status = "done"
  rxOut.queue.updatedAt = at
}

/** Mark Rx lines paid (the checkout unlock, plan §6). */
export function clearRxLines(lines: RxLineRow[], at: Ms): void {
  for (const l of lines) {
    l.paymentCleared = true
    l.updatedAt = at
  }
}

/* ---------------- Lab ---------------- */

export type LabStage =
  | "ordered"
  | "paid"
  | "collected"
  | "received"
  | "resulted"
  | "validated"
  | "released"

const STAGE_RANK: Record<LabStage, number> = {
  ordered: 0,
  paid: 1,
  collected: 2,
  received: 3,
  resulted: 4,
  validated: 5,
  released: 6,
}

const CONTAINER_ML: Partial<Record<Container, number>> = {
  EDTA: 3,
  plain: 5,
  fluoride: 2,
  citrate: 2.7,
  "urine-cup": 30,
  "stool-cup": 10,
}

export type LabOrderInput = {
  patient: PatientRow
  ageYears: number
  branch: BranchCode
  at: Ms
  testIds: Id[]
  stage: LabStage
  source: LabOrderRow["source"]
  doctorId?: Id
  encounterId?: Id
  priority?: LabOrderRow["priority"]
  /** Required unless the stage is "ordered" */
  billing?: {
    cashierId: Id
    shiftId?: Id
    tenders?: TenderSplit[]
    payerType?: "self" | "corporate"
    corporateClientId?: Id
    discountPct?: number
  }
  /** Analyte code to value; everything else gets a normal value */
  values?: Record<string, number | string>
  labtechId: Id
  pathologistId?: Id
  /** Minutes from order to each step (defaults are a typical day) */
  pace?: number
  /** Tests paid and then cancelled before collection (no specimen or result) */
  cancelTestIds?: Id[]
  cancelReason?: string
}

export type LabOut = {
  order: LabOrderRow
  items: LabOrderItemRow[]
  specimens: SpecimenRow[]
  results: ResultRow[]
  report?: LabReportRow
  invoice?: InvoiceOut
}

export function createLabOrder(ctx: SeedCtx, input: LabOrderInput): LabOut {
  const { bag } = ctx
  const pace = input.pace ?? 1
  const t = {
    paid: input.at + 6 * MINUTE * pace,
    collected: input.at + 18 * MINUTE * pace,
    received: input.at + 35 * MINUTE * pace,
    resulted: input.at + 95 * MINUTE * pace,
    validated: input.at + 110 * MINUTE * pace,
    released: input.at + 150 * MINUTE * pace,
  }
  const rank = STAGE_RANK[input.stage]
  const tests: LabTestRow[] = input.testIds.map((id) => bag.get("labTests", id))
  const cancelled = new Set(input.cancelTestIds ?? [])

  const order = bag.put("labOrders", ctx.seq("lo"), input.at, {
    orderNo: "",
    encounterId: input.encounterId,
    patientId: input.patient.id,
    doctorId: input.doctorId,
    branchId: input.branch,
    priority: input.priority ?? "routine",
    status: rank === 0 ? "ordered" : rank === 6 ? "completed" : "in-progress",
    source: input.source,
  })
  ctx.numbers.request(counterKey.labOrder(input.branch), input.at, (n) => {
    order.orderNo = docNo.labOrder(input.branch, n)
  })

  const itemStatus: LabItemStatus = (
    [
      "ordered",
      "paid",
      "collected",
      "received",
      "resulted",
      "validated",
      "released",
    ] as const
  )[rank]
  const items = tests.map((test) =>
    bag.put("labOrderItems", ctx.seq("li"), input.at, {
      labOrderId: order.id,
      patientId: input.patient.id,
      branchId: input.branch,
      testId: test.id,
      status: itemStatus,
      paymentCleared: rank >= 1,
    })
  )
  const lines: LineInput[] = tests.map((test, i) => ({
    sourceType: "test",
    sourceId: items[i].id,
    serviceType: "lab",
    description: test.name,
    descriptionBn: test.glossBn,
    qty: 1,
    unitPriceP: test.priceP,
  }))

  const live = items.filter((item) => !cancelled.has(item.testId))
  const testOf = (item: LabOrderItemRow) => tests[items.indexOf(item)]

  let invoice: InvoiceOut | undefined
  if (rank === 0) {
    items.forEach((item, i) => {
      item.basketLineId = openBasketLine(
        ctx,
        input.patient.id,
        input.branch,
        input.at,
        lines[i]
      ).id
    })
  } else {
    if (!input.billing) throw new Error("seed: paid lab order needs billing")
    invoice = createPaidInvoice(ctx, {
      patientId: input.patient.id,
      branch: input.branch,
      at: t.paid,
      cashierId: input.billing.cashierId,
      shiftId: input.billing.shiftId,
      lines,
      tenders: input.billing.tenders,
      payerType: input.billing.payerType,
      corporateClientId: input.billing.corporateClientId,
      discountPct: input.billing.discountPct,
    })
    items.forEach((item, i) => {
      item.basketLineId = invoice!.basketLines[i].id
      item.invoiceLineId = invoice!.lines[i].id
      item.updatedAt = t.paid
    })
  }

  /* Specimens: one per container type */
  const specimens: SpecimenRow[] = []
  if (rank >= 1) {
    const byContainer = new Map<Container, LabOrderItemRow[]>()
    for (const item of live) {
      const c = testOf(item).container
      byContainer.set(c, [...(byContainer.get(c) ?? []), item])
    }
    for (const [container, group] of byContainer) {
      const volume = CONTAINER_ML[container] ?? 1
      const used = group.reduce(
        (s, it) => s + (testOf(it).volumeMl > 0 ? 0.5 : 0),
        0
      )
      const specimen = bag.put("specimens", ctx.seq("spc"), t.paid, {
        accessionNo: "",
        barcode: "",
        patientId: input.patient.id,
        branchId: input.branch,
        labOrderId: order.id,
        itemIds: group.map((g) => g.id),
        container,
        status:
          rank >= 3
            ? "received"
            : rank >= 2
              ? "collected"
              : "awaiting-collection",
        collectedAt: rank >= 2 ? t.collected : undefined,
        collectedBy: rank >= 2 ? input.labtechId : undefined,
        receivedAt: rank >= 3 ? t.received : undefined,
        receivedBy: rank >= 3 ? input.labtechId : undefined,
        volumeRemainingMl:
          rank >= 4 ? Math.max(0.5, volume - used) : rank >= 2 ? volume : 0,
        labelPrintedAt: rank >= 2 ? t.collected - MINUTE : undefined,
      })
      specimen.updatedAt =
        rank >= 3 ? t.received : rank >= 2 ? t.collected : t.paid
      ctx.numbers.request(counterKey.accession(input.branch), t.paid, (n) => {
        specimen.accessionNo = docNo.accession(input.branch, n)
        specimen.barcode = specimen.accessionNo
      })
      for (const g of group) g.specimenId = specimen.id
      specimens.push(specimen)
    }
  }

  /* Results */
  const results: ResultRow[] = []
  if (rank >= 4) {
    live.forEach((item) => {
      const test = testOf(item)
      for (const a of test.analytes) {
        const override = input.values?.[a.code]
        const value =
          override ??
          defaultAnalyserValue(
            a,
            input.patient.sex,
            input.ageYears,
            `${item.id}`
          )
        const numeric = typeof value === "number"
        const flag = numeric
          ? flagFor(a, value, input.patient.sex, input.ageYears)
          : "N"
        const validated = rank >= 5
        const r = bag.put("results", ctx.seq("res"), t.resulted, {
          labOrderItemId: item.id,
          patientId: input.patient.id,
          testId: test.id,
          analyteCode: a.code,
          value: numeric ? value : null,
          text: numeric ? undefined : String(value),
          unit: a.units,
          flag,
          critical: flag === "LL" || flag === "HH",
          source: "analyser",
          status: validated ? "validated" : "pending",
          validatedBy: validated ? input.labtechId : undefined,
          validatedAt: validated ? t.validated : undefined,
        })
        if (validated) r.updatedAt = t.validated
        results.push(r)
      }
      item.updatedAt = rank >= 5 ? t.validated : t.resulted
    })
  }

  /* Report, released to the doctor inbox and the patient app */
  let report: LabReportRow | undefined
  if (rank >= 6) {
    const signer = input.pathologistId ?? ACTOR.mizanur
    const rpt = bag.put(
      "labReports",
      ctx.seq("rpt"),
      t.released - 10 * MINUTE,
      {
        reportNo: "",
        reportVersion: 1,
        patientId: input.patient.id,
        branchId: input.branch,
        labOrderId: order.id,
        itemIds: live.map((i) => i.id),
        status: "released",
        signedBy: signer,
        signedAt: t.released - 5 * MINUTE,
        releasedAt: t.released,
      }
    )
    rpt.updatedAt = t.released
    ctx.numbers.request(counterKey.report(input.branch), t.released, (n) => {
      rpt.reportNo = docNo.report(input.branch, n)
    })
    // Hash the content as signed, even if a later correction edits a result.
    const signed = results.map((r) => ({ ...r }))
    ctx.numbers.afterAssigned(() => {
      rpt.hash = reportHash(rpt, signed)
    })
    for (const item of live) {
      item.reportId = rpt.id
      item.updatedAt = t.released
    }
    report = rpt
  }

  for (const item of items) {
    if (!cancelled.has(item.testId)) continue
    item.status = "cancelled"
    item.cancelReason = input.cancelReason ?? "Cancelled before collection"
    item.updatedAt = t.paid + 20 * MINUTE
  }
  order.updatedAt = rank >= 6 ? t.released : rank >= 1 ? t.paid : input.at
  return { order, items, specimens, results, report, invoice }
}

/** SHA-256 over the signed content of a report version (QR verification). */
export function reportHash(report: LabReportRow, results: ResultRow[]): string {
  const content = {
    reportNo: report.reportNo,
    version: report.reportVersion,
    patientId: report.patientId,
    signedBy: report.signedBy,
    signedAt: report.signedAt,
    results: results
      .filter((r) => report.itemIds.includes(r.labOrderItemId))
      .map((r) => [
        r.analyteCode,
        r.value ?? r.text ?? null,
        r.unit ?? "",
        r.flag,
      ]),
  }
  return sha256Hex(JSON.stringify(content))
}

/* ---------------- Imaging ---------------- */

export function createImagingOrder(
  ctx: SeedCtx,
  input: {
    patient: PatientRow
    branch: BranchCode
    at: Ms
    testId: Id
    stage: "ordered" | "paid" | "released"
    doctorId?: Id
    encounterId?: Id
    indication: string
    bodyPart: string
    billing?: { cashierId: Id; shiftId?: Id; tenders?: TenderSplit[] }
    radiologistId: Id
    summary?: string
  }
): { order: ImagingOrderRow; report?: ImagingReportRow; invoice?: InvoiceOut } {
  const { bag } = ctx
  const test = bag.get("labTests", input.testId)
  const order = bag.put("imagingOrders", ctx.seq("io"), input.at, {
    orderNo: "",
    encounterId: input.encounterId,
    patientId: input.patient.id,
    doctorId: input.doctorId,
    branchId: input.branch,
    testId: test.id,
    modality: test.modality ?? "xray",
    bodyPart: input.bodyPart,
    indication: input.indication,
    contrast: false,
    status: input.stage,
    paymentCleared: input.stage !== "ordered",
  })
  ctx.numbers.request(counterKey.imagingOrder(input.branch), input.at, (n) => {
    order.orderNo = docNo.imagingOrder(input.branch, n)
  })
  const line: LineInput = {
    sourceType: "imaging",
    sourceId: order.id,
    serviceType: "imaging",
    description: test.name,
    descriptionBn: test.glossBn,
    qty: 1,
    unitPriceP: test.priceP,
  }
  let invoice: InvoiceOut | undefined
  if (input.stage === "ordered") {
    order.basketLineId = openBasketLine(
      ctx,
      input.patient.id,
      input.branch,
      input.at,
      line
    ).id
  } else {
    if (!input.billing)
      throw new Error("seed: paid imaging order needs billing")
    invoice = createPaidInvoice(ctx, {
      patientId: input.patient.id,
      branch: input.branch,
      at: input.at + 5 * MINUTE,
      cashierId: input.billing.cashierId,
      shiftId: input.billing.shiftId,
      lines: [line],
      tenders: input.billing.tenders,
    })
    order.basketLineId = invoice.basketLines[0].id
  }
  let report: ImagingReportRow | undefined
  if (input.stage === "released") {
    const releasedAt = input.at + 3 * 60 * MINUTE
    const pdfName = `${test.code}-${order.id}.pdf`
    report = bag.put(
      "imagingReports",
      ctx.seq("irp"),
      releasedAt - 20 * MINUTE,
      {
        imagingOrderId: order.id,
        patientId: input.patient.id,
        reportVersion: 1,
        status: "released",
        pdfName,
        pdfHash: sha256Hex(`${pdfName}:${input.summary ?? ""}`),
        radiologistId: input.radiologistId,
        summary: input.summary,
        releasedAt,
      }
    )
    order.reportId = report.id
    order.updatedAt = releasedAt
  }
  return { order, report, invoice }
}

/* ---------------- Doctor inbox and patient-app notifications ---------------- */

export function inboxItem(
  ctx: SeedCtx,
  input: {
    doctorId: Id
    patientId: Id
    kind: InboxItemRow["kind"]
    refs: InboxItemRow["refs"]
    at: Ms
    status: InboxItemRow["status"]
    ackAt?: Ms
    params?: Record<string, string | number>
  }
): InboxItemRow {
  return ctx.bag.put("inboxItems", ctx.seq("inb"), input.at, {
    doctorId: input.doctorId,
    patientId: input.patientId,
    kind: input.kind,
    refs: input.refs,
    titleKey: `consultation.inbox.kind.${input.kind}`,
    params: input.params,
    status: input.status,
    ackAt: input.ackAt,
  })
}

/** Patient-app notification: generic text only, never health data. */
export function notify(
  ctx: SeedCtx,
  patientId: Id,
  kind: string,
  refs: InboxItemRow["refs"],
  at: Ms,
  read: boolean
): void {
  ctx.bag.put("notifications", ctx.seq("ntf"), at, {
    patientId,
    kind,
    titleKey: `patientApp.notifications.${kind}`,
    refs,
    read,
    at,
  })
}
