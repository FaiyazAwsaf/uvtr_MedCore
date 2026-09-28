/**
 * The only interruptive alerts on the Rx pad (PRD HAZ-10, plan §11): allergy,
 * duplicate order and critical value. Pure functions over rows, shared by the
 * Rx pad (to show them) and the commands (to refuse a line whose alert was not
 * acknowledged), so the screen and the rule can never disagree.
 */

import { DAY } from "@/core/clock/dates"
import type {
  Allergy,
  CurrentMed,
  Id,
  Ms,
  PrescriptionRow,
  ResultFlag,
  ResultRow,
  RxLineRow,
} from "@/core/db/schema"

export type AllergyAlert = {
  kind: "allergy"
  substance: string
  allergyClass?: string
  reaction: string
  severity: Allergy["severity"]
}

export type DuplicateAlert = {
  kind: "duplicate"
  /** Where the same generic already is */
  source: "this-rx" | "active-rx" | "current-meds"
  genericId?: Id
  /** The medicine already prescribed or taken, as written there */
  name: string
  rxNo?: string
  signedAt?: Ms
}

export type CriticalAlert = {
  kind: "critical"
  resultId: Id
  testId: Id
  analyteCode: string
  value: string
  unit?: string
  flag: ResultFlag
  at: Ms
}

export type RxAlert = AllergyAlert | DuplicateAlert | CriticalAlert
export type RxAlertKind = RxAlert["kind"]

/** An acknowledgement the doctor gave for an alert (a reason is required for allergy). */
export type AlertOverride = { kind: RxAlertKind; reason?: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

/**
 * Allergy alert: the patient's allergy class matches the generic's class
 * (Abdul Karim's "penicillins" and Amoxicillin). For a medicine typed outside
 * the dictionary, the allergy substance appearing in its name also alerts.
 */
export function allergyAlertsFor(
  allergies: Allergy[],
  medicine: { allergyClass?: string; genericName?: string; freeText?: string }
): AllergyAlert[] {
  const out: AllergyAlert[] = []
  for (const allergy of allergies) {
    const byClass =
      !!allergy.allergyClass &&
      !!medicine.allergyClass &&
      allergy.allergyClass === medicine.allergyClass
    const substance = norm(allergy.substance)
    const byName =
      !!substance &&
      [medicine.genericName, medicine.freeText].some(
        (name) => !!name && norm(name).includes(substance)
      )
    if (byClass || byName) {
      out.push({
        kind: "allergy",
        substance: allergy.substance,
        allergyClass: allergy.allergyClass,
        reaction: allergy.reaction,
        severity: allergy.severity,
      })
    }
  }
  return out
}

/** Line statuses that still mean "the patient is on this medicine". */
const LIVE_LINE: RxLineRow["status"][] = [
  "open",
  "partial",
  "dispensed",
  "awaiting-prescriber",
  "bought-elsewhere",
]

/**
 * A signed line still runs when its course has not ended (signed day plus
 * the duration) or it says "continue" (duration 0).
 */
export function isLineActive(
  line: Pick<RxLineRow, "status" | "durationDays">,
  rx: Pick<PrescriptionRow, "status" | "signedAt">,
  now: Ms
): boolean {
  if (rx.status !== "signed" || !rx.signedAt) return false
  if (!LIVE_LINE.includes(line.status)) return false
  if (line.durationDays === 0) return true
  return rx.signedAt + line.durationDays * DAY >= now
}

export type DuplicateContext = {
  /** Lines already on the prescription being written (cancelled ones are ignored) */
  thisRx: Pick<RxLineRow, "id" | "genericId" | "brandId" | "nonDictionaryName" | "status">[]
  /** Lines of the patient's other signed prescriptions, with their prescription */
  otherLines: {
    line: Pick<RxLineRow, "genericId" | "status" | "durationDays" | "strength">
    rx: Pick<PrescriptionRow, "id" | "status" | "signedAt" | "rxNo">
    name: string
  }[]
  currentMeds: CurrentMed[]
  now: Ms
  /** Line being edited, not compared with itself */
  exceptLineId?: Id
}

/** Duplicate order: the same generic on this Rx, on an active Rx, or in current medicines. */
export function duplicateAlertsFor(
  genericId: Id | undefined,
  names: { thisRx: (lineId: Id) => string },
  ctx: DuplicateContext
): DuplicateAlert[] {
  if (!genericId) return []
  const out: DuplicateAlert[] = []
  for (const line of ctx.thisRx) {
    if (line.id === ctx.exceptLineId || line.status === "cancelled") continue
    if (line.genericId === genericId) {
      out.push({ kind: "duplicate", source: "this-rx", genericId, name: names.thisRx(line.id) })
    }
  }
  const seenRx = new Set<Id>()
  for (const { line, rx, name } of ctx.otherLines) {
    if (line.genericId !== genericId || seenRx.has(rx.id)) continue
    if (!isLineActive(line, rx, ctx.now)) continue
    seenRx.add(rx.id)
    out.push({
      kind: "duplicate",
      source: "active-rx",
      genericId,
      name,
      rxNo: rx.rxNo,
      signedAt: rx.signedAt,
    })
  }
  if (!out.length) {
    for (const med of ctx.currentMeds) {
      if (med.genericId === genericId) {
        out.push({ kind: "duplicate", source: "current-meds", genericId, name: med.name })
      }
    }
  }
  return out
}

/** How far back a critical result counts as "on file" for the Rx pad. */
export const CRITICAL_WINDOW_DAYS = 30

/** Critical value: a validated critical result on file in the last 30 days, newest first. */
export function criticalAlertsFor(results: ResultRow[], now: Ms): CriticalAlert[] {
  return results
    .filter(
      (r) =>
        r.critical &&
        r.status === "validated" &&
        (r.validatedAt ?? r.updatedAt) >= now - CRITICAL_WINDOW_DAYS * DAY
    )
    .sort((a, b) => (b.validatedAt ?? b.updatedAt) - (a.validatedAt ?? a.updatedAt))
    .map((r) => ({
      kind: "critical" as const,
      resultId: r.id,
      testId: r.testId,
      analyteCode: r.analyteCode,
      value: r.value !== null ? String(r.value) : (r.text ?? ""),
      unit: r.unit,
      flag: r.flag,
      at: r.validatedAt ?? r.updatedAt,
    }))
}

/** Alert kinds that still need an acknowledgement (allergy also needs a reason). */
export function missingOverrides(
  alerts: RxAlert[],
  overrides: AlertOverride[] | undefined
): RxAlertKind[] {
  const kinds = [...new Set(alerts.map((a) => a.kind))]
  return kinds.filter((kind) => {
    const given = overrides?.find((o) => o.kind === kind)
    if (!given) return true
    return kind === "allergy" && !given.reason?.trim()
  })
}
