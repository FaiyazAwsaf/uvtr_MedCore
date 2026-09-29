"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Banknote, CircleAlert, LoaderCircle, ReceiptText, Store, Wallet } from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText, type Tone } from "@/components/shared/status"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getBranch, type BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { newId } from "@/core/db/ids"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { Id, PaymentRow, ShiftRow } from "@/core/db/schema"
import { usePersona } from "@/core/session/persona"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { openShift } from "../commands"
import { parseTaka } from "../pricing"
import { lastClosedShiftFor, openShiftFor, shiftSummary } from "../queries"
import { TENDER_ICON, TENDER_TAG } from "./labels"
import { ClosedShiftCard, CloseShiftCard } from "./shift-close"
import { useBillingCommand, useProblemText } from "./use-billing-command"

const DEFAULT_FLOAT = "5000"

const PAYMENT_TONE: Record<PaymentRow["status"], Tone> = {
  pending: "warning",
  confirmed: "success",
  failed: "destructive",
  timeout: "destructive",
  refunded: "muted",
}

/**
 * `/cashier/shift` (plan §9): the cashier's open shift with its float and the
 * running expected cash (float plus cash taken minus cash refunded, derived
 * live from the payments), what came in by tender, this shift's payments,
 * and closing it with the denomination count (S13). Without an open shift:
 * the last closed shift, locked, with its Z-report, and opening a new one.
 */
export function ShiftScreen() {
  const persona = usePersona()
  const { t } = useLocale()
  const branch = persona?.branchId
  const cashierId = persona?.staff?.id
  if (!branch || !cashierId) {
    return <EmptyState icon={Store} title={t("billing.rules.NO_BRANCH")} />
  }
  return <ShiftWorkspace branch={branch} cashierId={cashierId} />
}

function ShiftWorkspace({ branch, cashierId }: { branch: BranchCode; cashierId: Id }) {
  const db = useDb()
  const { t, locale } = useLocale()
  const shift = useLiveQuery(
    async () => (await openShiftFor(db, cashierId, branch)) ?? null,
    [db, cashierId, branch]
  )
  const lastClosed = useLiveQuery(
    async () => (await lastClosedShiftFor(db, cashierId, branch)) ?? null,
    [db, cashierId, branch]
  )
  const branchRow = getBranch(branch)
  return (
    <div className="@container/shift flex flex-col gap-4 pb-2" data-testid="shift-screen">
      <header>
        <h1 className="text-[1.375rem] leading-tight font-semibold">{t("billing.shift.title")}</h1>
        <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
          {t("billing.shift.subtitle", { branch: `${branchRow.name[locale]} (${branchRow.code})` })}
        </p>
      </header>
      {shift === undefined ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : shift ? (
        <OpenShift shift={shift} />
      ) : (
        <div className="grid items-start gap-4 @min-[52rem]/shift:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {lastClosed ? <ClosedShiftCard shift={lastClosed} /> : null}
          <OpenShiftForm />
        </div>
      )}
    </div>
  )
}

function OpenShiftForm() {
  const { t, money } = useLocale()
  const [floatText, setFloatText] = React.useState(DEFAULT_FLOAT)
  const [idempotencyKey] = React.useState(() => newId("shift"))
  const open = useBillingCommand(openShift)
  const problemText = useProblemText()
  const floatP = parseTaka(floatText)
  return (
    <SectionCard
      title={t("billing.shift.none.title")}
      subtitle={t("billing.shift.none.body")}
      icon={Banknote}
      className="max-w-xl"
    >
      <form
        data-testid="shift-status"
        data-status="none"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (floatP === null) return
          void open.run({ floatP, idempotencyKey })
        }}
      >
        <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium" htmlFor="shift-float">
          {t("billing.shift.floatLabel")}
          <span className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
              ৳
            </span>
            <Input
              id="shift-float"
              data-testid="shift-float"
              inputMode="decimal"
              value={floatText}
              onChange={(event) => setFloatText(event.target.value)}
              aria-invalid={floatP === null}
              className="nums pl-7"
            />
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {floatP !== null ? t("billing.shift.floatHint", { amount: money(floatP) }) : null}
          </span>
        </label>
        {open.problem ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{problemText(open.problem)}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          type="submit"
          data-testid="shift-open"
          disabled={floatP === null || open.pending}
          className="w-fit"
        >
          {open.pending ? <LoaderCircle className="animate-spin" /> : <Wallet />}
          {t("billing.shift.open")}
        </Button>
      </form>
    </SectionCard>
  )
}

function OpenShift({ shift }: { shift: ShiftRow }) {
  const db = useDb()
  const { t, tk, time, dmy, locale } = useLocale()
  const nowMs = useNow(30_000)
  const summary = useLiveQuery(
    () => shiftSummary(db, shift, nowMs || now()),
    [db, shift, nowMs]
  )
  const tenders = ["cash", "card", "bkash", "nagad", "corporate"] as const

  return (
    <div className="grid items-start gap-4 @min-[52rem]/shift:grid-cols-[minmax(0,1fr)_20rem] @min-[90rem]/shift:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <section
          data-testid="shift-status"
          data-status={shift.status}
          data-shift-id={shift.id}
          className="surface-card flex flex-col gap-4 p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="icon-well flex size-10 items-center justify-center text-link">
                <Banknote className="size-5" />
              </span>
              <div>
                <h2 className="text-[1.0625rem] font-semibold">{t("billing.shift.openTitle")}</h2>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {t("billing.shift.openedAt", { date: dmy(shift.openedAt), time: time(shift.openedAt) })}
                </p>
              </div>
            </div>
            <StatusText tone="success" dot>
              {tk(`billing.shift.status.${shift.status}`)}
            </StatusText>
          </div>
          {summary ? (
            <>
              <KeyValueGrid
                columns={4}
                items={[
                  { label: t("billing.shift.float"), value: <MoneyText poisha={shift.floatP} /> },
                  { label: t("billing.shift.cashIn"), value: <MoneyText poisha={summary.cashInP} /> },
                  {
                    label: t("billing.shift.cashRefunds"),
                    value: <MoneyText poisha={-summary.cashRefundsP} />,
                  },
                  {
                    label: t("billing.shift.pendingMfs"),
                    value: <MoneyText poisha={summary.pendingMfsP} />,
                  },
                ]}
              />
              <div
                className="flex items-baseline justify-between gap-3 rounded-md bg-primary-soft px-4 py-3"
                data-testid="shift-expected"
                data-expected={summary.expectedCashP}
              >
                <span className="text-sm font-medium">{t("billing.shift.expected")}</span>
                <MoneyText poisha={summary.expectedCashP} className="text-[1.5rem] font-semibold" />
              </div>
              <p className="text-xs text-muted-foreground">{t("billing.shift.expectedHint")}</p>
            </>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </section>

        {summary ? <CloseShiftCard shift={shift} summary={summary} /> : null}

        <SectionCard title={t("billing.shift.payments")} icon={ReceiptText} size="sm">
          {!summary ? (
            <Skeleton className="h-32 w-full" />
          ) : summary.payments.length === 0 ? (
            <EmptyState size="sm" icon={ReceiptText} title={t("billing.shift.noPayments")} />
          ) : (
            <div className="@container/pay">
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.shift.col.time")}</TableHead>
                    <TableHead className="hidden @min-[36rem]/pay:table-cell">
                      {t("billing.shift.col.invoice")}
                    </TableHead>
                    <TableHead>{t("billing.shift.col.patient")}</TableHead>
                    <TableHead>{t("billing.shift.col.tender")}</TableHead>
                    <TableHead className="text-right">{t("billing.shift.col.amount")}</TableHead>
                    <TableHead className="hidden @min-[28rem]/pay:table-cell">
                      {t("billing.shift.col.status")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.payments.slice(0, 40).map((payment) => (
                    <TableRow key={payment.id} data-testid="shift-payment">
                      <TableCell>
                        <DateText value={payment.requestedAt} variant="time" />
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs @min-[36rem]/pay:table-cell">
                        <span lang="en">{payment.invoiceNo ?? ""}</span>
                      </TableCell>
                      <TableCell className="max-w-40 truncate">
                        {payment.patient ? nameIn(payment.patient, locale) : ""}
                      </TableCell>
                      <TableCell>
                        <span className={cn("tag", TENDER_TAG[payment.tender])}>
                          {tk(`billing.tender.${payment.tender}`)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyText poisha={payment.amountP} />
                      </TableCell>
                      <TableCell className="hidden @min-[28rem]/pay:table-cell">
                        <StatusText tone={PAYMENT_TONE[payment.status]}>
                          {tk(`billing.paymentStatus.${payment.status}`)}
                        </StatusText>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title={t("billing.shift.byTender")} icon={Wallet} size="sm">
        <ul className="flex flex-col" data-testid="shift-by-tender">
          {tenders.map((tender) => {
            const Icon = TENDER_ICON[tender]
            return (
              <li
                key={tender}
                className="flex items-center justify-between gap-3 border-b border-hairline py-2 text-[0.8125rem] last:border-0"
              >
                <span className="flex items-center gap-2">
                  <span className={cn("tag h-6 w-7 justify-center px-0", TENDER_TAG[tender])}>
                    <Icon className="size-3.5" />
                  </span>
                  {tk(`billing.tender.${tender}`)}
                </span>
                <MoneyText poisha={summary?.byTender[tender] ?? 0} className="font-medium" />
              </li>
            )
          })}
        </ul>
      </SectionCard>
    </div>
  )
}
