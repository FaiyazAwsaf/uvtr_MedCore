"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { ExternalLink, Printer } from "lucide-react"

import { PrintLayout } from "@/components/shared/print-layout"
import { QrCode } from "@/components/shared/qr-code"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ageOn, dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import type {
  LabOrderItemRow,
  LabOrderRow,
  LabReportRow,
  LabTestRow,
  PatientRow,
  ResultRow,
  SpecimenRow,
  StaffRow,
} from "@/core/db/schema"
import { rangeFor } from "@/core/seed/content/analyser-scripts"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { TEXT_ANALYTE } from "../commands"
import { formatRange, resultText } from "../logic"

export type ReportDoc = {
  report: LabReportRow
  previous?: LabReportRow
  patient?: PatientRow
  order?: LabOrderRow
  doctor?: StaffRow
  signer?: StaffRow
  items: LabOrderItemRow[]
  tests: Map<string, LabTestRow>
  results: ResultRow[]
  specimens: SpecimenRow[]
}

export async function loadReportDoc(
  db: MedcoreDb,
  reportId: string
): Promise<ReportDoc | null> {
  const report = await db.labReports.get(reportId)
  if (!report) return null
  const previous = report.supersedesId
    ? await db.labReports.get(report.supersedesId)
    : undefined
  const patient = await db.patients.get(report.patientId)
  const order = await db.labOrders.get(report.labOrderId)
  const doctorRow = order?.doctorId
    ? await db.doctors.get(order.doctorId)
    : undefined
  const doctor = doctorRow ? await db.staff.get(doctorRow.staffId) : undefined
  const signer = report.signedBy
    ? await db.staff.get(report.signedBy)
    : undefined
  const items = (await db.labOrderItems.bulkGet(report.itemIds)).filter(
    Boolean
  ) as LabOrderItemRow[]
  const testRows = (
    await db.labTests.bulkGet([...new Set(items.map((i) => i.testId))])
  ).filter(Boolean) as LabTestRow[]
  const results = report.itemIds.length
    ? await db.results.where("labOrderItemId").anyOf(report.itemIds).toArray()
    : []
  const specimenIds = [
    ...new Set(items.map((i) => i.specimenId).filter(Boolean) as string[]),
  ]
  const specimens = (await db.specimens.bulkGet(specimenIds)).filter(
    Boolean
  ) as SpecimenRow[]
  return {
    report,
    previous,
    patient,
    order,
    doctor,
    signer,
    items,
    tests: new Map(testRows.map((t) => [t.id, t])),
    results,
    specimens,
  }
}

export function useReportDoc(
  reportId: string | null | undefined
): ReportDoc | null | undefined {
  const db = useDb()
  return useLiveQuery(
    async () => (reportId ? loadReportDoc(db, reportId) : null),
    [db, reportId]
  )
}

/** Absolute link to the public verification page (the QR code's content). */
export function verifyUrl(reportId: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  return `${origin}/verify/${reportId}`
}

const PAPER_FLAG: Record<string, string> = {
  H: "font-bold",
  L: "font-bold",
  A: "font-bold",
  HH: "font-bold text-[#c00000]",
  LL: "font-bold text-[#c00000]",
}

/**
 * The printed laboratory report (A4, never themed): hospital brand, patient,
 * UHID, age and sex, each test's values with units, flags and reference
 * ranges, the signatory, the version (with a "Corrected" banner and change
 * summary on a new version) and a QR code to the public verification page.
 */
export function ReportDocument({ doc }: { doc: ReportDoc }) {
  const { t, locale, dmy, time, num } = useLocale()
  const { report, patient, order } = doc
  const signedAt = report.signedAt ?? report.createdAt
  const age = patient ? ageOn(patient.dob, dhakaDate(signedAt)) : undefined
  const collected = doc.specimens
    .map((s) => s.collectedAt)
    .filter(Boolean) as number[]
  const received = doc.specimens
    .map((s) => s.receivedAt)
    .filter(Boolean) as number[]
  const when = (ms?: number) => (ms ? `${dmy(ms)} ${time(ms)}` : "-")
  const corrected = report.reportVersion > 1
  const released =
    report.status === "released" || report.status === "superseded"

  const facts: [string, React.ReactNode][] = [
    [
      t("lab.report.patient"),
      patient ? (
        <span>
          <span className="font-semibold">{patient.nameEn}</span>
          {locale === "bn" ? (
            <span className="ml-1.5">{patient.nameBn}</span>
          ) : null}
        </span>
      ) : (
        "-"
      ),
    ],
    [
      t("common.uhid"),
      <span key="uhid" className="font-mono">
        {patient?.uhid ?? "-"}
      </span>,
    ],
    [
      t("lab.report.ageSex"),
      patient && age !== undefined
        ? `${t("common.years", { count: num(age) })} / ${t(`common.sexLong.${patient.sex}`)}`
        : "-",
    ],
    [
      t("lab.report.referredBy"),
      doc.doctor
        ? locale === "bn"
          ? doc.doctor.nameBn
          : doc.doctor.nameEn
        : t("lab.report.selfReferred"),
    ],
    [
      t("lab.common.orderNo"),
      <span key="order" className="font-mono">
        {order?.orderNo ?? "-"}
      </span>,
    ],
    [
      t("lab.report.specimen"),
      <span key="acc" className="font-mono">
        {doc.specimens.map((s) => s.accessionNo).join(", ") || "-"}
      </span>,
    ],
    [
      t("lab.report.collected"),
      when(collected.length ? Math.min(...collected) : undefined),
    ],
    [
      t("lab.report.received"),
      when(received.length ? Math.max(...received) : undefined),
    ],
    [t("lab.report.reported"), when(report.signedAt)],
    [t("lab.report.released"), when(report.releasedAt)],
  ]

  return (
    <PrintLayout
      size="A4"
      branch={report.branchId}
      title={corrected ? t("lab.report.corrected") : t("lab.report.title")}
      docNo={report.reportNo}
      meta={
        <span>
          {t("lab.report.version", { version: num(report.reportVersion) })}
          {" · "}
          {when(report.signedAt)}
        </span>
      }
      footer={
        <span>
          <span className="font-mono">{report.reportNo}</span> ·{" "}
          {t("lab.common.version", { version: num(report.reportVersion) })}
        </span>
      }
      className="text-[#111]"
    >
      <div
        data-testid="report-sheet"
        data-report-id={report.id}
        data-version={report.reportVersion}
      >
        {corrected ? (
          <div
            className="mb-4 rounded-sm border-2 border-[#c00000] px-3 py-2 text-[0.75rem]"
            data-testid="report-corrected-banner"
          >
            <div className="text-[0.8125rem] font-bold tracking-wide text-[#c00000] uppercase">
              {t("lab.report.corrected")}
            </div>
            <div>
              {t("lab.report.correctedBanner", {
                from: num(report.reportVersion - 1),
                date: doc.previous?.signedAt ? dmy(doc.previous.signedAt) : "-",
              })}
            </div>
            {report.correctionReason ? (
              <div>
                <span className="font-semibold">{t("lab.report.reason")}:</span>{" "}
                {report.correctionReason}
              </div>
            ) : null}
            {report.changeSummary ? (
              <div>
                <span className="font-semibold">{t("lab.report.change")}:</span>{" "}
                {report.changeSummary}
              </div>
            ) : null}
          </div>
        ) : null}
        {!released ? (
          <div className="mb-4 rounded-sm bg-[#f1f1f1] px-3 py-1.5 text-center text-[0.75rem] font-semibold">
            {t("lab.report.heldWatermark")}
          </div>
        ) : null}

        <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1 text-[0.75rem]">
          {facts.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="w-24 shrink-0 text-[#555]">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-4">
          {report.itemIds.map((itemId) => {
            const item = doc.items.find((i) => i.id === itemId)
            const test = item ? doc.tests.get(item.testId) : undefined
            if (!item || !test) return null
            const results = doc.results.filter(
              (r) => r.labOrderItemId === item.id
            )
            const byCode = new Map(results.map((r) => [r.analyteCode, r]))
            const analytes = test.analytes.length
              ? test.analytes
              : [
                  {
                    code: TEXT_ANALYTE,
                    name: test.name,
                    decimals: 0,
                    ranges: [],
                    units: undefined,
                  },
                ]
            return (
              <section key={item.id} className="break-inside-avoid">
                <h3 className="mb-1 flex items-baseline gap-2 border-b border-[#c9c9c9] pb-0.5 text-[0.8125rem] font-bold">
                  {test.name}
                  <span className="font-mono text-[0.6875rem] font-normal text-[#555]">
                    {test.code}
                  </span>
                  {test.method ? (
                    <span className="ml-auto text-[0.625rem] font-normal text-[#555]">
                      {t("lab.report.method", { method: test.method })}
                    </span>
                  ) : null}
                </h3>
                <table className="w-full text-[0.75rem]">
                  <thead>
                    <tr className="text-left text-[0.6875rem] text-[#555]">
                      <th className="py-0.5 font-medium">
                        {t("lab.common.analyte")}
                      </th>
                      <th className="py-0.5 text-right font-medium">
                        {t("lab.common.result")}
                      </th>
                      <th className="w-10 py-0.5 pl-2 font-medium">
                        {t("lab.common.flag")}
                      </th>
                      <th className="py-0.5 font-medium">
                        {t("lab.common.unit")}
                      </th>
                      <th className="py-0.5 font-medium">
                        {t("lab.common.range")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytes.map((analyte) => {
                      const result = byCode.get(analyte.code)
                      const range =
                        patient && analyte.ranges.length
                          ? rangeFor(analyte, patient.sex, age ?? 40)
                          : undefined
                      const flag = result?.flag ?? "N"
                      const text = analyte.code === TEXT_ANALYTE
                      return (
                        <tr
                          key={analyte.code}
                          className="border-b border-[#eeeeee] align-top"
                        >
                          <td className="py-0.5 pr-2">
                            {text ? "" : analyte.name}
                          </td>
                          <td
                            className={cn(
                              "py-0.5 text-right tabular-nums",
                              text
                                ? "text-left whitespace-pre-wrap"
                                : "font-mono",
                              PAPER_FLAG[flag]
                            )}
                            colSpan={text ? 4 : 1}
                          >
                            {result
                              ? resultText(result, analyte.decimals)
                              : "-"}
                          </td>
                          {text ? null : (
                            <>
                              <td
                                className={cn(
                                  "py-0.5 pl-2 font-mono",
                                  PAPER_FLAG[flag]
                                )}
                              >
                                {flag === "N" ? "" : flag}
                              </td>
                              <td className="py-0.5 font-mono text-[0.6875rem]">
                                {analyte.units ?? ""}
                              </td>
                              <td className="py-0.5 font-mono text-[0.6875rem]">
                                {formatRange(range, analyte.decimals)}
                              </td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            )
          })}
        </div>

        <p className="mt-3 text-[0.625rem] text-[#555]">
          {t("lab.report.legend")}
        </p>

        <div className="mt-6 flex break-inside-avoid items-end justify-between gap-6">
          <div className="text-[0.75rem]">
            <div className="text-[0.6875rem] text-[#555]">
              {t("lab.report.signedBy")}
            </div>
            <div className="text-[0.875rem] font-bold">
              {doc.signer
                ? locale === "bn"
                  ? doc.signer.nameBn
                  : doc.signer.nameEn
                : "-"}
            </div>
            {doc.signer ? (
              <div>
                {doc.signer.designation[locale]}
                {doc.signer.regNo
                  ? ` · ${doc.signer.regBody ?? "BMDC"} ${doc.signer.regNo}`
                  : ""}
              </div>
            ) : null}
            <div className="text-[#555]">{when(report.signedAt)}</div>
            <div className="mt-3 max-w-[26rem]">
              <div className="text-[0.625rem] text-[#555]">
                {t("lab.report.hash")}
              </div>
              <div
                className="font-mono text-[0.625rem] break-all"
                data-testid="report-hash"
              >
                {report.hash ?? "-"}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1 text-center">
            <QrCode
              value={verifyUrl(report.id)}
              size={92}
              plate={false}
              title={t("lab.report.verify")}
            />
            <span className="max-w-[8rem] text-[0.625rem] text-[#555]">
              {t("lab.report.verify")}
            </span>
          </div>
        </div>
        <p className="mt-4 text-center text-[0.625rem] tracking-widest text-[#555] uppercase">
          {t("lab.report.end")}
        </p>
      </div>
    </PrintLayout>
  )
}

/** The report in a wide dialog with Print and a link to the verification page. */
export function ReportDialog({
  reportId,
  onClose,
}: {
  reportId: string | null
  onClose: () => void
}) {
  const { t } = useLocale()
  const doc = useReportDoc(reportId)
  return (
    <Dialog
      open={!!reportId}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <DialogContent
        className="gap-4 sm:max-w-[calc(210mm+3.5rem)]"
        data-testid="report-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {doc
              ? t("lab.report.dialogTitle", { reportNo: doc.report.reportNo })
              : t("common.loading")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("lab.report.title")}
          </DialogDescription>
          {doc ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                data-testid="report-print-now"
                onClick={() => window.print()}
              >
                <Printer />
                {t("lab.report.printNow")}
              </Button>
              <Link
                href={`/verify/${doc.report.id}`}
                target="_blank"
                className={buttonVariants({ variant: "neutral", size: "sm" })}
                data-testid="report-verify-link"
              >
                <ExternalLink />
                {t("lab.report.openVerify")}
              </Link>
            </div>
          ) : null}
        </DialogHeader>
        <div className="-mx-2 overflow-x-auto px-2 pb-2">
          {doc ? <ReportDocument doc={doc} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
