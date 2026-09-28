/**
 * Transaction helpers behind the prescribing commands: building a line from
 * the dictionary, the three interruptive alert checks, the billing basket
 * line for a signed Rx line, and the revise (v2) and replace (new Rx) rules.
 * Everything runs inside the calling command's single atomic commit.
 */

import type { BranchCode } from "@/config/brand.config"
import { queueSms, notifyPatient } from "@/core/comms/sms"
import type {
  BasketLineRow,
  BatchRow,
  CorporateEmployeeRow,
  EncounterRow,
  MealTiming,
  PatientRow,
  PrescriptionRow,
  RxLineRow,
} from "@/core/db/schema"
import { nextRxNo } from "@/core/engine/docNumbers"
import type { NewRow, Tx } from "@/core/engine/types"
import { bnDigits } from "@/core/seed/content"
import type { Locale } from "@/lib/i18n/config"
import { dmyLatin, payerFor } from "@/modules/consultation/server"

import {
  allergyAlertsFor,
  criticalAlertsFor,
  duplicateAlertsFor,
  missingOverrides,
  type AlertOverride,
  type DuplicateContext,
  type RxAlert,
} from "./alerts"
import { dispensableOnHand } from "./alternatives"
import {
  instructionsFor,
  isDoseCode,
  normaliseDoseCode,
  quantityFor,
} from "./dose"

/** What the doctor writes for one line (the command fills the rest from the dictionary). */
export type LineContent = {
  brandId?: string
  nonDictionaryName?: string
  strength?: string
  form?: string
  dosePattern: string
  mealTiming: MealTiming
  durationDays: number
  qtyPrescribed?: number
}

type BuiltLine = Omit<
  NewRow<"rxLines">,
  | "rxId"
  | "patientId"
  | "branchId"
  | "lineNo"
  | "paymentCleared"
  | "dispensedQty"
  | "status"
>

/** A full line from the dictionary: generic, strength, form, flags and both instruction lines. */
export async function buildLine(
  tx: Tx,
  content: LineContent
): Promise<BuiltLine> {
  const code = normaliseDoseCode(content.dosePattern)
  if (!isDoseCode(code))
    tx.reject("DOSE_INVALID", { dose: content.dosePattern })
  const instructions = instructionsFor(
    code,
    content.mealTiming,
    content.durationDays
  )
  const qty = content.qtyPrescribed ?? quantityFor(code, content.durationDays)
  const dosing = {
    dosePattern: code,
    mealTiming: content.mealTiming,
    durationDays: content.durationDays,
    instructionsEn: instructions.en,
    instructionsBn: instructions.bn,
  }
  if (content.brandId) {
    const brand = await tx.get("brands", content.brandId)
    const generic = await tx.get("generics", brand.genericId)
    if (qty < 1)
      tx.reject("QTY_REQUIRED", { item: `${brand.name} ${brand.strength}` })
    return {
      brandId: brand.id,
      genericId: generic.id,
      strength: brand.strength,
      form: brand.form,
      ...dosing,
      qtyPrescribed: qty,
      isAntibiotic: brand.isAntibiotic || generic.isAntibiotic,
      isControlled:
        brand.category === "controlled" || !!generic.controlledClass,
    }
  }
  const name = content.nonDictionaryName?.trim()
  if (!name) tx.reject("MEDICINE_REQUIRED", {})
  return {
    nonDictionaryName: name,
    strength: content.strength?.trim() ?? "",
    form: content.form?.trim() ?? "",
    ...dosing,
    qtyPrescribed: Math.max(0, qty),
    isAntibiotic: false,
    isControlled: false,
  }
}

/** "Zimax 500 mg" or the typed name, for alerts and messages. */
export async function lineName(
  tx: Tx,
  line: Pick<RxLineRow, "brandId" | "nonDictionaryName" | "strength">
): Promise<string> {
  if (line.brandId) {
    const brand = await tx.find("brands", line.brandId)
    if (brand) return `${brand.name} ${brand.strength}`
  }
  return `${line.nonDictionaryName ?? ""} ${line.strength}`.trim()
}

/** The patient's lines on other signed prescriptions (for the duplicate-order check). */
async function otherSignedLines(
  tx: Tx,
  patientId: string,
  ignoreRxIds: Set<string>
): Promise<DuplicateContext["otherLines"]> {
  const out: DuplicateContext["otherLines"] = []
  const rxCache = new Map<string, PrescriptionRow | undefined>()
  for (const line of await tx.list("rxLines", "patientId", patientId)) {
    if (ignoreRxIds.has(line.rxId)) continue
    if (!rxCache.has(line.rxId))
      rxCache.set(line.rxId, await tx.find("prescriptions", line.rxId))
    const rx = rxCache.get(line.rxId)
    if (!rx || rx.status !== "signed") continue
    out.push({ line, rx, name: await lineName(tx, line) })
  }
  return out
}

export type AlertScope = {
  /** Other lines on the prescription being written (drafted or revised) */
  thisRx: Pick<
    RxLineRow,
    "id" | "genericId" | "brandId" | "nonDictionaryName" | "status" | "strength"
  >[]
  /** Prescriptions that do not count as "another active Rx" (the one being revised) */
  ignoreRxIds: string[]
  exceptLineId?: string
  /** Which alerts to check (all three by default) */
  kinds?: RxAlert["kind"][]
}

/**
 * The interruptive alert check (HAZ-10): allergy, duplicate order and
 * critical value. A line whose alerts were not acknowledged is refused; an
 * allergy needs a reason and the refused attempt is audited.
 */
export async function checkAlerts(
  tx: Tx,
  patient: PatientRow,
  content: LineContent,
  scope: AlertScope,
  overrides: AlertOverride[] | undefined
): Promise<RxAlert[]> {
  const kinds = scope.kinds ?? ["allergy", "duplicate", "critical"]
  const brand = content.brandId
    ? await tx.get("brands", content.brandId)
    : undefined
  const generic = brand ? await tx.get("generics", brand.genericId) : undefined
  const item = brand
    ? `${brand.name} ${brand.strength}`
    : (content.nonDictionaryName ?? "")
  const alerts: RxAlert[] = []
  if (kinds.includes("allergy")) {
    alerts.push(
      ...allergyAlertsFor(patient.allergies, {
        allergyClass: generic?.allergyClass,
        genericName: generic?.name,
        freeText: content.nonDictionaryName,
      })
    )
  }
  if (kinds.includes("duplicate")) {
    const names = new Map<string, string>()
    for (const line of scope.thisRx)
      names.set(line.id, await lineName(tx, line))
    alerts.push(
      ...duplicateAlertsFor(
        generic?.id,
        { thisRx: (id) => names.get(id) ?? "" },
        {
          thisRx: scope.thisRx,
          otherLines: await otherSignedLines(
            tx,
            patient.id,
            new Set(scope.ignoreRxIds)
          ),
          currentMeds: patient.currentMeds,
          now: tx.now(),
          exceptLineId: scope.exceptLineId,
        }
      )
    )
  }
  if (kinds.includes("critical")) {
    alerts.push(
      ...criticalAlertsFor(
        await tx.list("results", "patientId", patient.id),
        tx.now()
      )
    )
  }
  const missing = missingOverrides(alerts, overrides)
  if (missing.includes("allergy")) {
    tx.reject("ALLERGY_OVERRIDE_REQUIRED", { item }, { audit: true })
  }
  if (missing.includes("duplicate"))
    tx.reject("DUPLICATE_ACK_REQUIRED", { item })
  if (missing.includes("critical")) tx.reject("CRITICAL_ACK_REQUIRED", { item })
  const reasons = (overrides ?? [])
    .filter((o) => alerts.some((a) => a.kind === o.kind))
    .map((o) => `${o.kind}: ${o.reason?.trim() || "acknowledged"} (${item})`)
  if (reasons.length) tx.auditContext({ reason: reasons.join("; ") })
  return alerts
}

/* ================================================================== *
 * Drafts
 * ================================================================== */

export async function prescriptionsOf(
  tx: Tx,
  encounterId: string
): Promise<PrescriptionRow[]> {
  return (await tx.list("prescriptions", "encounterId", encounterId)).sort(
    (a, b) => b.createdAt - a.createdAt
  )
}

/** The encounter's draft Rx, created on first use. Refused once an Rx is signed (revise it instead). */
export async function ensureDraftRx(
  tx: Tx,
  encounter: EncounterRow
): Promise<PrescriptionRow> {
  const all = await prescriptionsOf(tx, encounter.id)
  const signed = all.find((rx) => rx.status === "signed")
  if (signed) tx.reject("RX_ALREADY_SIGNED", { rxNo: signed.rxNo })
  const draft = all.find((rx) => rx.status === "draft")
  if (draft) return draft
  return tx.insert("prescriptions", {
    rxNo: await nextRxNo(tx, encounter.branchId),
    rxVersion: 1,
    encounterId: encounter.id,
    patientId: encounter.patientId,
    doctorId: encounter.doctorId,
    branchId: encounter.branchId,
    status: "draft",
    mode: encounter.mode,
    advice: "",
    tests: [],
    vitalsSnapshot: encounter.vitals,
  })
}

export async function liveLinesOf(tx: Tx, rxId: string): Promise<RxLineRow[]> {
  return (await tx.list("rxLines", "rxId", rxId))
    .filter((l) => l.status !== "cancelled")
    .sort((a, b) => a.lineNo - b.lineNo)
}

/** Test names for the Rx: the ones written on it plus the encounter's lab and imaging orders. */
export async function encounterTestNames(
  tx: Tx,
  encounterId: string | undefined,
  existing: string[]
): Promise<string[]> {
  const names = new Set(existing)
  if (!encounterId) return [...names]
  for (const order of await tx.list("labOrders", "encounterId", encounterId)) {
    if (order.status === "cancelled") continue
    for (const item of await tx.list("labOrderItems", "labOrderId", order.id)) {
      if (item.status === "cancelled") continue
      const test = await tx.find("labTests", item.testId)
      if (test) names.add(test.name)
    }
  }
  for (const order of await tx.list(
    "imagingOrders",
    "encounterId",
    encounterId
  )) {
    if (order.status === "cancelled") continue
    const test = await tx.find("labTests", order.testId)
    if (test) names.add(test.name)
  }
  return [...names]
}

/* ================================================================== *
 * Signing effects
 * ================================================================== */

/** Units dispensable at a branch now (FEFO-eligible batches only). */
export async function onHandNow(
  tx: Tx,
  branch: BranchCode,
  brandId: string
): Promise<number> {
  const levels = await tx.list("stockLevels", "[branchId+brandId]", [
    branch,
    brandId,
  ])
  const batches = new Map<string, BatchRow>()
  for (const level of levels) {
    const batch = await tx.find("batches", level.batchId)
    if (batch) batches.set(batch.id, batch)
  }
  return dispensableOnHand(levels, batches, branch, brandId, tx.today())
}

/**
 * The billing basket line for a signed Rx line: quantity is what can be
 * handed over now, min(prescribed, dispensable on hand); the unit price is
 * the brand's, never above MRP (INV-05). No line when nothing is on hand or
 * the medicine is outside the dictionary (neither can be sold here today).
 */
export async function basketLineFor(
  tx: Tx,
  rx: PrescriptionRow,
  line: RxLineRow,
  employee: CorporateEmployeeRow | undefined
): Promise<BasketLineRow | undefined> {
  if (!line.brandId || line.status === "cancelled") return undefined
  const brand = await tx.get("brands", line.brandId)
  const qty = Math.min(
    line.qtyPrescribed,
    await onHandNow(tx, rx.branchId, brand.id)
  )
  if (qty <= 0) return undefined
  return tx.insert("basketLines", {
    patientId: rx.patientId,
    branchId: rx.branchId,
    sourceType: "rx-line",
    sourceId: line.id,
    serviceType: "medicine",
    description: `${brand.name} ${brand.strength}`,
    doctorId: rx.doctorId,
    qty,
    unitPriceP: brand.unitPriceP,
    mrpP: brand.mrpP,
    status: "open",
    ...payerFor(employee),
  })
}

/** The patient-app item for a ready prescription (generic text only, no health data). */
export function notifyRxReady(tx: Tx, rx: PrescriptionRow): void {
  notifyPatient(tx, {
    patientId: rx.patientId,
    kind: "rxReady",
    titleKey: "patientApp.notifications.rxReady",
    refs: { rxId: rx.id, encounterId: rx.encounterId },
  })
}

/** Follow-up reminder SMS: only to a verified number with SMS consent, never with clinical content. */
export function queueFollowUpSms(
  tx: Tx,
  patient: PatientRow,
  followUpDate: string,
  lang: Locale
): boolean {
  const consent = patient.consents.find((c) => c.purpose === "sms")
  if (!patient.phone || !patient.phoneVerified || consent?.granted === false)
    return false
  const date = dmyLatin(followUpDate)
  queueSms(tx, {
    to: patient.phone,
    patientId: patient.id,
    lang,
    templateId: "follow-up-reminder",
    params: { date: lang === "bn" ? bnDigits(date) : date },
  })
  return true
}

/* ================================================================== *
 * Revise (v2 before dispensing) and replace (new Rx after dispensing)
 * ================================================================== */

export type RevisedLine = LineContent & {
  /** The line of the old Rx this one continues */
  keepLineId?: string
  /** Substitution: keep the old line's payment even though the brand changed */
  carryPayment?: boolean
  substitutedFromLineId?: string
}

const CONTENT_FIELDS = [
  "brandId",
  "nonDictionaryName",
  "strength",
  "form",
  "dosePattern",
  "mealTiming",
  "durationDays",
  "qtyPrescribed",
] as const

function sameContent(
  a: Pick<RxLineRow, (typeof CONTENT_FIELDS)[number]>,
  b: BuiltLine
): boolean {
  return CONTENT_FIELDS.every(
    (field) =>
      (a[field] ?? "") === ((b as Record<string, unknown>)[field] ?? "")
  )
}

/**
 * Revise a signed Rx (plan §6 `rx.revise`). Before any dispense: a new
 * version (same Rx number, v+1) supersedes the old one, and the pharmacy
 * queue and billing basket are repointed to it. After a dispense: a new Rx
 * (new number) replaces the old one, whose open queue entry and unpaid
 * basket lines are withdrawn. Unchanged, undispensed lines keep their payment.
 */
export async function reviseRx(
  tx: Tx,
  old: PrescriptionRow,
  lines: RevisedLine[],
  opts: {
    advice: string
    followUpDate?: string
    employee: CorporateEmployeeRow | undefined
    encounter?: EncounterRow
  }
): Promise<{
  rx: PrescriptionRow
  lines: RxLineRow[]
  mode: "revised" | "replaced"
}> {
  const oldLines = await liveLinesOf(tx, old.id)
  const dispenses = await tx.list("dispenses", "rxId", old.id)
  const dispensed =
    dispenses.length > 0 || oldLines.some((l) => l.dispensedQty > 0)
  const tests = await encounterTestNames(tx, old.encounterId, old.tests)
  const header = {
    encounterId: old.encounterId,
    patientId: old.patientId,
    doctorId: old.doctorId,
    branchId: old.branchId,
    status: "signed" as const,
    mode: old.mode,
    advice: opts.advice,
    followUpDate: opts.followUpDate,
    tests,
    vitalsSnapshot: opts.encounter?.vitals ?? old.vitalsSnapshot,
    signedAt: tx.now(),
  }
  let rx: PrescriptionRow
  if (!dispensed) {
    await tx.update("prescriptions", old.id, { status: "superseded" })
    rx = tx.insert("prescriptions", {
      ...header,
      rxNo: old.rxNo,
      rxVersion: old.rxVersion + 1,
      supersedesId: old.id,
    })
  } else {
    await tx.update("prescriptions", old.id, { status: "replaced" })
    rx = tx.insert("prescriptions", {
      ...header,
      rxNo: await nextRxNo(tx, old.branchId),
      rxVersion: 1,
      replacesId: old.id,
    })
  }

  const oldById = new Map(oldLines.map((l) => [l.id, l]))
  const carried = new Set<string>()
  const created: RxLineRow[] = []
  for (const [index, input] of lines.entries()) {
    const content = await buildLine(tx, input)
    const prev = input.keepLineId ? oldById.get(input.keepLineId) : undefined
    const carryable = !!prev && prev.dispensedQty === 0 && !carried.has(prev.id)
    const unchanged = carryable && sameContent(prev!, content)
    const paidSwap =
      carryable && !unchanged && !!input.carryPayment && prev!.paymentCleared
    const row = tx.insert("rxLines", {
      rxId: rx.id,
      patientId: rx.patientId,
      branchId: rx.branchId,
      lineNo: index + 1,
      ...content,
      paymentCleared:
        unchanged || paidSwap ? prev!.paymentCleared : !!opts.employee,
      dispensedQty: 0,
      status: "open",
      substitutedFromLineId: input.substitutedFromLineId,
    })
    created.push(row)
    if (unchanged || paidSwap) {
      carried.add(prev!.id)
      for (const basket of await tx.list("basketLines", "sourceId", prev!.id)) {
        if (basket.status === "removed") continue
        if (paidSwap && basket.status === "open") {
          await tx.update("basketLines", basket.id, { status: "removed" })
        } else {
          await tx.update("basketLines", basket.id, { sourceId: row.id })
        }
      }
    } else {
      await basketLineFor(tx, rx, row, opts.employee)
    }
  }

  // Old lines that were not carried: withdraw what is not paid or handed over.
  for (const prev of oldLines) {
    if (!carried.has(prev.id)) {
      for (const basket of await tx.list("basketLines", "sourceId", prev.id)) {
        if (basket.status === "open") {
          await tx.update("basketLines", basket.id, { status: "removed" })
        }
      }
    }
    if (prev.dispensedQty === 0 && prev.status !== "bought-elsewhere") {
      await tx.update("rxLines", prev.id, { status: "cancelled" })
    }
  }

  const queue = await tx.list("pharmacyQueue", "rxId", old.id)
  if (!dispensed) {
    for (const entry of queue) {
      await tx.update("pharmacyQueue", entry.id, { rxId: rx.id, rxNo: rx.rxNo })
    }
    if (!queue.length) await insertQueueEntry(tx, rx)
  } else {
    for (const entry of queue) {
      if (entry.status !== "done" && entry.status !== "cancelled") {
        await tx.update("pharmacyQueue", entry.id, { status: "cancelled" })
      }
    }
    await insertQueueEntry(tx, rx)
  }
  notifyRxReady(tx, rx)
  return { rx, lines: created, mode: dispensed ? "replaced" : "revised" }
}

export async function insertQueueEntry(tx: Tx, rx: PrescriptionRow) {
  return tx.insert("pharmacyQueue", {
    rxId: rx.id,
    rxNo: rx.rxNo,
    patientId: rx.patientId,
    branchId: rx.branchId,
    status: "waiting",
    receivedAt: tx.now(),
  })
}
