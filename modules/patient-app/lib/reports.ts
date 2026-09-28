import type {
  Analyte,
  ImagingReportRow,
  LabReportRow,
  RefRange,
  ResultFlag,
  Sex,
} from "@/core/db/schema"
import { rangeFor } from "@/core/seed/content"

/**
 * Which reports a patient may see, and how versions group (HAZ-03). Only
 * versions that were released reach the app: drafts, signed-but-held and
 * never-released versions do not. A corrected report keeps every released
 * version; the superseded ones carry the "Corrected" banner and point to the
 * current version.
 */

/** A version the patient may see: released now, or released before a correction. */
export function isVisibleReport(report: Pick<LabReportRow, "status" | "releasedAt">): boolean {
  return (report.status === "released" || report.status === "superseded") && !!report.releasedAt
}

export type ReportGroup<R> = {
  /** Shared by every version (the report number, or the imaging order) */
  key: string
  current: R
  /** Earlier released versions, latest first */
  earlier: R[]
}

type Versioned = {
  id: string
  status: string
  releasedAt?: number
  supersedesId?: string
}

function group<R extends Versioned>(
  reports: R[],
  keyOf: (report: R) => string,
  versionOf: (report: R) => number
): ReportGroup<R>[] {
  const groups = new Map<string, R[]>()
  for (const report of reports) {
    if (!isVisibleReport(report as Pick<LabReportRow, "status" | "releasedAt">)) continue
    const key = keyOf(report)
    groups.set(key, [...(groups.get(key) ?? []), report])
  }
  return [...groups.entries()]
    .map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => versionOf(b) - versionOf(a))
      const current = sorted.find((r) => r.status === "released") ?? sorted[0]
      return { key, current, earlier: sorted.filter((r) => r !== current) }
    })
    .sort((a, b) => (b.current.releasedAt ?? 0) - (a.current.releasedAt ?? 0))
}

/** Lab reports grouped by report number, newest release first. */
export function groupLabReports(reports: LabReportRow[]): ReportGroup<LabReportRow>[] {
  return group(reports, (r) => r.reportNo || r.id, (r) => r.reportVersion)
}

/** Imaging reports grouped by order, newest release first. */
export function groupImagingReports(
  reports: ImagingReportRow[]
): ReportGroup<ImagingReportRow>[] {
  return group(reports, (r) => r.imagingOrderId, (r) => r.reportVersion)
}

/** The version that replaced `version` (its direct successor, else the current one). */
export function replacementOf<R extends Versioned>(version: R, group: ReportGroup<R>): R {
  const all = [group.current, ...group.earlier]
  return all.find((r) => r.supersedesId === version.id) ?? group.current
}

/** Values outside the reference range (H, L, critical or abnormal). */
export function isOutOfRange(flag: ResultFlag): boolean {
  return flag !== "N"
}

/** The reference range for a patient, from the test's analyte definition. */
export function referenceRange(
  analyte: Analyte | undefined,
  sex: Sex,
  ageYears: number
): RefRange | undefined {
  return analyte ? rangeFor(analyte, sex, ageYears) : undefined
}
