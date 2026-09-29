"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  Banknote,
  ChevronRight,
  Hourglass,
  Landmark,
  LoaderCircle,
  Store,
  Wallet,
  X,
} from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, TONE_TEXT } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getBranch, type BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import { newId } from "@/core/db/ids"
import type { Id, Poisha, ShiftRow } from "@/core/db/schema"
import { usePersona } from "@/core/session/persona"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { openShift, type CheckoutResult } from "../commands"
import {
  basketOf,
  dueInvoicesOf,
  openShiftFor,
  todayKpisAt,
  type DueInvoice,
} from "../queries"
import { Basket } from "./basket"
import { CheckoutPanel } from "./checkout-panel"
import { InvoicePanel } from "./invoice-panel"
import { CashierKpis } from "./kpi-row"
import { TENDER_ICON, TENDER_TAG } from "./labels"
import { PatientFinder } from "./patient-finder"
import { useBillingCommand, useProblemText } from "./use-billing-command"

type Panel =
  | { kind: "bill" }
  | { kind: "invoice"; invoiceId: Id }
  | { kind: "balance"; invoiceId: Id }

/**
 * `/cashier` (plan §9): find the patient, pick the lines they pay for now,
 * discount, tenders, receipt. The selected patient lives in the address
 * (`?patient=`), so a reload mid-payment comes back to the same bill and a
 * bKash push still waiting shows again, read from the data.
 */
export function CashierScreen() {
  const persona = usePersona()
  const { t } = useLocale()
  const branch = persona?.branchId
  const cashierId = persona?.staff?.id
  if (!branch || !cashierId) {
    return <EmptyState icon={Store} title={t("billing.rules.NO_BRANCH")} />
  }
  return <CashierWorkspace branch={branch} cashierId={cashierId} />
}

function CashierWorkspace({
  branch,
  cashierId,
}: {
  branch: BranchCode
  cashierId: Id
}) {
  const db = useDb()
  const { t, locale, time, money } = useLocale()
  const nowMs = useNow(60_000)
  const today = dhakaDate(nowMs || now())
  const searchParams = useSearchParams()
  const patientId = searchParams.get("patient")
  const [panel, setPanel] = React.useState<Panel>({ kind: "bill" })
  const shift = useLiveQuery(
    async () => (await openShiftFor(db, cashierId, branch)) ?? null,
    [db, cashierId, branch]
  )

  const select = React.useCallback((id: Id | null, invoiceId?: Id) => {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set("patient", id)
    else url.searchParams.delete("patient")
    window.history.replaceState(null, "", `${url.pathname}${url.search}`)
    setPanel(invoiceId ? { kind: "invoice", invoiceId } : { kind: "bill" })
  }, [])

  const branchRow = getBranch(branch)

  return (
    <div
      className="@container/cashier flex flex-col gap-4 pb-2"
      data-testid="cashier-screen"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] leading-tight font-semibold">
            {t("billing.cashier.heading")}
          </h1>
          <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
            {t("billing.cashier.subtitle", {
              branch: `${branchRow.name[locale]} (${branchRow.code})`,
            })}
          </p>
        </div>
        {shift === undefined ? null : shift ? (
          <Link
            href="/cashier/shift"
            data-testid="cashier-shift"
            data-status="open"
            className="flex items-center gap-2 rounded-full bg-surface-raised px-3 py-1.5 text-xs font-medium transition-colors hover:bg-primary-soft"
          >
            <span className="size-2 rounded-full bg-success" />
            {t("billing.cashier.shiftOpen", {
              time: time(shift.openedAt),
              amount: money(shift.floatP),
            })}
            <ChevronRight className="size-3.5 text-muted-foreground" />
          </Link>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/cashier/shift"
              data-testid="cashier-shift"
              data-status="none"
              className="flex items-center gap-2 rounded-full bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-primary-soft"
            >
              <span className="size-2 rounded-full bg-warning" />
              {t("billing.cashier.noShift")}
              <ChevronRight className="size-3.5" />
            </Link>
            <OpenShiftNow />
          </div>
        )}
      </header>

      <CashierKpis branch={branch} today={today} />

      {patientId ? (
        <PatientBilling
          key={patientId}
          patientId={patientId}
          branch={branch}
          today={today}
          shift={shift}
          panel={panel}
          setPanel={setPanel}
          onSelect={select}
        />
      ) : (
        <div className="grid gap-4 @min-[52rem]/cashier:grid-cols-[minmax(0,1fr)_20rem] @min-[90rem]/cashier:grid-cols-[minmax(0,1fr)_24rem]">
          <PatientFinder branch={branch} onSelect={select} />
          <div className="flex flex-col gap-4">
            <TodayByTender branch={branch} today={today} />
            <ShiftSnapshot shift={shift} />
          </div>
        </div>
      )}
    </div>
  )
}

function PatientBilling({
  patientId,
  branch,
  today,
  shift,
  panel,
  setPanel,
  onSelect,
}: {
  patientId: Id
  branch: BranchCode
  today: string
  shift: ShiftRow | null | undefined
  panel: Panel
  setPanel: (panel: Panel) => void
  onSelect: (id: Id | null, invoiceId?: Id) => void
}) {
  const db = useDb()
  const { t } = useLocale()
  const patient = useLiveQuery(
    async () => (await db.patients.get(patientId)) ?? null,
    [db, patientId]
  )
  const basket = useLiveQuery(
    () => (patient ? basketOf(db, patient, branch, today) : undefined),
    [db, patient, branch, today]
  )
  const due = useLiveQuery(
    () => dueInvoicesOf(db, patientId, branch),
    [db, patientId, branch]
  )
  // Lines start selected, including ones that arrive while the bill is open;
  // a fee for a later visit starts unselected (it is usually paid on the day).
  const [deselected, setDeselected] = React.useState<ReadonlySet<Id>>(
    () => new Set()
  )
  const [picked, setPicked] = React.useState<ReadonlySet<Id>>(() => new Set())
  const [changeDue, setChangeDue] = React.useState<Record<Id, Poisha>>({})
  const [mountedAt] = React.useState(() => now())

  if (patient === undefined) {
    return <Skeleton className="h-40 w-full rounded-lg" />
  }
  if (patient === null) {
    return (
      <EmptyState
        icon={X}
        title={t("billing.cashier.patient.missing")}
        action={{
          label: t("billing.cashier.patient.change"),
          onClick: () => onSelect(null),
        }}
      />
    )
  }

  const lines = basket?.lines ?? []
  const laterVisits = basket?.laterVisits ?? {}
  const selected = new Set(
    lines
      .filter((line) =>
        laterVisits[line.id] ? picked.has(line.id) : !deselected.has(line.id)
      )
      .map((line) => line.id)
  )
  const selectedLines = lines.filter((line) => selected.has(line.id))
  const waiting = due?.find((row) => row.pending.length > 0) ?? due?.[0]
  // With nothing left to bill, an invoice still due is what the cashier needs.
  const effective: Panel =
    panel.kind === "bill" && basket && lines.length === 0 && waiting
      ? { kind: "invoice", invoiceId: waiting.invoice.id }
      : panel

  const onChangeSelection = (ids: Id[], checked: boolean) => {
    const later = ids.filter((id) => laterVisits[id])
    setPicked((current) => {
      const next = new Set(current)
      for (const id of later) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
    setDeselected((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (laterVisits[id]) continue
        if (checked) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const onPaid = (result: CheckoutResult) => {
    if (result.changeDueP > 0) {
      setChangeDue((current) => ({
        ...current,
        [result.invoiceId]: result.changeDueP,
      }))
    }
    setDeselected(new Set())
    setPicked(new Set())
    setPanel({ kind: "invoice", invoiceId: result.invoiceId })
  }

  const balanceTarget =
    effective.kind === "balance"
      ? due?.find((row) => row.invoice.id === effective.invoiceId)
      : undefined

  return (
    <div className="grid items-start gap-4 @min-[52rem]/cashier:grid-cols-[minmax(0,1fr)_20rem] @min-[90rem]/cashier:grid-cols-[20rem_minmax(0,1fr)_24rem]">
      <div className="hidden @min-[90rem]/cashier:block">
        <PatientFinder branch={branch} onSelect={onSelect} compact />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div data-testid="cashier-patient" data-patient-id={patient.id}>
          <IdentityBanner
            patient={patient}
            compact
            actions={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="cashier-change-patient"
                onClick={() => onSelect(null)}
              >
                <X />
                {t("billing.cashier.patient.change")}
              </Button>
            }
          />
        </div>
        {basket ? (
          <Basket
            lines={lines}
            selected={selected}
            onChange={onChangeSelection}
            cover={basket.cover}
            laterVisits={laterVisits}
            mountedAt={mountedAt}
          />
        ) : (
          <Skeleton className="h-48 w-full rounded-lg" />
        )}
        {due && due.length > 0 ? (
          <PatientDue
            due={due}
            activeId={
              effective.kind === "bill" ? undefined : effective.invoiceId
            }
            onOpen={(invoiceId) => setPanel({ kind: "invoice", invoiceId })}
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4 @min-[52rem]/cashier:sticky @min-[52rem]/cashier:top-0">
        {effective.kind === "invoice" ? (
          <InvoicePanel
            key={effective.invoiceId}
            invoiceId={effective.invoiceId}
            changeDueP={changeDue[effective.invoiceId]}
            hasOpenLines={lines.length > 0}
            onCollect={(detail) =>
              setPanel({ kind: "balance", invoiceId: detail.invoice.id })
            }
            onNewBill={() => setPanel({ kind: "bill" })}
            onNextPatient={() => onSelect(null)}
          />
        ) : effective.kind === "balance" && balanceTarget ? (
          <CheckoutPanel
            key={`balance:${balanceTarget.invoice.id}`}
            target={{
              kind: "balance",
              invoiceId: balanceTarget.invoice.id,
              invoiceNo: balanceTarget.invoice.invoiceNo,
              totalP: balanceTarget.invoice.totalP,
              paidP: balanceTarget.invoice.paidP,
            }}
            patient={patient}
            shift={shift}
            onDone={(result) => onPaid(result)}
            onCancel={() =>
              setPanel({ kind: "invoice", invoiceId: balanceTarget.invoice.id })
            }
          />
        ) : (
          <CheckoutPanel
            key="bill"
            target={{
              kind: "bill",
              lines: selectedLines,
              cover: basket?.cover ?? null,
            }}
            patient={patient}
            shift={shift}
            onDone={(result) => onPaid(result)}
          />
        )}
      </div>
    </div>
  )
}

function PatientDue({
  due,
  activeId,
  onOpen,
}: {
  due: DueInvoice[]
  activeId?: Id
  onOpen: (invoiceId: Id) => void
}) {
  const { t, tk } = useLocale()
  return (
    <SectionCard
      title={t("billing.cashier.due.patientTitle")}
      icon={Hourglass}
      size="sm"
      bodyClassName="-mx-1.5"
    >
      <ul className="flex flex-col">
        {due.map((row) => {
          const pending = row.pending[0]
          return (
            <li
              key={row.invoice.id}
              className="border-b border-hairline last:border-0"
            >
              <button
                type="button"
                onClick={() => onOpen(row.invoice.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-surface-raised",
                  activeId === row.invoice.id && "bg-primary-soft"
                )}
              >
                <span
                  lang="en"
                  className="min-w-0 flex-1 truncate font-mono text-xs"
                >
                  {row.invoice.invoiceNo}
                </span>
                {pending ? (
                  <span className={cn("tag", TENDER_TAG[pending.tender])}>
                    {t("billing.cashier.due.waiting", {
                      tender: tk(`billing.tender.${pending.tender}`),
                    })}
                  </span>
                ) : (
                  <StatusPill
                    tone="warning"
                    className="h-5 px-2 text-[0.6875rem]"
                  >
                    {t("billing.cashier.due.partial")}
                  </StatusPill>
                )}
                <MoneyText
                  poisha={row.dueP}
                  className="text-[0.8125rem] font-semibold"
                />
              </button>
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}

/** Today's collections at the branch, tender by tender (plan §9 KPI detail). */
function TodayByTender({
  branch,
  today,
}: {
  branch: BranchCode
  today: string
}) {
  const db = useDb()
  const { t, tk, num } = useLocale()
  const kpis = useLiveQuery(
    () => todayKpisAt(db, branch, today),
    [db, branch, today]
  )
  const tenders = ["cash", "card", "bkash", "nagad", "corporate"] as const
  return (
    <SectionCard
      title={t("billing.cashier.byTender.title")}
      icon={Landmark}
      size="sm"
    >
      <ul className="flex flex-col" data-testid="today-by-tender">
        {tenders.map((tender) => {
          const Icon = TENDER_ICON[tender]
          return (
            <li
              key={tender}
              className="flex items-center justify-between gap-3 border-b border-hairline py-2 text-[0.8125rem] last:border-0"
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "tag h-6 w-7 justify-center px-0",
                    TENDER_TAG[tender]
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                {tk(`billing.tender.${tender}`)}
                <span className="text-xs text-muted-foreground">
                  {num(kpis?.payments[tender] ?? 0)}
                </span>
              </span>
              <MoneyText
                poisha={kpis?.byTender[tender] ?? 0}
                className="font-medium"
              />
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}

/** The usual float, for opening a shift in one click from the bill screen. */
const QUICK_FLOAT_P: Poisha = 5_000_00

/**
 * "Open shift" in one click (plan §9): after a close (S13) the cashier is
 * back to taking payments without leaving the bill screen. A different
 * float is set on the shift page.
 */
function OpenShiftNow() {
  const { t, money } = useLocale()
  const open = useBillingCommand(openShift)
  const problemText = useProblemText()
  const [idempotencyKey] = React.useState(() => newId("shift"))
  return (
    <>
      <Button
        type="button"
        size="sm"
        data-testid="shift-open"
        disabled={open.pending}
        onClick={() => void open.run({ floatP: QUICK_FLOAT_P, idempotencyKey })}
      >
        {open.pending ? <LoaderCircle className="animate-spin" /> : <Wallet />}
        {t("billing.cashier.openShiftNow", { amount: money(QUICK_FLOAT_P) })}
      </Button>
      {open.problem ? (
        <span className="text-xs text-destructive">{problemText(open.problem)}</span>
      ) : null}
    </>
  )
}

function ShiftSnapshot({ shift }: { shift: ShiftRow | null | undefined }) {
  const { t, time } = useLocale()
  if (shift === undefined) return null
  return (
    <SectionCard
      title={t("billing.shift.title")}
      icon={Banknote}
      size="sm"
      seeAllHref="/cashier/shift"
      seeAllLabel={t("billing.cashier.openShiftPage")}
    >
      {shift ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t("billing.cashier.shiftSince", { time: time(shift.openedAt) })}
        </p>
      ) : (
        <p className={cn("text-[0.8125rem]", TONE_TEXT.warning)}>
          {t("billing.cashier.noShiftHint")}
        </p>
      )}
    </SectionCard>
  )
}
