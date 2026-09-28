"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { FilePenLine, FileText, Printer, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, StatusText } from "@/components/shared/status"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { BranchCode } from "@/config/brand.config"
import { ageOn, DAY, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { now } from "@/core/clock/clock"
import { useDb } from "@/core/db/DbProvider"
import type { LabTestRow, ResultFlag, ResultRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { correctReport, TEXT_ANALYTE } from "../commands"
import { flagValue, resultText, toLatinDigits } from "../logic"
import { useLabCommand } from "./lab-feedback"
import { FlagText, PatientCell, TestChips } from "./lab-ui"
import { ReportDialog, useReportDoc } from "./report-document"
import { loadReportViews, useLabTests, type ReportView } from "./use-lab-data"

/**
 * Released reports at the branch (last 7 days): print with the QR code,
 * open the public verification page, or correct a report into a new version
 * (plan §6 `lab.correctReport`, scenario S8, HAZ-03).
 */
export function ReportsTab({ branch }: { branch: BranchCode }) {
  const { t } = useLocale()
  const db = useDb()
  const tests = useLabTests()
  const tick = useNow(60_000)
  const since = Math.floor(((tick || now()) - 7 * DAY) / 60_000) * 60_000
  const rows = useLiveQuery(async () => {
    const reports = (
      await db.labReports.where("branchId").equals(branch).toArray()
    )
      .filter(
        (r) =>
          (r.status === "released" || r.status === "superseded") &&
          (r.releasedAt ?? r.signedAt ?? r.createdAt) >= since
      )
      .sort(
        (a, b) =>
          (b.signedAt ?? b.createdAt) - (a.signedAt ?? a.createdAt) ||
          b.reportVersion - a.reportVersion
      )
      .slice(0, 60)
    return loadReportViews(db, reports)
  }, [db, branch, since])
  const [printing, setPrinting] = React.useState<string | null>(null)
  const [correcting, setCorrecting] = React.useState<string | null>(null)

  const latest = new Map<string, number>()
  for (const row of rows ?? []) {
    latest.set(
      row.report.reportNo,
      Math.max(latest.get(row.report.reportNo) ?? 0, row.report.reportVersion)
    )
  }

  return (
    <SectionCard
      size="sm"
      icon={FileText}
      title={t("lab.reports.title")}
      subtitle={t("lab.reports.subtitle")}
    >
      {rows && !rows.length ? (
        <EmptyState size="sm" icon={FileText} title={t("lab.reports.empty")} />
      ) : (
        <div className="@container/table">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("lab.report.title")}</TableHead>
                <TableHead>{t("lab.common.patient")}</TableHead>
                <TableHead className="hidden @min-[44rem]/table:table-cell">
                  {t("lab.common.tests")}
                </TableHead>
                <TableHead className="hidden @min-[36rem]/table:table-cell">
                  {t("lab.common.released")}
                </TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((row) => (
                <ReportRowView
                  key={row.report.id}
                  row={row}
                  tests={tests}
                  newerVersion={
                    row.report.status === "superseded"
                      ? (latest.get(row.report.reportNo) ??
                        row.report.reportVersion + 1)
                      : undefined
                  }
                  onPrint={() => setPrinting(row.report.id)}
                  onCorrect={() => setCorrecting(row.report.id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ReportDialog reportId={printing} onClose={() => setPrinting(null)} />
      <Dialog
        open={!!correcting}
        onOpenChange={(next) => (!next ? setCorrecting(null) : undefined)}
      >
        <DialogContent className="sm:max-w-2xl" data-testid="correct-dialog">
          {correcting ? (
            <CorrectBody
              key={correcting}
              reportId={correcting}
              tests={tests}
              onClose={() => setCorrecting(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

function ReportRowView({
  row,
  tests,
  newerVersion,
  onPrint,
  onCorrect,
}: {
  row: ReportView
  tests: Map<string, LabTestRow> | undefined
  newerVersion?: number
  onPrint: () => void
  onCorrect: () => void
}) {
  const { t, num } = useLocale()
  const { report } = row
  const superseded = report.status === "superseded"
  return (
    <TableRow
      data-testid="report-row"
      data-report-id={report.id}
      data-report-no={report.reportNo}
      data-version={report.reportVersion}
      className={cn(superseded && "opacity-60")}
    >
      <TableCell>
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-xs" lang="en">
            {report.reportNo}
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">
              {t("lab.common.version", { version: num(report.reportVersion) })}
            </span>
            {superseded ? (
              <StatusText tone="muted">
                {t("lab.reports.supersededBy", {
                  version: num(newerVersion ?? report.reportVersion + 1),
                })}
              </StatusText>
            ) : report.reportVersion > 1 ? (
              <StatusPill tone="warning" className="h-5 px-2 text-[0.6875rem]">
                {t("lab.reports.corrected")}
              </StatusPill>
            ) : null}
          </span>
        </span>
      </TableCell>
      <TableCell className="max-w-[14rem]">
        <PatientCell patient={row.patient} />
      </TableCell>
      <TableCell className="hidden whitespace-normal @min-[44rem]/table:table-cell">
        <TestChips testIds={row.items.map((i) => i.testId)} tests={tests} />
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground @min-[36rem]/table:table-cell">
        {report.releasedAt ? (
          <DateText value={report.releasedAt} variant="dmyTime" />
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1.5">
          <Link
            href={`/verify/${report.id}`}
            target="_blank"
            data-testid="report-verify"
            title={t("lab.reports.verify")}
            aria-label={t("lab.reports.verify")}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ShieldCheck />
          </Link>
          {!superseded ? (
            <>
              <Button
                variant="neutral"
                size="sm"
                data-testid="report-print"
                onClick={onPrint}
              >
                <Printer />
                <span className="hidden @min-[40rem]/table:inline">
                  {t("lab.reports.print")}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                data-testid="report-correct"
                onClick={onCorrect}
              >
                <FilePenLine />
                <span className="hidden @min-[40rem]/table:inline">
                  {t("lab.reports.correct")}
                </span>
              </Button>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

type Edit = { value: string }

/** Edit values, give a reason and a change summary, then sign the next version. */
function CorrectBody({
  reportId,
  tests,
  onClose,
}: {
  reportId: string
  tests: Map<string, LabTestRow> | undefined
  onClose: () => void
}) {
  const { t, tk, num, locale } = useLocale()
  const doc = useReportDoc(reportId)
  const correct = useLabCommand(correctReport)
  const [edits, setEdits] = React.useState<Record<string, Edit>>({})
  const [reason, setReason] = React.useState("")
  const [summary, setSummary] = React.useState("")
  const [summaryTouched, setSummaryTouched] = React.useState(false)

  if (!doc) return null
  const { report, patient } = doc
  const age = patient ? ageOn(patient.dob, dhakaDate(now())) : 40
  const rows = report.itemIds.flatMap((itemId) => {
    const item = doc.items.find((i) => i.id === itemId)
    const test = item
      ? (tests?.get(item.testId) ?? doc.tests.get(item.testId))
      : undefined
    if (!item || !test) return []
    return doc.results
      .filter((r) => r.labOrderItemId === item.id)
      .map((result) => ({
        result,
        test,
        analyte: test.analytes.find((a) => a.code === result.analyteCode),
      }))
  })

  type Change = {
    result: ResultRow
    value?: number
    text?: string
    newFlag: ResultFlag
    from: string
    to: string
    name: string
  }
  const changes: Change[] = []
  for (const { result, test, analyte } of rows) {
    const raw = edits[result.id]?.value
    if (raw === undefined || raw.trim() === "") continue
    const latin = toLatinDigits(raw).trim()
    const numeric = typeof result.value === "number"
    const decimals = analyte?.decimals ?? 2
    const name =
      analyte?.name ??
      (result.analyteCode === TEXT_ANALYTE ? test.name : result.analyteCode)
    if (numeric) {
      const n = Number(latin)
      if (!Number.isFinite(n) || n === result.value) continue
      const newFlag =
        analyte && patient
          ? flagValue(analyte, n, patient.sex, age)
          : result.flag
      changes.push({
        result,
        value: n,
        newFlag,
        name,
        from: `${resultText(result, decimals)} ${result.unit ?? ""}`.trim(),
        to: `${n.toFixed(decimals)} ${result.unit ?? ""}`.trim(),
      })
    } else {
      if (latin === result.text) continue
      const newFlag =
        analyte && patient
          ? flagValue(analyte, latin, patient.sex, age)
          : result.flag
      changes.push({
        result,
        text: latin,
        newFlag,
        name,
        from: result.text ?? "-",
        to: latin,
      })
    }
  }

  const autoSummary = changes
    .map((c) => {
      const line = t("lab.correct.autoSummary", {
        analyte: c.name,
        from: c.from,
        to: c.to,
      })
      return c.newFlag !== c.result.flag
        ? `${line} ${t("lab.correct.flagChange", {
            from: tk(`lab.flags.${c.result.flag}`),
            to: tk(`lab.flags.${c.newFlag}`),
          })}`
        : line
    })
    .join(" ")
  const summaryText = summaryTouched ? summary : autoSummary
  const canSave =
    changes.length > 0 &&
    reason.trim().length >= 3 &&
    summaryText.trim().length >= 3

  const confirm = async () => {
    if (!canSave) return
    const done = await correct.run({
      reportId: report.id,
      expectedVersion: report.version,
      reason: reason.trim(),
      changeSummary: summaryText.trim(),
      corrections: changes.map((c) =>
        c.value !== undefined
          ? { resultId: c.result.id, value: c.value }
          : { resultId: c.result.id, text: c.text }
      ),
      smsLang: locale,
    })
    if (done) {
      toast.success(
        t("lab.correct.done", {
          reportNo: report.reportNo,
          version: num(done.version),
        })
      )
      onClose()
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("lab.correct.title", { reportNo: report.reportNo })}
        </DialogTitle>
        <DialogDescription>
          {t("lab.correct.subtitle", {
            from: num(report.reportVersion),
            to: num(report.reportVersion + 1),
          })}
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[38svh] overflow-y-auto rounded-md border border-hairline">
        <table className="w-full text-[0.8125rem]">
          <thead className="sticky top-0 bg-surface-raised text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2.5 py-2 font-medium">
                {t("lab.common.analyte")}
              </th>
              <th className="px-2.5 py-2 text-right font-medium">
                {t("lab.correct.current")}
              </th>
              <th className="px-2.5 py-2 font-medium">
                {t("lab.correct.corrected")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ result, test, analyte }) => {
              const change = changes.find((c) => c.result.id === result.id)
              return (
                <tr key={result.id} className="border-t border-hairline">
                  <td className="px-2.5 py-1.5">
                    <span className="font-medium">
                      {analyte?.name ?? test.name}
                    </span>{" "}
                    <span
                      className="font-mono text-[0.6875rem] text-muted-foreground"
                      lang="en"
                    >
                      {test.code}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                    <span className="font-mono" lang="en">
                      {resultText(result, analyte?.decimals ?? 2)}
                    </span>{" "}
                    <span className="text-xs text-muted-foreground" lang="en">
                      {result.unit}
                    </span>{" "}
                    <FlagText flag={result.flag} />
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className="flex items-center gap-2">
                      <Input
                        className="h-8 w-28"
                        data-testid="correct-value"
                        data-result-id={result.id}
                        data-analyte={result.analyteCode}
                        inputMode={
                          typeof result.value === "number" ? "decimal" : "text"
                        }
                        value={edits[result.id]?.value ?? ""}
                        onChange={(event) =>
                          setEdits((current) => ({
                            ...current,
                            [result.id]: { value: event.target.value },
                          }))
                        }
                      />
                      {change ? <FlagText flag={change.newFlag} /> : null}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="correct-reason">{t("lab.correct.reason")}</Label>
          <Input
            id="correct-reason"
            data-testid="correct-reason"
            value={reason}
            maxLength={300}
            placeholder={t("lab.correct.reasonPlaceholder")}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="correct-summary">{t("lab.correct.summary")}</Label>
          <Textarea
            id="correct-summary"
            data-testid="correct-summary"
            className="min-h-16"
            value={summaryText}
            maxLength={600}
            onChange={(event) => {
              setSummaryTouched(true)
              setSummary(event.target.value)
            }}
          />
          <p className="text-[0.6875rem] text-muted-foreground">
            {t("lab.correct.summaryHint")}
          </p>
        </div>
      </div>
      <DialogFooter>
        <span className="mr-auto self-center text-xs text-muted-foreground">
          {!changes.length
            ? t("lab.correct.noChange")
            : !canSave
              ? t("lab.correct.needReason")
              : null}
        </span>
        <Button variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          data-testid="correct-confirm"
          disabled={!canSave || correct.pending}
          onClick={confirm}
        >
          <FilePenLine />
          {t("lab.correct.confirm", { version: num(report.reportVersion + 1) })}
        </Button>
      </DialogFooter>
    </>
  )
}
