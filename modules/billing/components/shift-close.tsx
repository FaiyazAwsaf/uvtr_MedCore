"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CircleAlert,
  Coins,
  Eraser,
  FileText,
  LoaderCircle,
  Lock,
  Printer,
  ShieldCheck,
} from "lucide-react"

import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText, type Tone } from "@/components/shared/status"
import { useSupervisorOverride } from "@/components/shared/supervisor-override-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { getBranch } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { now } from "@/core/clock/clock"
import { useDb } from "@/core/db/DbProvider"
import { newId } from "@/core/db/ids"
import type { ShiftRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { closeShift } from "../commands"
import { shiftReport, type ShiftReport, type ShiftSummary } from "../queries"
import { APPROVAL_AUTHORITY } from "../refunds"
import { countedFrom, DENOMINATIONS, SMALL_DENOMINATIONS } from "../shift"
import { useBillingCommand, useProblemText } from "./use-billing-command"

const NOTE_VALUES = DENOMINATIONS.filter(
  (value) => !SMALL_DENOMINATIONS.includes(value)
)

function toneOf(varianceP: number): Tone {
  if (varianceP === 0) return "success"
  return Math.abs(varianceP) > rules.cashVarianceThresholdP
    ? "destructive"
    : "warning"
}

/**
 * Closing the shift (plan §9, S13): the cashier counts the drawer note by
 * note, the counted total and the variance against the expected cash update
 * as they type, and the close goes through directly within ±৳500 or with a
 * supervisor's inline approval beyond it. The command re-checks everything.
 */
export function CloseShiftCard({
  shift,
  summary,
}: {
  shift: ShiftRow
  summary: ShiftSummary
}) {
  const { t, money } = useLocale()
  const override = useSupervisorOverride()
  const problemText = useProblemText()
  const close = useBillingCommand(closeShift)
  const [counts, setCounts] = React.useState<Record<string, string>>({})
  const [idempotencyKey, setIdempotencyKey] = React.useState(() =>
    newId("close")
  )

  const parsed: Record<string, number> = {}
  for (const [value, text] of Object.entries(counts)) {
    const count = Number(text.replace(/[^\d]/g, ""))
    if (count > 0) parsed[value] = count
  }
  const countedP = countedFrom(parsed)
  const expectedP = summary.expectedCashP
  const varianceP = countedP - expectedP
  const needsApproval = Math.abs(varianceP) > rules.cashVarianceThresholdP
  const limit = money(rules.cashVarianceThresholdP)

  const submit = async () => {
    if (countedP === 0 || close.pending) return
    let approval:
      { approverStaffId: string; reason: string; pinVerified: true } | undefined
    if (needsApproval) {
      const granted = await override.request({
        authority: APPROVAL_AUTHORITY.variance,
        title: t("billing.shift.close.approvalTitle"),
        description: t("billing.shift.close.approvalBody", {
          counted: money(countedP),
          expected: money(expectedP),
          variance: money(varianceP),
        }),
      })
      if (!granted) return
      approval = {
        approverStaffId: granted.approverStaffId,
        reason: granted.reason,
        pinVerified: true,
      }
    }
    const result = await close.run({
      shiftId: shift.id,
      denominations: parsed,
      approval,
      idempotencyKey,
    })
    if (!result) setIdempotencyKey(newId("close"))
  }

  const field = (value: number) => (
    <label
      key={value}
      className="flex items-center gap-2 rounded-md bg-surface-raised/60 px-2.5 py-1.5 dark:bg-surface-raised/45"
    >
      <span className="w-14 shrink-0 text-[0.8125rem] font-semibold tabular-nums">
        {money(value * 100)}
      </span>
      <span className="text-xs text-muted-foreground">×</span>
      <Input
        inputMode="numeric"
        aria-label={t("billing.shift.close.countOf", {
          value: money(value * 100),
        })}
        data-testid="shift-count"
        data-denomination={value}
        value={counts[String(value)] ?? ""}
        onChange={(event) =>
          setCounts((current) => ({
            ...current,
            [String(value)]: event.target.value
              .replace(/[^\d]/g, "")
              .slice(0, 5),
          }))
        }
        placeholder="0"
        className="nums h-8 min-w-0 flex-1 text-right"
      />
    </label>
  )

  return (
    <SectionCard
      title={t("billing.shift.close.title")}
      subtitle={t("billing.shift.close.subtitle")}
      icon={Coins}
      size="sm"
      action={
        countedP > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCounts({})}
          >
            <Eraser />
            {t("billing.shift.close.clear")}
          </Button>
        ) : undefined
      }
    >
      <div
        className="@container/count flex flex-col gap-3"
        data-testid="shift-close-card"
      >
        <div className="flex flex-col gap-1.5">
          <span className="micro">{t("billing.shift.close.notes")}</span>
          <div className="grid grid-cols-2 gap-1.5 @min-[34rem]/count:grid-cols-4 @min-[48rem]/count:grid-cols-7">
            {NOTE_VALUES.map(field)}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="micro">{t("billing.shift.close.small")}</span>
          <div className="grid grid-cols-2 gap-1.5 @min-[34rem]/count:grid-cols-4 @min-[48rem]/count:grid-cols-7">
            {SMALL_DENOMINATIONS.map(field)}
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 rounded-md bg-primary-soft px-3 py-2.5">
          <div
            className="min-w-0"
            data-testid="shift-counted"
            data-counted={countedP}
          >
            <dt className="text-xs text-muted-foreground">
              {t("billing.shift.close.counted")}
            </dt>
            <dd>
              <MoneyText
                poisha={countedP}
                className="text-base font-semibold"
              />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              {t("billing.shift.close.expected")}
            </dt>
            <dd>
              <MoneyText
                poisha={expectedP}
                className="text-base font-semibold"
              />
            </dd>
          </div>
          <div
            className="min-w-0"
            data-testid="shift-variance"
            data-variance={varianceP}
          >
            <dt className="text-xs text-muted-foreground">
              {t("billing.shift.close.variance")}
            </dt>
            <dd>
              <StatusText
                tone={countedP ? toneOf(varianceP) : "muted"}
                className="text-base"
              >
                {varianceP > 0 ? "+" : ""}
                {money(varianceP)}
              </StatusText>
            </dd>
          </div>
        </dl>
        {close.problem ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{problemText(close.problem)}</AlertDescription>
          </Alert>
        ) : null}

        {/* The action sits at the right: the presenter's cue card covers the bottom-left corner. */}
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {countedP > 0 ? (
            <p className="flex min-w-0 flex-1 basis-56 items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  needsApproval ? "text-destructive" : "text-success"
                )}
              />
              {needsApproval
                ? t("billing.shift.close.above", { limit })
                : t("billing.shift.close.within", { limit })}
            </p>
          ) : null}
          <Button
            type="button"
            data-testid="shift-close"
            data-needs-approval={needsApproval}
            variant={needsApproval ? "destructive" : "default"}
            disabled={countedP === 0 || close.pending}
            onClick={() => void submit()}
          >
            {close.pending ? (
              <LoaderCircle className="animate-spin" />
            ) : needsApproval ? (
              <ShieldCheck />
            ) : (
              <Lock />
            )}
            {close.pending
              ? t("billing.shift.close.working")
              : needsApproval
                ? t("billing.shift.close.approveButton")
                : t("billing.shift.close.button")}
          </Button>
        </div>
      </div>
      {override.dialog}
    </SectionCard>
  )
}

/** The last closed shift, locked, with its figures and the Z-report. */
export function ClosedShiftCard({ shift }: { shift: ShiftRow }) {
  const db = useDb()
  const { t, dmy, time, locale } = useLocale()
  const [open, setOpen] = React.useState(false)
  const report = useLiveQuery(() => shiftReport(db, shift, now()), [db, shift])
  const varianceP = shift.varianceP ?? 0
  return (
    <section
      data-testid="shift-locked"
      data-shift-id={shift.id}
      data-status={shift.status}
      className="surface-card flex flex-col gap-4 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="icon-well flex size-10 items-center justify-center text-muted-foreground">
            <Lock className="size-5" />
          </span>
          <div>
            <h2 className="text-[1.0625rem] font-semibold">
              {t("billing.shift.closed.title")}
            </h2>
            <p className="text-[0.8125rem] text-muted-foreground">
              {shift.closedAt
                ? t("billing.shift.closed.body", {
                    date: dmy(shift.closedAt),
                    time: time(shift.closedAt),
                  })
                : null}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="shift-z-report"
          disabled={!report}
          onClick={() => setOpen(true)}
        >
          <FileText />
          {t("billing.shift.closed.zReport")}
        </Button>
      </div>
      <KeyValueGrid
        columns={4}
        items={[
          {
            label: t("billing.shift.close.expected"),
            value: <MoneyText poisha={shift.expectedP ?? 0} />,
          },
          {
            label: t("billing.shift.close.counted"),
            value: <MoneyText poisha={shift.countedP ?? 0} />,
          },
          {
            label: t("billing.shift.close.variance"),
            value: (
              <StatusText
                tone={toneOf(varianceP)}
                data-testid="shift-locked-variance"
                data-variance={varianceP}
              >
                {varianceP > 0 ? "+" : ""}
                <MoneyText poisha={varianceP} />
              </StatusText>
            ),
          },
          {
            label: t("billing.shift.z.approvedBy"),
            value: report?.approver ? report.approver[locale] : "-",
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {t("billing.shift.closed.openNew")}
      </p>
      {report && open ? (
        <ZReportDialog report={report} onClose={() => setOpen(false)} />
      ) : null}
    </section>
  )
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: React.ReactNode
  value: React.ReactNode
  strong?: boolean
}) {
  return (
    <div className={cn("flex justify-between gap-2", strong && "font-bold")}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

/**
 * The printed Z-report (80 mm roll): shift times, float, cash taken and
 * refunded, expected against counted and the variance with its approver,
 * takings and refunds by tender, the drawer count, and signature lines.
 */
export function ZReportSheet({ report }: { report: ShiftReport }) {
  const { t, tk, money, num, dmy, time, locale } = useLocale()
  const { shift } = report
  const branch = getBranch(shift.branchId)
  const tenders = ["cash", "card", "bkash", "nagad", "corporate"] as const
  const refundTenders = tenders.filter(
    (tender) => report.refundsByTender[tender] > 0
  )
  const denominations = DENOMINATIONS.filter(
    (value) => (shift.denominations?.[String(value)] ?? 0) > 0
  )
  const stamp = (at?: number) => (at ? `${dmy(at)} ${time(at)}` : "-")
  return (
    <PrintLayout
      size="receipt"
      branch={shift.branchId}
      title={t("billing.shift.z.title")}
      docNo={shift.id}
      meta={stamp(shift.closedAt)}
    >
      <div className="flex flex-col gap-2" data-testid="z-report">
        <div className="flex flex-col gap-0.5">
          <Row
            label={t("billing.shift.z.branch")}
            value={`${branch.name[locale]} (${branch.code})`}
          />
          <Row
            label={t("billing.shift.z.cashier")}
            value={report.cashier?.[locale] ?? shift.cashierId}
          />
          <Row
            label={t("billing.shift.z.opened")}
            value={stamp(shift.openedAt)}
          />
          <Row
            label={t("billing.shift.z.closed")}
            value={stamp(shift.closedAt)}
          />
        </div>
        <div className="flex flex-col gap-0.5 border-y border-dashed border-[#999] py-1.5">
          <Row label={t("billing.shift.z.float")} value={money(shift.floatP)} />
          <Row
            label={t("billing.shift.z.cashIn")}
            value={money(report.cashInP)}
          />
          <Row
            label={t("billing.shift.z.cashRefunds")}
            value={money(-report.cashRefundsP)}
          />
          <Row
            label={t("billing.shift.z.expected")}
            value={money(shift.expectedP ?? report.expectedCashP)}
            strong
          />
          <Row
            label={t("billing.shift.z.counted")}
            value={money(shift.countedP ?? 0)}
            strong
          />
          <Row
            label={t("billing.shift.z.variance")}
            value={money(shift.varianceP ?? 0)}
            strong
          />
          {report.approver ? (
            <>
              <Row
                label={t("billing.shift.z.approvedBy")}
                value={report.approver[locale]}
              />
              {report.approval?.reason ? (
                <div className="text-[#555]">
                  {t("billing.shift.z.reason")}: {report.approval.reason}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div>
          <div className="pb-1 font-semibold">
            {t("billing.shift.z.byTender")}
          </div>
          {tenders.map((tender) => (
            <Row
              key={tender}
              label={tk(`billing.tender.${tender}`)}
              value={money(report.byTender[tender])}
            />
          ))}
          <div className="text-[#555]">
            {t("billing.shift.z.payments", {
              count: num(
                Object.values(report.counts).reduce(
                  (sum, n) => sum + (n ?? 0),
                  0
                )
              ),
            })}
          </div>
        </div>
        <div className="border-t border-dashed border-[#999] pt-1.5">
          <div className="pb-1 font-semibold">
            {t("billing.shift.z.refunds")}
          </div>
          {refundTenders.length ? (
            refundTenders.map((tender) => (
              <Row
                key={tender}
                label={tk(`billing.tender.${tender}`)}
                value={money(report.refundsByTender[tender])}
              />
            ))
          ) : (
            <div className="text-[#555]">{t("billing.shift.z.noRefunds")}</div>
          )}
        </div>
        {denominations.length ? (
          <div className="border-t border-dashed border-[#999] pt-1.5">
            <div className="pb-1 font-semibold">
              {t("billing.shift.z.denominations")}
            </div>
            {denominations.map((value) => {
              const count = shift.denominations?.[String(value)] ?? 0
              return (
                <Row
                  key={value}
                  label={`${money(value * 100)} × ${num(count)}`}
                  value={money(value * 100 * count)}
                />
              )
            })}
          </div>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-4 text-center text-[#555]">
          <div className="border-t border-[#999] pt-1">
            {t("billing.shift.z.cashierSign")}
          </div>
          <div className="border-t border-[#999] pt-1">
            {t("billing.shift.z.supervisorSign")}
          </div>
        </div>
      </div>
    </PrintLayout>
  )
}

function ZReportDialog({
  report,
  onClose,
}: {
  report: ShiftReport
  onClose: () => void
}) {
  const { t } = useLocale()
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-104" data-testid="z-report-dialog">
        <DialogHeader>
          <DialogTitle>{t("billing.shift.closed.zReport")}</DialogTitle>
          <DialogDescription>
            {t("billing.shift.z.previewBody")}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-2 max-h-[60svh] overflow-y-auto rounded-md bg-surface-raised p-3">
          <ZReportSheet report={report} />
        </div>
        <DialogFooter>
          <Button type="button" variant="neutral" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button type="button" onClick={() => window.print()}>
            <Printer />
            {t("common.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
