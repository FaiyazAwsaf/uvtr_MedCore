"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FileScan,
  FileText,
  FlaskConical,
  History,
  Info,
  PenLine,
  TriangleAlert,
} from "lucide-react"

import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusPill } from "@/components/shared/status"
import { ageOn, dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type {
  ImagingReportRow,
  LabReportRow,
  LabTestRow,
  ResultRow,
} from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { TEXT_ANALYTE } from "@/modules/lab/commands"
import {
  useReportDoc,
  type ReportDoc,
} from "@/modules/lab/components/report-document"
import { formatRange, resultText } from "@/modules/lab/logic"

import {
  groupImagingReports,
  groupLabReports,
  isOutOfRange,
  referenceRange,
  replacementOf,
  type ReportGroup,
} from "../lib/reports"
import {
  AppCard,
  AppLoading,
  ScreenTitle,
  SegmentLinks,
  useFocusId,
  useFocusRing,
} from "./bits"
import { branchName, staffName, useMember } from "./data"

/** Reports | Prescriptions switch at the top of both record screens. */
export function RecordsSwitch() {
  const { t } = useLocale()
  return (
    <SegmentLinks
      label={t("patientApp.records.label")}
      items={[
        { href: "/app/reports", label: t("patientApp.records.reports") },
        {
          href: "/app/prescriptions",
          label: t("patientApp.records.prescriptions"),
        },
      ]}
    />
  )
}

/** Released lab and imaging reports of the member on screen, grouped by version. */
export function useMemberReports() {
  const db = useDb()
  const member = useMember()
  const lab = useLiveQuery(
    () => db.labReports.where("patientId").equals(member.id).toArray(),
    [db, member.id]
  )
  const imaging = useLiveQuery(
    () => db.imagingReports.where("patientId").equals(member.id).toArray(),
    [db, member.id]
  )
  return React.useMemo(() => {
    if (!lab || !imaging) return undefined
    type Entry =
      | { kind: "lab"; group: ReportGroup<LabReportRow> }
      | { kind: "imaging"; group: ReportGroup<ImagingReportRow> }
    const entries: Entry[] = [
      ...groupLabReports(lab).map((group) => ({ kind: "lab" as const, group })),
      ...groupImagingReports(imaging).map((group) => ({
        kind: "imaging" as const,
        group,
      })),
    ]
    return entries.sort(
      (a, b) =>
        (b.group.current.releasedAt ?? 0) - (a.group.current.releasedAt ?? 0)
    )
  }, [lab, imaging])
}

/** Test names covered by a report, e.g. "HbA1c, Creatinine, Lipid profile". */
export function reportTitle(doc: ReportDoc | null | undefined): string {
  if (!doc) return ""
  const names = [
    ...new Set(
      doc.items.map((i) => doc.tests.get(i.testId)?.name).filter(Boolean)
    ),
  ]
  return names.join(", ")
}

export function ReportsScreen() {
  const { t } = useLocale()
  const entries = useMemberReports()
  const focusId = useFocusId()

  return (
    <>
      <RecordsSwitch />
      <ScreenTitle
        title={t("patientApp.reports.title")}
        subtitle={t("patientApp.reports.subtitle")}
      />
      {!entries ? (
        <AppLoading />
      ) : entries.length ? (
        <div className="flex flex-col gap-3">
          {entries.map((entry, index) =>
            entry.kind === "lab" ? (
              <LabReportGroup
                key={entry.group.key}
                group={entry.group}
                focusId={focusId}
                open={index === 0}
              />
            ) : (
              <ImagingReportCard
                key={entry.group.key}
                group={entry.group}
                focusId={focusId}
              />
            )
          )}
          <p className="flex items-start gap-2 px-1 pt-1 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t("patientApp.reports.askDoctor")}
          </p>
        </div>
      ) : (
        <AppCard className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-raised text-muted-foreground">
            <FileText className="size-5" />
          </span>
          <p className="text-[0.9375rem] font-semibold">
            {t("patientApp.reports.empty")}
          </p>
          <p className="max-w-[30ch] text-[0.8125rem] text-muted-foreground">
            {t("patientApp.reports.emptyHint")}
          </p>
        </AppCard>
      )}
    </>
  )
}

const FLAG_TONE: Record<string, string> = {
  H: "text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning",
  L: "text-info",
  HH: "text-destructive",
  LL: "text-destructive",
  A: "text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning",
}

function ResultRows({ doc }: { doc: ReportDoc }) {
  const { t, tk, locale } = useLocale()
  const age = doc.patient
    ? ageOn(
        doc.patient.dob,
        dhakaDate(doc.report.releasedAt ?? doc.report.updatedAt)
      )
    : 30
  const sex = doc.patient?.sex ?? "M"
  const byItem = new Map<string, ResultRow[]>()
  for (const r of doc.results)
    byItem.set(r.labOrderItemId, [...(byItem.get(r.labOrderItemId) ?? []), r])

  return (
    <div className="mt-3 flex flex-col gap-3">
      {doc.items.map((item) => {
        const test: LabTestRow | undefined = doc.tests.get(item.testId)
        const rows = byItem.get(item.id) ?? []
        if (!test) return null
        return (
          <div
            key={item.id}
            className="overflow-hidden rounded-2xl border border-hairline"
          >
            <p className="flex items-center gap-2 bg-surface-raised px-3 py-2 text-[0.8125rem] font-semibold">
              <FlaskConical className="size-4 shrink-0 text-link" />
              <span lang="en">{test.name}</span>
              {locale === "bn" && test.glossBn ? (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {test.glossBn}
                </span>
              ) : null}
            </p>
            <ul className="divide-y divide-hairline">
              {test.analytes.map((analyte) => {
                const result = rows.find((r) => r.analyteCode === analyte.code)
                if (!result) return null
                if (analyte.code === TEXT_ANALYTE) {
                  return (
                    <li
                      key={analyte.code}
                      className="px-3 py-2.5 text-[0.8125rem] leading-relaxed"
                      lang="en"
                    >
                      {result.text}
                    </li>
                  )
                }
                const out = isOutOfRange(result.flag)
                const range = formatRange(
                  referenceRange(analyte, sex, age),
                  analyte.decimals
                )
                return (
                  <li
                    key={analyte.code}
                    data-testid="app-report-result"
                    data-analyte={analyte.code}
                    data-flag={result.flag}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span
                        className="block truncate text-[0.8125rem]"
                        lang="en"
                      >
                        {analyte.name}
                      </span>
                      <span className="block truncate text-[0.6875rem] text-muted-foreground">
                        {t("patientApp.reports.range", {
                          range: `${range}${analyte.units ? ` ${analyte.units}` : ""}`,
                        })}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        lang="en"
                        className={cn(
                          "flex items-center justify-end gap-1 font-mono text-[0.9375rem] font-semibold tabular-nums",
                          out && FLAG_TONE[result.flag]
                        )}
                      >
                        {result.flag === "H" || result.flag === "HH" ? (
                          <ArrowUp className="size-3.5" />
                        ) : null}
                        {result.flag === "L" || result.flag === "LL" ? (
                          <ArrowDown className="size-3.5" />
                        ) : null}
                        {resultText(result, analyte.decimals)}
                        {analyte.units ? (
                          <span className="font-sans text-[0.6875rem] font-normal text-muted-foreground">
                            {analyte.units}
                          </span>
                        ) : null}
                      </span>
                      {out ? (
                        <span
                          className={cn(
                            "block text-[0.6875rem] font-medium",
                            FLAG_TONE[result.flag]
                          )}
                        >
                          {tk(`patientApp.reports.flag.${result.flag}`)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

/** The current version of a lab report, then its earlier (corrected) versions. */
function LabReportGroup({
  group,
  focusId,
  open: openFirst,
}: {
  group: ReportGroup<LabReportRow>
  focusId: string | null
  open: boolean
}) {
  const { t, num, dmy, locale } = useLocale()
  const doc = useReportDoc(group.current.id)
  const report = group.current
  const focused = focusId === report.id || focusId === report.labOrderId
  const { ref, flash } = useFocusRing(focused)
  const [expanded, setExpanded] = React.useState<boolean | null>(null)
  const open = expanded ?? (openFirst || focused)
  const corrected = report.reportVersion > 1 || group.earlier.length > 0
  const outCount = doc
    ? doc.results.filter((r) => isOutOfRange(r.flag)).length
    : 0

  return (
    <>
      <AppCard
        ref={ref}
        flash={flash}
        data-testid="app-report"
        data-report-id={report.id}
        data-report-no={report.reportNo}
        data-version={report.reportVersion}
        data-status={report.status}
        className="scroll-mt-20"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-link">
            <FlaskConical className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="text-[0.9375rem] leading-snug font-semibold"
              lang="en"
            >
              {reportTitle(doc) || report.reportNo}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span lang="en" className="font-mono">
                {report.reportNo}
              </span>
              {" · "}
              {branchName(report.branchId, locale)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("patientApp.reports.released", {
                date: dmy(report.releasedAt!),
              })}
              {" · "}
              {t("patientApp.reports.version", {
                version: num(report.reportVersion),
              })}
            </p>
            {corrected ? (
              <StatusPill
                tone="warning"
                data-testid="app-report-corrected-pill"
                className="mt-1.5"
              >
                {t("patientApp.reports.corrected")}
              </StatusPill>
            ) : null}
          </div>
        </div>

        {doc ? (
          <p
            className={cn(
              "mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[0.8125rem] font-medium",
              outCount
                ? "bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] text-[color-mix(in_oklch,var(--warning),var(--foreground)_40%)] dark:text-warning"
                : "bg-[color-mix(in_oklch,var(--success)_14%,transparent)] text-success"
            )}
          >
            {outCount ? (
              <TriangleAlert className="size-4 shrink-0" />
            ) : (
              <Info className="size-4 shrink-0" />
            )}
            {outCount
              ? t("patientApp.reports.outOfRange", { count: num(outCount) })
              : t("patientApp.reports.allNormal")}
          </p>
        ) : null}

        {corrected && (report.changeSummary || report.correctionReason) ? (
          <div className="mt-3 rounded-xl border border-hairline p-3 text-[0.8125rem]">
            <p className="flex items-center gap-1.5 font-semibold">
              <History className="size-4 text-link" />
              {t("patientApp.reports.whatChanged")}
            </p>
            {report.changeSummary ? (
              <p className="mt-1 leading-relaxed" lang="en">
                {report.changeSummary}
              </p>
            ) : null}
            {report.correctionReason ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("patientApp.reports.reason", {
                  reason: report.correctionReason,
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          aria-expanded={open}
          onClick={() => setExpanded(!open)}
          className="mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full bg-surface-raised text-[0.8125rem] font-medium"
        >
          {open
            ? t("patientApp.reports.hideResults")
            : t("patientApp.reports.showResults")}
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </button>
        {open && doc ? <ResultRows doc={doc} /> : null}

        {doc?.signer ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <PenLine className="size-3.5" />
            {t("patientApp.reports.signedBy", {
              name: staffName(doc.signer, locale),
            })}
          </p>
        ) : null}
      </AppCard>

      {group.earlier.map((version) => (
        <SupersededCard
          key={version.id}
          version={version}
          group={group}
          focusId={focusId}
        />
      ))}
    </>
  )
}

/**
 * An earlier released version that was corrected (HAZ-03): kept visible with
 * the "Corrected" banner and a link to the current version, and without its
 * results, which the correction replaced.
 */
function SupersededCard({
  version,
  group,
  focusId,
}: {
  version: LabReportRow
  group: ReportGroup<LabReportRow>
  focusId: string | null
}) {
  const { t, num, dmy } = useLocale()
  const replacement = replacementOf(version, group)
  const { ref, flash } = useFocusRing(focusId === version.id)
  return (
    <AppCard
      ref={ref}
      flash={flash}
      data-testid="app-report"
      data-report-id={version.id}
      data-report-no={version.reportNo}
      data-version={version.reportVersion}
      data-status={version.status}
      className="ml-4 scroll-mt-20 border-l-4 border-l-warning opacity-95"
    >
      <p className="text-xs font-medium text-muted-foreground">
        {t("patientApp.reports.earlier")} ·{" "}
        {t("patientApp.reports.version", {
          version: num(version.reportVersion),
        })}
        {" · "}
        {t("patientApp.reports.released", { date: dmy(version.releasedAt!) })}
      </p>
      <div
        role="note"
        data-testid="app-report-corrected"
        data-current-id={replacement.id}
        className="mt-2 rounded-xl bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] p-3"
      >
        <p className="flex items-center gap-2 text-[0.8125rem] font-semibold">
          <TriangleAlert className="size-4 shrink-0 text-[color-mix(in_oklch,var(--warning),var(--foreground)_40%)] dark:text-warning" />
          {t("patientApp.reports.correctedTitle")}
        </p>
        <p className="mt-1 text-xs leading-relaxed">
          {t("patientApp.reports.correctedBody", {
            version: num(replacement.reportVersion),
            date: dmy(replacement.releasedAt ?? replacement.updatedAt),
          })}
        </p>
        <Link
          href={`/app/reports?focus=${replacement.id}`}
          data-testid="app-report-current-link"
          className="mt-2 inline-flex min-h-10 items-center text-[0.8125rem] font-semibold text-link underline-offset-4 hover:underline"
        >
          {t("patientApp.reports.seeCurrent")}
        </Link>
      </div>
    </AppCard>
  )
}

/** A released imaging report: the radiologist's summary and the signed file. */
function ImagingReportCard({
  group,
  focusId,
}: {
  group: ReportGroup<ImagingReportRow>
  focusId: string | null
}) {
  const { t, dmy, num } = useLocale()
  const db = useDb()
  const report = group.current
  const order = useLiveQuery(
    () => db.imagingOrders.get(report.imagingOrderId),
    [db, report.imagingOrderId]
  )
  const test = useLiveQuery(
    async () => (order ? db.labTests.get(order.testId) : undefined),
    [db, order?.testId]
  )
  const focused = focusId === report.id || focusId === report.imagingOrderId
  const { ref, flash } = useFocusRing(focused)
  return (
    <AppCard
      ref={ref}
      flash={flash}
      data-testid="app-report"
      data-report-id={report.id}
      data-kind="imaging"
      className="scroll-mt-20"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-link">
          <FileScan className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] leading-snug font-semibold" lang="en">
            {test?.name ?? t("patientApp.reports.imaging")}
            {order?.bodyPart ? `, ${order.bodyPart}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("patientApp.reports.imaging")} ·{" "}
            {t("patientApp.reports.released", {
              date: dmy(report.releasedAt!),
            })}
            {report.reportVersion > 1
              ? ` · ${t("patientApp.reports.version", { version: num(report.reportVersion) })}`
              : ""}
          </p>
        </div>
      </div>
      {report.summary ? (
        <p
          className="mt-3 rounded-xl bg-surface-raised p-3 text-[0.8125rem] leading-relaxed"
          lang="en"
        >
          {report.summary}
        </p>
      ) : null}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <FileText className="size-3.5" />
        {t("patientApp.reports.file")}
        <span lang="en" className="font-mono">
          {report.pdfName}
        </span>
        <SimulatedBadge className="h-5" />
      </p>
    </AppCard>
  )
}
