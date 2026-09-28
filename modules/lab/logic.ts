/**
 * Pure lab rules shared by the commands, the screens and the tests: the
 * second-identifier check (HAZ-01), result flags and reference ranges, the
 * delta check, the doctor-inbox kind for a report, and the signed-content
 * hash behind QR verification. No IO and no clock here.
 */

import { canonicalJson, sha256Hex } from "@/core/audit/chain"
import type {
  Analyte,
  Container,
  LabReportRow,
  RefRange,
  ResultFlag,
  ResultRow,
  Sex,
} from "@/core/db/schema"
import { flagFor, rangeFor } from "@/core/seed/content/analyser-scripts"

/* ---------------- Digits and the second identifier (HAZ-01) ---------------- */

const BN_ZERO = 0x09e6

/** Bangla digits (০-৯) to Latin, so a Bangla keyboard works for identifiers. */
export function toLatinDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - BN_ZERO))
}

export function digitsOnly(text: string): string {
  return toLatinDigits(text).replace(/\D/g, "")
}

export type SecondIdMatch = "dob" | "phone"

/**
 * The second identifier asked at collection: the patient's date of birth
 * (DD-MM-YYYY, DDMMYYYY or YYYY-MM-DD, Bangla digits allowed) or the last four
 * digits of their phone (or their attendant's phone). Returns what matched,
 * or null.
 */
export function secondIdentifierMatch(
  patient: { dob: string; phone?: string; attendantPhone?: string },
  typed: string
): SecondIdMatch | null {
  const latin = toLatinDigits(typed).trim()
  if (!latin) return null
  const [y, m, d] = patient.dob.split("-")

  const parts = latin.split(/[\s./-]+/).filter(Boolean)
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b, c] = parts
    const pad = (s: string) => s.padStart(2, "0")
    if (c.length === 4 && `${c}-${pad(b)}-${pad(a)}` === patient.dob) return "dob"
    if (a.length === 4 && `${a}-${pad(b)}-${pad(c)}` === patient.dob) return "dob"
  }

  const digits = digitsOnly(latin)
  if (digits.length === 8 && (digits === `${d}${m}${y}` || digits === `${y}${m}${d}`)) {
    return "dob"
  }
  if (digits.length === 4) {
    for (const phone of [patient.phone, patient.attendantPhone]) {
      if (phone && digitsOnly(phone).slice(-4) === digits) return "phone"
    }
  }
  return null
}

/* ---------------- Containers ---------------- */

/** Tube cap colours for the collection worklist and the tube label. */
export const CONTAINER_CAP: Record<Container, string> = {
  EDTA: "#9b7fd4",
  plain: "#d64545",
  fluoride: "#8e949c",
  citrate: "#5aa9e6",
  "urine-cup": "#e8c547",
  "stool-cup": "#8a5a3c",
  swab: "#e9e9e9",
  formalin: "#3fa7a0",
  none: "transparent",
}

/* ---------------- Flags and ranges ---------------- */

export function isCriticalFlag(flag: ResultFlag): boolean {
  return flag === "LL" || flag === "HH"
}

/** The normal text of a qualitative analyte for this patient ("Negative", "Nil"). */
export function normalText(analyte: Analyte, sex: Sex, ageYears: number): string {
  return rangeFor(analyte, sex, ageYears)?.text ?? "Negative"
}

/**
 * Flag for one value: numeric values against the patient's range and the
 * critical limits; qualitative text is "A" (abnormal) unless it reads as the
 * normal text.
 */
export function flagValue(
  analyte: Analyte,
  value: number | string,
  sex: Sex,
  ageYears: number
): ResultFlag {
  if (typeof value === "number") return flagFor(analyte, value, sex, ageYears)
  const normal = normalText(analyte, sex, ageYears).trim().toLowerCase()
  return value.trim().toLowerCase() === normal ? "N" : "A"
}

/** A number with the analyte's decimals, always Latin digits (clinical values). */
export function formatValue(value: number, decimals: number): string {
  return value.toFixed(Math.max(0, Math.min(decimals, 4)))
}

/** "4.0 - 11.0", "< 200", "> 40", "Negative", or "-" when there is no range. */
export function formatRange(range: RefRange | undefined, decimals: number): string {
  if (!range) return "-"
  if (range.text) return range.text
  const f = (n: number) => formatValue(n, decimals)
  if (range.low !== undefined && range.high !== undefined) return `${f(range.low)} - ${f(range.high)}`
  if (range.high !== undefined) return `< ${f(range.high)}`
  if (range.low !== undefined) return `> ${f(range.low)}`
  return "-"
}

/** A stored result as display text: the number with decimals, or its text. */
export function resultText(
  result: Pick<ResultRow, "value" | "text">,
  decimals: number
): string {
  if (typeof result.value === "number") return formatValue(result.value, decimals)
  return result.text ?? "-"
}

/* ---------------- Delta check ---------------- */

/**
 * Largest plausible change (percent of the previous value) before a result is
 * delta-flagged for review. Demo values; the default covers everything else.
 */
export const DELTA_LIMIT_PCT: Record<string, number> = {
  HB: 20,
  HCT: 20,
  RBC: 20,
  WBC: 50,
  PLT: 50,
  NA: 5,
  K: 20,
  CL: 10,
  CREAT: 50,
  UREA: 50,
  HBA1C: 15,
  TSH: 50,
}
export const DEFAULT_DELTA_PCT = 40

export type Delta = { diff: number; pct: number; limit: number; flagged: boolean }

export function deltaCheck(analyteCode: string, current: number, previous: number): Delta {
  const diff = current - previous
  const limit = DELTA_LIMIT_PCT[analyteCode] ?? DEFAULT_DELTA_PCT
  const pct =
    previous === 0 ? (current === 0 ? 0 : 100) : (diff / Math.abs(previous)) * 100
  return { diff, pct, limit, flagged: Math.abs(pct) > limit }
}

/**
 * The patient's latest validated numeric result for the same analyte before
 * `before`, from another order item (the delta check baseline).
 */
export function previousFor<R extends Pick<ResultRow, "analyteCode" | "labOrderItemId" | "status" | "value" | "createdAt">>(
  rows: R[],
  analyteCode: string,
  excludeItemId: string,
  before: number
): R | undefined {
  let best: R | undefined
  for (const row of rows) {
    if (row.analyteCode !== analyteCode || row.labOrderItemId === excludeItemId) continue
    if (row.status !== "validated" || typeof row.value !== "number") continue
    if (row.createdAt >= before) continue
    if (!best || row.createdAt > best.createdAt) best = row
  }
  return best
}

/* ---------------- Reports ---------------- */

export type InboxResultKind = "critical" | "abnormal" | "result"

/** Doctor-inbox kind for a released report: critical beats abnormal beats plain. */
export function inboxKindFor(
  results: Pick<ResultRow, "flag" | "critical">[]
): InboxResultKind {
  if (results.some((r) => r.critical || isCriticalFlag(r.flag))) return "critical"
  if (results.some((r) => r.flag !== "N")) return "abnormal"
  return "result"
}

type HashReport = Pick<
  LabReportRow,
  | "reportNo"
  | "reportVersion"
  | "patientId"
  | "labOrderId"
  | "itemIds"
  | "signedBy"
  | "signedAt"
  | "correctionReason"
  | "changeSummary"
  | "supersedesId"
>
type HashResult = Pick<
  ResultRow,
  "labOrderItemId" | "testId" | "analyteCode" | "value" | "text" | "unit" | "flag"
>

/** The signed content of one report version: what the hash covers. */
export function reportContent(report: HashReport, results: HashResult[]) {
  const order = new Map(report.itemIds.map((id, i) => [id, i]))
  const rows = results
    .filter((r) => order.has(r.labOrderItemId))
    .sort(
      (a, b) =>
        order.get(a.labOrderItemId)! - order.get(b.labOrderItemId)! ||
        (a.analyteCode < b.analyteCode ? -1 : a.analyteCode > b.analyteCode ? 1 : 0)
    )
    .map((r) => [r.testId, r.analyteCode, r.value ?? r.text ?? null, r.unit ?? "", r.flag])
  return {
    reportNo: report.reportNo,
    version: report.reportVersion,
    patientId: report.patientId,
    labOrderId: report.labOrderId,
    itemIds: report.itemIds,
    signedBy: report.signedBy,
    signedAt: report.signedAt,
    correctionReason: report.correctionReason,
    changeSummary: report.changeSummary,
    supersedesId: report.supersedesId,
    results: rows,
  }
}

/** SHA-256 over the canonical JSON of the signed content (QR verification). */
export function reportHash(report: HashReport, results: HashResult[]): string {
  return sha256Hex(canonicalJson(reportContent(report, results)))
}

/** "A. K." from "Abdul Karim": initials only for the public verify page. */
export function initialsOf(name: string): string {
  return name
    .replace(/^(md\.?|mohammad|mohammed|muhammad|mst\.?|dr\.?)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}.`)
    .join(" ")
}
