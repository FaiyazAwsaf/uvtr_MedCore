import { z } from "zod"

import { ageOn } from "@/core/clock/dates"
import { notifyPatient, queueSms } from "@/core/comms/sms"
import type {
  Id,
  LabOrderItemRow,
  LabOrderRow,
  LabReportRow,
  LabTestRow,
  PatientRow,
  ResultRow,
} from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import { nextLabOrderNo, nextReportNo } from "@/core/engine/docNumbers"
import type { Tx } from "@/core/engine/types"
import { createSpecimensForItems } from "@/core/lab/specimens"
import {
  defaultAnalyserValue,
  findAnalyserScript,
} from "@/core/seed/content/analyser-scripts"

import {
  deltaCheck,
  flagValue,
  inboxKindFor,
  isCriticalFlag,
  previousFor,
  reportHash,
  resultText,
  secondIdentifierMatch,
} from "./logic"

/**
 * Laboratory and pathology commands (plan §6, WS-D). Each is one atomic
 * commit: specimen and item states move together with their events, doctor
 * inbox items, patient-app notifications and SMS. The engine's invariants
 * back the payment gate (INV-10), signed-report immutability (INV-04) and
 * the no-cancellation-after-validation rule (INV-15).
 */

const smsLang = z.enum(["en", "bn"]).default("bn")

/** Analyte used for free-text (template) tests that have no analytes. */
export const TEXT_ANALYTE = "TEXT"

export const REJECT_REASONS = [
  "haemolysed",
  "clotted",
  "insufficient",
  "mislabelled",
  "wrong-container",
  "other",
] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

/** Items that still count: not cancelled and not rejected. */
function isLive(item: LabOrderItemRow): boolean {
  return item.status !== "cancelled" && item.status !== "rejected"
}

async function itemsOf(tx: Tx, ids: Id[]): Promise<LabOrderItemRow[]> {
  const out: LabOrderItemRow[] = []
  for (const id of ids) out.push(await tx.get("labOrderItems", id))
  return out
}

async function testsOf(tx: Tx, items: LabOrderItemRow[]): Promise<Map<Id, LabTestRow>> {
  const map = new Map<Id, LabTestRow>()
  for (const item of items) {
    if (!map.has(item.testId)) map.set(item.testId, await tx.get("labTests", item.testId))
  }
  return map
}

function codesOf(items: LabOrderItemRow[], tests: Map<Id, LabTestRow>): string {
  return [...new Set(items.map((i) => tests.get(i.testId)?.code ?? i.testId))].join(", ")
}

function ageOf(tx: Tx, patient: PatientRow): number {
  return Math.max(0, ageOn(patient.dob, tx.today()))
}

/** Set the order's status from its items (ordered, in progress, completed). */
async function refreshOrderStatus(tx: Tx, orderId: Id): Promise<void> {
  const order = await tx.get("labOrders", orderId)
  const live = (await tx.list("labOrderItems", "labOrderId", orderId)).filter(isLive)
  if (!live.length) return
  let status: LabOrderRow["status"] = "in-progress"
  if (live.every((i) => i.status === "released")) status = "completed"
  else if (live.every((i) => i.status === "ordered")) status = "ordered"
  if (status !== order.status) await tx.update("labOrders", orderId, { status })
}

function smsAllowed(patient: PatientRow): boolean {
  return patient.consents.find((c) => c.purpose === "sms")?.granted !== false
}

/* ================================================================== *
 * Collection, label and intake
 * ================================================================== */

/**
 * Collect a paid specimen (plan §6 `lab.collect`). The second identifier
 * (date of birth or the last four phone digits, HAZ-01) is checked first; a
 * mismatch is refused and written to the audit log. Items move to collected,
 * which the engine's payment gate (INV-10) refuses for unpaid items.
 */
export const collectSpecimen = defineCommand({
  name: "lab.collect",
  roles: ["labtech"],
  input: z.object({
    specimenId: z.string(),
    secondIdentifier: z.string().trim().min(1).max(40),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    const specimen = await tx.get("specimens", input.specimenId, {
      expectedVersion: input.expectedVersion,
    })
    if (specimen.status !== "awaiting-collection") {
      tx.reject("LAB_SPECIMEN_STATE", {
        accessionNo: specimen.accessionNo,
        status: specimen.status,
      })
    }
    const patient = await tx.get("patients", specimen.patientId)
    const matchedBy = secondIdentifierMatch(patient, input.secondIdentifier)
    if (!matchedBy) {
      tx.reject(
        "LAB_SECOND_ID_MISMATCH",
        { accessionNo: specimen.accessionNo },
        { audit: true }
      )
    }

    const items = (await itemsOf(tx, specimen.itemIds)).filter(isLive)
    if (!items.length) tx.reject("LAB_NOTHING_TO_COLLECT", { accessionNo: specimen.accessionNo })
    const tests = await testsOf(tx, items)
    for (const item of items) {
      if (item.status !== "paid" && item.status !== "ordered") {
        tx.reject("LAB_ITEM_STATE", {
          test: tests.get(item.testId)?.code ?? item.testId,
          status: item.status,
        })
      }
      // INV-10 refuses this for an unpaid item (the payment gate).
      await tx.update("labOrderItems", item.id, { status: "collected" })
    }
    await tx.update("specimens", specimen.id, {
      status: "collected",
      collectedAt: tx.now(),
      collectedBy: tx.actor.staffId,
    })
    await refreshOrderStatus(tx, specimen.labOrderId)

    tx.emit("SpecimenCollected", {
      branchId: specimen.branchId,
      refs: {
        patientId: patient.id,
        specimenId: specimen.id,
        labOrderId: specimen.labOrderId,
      },
      params: { accessionNo: specimen.accessionNo, tests: codesOf(items, tests) },
    })
    return { specimenId: specimen.id, accessionNo: specimen.accessionNo, matchedBy }
  },
})

/** Send the tube label to the (simulated) label printer. */
export const printSpecimenLabel = defineCommand({
  name: "lab.printLabel",
  roles: ["labtech"],
  input: z.object({ specimenId: z.string() }),
  async run(tx, input) {
    const specimen = await tx.get("specimens", input.specimenId)
    if (specimen.status === "rejected" || specimen.status === "consumed") {
      tx.reject("LAB_SPECIMEN_STATE", {
        accessionNo: specimen.accessionNo,
        status: specimen.status,
      })
    }
    await tx.update("specimens", specimen.id, { labelPrintedAt: tx.now() })
    return { accessionNo: specimen.accessionNo, printedAt: tx.now() }
  },
})

/** Receive a collected specimen at the lab bench (plan §6 `lab.receive`). */
export const receiveSpecimen = defineCommand({
  name: "lab.receive",
  roles: ["labtech"],
  input: z.object({
    specimenId: z.string(),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    const specimen = await tx.get("specimens", input.specimenId, {
      expectedVersion: input.expectedVersion,
    })
    if (specimen.status !== "collected") {
      tx.reject("LAB_SPECIMEN_STATE", {
        accessionNo: specimen.accessionNo,
        status: specimen.status,
      })
    }
    const items = (await itemsOf(tx, specimen.itemIds)).filter(isLive)
    const tests = await testsOf(tx, items)
    for (const item of items) {
      if (item.status === "collected") {
        await tx.update("labOrderItems", item.id, { status: "received" })
      }
    }
    await tx.update("specimens", specimen.id, {
      status: "received",
      receivedAt: tx.now(),
      receivedBy: tx.actor.staffId,
    })
    tx.emit("SpecimenReceived", {
      branchId: specimen.branchId,
      refs: {
        patientId: specimen.patientId,
        specimenId: specimen.id,
        labOrderId: specimen.labOrderId,
      },
      params: { accessionNo: specimen.accessionNo, tests: codesOf(items, tests) },
    })
    return { specimenId: specimen.id }
  },
})

/**
 * Reject a collected or received specimen with a reason (plan §9, scenario
 * S5): the specimen and its items are rejected, and a free recollection
 * order (zero price, already cleared) with a new specimen awaiting collection
 * is created, plus an SMS and a patient-app notice with no clinical content.
 */
export const rejectSpecimen = defineCommand({
  name: "lab.reject",
  roles: ["labtech"],
  input: z.object({
    specimenId: z.string(),
    reason: z.enum(REJECT_REASONS),
    note: z.string().trim().max(300).optional(),
    expectedVersion: z.number().int().optional(),
    smsLang,
  }),
  async run(tx, input) {
    const specimen = await tx.get("specimens", input.specimenId, {
      expectedVersion: input.expectedVersion,
    })
    if (specimen.status !== "collected" && specimen.status !== "received") {
      tx.reject("LAB_SPECIMEN_STATE", {
        accessionNo: specimen.accessionNo,
        status: specimen.status,
      })
    }
    const items = (await itemsOf(tx, specimen.itemIds)).filter(isLive)
    const tests = await testsOf(tx, items)
    const used = items.find((i) => i.status !== "collected" && i.status !== "received")
    if (used) {
      tx.reject("LAB_SPECIMEN_IN_USE", {
        accessionNo: specimen.accessionNo,
        test: tests.get(used.testId)?.code ?? used.testId,
      })
    }
    if (!items.length) tx.reject("LAB_NOTHING_TO_COLLECT", { accessionNo: specimen.accessionNo })

    await tx.update("specimens", specimen.id, {
      status: "rejected",
      rejectReason: input.reason,
    })
    for (const item of items) {
      await tx.update("labOrderItems", item.id, { status: "rejected" })
    }
    if (input.note) tx.auditContext({ reason: input.note })

    const original = await tx.get("labOrders", specimen.labOrderId)
    const orderNo = await nextLabOrderNo(tx, specimen.branchId)
    const order = tx.insert("labOrders", {
      orderNo,
      encounterId: original.encounterId,
      patientId: specimen.patientId,
      doctorId: original.doctorId,
      branchId: specimen.branchId,
      priority: original.priority,
      status: "in-progress",
      source: original.source,
    })
    const fresh = items.map((item) =>
      tx.insert("labOrderItems", {
        labOrderId: order.id,
        patientId: item.patientId,
        branchId: item.branchId,
        testId: item.testId,
        status: "paid",
        // A free recollection: nothing to pay, so the payment gate is clear.
        paymentCleared: true,
        isFreeRecollection: true,
        recollectionOfItemId: item.id,
      })
    )
    const specimens = await createSpecimensForItems(tx, fresh)

    const patient = await tx.get("patients", specimen.patientId)
    const phone = patient.phone ?? patient.attendantPhone
    if (phone && smsAllowed(patient)) {
      queueSms(tx, {
        to: phone,
        patientId: patient.id,
        lang: input.smsLang,
        templateId: "sample-recollection",
      })
    }
    notifyPatient(tx, {
      patientId: patient.id,
      kind: "sampleRecollection",
      titleKey: "patientApp.notifications.sampleRecollection",
      refs: { labOrderId: order.id, specimenId: specimens[0]?.id },
    })

    const refs = {
      patientId: patient.id,
      specimenId: specimen.id,
      labOrderId: specimen.labOrderId,
    }
    tx.emit("SpecimenRejected", {
      branchId: specimen.branchId,
      refs,
      params: {
        accessionNo: specimen.accessionNo,
        reason: input.reason,
        tests: codesOf(items, tests),
      },
    })
    tx.emit("RecollectionOrdered", {
      branchId: specimen.branchId,
      refs: { patientId: patient.id, labOrderId: order.id, specimenId: specimens[0]?.id },
      params: {
        orderNo,
        accessionNo: specimens.map((s) => s.accessionNo).join(", "),
      },
    })
    return {
      recollectionOrderId: order.id,
      recollectionOrderNo: orderNo,
      specimenIds: specimens.map((s) => s.id),
      accessionNos: specimens.map((s) => s.accessionNo),
    }
  },
})

/* ================================================================== *
 * Results: analyser import and manual entry
 * ================================================================== */

type NewResult = {
  analyteCode: string
  value: number | string
}

/**
 * Insert one pending result row per analyte for an item, with flag, critical
 * flag and delta check. Returns the rows (and moves the item to resulted).
 */
async function writeResults(
  tx: Tx,
  item: LabOrderItemRow,
  test: LabTestRow,
  patient: PatientRow,
  values: NewResult[],
  source: ResultRow["source"],
  history: ResultRow[]
): Promise<ResultRow[]> {
  const age = ageOf(tx, patient)
  const rows: ResultRow[] = []
  for (const entry of values) {
    const analyte = test.analytes.find((a) => a.code === entry.analyteCode)
    const numeric = typeof entry.value === "number"
    const flag = analyte ? flagValue(analyte, entry.value, patient.sex, age) : "N"
    let deltaFlag: boolean | undefined
    if (numeric) {
      const previous = previousFor(history, entry.analyteCode, item.id, tx.now() + 1)
      if (typeof previous?.value === "number") {
        deltaFlag = deltaCheck(entry.analyteCode, entry.value as number, previous.value).flagged
      }
    }
    rows.push(
      tx.insert("results", {
        labOrderItemId: item.id,
        patientId: patient.id,
        testId: test.id,
        analyteCode: entry.analyteCode,
        value: numeric ? (entry.value as number) : null,
        text: numeric ? undefined : String(entry.value),
        unit: analyte?.units,
        flag,
        critical: isCriticalFlag(flag),
        source,
        status: "pending",
        deltaFlag,
      })
    )
  }
  await tx.update("labOrderItems", item.id, { status: "resulted" })
  return rows
}

function emitCriticals(
  tx: Tx,
  rows: ResultRow[],
  tests: Map<Id, LabTestRow>,
  branchId: LabOrderItemRow["branchId"],
  refs: { patientId: Id; specimenId?: Id; labOrderId: Id }
): void {
  for (const row of rows) {
    if (!row.critical) continue
    const analyte = tests.get(row.testId)?.analytes.find((a) => a.code === row.analyteCode)
    tx.emit("CriticalFlagged", {
      branchId,
      refs: { ...refs, resultId: row.id, labItemId: row.labOrderItemId },
      params: {
        analyte: analyte?.name ?? row.analyteCode,
        value: `${resultText(row, analyte?.decimals ?? 2)} ${row.unit ?? ""}`.trim(),
      },
    })
  }
}

/**
 * "Receive results from analyser" (plan §6 `lab.importAnalyser`, simulated):
 * scripted values for known patients and tests (the hero's CBC and CRP, the
 * S7 potassium), plausible in-range values otherwise. One result per analyte
 * with unit, flag and critical flag. Template tests (culture, histology) have
 * no analytes and need manual entry.
 */
export const importAnalyserResults = defineCommand({
  name: "lab.importAnalyser",
  roles: ["labtech"],
  input: z.object({
    specimenId: z.string(),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    const specimen = await tx.get("specimens", input.specimenId, {
      expectedVersion: input.expectedVersion,
    })
    if (specimen.status !== "received") {
      tx.reject("LAB_SPECIMEN_STATE", {
        accessionNo: specimen.accessionNo,
        status: specimen.status,
      })
    }
    const patient = await tx.get("patients", specimen.patientId)
    const age = ageOf(tx, patient)
    const all = (await itemsOf(tx, specimen.itemIds)).filter((i) => i.status === "received")
    const tests = await testsOf(tx, all)
    const runnable = all.filter((i) => (tests.get(i.testId)?.analytes.length ?? 0) > 0)
    if (!runnable.length) tx.reject("LAB_NOTHING_TO_RUN", { accessionNo: specimen.accessionNo })

    const history = await tx.list("results", "patientId", patient.id)
    const rows: ResultRow[] = []
    for (const item of runnable) {
      const test = tests.get(item.testId)!
      const script = findAnalyserScript(patient.id, test.id)
      const values = test.analytes.map((analyte) => ({
        analyteCode: analyte.code,
        value:
          script?.values[analyte.code] ??
          defaultAnalyserValue(analyte, patient.sex, age, item.id),
      }))
      rows.push(...(await writeResults(tx, item, test, patient, values, "analyser", history)))
    }
    await tx.update("specimens", specimen.id, {
      volumeRemainingMl: Math.max(
        0,
        Math.round((specimen.volumeRemainingMl - 0.5 * runnable.length) * 10) / 10
      ),
    })

    const refs = {
      patientId: patient.id,
      specimenId: specimen.id,
      labOrderId: specimen.labOrderId,
    }
    tx.emit("ResultsReceived", {
      branchId: specimen.branchId,
      refs,
      params: {
        accessionNo: specimen.accessionNo,
        tests: codesOf(runnable, tests),
        count: rows.length,
      },
    })
    emitCriticals(tx, rows, tests, specimen.branchId, refs)
    return {
      resultIds: rows.map((r) => r.id),
      itemIds: runnable.map((i) => i.id),
      abnormal: rows.filter((r) => r.flag !== "N").length,
      critical: rows.filter((r) => r.critical).length,
    }
  },
})

/**
 * Enter results by hand for one received item (analyser down, manual tests,
 * template reports). Marked "manual": validation then needs a second person.
 */
export const enterManualResults = defineCommand({
  name: "lab.enterManualResults",
  roles: ["labtech"],
  input: z.object({
    itemId: z.string(),
    expectedVersion: z.number().int().optional(),
    values: z
      .array(
        z.object({
          analyteCode: z.string().min(1),
          value: z.number().finite().optional(),
          text: z.string().trim().max(2000).optional(),
        })
      )
      .min(1),
  }),
  async run(tx, input) {
    const item = await tx.get("labOrderItems", input.itemId, {
      expectedVersion: input.expectedVersion,
    })
    const test = await tx.get("labTests", item.testId)
    if (item.status !== "received") {
      tx.reject("LAB_ITEM_STATE", { test: test.code, status: item.status })
    }
    const patient = await tx.get("patients", item.patientId)
    const byCode = new Map(input.values.map((v) => [v.analyteCode, v]))
    const values: NewResult[] = []
    if (test.analytes.length === 0) {
      const text = byCode.get(TEXT_ANALYTE)?.text
      if (!text) tx.reject("LAB_RESULT_MISSING", { test: test.code, analyte: TEXT_ANALYTE })
      values.push({ analyteCode: TEXT_ANALYTE, value: text as string })
    } else {
      for (const analyte of test.analytes) {
        const entry = byCode.get(analyte.code)
        const value = analyte.qualitative ? entry?.text : entry?.value
        if (value === undefined || value === "") {
          tx.reject("LAB_RESULT_MISSING", { test: test.code, analyte: analyte.name })
        }
        values.push({ analyteCode: analyte.code, value: value as number | string })
      }
    }
    const history = await tx.list("results", "patientId", patient.id)
    const rows = await writeResults(tx, item, test, patient, values, "manual", history)
    const tests = new Map([[test.id, test]])
    const refs = {
      patientId: patient.id,
      specimenId: item.specimenId,
      labOrderId: item.labOrderId,
    }
    tx.emit("ResultsEnteredManually", {
      branchId: item.branchId,
      refs: { ...refs, labItemId: item.id },
      params: { test: test.code, count: rows.length },
    })
    emitCriticals(tx, rows, tests, item.branchId, refs)
    return { resultIds: rows.map((r) => r.id) }
  },
})

/* ================================================================== *
 * Technical validation
 * ================================================================== */

/**
 * Technical validation of one item's results (plan §6 `lab.validate`).
 * Manual results need a second person's check: another lab or pathology
 * staff member, not the validator and not whoever typed the values.
 */
export const validateItem = defineCommand({
  name: "lab.validate",
  roles: ["labtech"],
  input: z.object({
    itemId: z.string(),
    expectedVersion: z.number().int().optional(),
    secondCheckBy: z.string().optional(),
  }),
  async run(tx, input) {
    const item = await tx.get("labOrderItems", input.itemId, {
      expectedVersion: input.expectedVersion,
    })
    const test = await tx.get("labTests", item.testId)
    if (item.status !== "resulted") {
      tx.reject("LAB_ITEM_STATE", { test: test.code, status: item.status })
    }
    const results = (await tx.list("results", "labOrderItemId", item.id)).filter(
      (r) => r.status === "pending"
    )
    if (!results.length) tx.reject("LAB_NO_RESULTS", { test: test.code })

    const manual = results.filter((r) => r.source === "manual")
    let secondCheckBy: Id | undefined
    if (manual.length) {
      secondCheckBy = input.secondCheckBy
      if (!secondCheckBy) tx.reject("LAB_SECOND_CHECK_REQUIRED", { test: test.code })
      if (
        secondCheckBy === tx.actor.staffId ||
        manual.some((r) => r.createdBy === secondCheckBy)
      ) {
        tx.reject("LAB_SECOND_CHECK_SAME_PERSON", { test: test.code })
      }
      const checker = await tx.find("staff", secondCheckBy!)
      if (!checker || (checker.role !== "labtech" && checker.role !== "pathologist")) {
        tx.reject("LAB_SECOND_CHECKER_INVALID", { test: test.code })
      }
    }

    for (const result of results) {
      await tx.update("results", result.id, {
        status: "validated",
        validatedBy: tx.actor.staffId,
        validatedAt: tx.now(),
        secondCheckBy: result.source === "manual" ? secondCheckBy : undefined,
      })
    }
    await tx.update("labOrderItems", item.id, { status: "validated" })
    tx.emit("TechnicallyValidated", {
      branchId: item.branchId,
      refs: { patientId: item.patientId, labOrderId: item.labOrderId, labItemId: item.id },
      params: {
        test: test.code,
        abnormal: results.filter((r) => r.flag !== "N").length,
        critical: results.filter((r) => r.critical).length,
      },
    })
    return { itemId: item.id, validated: results.length }
  },
})

/* ================================================================== *
 * Sign-off, release, correction
 * ================================================================== */

type ReleaseKind = "ready" | "corrected"

/**
 * Release a signed report when every item is paid (INV-10); otherwise mark it
 * held for payment. On release: items released, a doctor inbox item (result,
 * abnormal, critical, or corrected), a patient-app notification and an SMS
 * to an OTP-verified phone only, never with clinical content.
 */
async function releaseOrHold(
  tx: Tx,
  report: LabReportRow,
  opts: { kind: ReleaseKind; smsLang: "en" | "bn" }
): Promise<{ released: boolean }> {
  const items = await itemsOf(tx, report.itemIds)
  const order = await tx.get("labOrders", report.labOrderId)
  const refs = { patientId: report.patientId, reportId: report.id, labOrderId: order.id }

  if (items.some((i) => !i.paymentCleared)) {
    if (!report.heldForPayment) {
      await tx.update("labReports", report.id, { heldForPayment: true })
      tx.emit("ReportHeldForPayment", {
        branchId: report.branchId,
        refs,
        params: { reportNo: report.reportNo, version: report.reportVersion },
      })
    }
    return { released: false }
  }

  await tx.update("labReports", report.id, {
    status: "released",
    releasedAt: tx.now(),
    heldForPayment: report.heldForPayment ? false : undefined,
  })
  for (const item of items) {
    if (item.status !== "released") {
      await tx.update("labOrderItems", item.id, { status: "released", reportId: report.id })
    }
  }
  await refreshOrderStatus(tx, order.id)

  const tests = await testsOf(tx, items)
  const results: ResultRow[] = []
  for (const item of items) results.push(...(await tx.list("results", "labOrderItemId", item.id)))
  const kind = opts.kind === "corrected" ? "corrected" : inboxKindFor(results)
  if (order.doctorId) {
    tx.insert("inboxItems", {
      doctorId: order.doctorId,
      patientId: report.patientId,
      kind,
      refs,
      titleKey: `consultation.inbox.kind.${kind}`,
      params: {
        reportNo: report.reportNo,
        version: report.reportVersion,
        tests: codesOf(items, tests),
      },
      status: "unread",
    })
  }
  notifyPatient(tx, {
    patientId: report.patientId,
    kind: opts.kind === "corrected" ? "reportUpdated" : "reportReady",
    titleKey:
      opts.kind === "corrected"
        ? "patientApp.notifications.reportUpdated"
        : "patientApp.notifications.reportReady",
    refs: { reportId: report.id, labOrderId: order.id },
  })
  const patient = await tx.get("patients", report.patientId)
  // "Report ready" goes only to an OTP-verified number (HAZ-09), with no content.
  if (patient.phone && patient.phoneVerified && smsAllowed(patient)) {
    queueSms(tx, {
      to: patient.phone,
      patientId: patient.id,
      lang: opts.smsLang,
      templateId: opts.kind === "corrected" ? "report-updated" : "report-ready",
    })
  }
  tx.emit("ReportReleased", {
    branchId: report.branchId,
    refs,
    params: { reportNo: report.reportNo, version: report.reportVersion, kind },
  })
  return { released: true }
}

/**
 * Sign validated results into a report (plan §6 `lab.signAndRelease`):
 * version 1 with the next report number, signed by the pathologist and hashed
 * (SHA-256 of the canonical content, shown by QR verification). With
 * `release` (the default) it is released in the same commit when every item
 * is paid, or kept signed and held for payment.
 */
export const signAndRelease = defineCommand({
  name: "lab.signAndRelease",
  roles: ["pathologist"],
  input: z.object({
    labOrderId: z.string(),
    /** Defaults to every validated item on the order */
    itemIds: z.array(z.string()).min(1).optional(),
    release: z.boolean().default(true),
    smsLang,
  }),
  async run(tx, input) {
    const order = await tx.get("labOrders", input.labOrderId)
    const onOrder = await tx.list("labOrderItems", "labOrderId", order.id)
    const wanted = input.itemIds ? new Set(input.itemIds) : undefined
    const items = onOrder.filter((i) => (wanted ? wanted.has(i.id) : i.status === "validated"))
    if (!items.length) tx.reject("LAB_NOTHING_TO_SIGN", { orderNo: order.orderNo })
    const tests = await testsOf(tx, items)
    for (const item of items) {
      if (item.status !== "validated") {
        tx.reject("LAB_ITEM_STATE", {
          test: tests.get(item.testId)?.code ?? item.testId,
          status: item.status,
        })
      }
    }

    const results: ResultRow[] = []
    for (const item of items) {
      results.push(
        ...(await tx.list("results", "labOrderItemId", item.id)).filter(
          (r) => r.status === "validated"
        )
      )
    }
    const reportNo = await nextReportNo(tx, order.branchId)
    const base = {
      reportNo,
      reportVersion: 1,
      patientId: order.patientId,
      branchId: order.branchId,
      labOrderId: order.id,
      itemIds: items.map((i) => i.id),
      signedBy: tx.actor.staffId,
      signedAt: tx.now(),
    }
    const report = tx.insert("labReports", {
      ...base,
      status: "signed",
      hash: reportHash(base, results),
    })
    for (const item of items) {
      await tx.update("labOrderItems", item.id, { status: "signed", reportId: report.id })
    }
    tx.emit("ReportSigned", {
      branchId: order.branchId,
      refs: { patientId: order.patientId, reportId: report.id, labOrderId: order.id },
      params: { reportNo, version: 1, tests: codesOf(items, tests) },
    })
    const { released } = input.release
      ? await releaseOrHold(tx, report, { kind: "ready", smsLang: input.smsLang })
      : { released: false }
    await refreshOrderStatus(tx, order.id)
    return {
      reportId: report.id,
      reportNo,
      released,
      held: input.release && !released,
    }
  },
})

/** Release a signed report, e.g. one held for payment once it is paid. */
export const releaseReport = defineCommand({
  name: "lab.releaseReport",
  roles: ["pathologist"],
  input: z.object({
    reportId: z.string(),
    expectedVersion: z.number().int().optional(),
    smsLang,
  }),
  async run(tx, input) {
    const report = await tx.get("labReports", input.reportId, {
      expectedVersion: input.expectedVersion,
    })
    if (report.status !== "signed") {
      tx.reject("LAB_REPORT_STATE", { reportNo: report.reportNo, status: report.status })
    }
    const items = await itemsOf(tx, report.itemIds)
    if (items.some((i) => !i.paymentCleared)) {
      // The same rule INV-10 enforces, refused before anything changes.
      tx.reject("PAYMENT_GATE", { step: "release", rule: "INV-10" })
    }
    // A correction of an already-released version tells everyone "updated".
    const previous = report.supersedesId
      ? await tx.find("labReports", report.supersedesId)
      : undefined
    const kind: ReleaseKind = previous?.releasedAt ? "corrected" : "ready"
    await releaseOrHold(tx, report, { kind, smsLang: input.smsLang })
    return { reportId: report.id, released: true }
  },
})

/**
 * Correct a signed or released report (plan §6 `lab.correctReport`, S8,
 * HAZ-03): the results are corrected, a new version is signed and hashed
 * with the reason and change summary, the old version becomes superseded
 * (kept, never edited), and, when the old version had been released, the
 * doctor gets a "corrected" inbox item, the patient app an "updated report"
 * notice and a verified phone an SMS.
 */
export const correctReport = defineCommand({
  name: "lab.correctReport",
  roles: ["pathologist"],
  input: z.object({
    reportId: z.string(),
    expectedVersion: z.number().int().optional(),
    reason: z.string().trim().min(3).max(300),
    changeSummary: z.string().trim().min(3).max(600),
    corrections: z
      .array(
        z.object({
          resultId: z.string(),
          value: z.number().finite().nullable().optional(),
          text: z.string().trim().max(500).optional(),
          unit: z.string().trim().max(20).optional(),
        })
      )
      .min(1),
    smsLang,
  }),
  async run(tx, input) {
    const current = await tx.get("labReports", input.reportId, {
      expectedVersion: input.expectedVersion,
    })
    if (current.status !== "signed" && current.status !== "released") {
      tx.reject("LAB_REPORT_STATE", { reportNo: current.reportNo, status: current.status })
    }
    const patient = await tx.get("patients", current.patientId)
    const age = ageOf(tx, patient)
    const items = await itemsOf(tx, current.itemIds)
    const tests = await testsOf(tx, items)

    let changed = 0
    for (const fix of input.corrections) {
      const result = await tx.get("results", fix.resultId)
      if (!current.itemIds.includes(result.labOrderItemId)) {
        tx.reject("LAB_RESULT_NOT_ON_REPORT", { reportNo: current.reportNo })
      }
      const analyte = tests.get(result.testId)?.analytes.find((a) => a.code === result.analyteCode)
      const numeric = typeof result.value === "number" || (analyte ? !analyte.qualitative : false)
      const value = numeric ? (fix.value ?? result.value) : null
      const text = numeric ? undefined : (fix.text ?? result.text)
      const unit = fix.unit ?? result.unit
      if (numeric && typeof value !== "number") {
        tx.reject("LAB_RESULT_MISSING", {
          test: tests.get(result.testId)?.code ?? result.testId,
          analyte: analyte?.name ?? result.analyteCode,
        })
      }
      const same = value === result.value && text === result.text && unit === result.unit
      if (same) continue
      const flag = analyte
        ? flagValue(analyte, numeric ? (value as number) : (text ?? ""), patient.sex, age)
        : result.flag
      await tx.update("results", result.id, {
        value,
        text,
        unit,
        flag,
        critical: isCriticalFlag(flag),
      })
      changed += 1
    }
    if (!changed) tx.reject("LAB_NO_CHANGE", { reportNo: current.reportNo })

    const wasReleased = current.status === "released"
    await tx.update("labReports", current.id, { status: "superseded" })

    const results: ResultRow[] = []
    for (const item of items) {
      results.push(...(await tx.list("results", "labOrderItemId", item.id)))
    }
    const base = {
      reportNo: current.reportNo,
      reportVersion: current.reportVersion + 1,
      patientId: current.patientId,
      branchId: current.branchId,
      labOrderId: current.labOrderId,
      itemIds: current.itemIds,
      signedBy: tx.actor.staffId,
      signedAt: tx.now(),
      correctionReason: input.reason,
      changeSummary: input.changeSummary,
      supersedesId: current.id,
    }
    const next = tx.insert("labReports", {
      ...base,
      status: "signed",
      heldForPayment: current.heldForPayment || undefined,
      hash: reportHash(base, results),
    })
    for (const item of items) {
      await tx.update("labOrderItems", item.id, { reportId: next.id })
    }
    tx.auditContext({ reason: input.reason })
    const refs = {
      patientId: current.patientId,
      reportId: next.id,
      labOrderId: current.labOrderId,
    }
    tx.emit("ReportCorrected", {
      branchId: current.branchId,
      refs,
      params: {
        reportNo: current.reportNo,
        version: next.reportVersion,
        from: current.reportVersion,
      },
    })
    const { released } = wasReleased
      ? await releaseOrHold(tx, next, { kind: "corrected", smsLang: input.smsLang })
      : { released: false }
    return {
      reportId: next.id,
      version: next.reportVersion,
      supersededId: current.id,
      released,
    }
  },
})

/* ================================================================== *
 * Critical call log (HAZ-05)
 * ================================================================== */

/**
 * Log the phone call for a critical result: who was called, their role, when,
 * and the read-back (plan §5.5). The call stays open until the doctor
 * acknowledges it; the 30-minute escalation builds on this row (S7, T2.6).
 */
export const logCriticalCall = defineCommand({
  name: "lab.logCriticalCall",
  roles: ["pathologist", "labtech"],
  input: z.object({
    resultId: z.string(),
    calledPerson: z.string().trim().min(2).max(80),
    calledRole: z.enum(["ordering-doctor", "duty-doctor", "ward"]),
    /** Demo-clock time of the call; defaults to now */
    calledAt: z.number().int().positive().optional(),
    readBack: z.boolean(),
    readBackText: z.string().trim().max(300).optional(),
  }),
  async run(tx, input) {
    const result = await tx.get("results", input.resultId)
    const item = await tx.get("labOrderItems", result.labOrderItemId)
    const test = await tx.get("labTests", result.testId)
    if (!result.critical) {
      tx.reject("LAB_NOT_CRITICAL", { test: test.code })
    }
    const calledAt = input.calledAt ?? tx.now()
    if (calledAt > tx.now()) tx.reject("LAB_CALL_IN_FUTURE", {})
    const analyte = test.analytes.find((a) => a.code === result.analyteCode)
    const valueText =
      `${analyte?.name ?? result.analyteCode} ${resultText(result, analyte?.decimals ?? 2)} ${result.unit ?? ""}`.trim()
    const call = tx.insert("criticalCalls", {
      resultId: result.id,
      labOrderItemId: item.id,
      patientId: result.patientId,
      branchId: item.branchId,
      valueText,
      calledPerson: input.calledPerson,
      calledRole: input.calledRole,
      calledAt,
      readBack: input.readBack,
      readBackText: input.readBackText || undefined,
      status: "open",
      loggedBy: tx.actor.staffId,
    })
    tx.emit("CriticalCallLogged", {
      branchId: item.branchId,
      refs: {
        patientId: result.patientId,
        resultId: result.id,
        labOrderId: item.labOrderId,
        labItemId: item.id,
      },
      params: { analyte: analyte?.name ?? result.analyteCode, person: input.calledPerson },
    })
    return { callId: call.id, valueText }
  },
})
