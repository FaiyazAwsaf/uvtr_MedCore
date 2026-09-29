"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CalendarX2,
  CircleAlert,
  History,
  LoaderCircle,
  ReceiptText,
  Search,
  Store,
  Undo2,
  X,
} from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { MoneyText } from "@/components/shared/money-text"
import { PatientPicker } from "@/components/shared/patient-picker"
import { nameIn } from "@/components/shared/person"
import { SectionCard } from "@/components/shared/section-card"
import { useSupervisorOverride } from "@/components/shared/supervisor-override-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { getBranch, type BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import { newId } from "@/core/db/ids"
import type { Id } from "@/core/db/schema"
import { usePersona } from "@/core/session/persona"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { refund } from "../commands"
import {
  invoiceByNo,
  paidInvoicesOf,
  refundRequestsAt,
  refundsTodayAt,
  refundView,
  type RefundInvoiceView,
  type RefundLineView,
  type RefundRequest,
} from "../queries"
import type { RefundOutcome } from "../refund-tx"
import { APPROVAL_AUTHORITY, refundApproval } from "../refunds"
import { TENDER_TAG } from "./labels"
import { RefundDialog, RefundDone, type RefundMode } from "./refund-dialog"
import { RefundInvoiceCard } from "./refund-invoice"
import { useBillingCommand, useProblemText } from "./use-billing-command"

type Target = {
  view: RefundInvoiceView
  line: RefundLineView
  mode: RefundMode
}

/**
 * `/cashier/refunds` (plan §9): find a patient or an invoice, see each paid
 * line with the stage of its work and what cancelling it will do, cancel or
 * refund to the original tender, and pay back the "refund requested" list
 * (appointments cancelled after a doctor delay). The selection lives in the
 * address (`?patient=`, `?invoice=`, `&focus=`), so launchers and reloads
 * land on the same bill.
 */
export function RefundsScreen() {
  const persona = usePersona()
  const { t } = useLocale()
  const branch = persona?.branchId
  if (!branch || !persona?.staff) {
    return <EmptyState icon={Store} title={t("billing.rules.NO_BRANCH")} />
  }
  return <RefundsWorkspace branch={branch} />
}

function RefundsWorkspace({ branch }: { branch: BranchCode }) {
  const { t, locale } = useLocale()
  const searchParams = useSearchParams()
  const patientId = searchParams.get("patient")
  const invoiceId = searchParams.get("invoice")
  const focus = searchParams.get("focus")
  const [target, setTarget] = React.useState<Target | null>(null)
  const nowMs = useNow(60_000)
  const today = dhakaDate(nowMs || now())
  const branchRow = getBranch(branch)

  const go = React.useCallback(
    (params: { patient?: Id; invoice?: Id } | null) => {
      const url = new URL(window.location.href)
      url.search = ""
      if (params?.patient) url.searchParams.set("patient", params.patient)
      if (params?.invoice) url.searchParams.set("invoice", params.invoice)
      window.history.replaceState(null, "", `${url.pathname}${url.search}`)
    },
    []
  )

  const onAction =
    (view: RefundInvoiceView) => (line: RefundLineView, mode: RefundMode) =>
      setTarget({ view, line, mode })

  return (
    <div
      className="@container/refunds flex flex-col gap-4 pb-2"
      data-testid="refunds-screen"
    >
      <header className="min-w-0">
        <h1 className="text-[1.375rem] leading-tight font-semibold">
          {t("billing.refunds.title")}
        </h1>
        <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
          {t("billing.refunds.subtitle", {
            branch: `${branchRow.name[locale]} (${branchRow.code})`,
          })}
        </p>
      </header>

      <div className="grid items-start gap-4 @min-[52rem]/refunds:grid-cols-[minmax(0,1fr)_19rem] @min-[90rem]/refunds:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {invoiceId ? (
            <InvoiceFocus
              key={invoiceId}
              invoiceId={invoiceId}
              onChange={() => go(null)}
              onAction={onAction}
            />
          ) : patientId ? (
            <PatientRefunds
              key={patientId}
              patientId={patientId}
              branch={branch}
              focus={focus}
              onChange={() => go(null)}
              onAction={onAction}
            />
          ) : (
            <RefundFinder
              branch={branch}
              onPatient={(id) => go({ patient: id })}
              onInvoice={(id) => go({ invoice: id })}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <RefundRequestsCard branch={branch} />
          <RefundsTodayCard
            branch={branch}
            today={today}
            onOpen={(id) => go({ invoice: id })}
          />
        </div>
      </div>

      {target ? (
        <RefundDialog
          key={`${target.line.line.id}:${target.mode}`}
          view={target.view}
          line={target.line}
          initialMode={target.mode}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </div>
  )
}

function ChangeButton({ onClick }: { onClick: () => void }) {
  const { t } = useLocale()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="refunds-change"
      onClick={onClick}
    >
      <X />
      {t("billing.refunds.change")}
    </Button>
  )
}

function RefundFinder({
  branch,
  onPatient,
  onInvoice,
}: {
  branch: BranchCode
  onPatient: (patientId: Id) => void
  onInvoice: (invoiceId: Id) => void
}) {
  const db = useDb()
  const { t } = useLocale()
  const [invoiceNo, setInvoiceNo] = React.useState("")
  const [missing, setMissing] = React.useState<string | null>(null)
  return (
    <SectionCard
      title={t("billing.refunds.find.title")}
      subtitle={t("billing.refunds.find.hint")}
      icon={Search}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <div data-testid="refunds-search">
          <PatientPicker onSelect={(patient) => onPatient(patient.id)} />
        </div>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={async (event) => {
            event.preventDefault()
            const query = invoiceNo.trim()
            if (!query) return
            const invoice = await invoiceByNo(db, query, branch)
            if (invoice) onInvoice(invoice.id)
            else setMissing(query)
          }}
        >
          <label
            htmlFor="refund-invoice-no"
            className="text-[0.8125rem] font-medium"
          >
            {t("billing.refunds.find.invoiceLabel")}
          </label>
          <div className="flex gap-2">
            <Input
              id="refund-invoice-no"
              data-testid="refunds-invoice-no"
              lang="en"
              value={invoiceNo}
              onChange={(event) => {
                setInvoiceNo(event.target.value)
                setMissing(null)
              }}
              placeholder="C1-B1-2627-000123"
              className="font-mono"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!invoiceNo.trim()}
            >
              {t("billing.refunds.find.invoiceGo")}
            </Button>
          </div>
          {missing ? (
            <p className="text-xs text-destructive">
              {t("billing.refunds.find.invoiceMissing", { invoiceNo: missing })}
            </p>
          ) : null}
        </form>
      </div>
    </SectionCard>
  )
}

function PatientRefunds({
  patientId,
  branch,
  focus,
  onChange,
  onAction,
}: {
  patientId: Id
  branch: BranchCode
  focus: string | null
  onChange: () => void
  onAction: (
    view: RefundInvoiceView
  ) => (line: RefundLineView, mode: RefundMode) => void
}) {
  const db = useDb()
  const { t } = useLocale()
  const patient = useLiveQuery(
    async () => (await db.patients.get(patientId)) ?? null,
    [db, patientId]
  )
  const views = useLiveQuery(
    () => paidInvoicesOf(db, patientId, branch),
    [db, patientId, branch]
  )
  if (patient === undefined)
    return <Skeleton className="h-40 w-full rounded-lg" />
  if (patient === null) {
    return (
      <EmptyState
        icon={X}
        title={t("billing.cashier.patient.missing")}
        action={{ label: t("billing.refunds.change"), onClick: onChange }}
      />
    )
  }
  return (
    <>
      <div data-testid="refunds-patient" data-patient-id={patient.id}>
        <IdentityBanner
          patient={patient}
          compact
          actions={<ChangeButton onClick={onChange} />}
        />
      </div>
      <h2 className="micro -mb-2">{t("billing.refunds.bills")}</h2>
      {!views ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : views.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={t("billing.refunds.noBills")}
          size="sm"
        />
      ) : (
        views.map((view) => (
          <RefundInvoiceCard
            key={view.invoice.id}
            view={view}
            focused={view.invoice.id === focus}
            onAction={onAction(view)}
          />
        ))
      )}
    </>
  )
}

function InvoiceFocus({
  invoiceId,
  onChange,
  onAction,
}: {
  invoiceId: Id
  onChange: () => void
  onAction: (
    view: RefundInvoiceView
  ) => (line: RefundLineView, mode: RefundMode) => void
}) {
  const db = useDb()
  const { t } = useLocale()
  const view = useLiveQuery(
    async () => (await refundView(db, invoiceId)) ?? null,
    [db, invoiceId]
  )
  if (view === undefined) return <Skeleton className="h-48 w-full rounded-lg" />
  if (view === null) {
    return (
      <EmptyState
        icon={X}
        title={t("billing.refunds.invoice.missing")}
        action={{ label: t("billing.refunds.change"), onClick: onChange }}
      />
    )
  }
  return (
    <>
      {view.patient ? (
        <div data-testid="refunds-patient" data-patient-id={view.patient.id}>
          <IdentityBanner
            patient={view.patient}
            compact
            actions={<ChangeButton onClick={onChange} />}
          />
        </div>
      ) : null}
      <RefundInvoiceCard view={view} focused onAction={onAction(view)} />
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Right rail: refund requested, refunds today
 * ------------------------------------------------------------------ */

function RefundRequestsCard({ branch }: { branch: BranchCode }) {
  const db = useDb()
  const { t, num } = useLocale()
  const requests = useLiveQuery(
    () => refundRequestsAt(db, branch),
    [db, branch]
  )
  return (
    <SectionCard
      title={t("billing.refunds.requests.title")}
      subtitle={t("billing.refunds.requests.subtitle")}
      icon={CalendarX2}
      size="sm"
      action={
        requests?.length ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-warning text-xs font-semibold text-[#2a2410]">
            {num(requests.length)}
          </span>
        ) : undefined
      }
    >
      {!requests ? (
        <Skeleton className="h-16 w-full" />
      ) : requests.length === 0 ? (
        <EmptyState
          size="sm"
          icon={CalendarX2}
          title={t("billing.refunds.requests.empty")}
        />
      ) : (
        <ul className="flex flex-col">
          {requests.map((request) => (
            <RefundRequestRow key={request.appointment.id} request={request} />
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

/**
 * One refund request, paid back in one step: the reason is known (doctor
 * delay), the split is automatic; only an amount above the cashier's limit
 * asks for a supervisor first.
 */
function RefundRequestRow({ request }: { request: RefundRequest }) {
  const { t, money, locale, dmy } = useLocale()
  const override = useSupervisorOverride()
  const give = useBillingCommand(refund)
  const problemText = useProblemText()
  const [idempotencyKey, setIdempotencyKey] = React.useState(() =>
    newId("refund")
  )
  const [outcome, setOutcome] = React.useState<RefundOutcome | null>(null)
  const amountP = request.line.netP
  const approval = refundApproval("refund", amountP)
  const reason = t("billing.refunds.requests.reason")

  const pay = async () => {
    let granted:
      { approverStaffId: string; reason: string; pinVerified: true } | undefined
    if (approval) {
      const answer = await override.request({
        authority: APPROVAL_AUTHORITY[approval],
        title: t(`billing.refunds.dialog.approvalTitle.${approval}`),
        description: t("billing.refunds.dialog.approvalBody", {
          item: request.line.description,
          invoiceNo: request.invoice.invoiceNo,
          amount: money(amountP),
          patient: request.patient ? nameIn(request.patient, locale) : "",
        }),
      })
      if (!answer) return
      granted = {
        approverStaffId: answer.approverStaffId,
        reason: answer.reason,
        pinVerified: true,
      }
    }
    const result = await give.run({
      invoiceLineIds: [request.line.id],
      kind: "refund",
      reason,
      approval: granted,
      smsLang: locale,
      idempotencyKey,
    })
    if (result) setOutcome(result)
    else setIdempotencyKey(newId("refund"))
  }

  return (
    <li
      data-testid="refund-request"
      data-appointment-id={request.appointment.id}
      className="flex flex-col gap-1.5 border-b border-hairline py-2.5 last:border-0"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-semibold">
            {request.patient
              ? nameIn(request.patient, locale)
              : request.appointment.patientId}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {t("billing.refunds.requests.visit", {
              doctor: request.doctor?.[locale] ?? "",
              date: dmy(request.appointment.date),
            })}
          </p>
        </div>
        <MoneyText
          poisha={amountP}
          className="text-[0.8125rem] font-semibold"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="refund-request-pay"
          disabled={give.pending}
          onClick={() => void pay()}
        >
          {give.pending ? <LoaderCircle className="animate-spin" /> : <Undo2 />}
          {t("billing.refunds.requests.refund")}
        </Button>
      </div>
      {give.problem ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{problemText(give.problem)}</AlertDescription>
        </Alert>
      ) : null}
      {override.dialog}
      {outcome ? (
        <Dialog
          open
          onOpenChange={(open) => (open ? undefined : setOutcome(null))}
        >
          <DialogContent className="gap-4 sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {t("billing.refunds.dialog.done.title", {
                  amount: money(outcome.amountP),
                })}
              </DialogTitle>
            </DialogHeader>
            <RefundDone outcome={outcome} />
            <DialogFooter>
              <Button
                type="button"
                data-testid="refund-close"
                onClick={() => setOutcome(null)}
              >
                {t("billing.refunds.dialog.done.close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </li>
  )
}

function RefundsTodayCard({
  branch,
  today,
  onOpen,
}: {
  branch: BranchCode
  today: string
  onOpen: (invoiceId: Id) => void
}) {
  const db = useDb()
  const { t, tk, locale, time } = useLocale()
  const rows = useLiveQuery(
    () => refundsTodayAt(db, branch, today),
    [db, branch, today]
  )
  return (
    <SectionCard
      title={t("billing.refunds.recent.title")}
      icon={History}
      size="sm"
      bodyClassName="-mx-1.5"
    >
      {!rows ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          size="sm"
          icon={History}
          title={t("billing.refunds.recent.empty")}
        />
      ) : (
        <ul className="flex flex-col">
          {rows.slice(0, 8).map((row) => (
            <li
              key={row.creditNoteId}
              className="border-b border-hairline last:border-0"
            >
              <button
                type="button"
                data-testid="refund-recent"
                onClick={() => row.invoice && onOpen(row.invoice.id)}
                className="flex w-full items-center gap-3 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-surface-raised"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[0.8125rem] font-medium">
                    {row.patient ? nameIn(row.patient, locale) : ""}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                    <span lang="en" className="font-mono">
                      {row.creditNoteNo ?? ""}
                    </span>
                    <span>{time(row.at)}</span>
                    {[...new Set(row.refunds.map((r) => r.tender))].map(
                      (tender) => (
                        <span
                          key={tender}
                          className={cn(
                            "tag h-5 px-1.5 text-[0.625rem]",
                            TENDER_TAG[tender]
                          )}
                        >
                          {tk(`billing.tender.${tender}`)}
                        </span>
                      )
                    )}
                  </span>
                </span>
                <MoneyText
                  poisha={row.amountP}
                  className="text-[0.8125rem] font-semibold"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
