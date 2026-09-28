"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CircleAlert,
  CircleCheck,
  FlaskConical,
  Hourglass,
  Lock,
  Pill,
  Printer,
  ScanLine,
  Smartphone,
  TimerOff,
  UserRoundPlus,
  Wallet,
} from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { rules } from "@/config/rules.config"
import { MINUTE } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { Id, PaymentRow, Poisha } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { confirmMfs, timeoutMfs } from "../commands"
import { invoiceDetail, type InvoiceDetail } from "../queries"
import { TENDER_ICON, TENDER_TAG } from "./labels"
import { ReceiptDialog } from "./receipt"
import { useBillingCommand, useProblemText } from "./use-billing-command"

/**
 * Where an invoice stands after Pay, live from the data (so another window,
 * such as the patient app approving the push, updates it too): waiting for
 * a bKash or Nagad approval, paid with its receipt, or timed out with the
 * balance still due.
 */
export function InvoicePanel({
  invoiceId,
  changeDueP,
  hasOpenLines,
  onCollect,
  onNewBill,
  onNextPatient,
}: {
  invoiceId: Id
  /** Change given back for cash at this counter, when known */
  changeDueP?: Poisha
  hasOpenLines: boolean
  onCollect: (detail: InvoiceDetail) => void
  onNewBill: () => void
  onNextPatient: () => void
}) {
  const db = useDb()
  const detail = useLiveQuery(() => invoiceDetail(db, invoiceId), [db, invoiceId])

  if (detail === undefined) {
    return (
      <div className="surface-card flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (detail === null) return null

  const pending = detail.payments.filter((p) => p.status === "pending")
  if (pending.length) return <MfsPending detail={detail} pending={pending} />
  if (detail.invoice.status === "paid") {
    return (
      <PaymentDone
        detail={detail}
        changeDueP={changeDueP}
        hasOpenLines={hasOpenLines}
        onNewBill={onNewBill}
        onNextPatient={onNextPatient}
      />
    )
  }
  return <BalanceDue detail={detail} onCollect={onCollect} />
}

function ReceivedSoFar({ payments }: { payments: PaymentRow[] }) {
  const { t, tk } = useLocale()
  const confirmed = payments.filter((p) => p.status === "confirmed")
  if (!confirmed.length) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surface-raised/60 px-3 py-2.5 dark:bg-surface-raised/45">
      <span className="micro">{t("billing.cashier.mfs.received")}</span>
      {confirmed.map((payment) => (
        <div key={payment.id} className="flex items-center justify-between gap-2 text-[0.8125rem]">
          <span className="flex items-center gap-1.5">
            <CircleCheck className="size-3.5 text-success" />
            {tk(`billing.tender.${payment.tender}`)}
          </span>
          <MoneyText poisha={payment.amountP} className="font-medium" />
        </div>
      ))}
    </div>
  )
}

function MfsPending({ detail, pending }: { detail: InvoiceDetail; pending: PaymentRow[] }) {
  const { t } = useLocale()
  return (
    <SectionCard
      title={t("billing.cashier.mfs.title")}
      subtitle={detail.invoice.invoiceNo}
      icon={Hourglass}
      size="sm"
      action={<SimulatedBadge />}
    >
      <div className="flex flex-col gap-3">
        {pending.map((payment) => (
          <PendingPush key={payment.id} payment={payment} detail={detail} />
        ))}
        <ReceivedSoFar payments={detail.payments} />
        <p className="flex items-start gap-2 text-xs text-muted-foreground" data-testid="mfs-locked">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {t("billing.cashier.mfs.locked")}
        </p>
      </div>
    </SectionCard>
  )
}

function PendingPush({ payment, detail }: { payment: PaymentRow; detail: InvoiceDetail }) {
  const { t, tk, money, digits, duration } = useLocale()
  const nowMs = useNow(1000)
  const approve = useBillingCommand(confirmMfs)
  const timeout = useBillingCommand(timeoutMfs)
  const problemText = useProblemText()
  const problem = approve.problem ?? timeout.problem
  const busy = approve.pending || timeout.pending
  const Icon = TENDER_ICON[payment.tender]
  const tender = tk(`billing.tender.${payment.tender}`)
  const phone = detail.patient?.phone ?? detail.patient?.attendantPhone
  const leftSec = Math.max(
    0,
    Math.round((payment.requestedAt + rules.mfsPendingTimeoutMin * MINUTE - nowMs) / 1000)
  )

  return (
    <div
      data-testid="mfs-pending"
      data-payment-id={payment.id}
      data-tender={payment.tender}
      className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-raised">
          <Smartphone className="size-5 text-link" />
          <span className="absolute inset-0 animate-pulse-ring rounded-full" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className={cn("tag", TENDER_TAG[payment.tender])}>
              <Icon className="size-3" />
              {tender}
            </span>
            <MoneyText poisha={payment.amountP} className="text-lg font-semibold" />
          </span>
          <span className="text-xs text-muted-foreground">
            {phone
              ? t("billing.cashier.mfs.sentTo", { phone: digits(phone) })
              : t("billing.cashier.mfs.sent")}
          </span>
        </div>
      </div>
      <p className="text-[0.8125rem] text-foreground/90">
        {t("billing.cashier.mfs.body", { tender, amount: money(payment.amountP) })}
      </p>
      <p className="nums text-xs text-muted-foreground" data-testid="mfs-countdown">
        {leftSec > 0
          ? t("billing.cashier.mfs.expiresIn", { time: duration(leftSec) })
          : t("billing.cashier.mfs.expiring")}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          data-testid="mfs-approve"
          disabled={busy}
          onClick={() =>
            void approve.run({ paymentId: payment.id, idempotencyKey: `mfs-confirm:${payment.id}` })
          }
        >
          <CircleCheck />
          {t("billing.cashier.mfs.approve")}
        </Button>
        <Button
          type="button"
          variant="destructive-outline"
          data-testid="mfs-timeout"
          disabled={busy}
          onClick={() =>
            void timeout.run({ paymentId: payment.id, idempotencyKey: `mfs-timeout:${payment.id}` })
          }
        >
          <TimerOff />
          {t("billing.cashier.mfs.timeout")}
        </Button>
      </div>
      {problem ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{problemText(problem)}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function PaymentDone({
  detail,
  changeDueP,
  hasOpenLines,
  onNewBill,
  onNextPatient,
}: {
  detail: InvoiceDetail
  changeDueP?: Poisha
  hasOpenLines: boolean
  onNewBill: () => void
  onNextPatient: () => void
}) {
  const { t, tk, money, num } = useLocale()
  const [receiptOpen, setReceiptOpen] = React.useState(false)
  const { invoice, receipt, unlocked } = detail
  const confirmed = detail.payments.filter((p) => p.status === "confirmed")
  const cashP = confirmed.filter((p) => p.tender === "cash").reduce((s, p) => s + p.amountP, 0)
  const changeP = cashP > 0 ? (changeDueP ?? 0) : 0
  const unlocks = [
    unlocked.tests
      ? {
          icon: FlaskConical,
          text: t("billing.cashier.done.unlockedLab", {
            count: num(unlocked.tests),
            samples: num(unlocked.specimens),
          }),
        }
      : null,
    unlocked.imaging
      ? { icon: ScanLine, text: t("billing.cashier.done.unlockedImaging", { count: num(unlocked.imaging) }) }
      : null,
    unlocked.medicines
      ? { icon: Pill, text: t("billing.cashier.done.unlockedRx", { count: num(unlocked.medicines) }) }
      : null,
  ].filter((item): item is { icon: typeof Pill; text: string } => item !== null)

  return (
    <section
      data-testid="payment-done"
      data-invoice-id={invoice.id}
      className="surface-card relative flex flex-col gap-4 p-4"
    >
      {/* Plays once when the invoice turns paid, wherever the approval came from. */}
      <span aria-hidden className="flash-sync pointer-events-none absolute inset-0 rounded-lg" />
      <header className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--success)_16%,transparent)] text-success">
          <CircleCheck className="size-6" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1.0625rem] font-semibold">{t("billing.cashier.done.title")}</h2>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("billing.cashier.done.body", { amount: money(invoice.totalP) })}
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 rounded-md bg-surface-raised/60 px-3 py-2.5 dark:bg-surface-raised/45">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("billing.cashier.done.invoice")}</dt>
          <dd lang="en" className="truncate font-mono text-[0.8125rem] font-medium" data-testid="invoice-no">
            {invoice.invoiceNo}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("billing.cashier.done.receipt")}</dt>
          <dd lang="en" className="truncate font-mono text-[0.8125rem] font-medium" data-testid="receipt-no">
            {receipt?.receiptNo ?? "-"}
          </dd>
        </div>
      </dl>

      <ul className="flex flex-col gap-1.5 text-[0.8125rem]">
        {confirmed.map((payment) => {
          const Icon = TENDER_ICON[payment.tender]
          return (
            <li key={payment.id} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                <span>{tk(`billing.tender.${payment.tender}`)}</span>
                {payment.ref ? (
                  <span lang="en" className="truncate font-mono text-xs text-muted-foreground">
                    {payment.ref}
                  </span>
                ) : null}
              </span>
              <MoneyText poisha={payment.amountP} className="font-medium" />
            </li>
          )
        })}
      </ul>

      {changeP > 0 ? (
        <p
          data-testid="change-due"
          className="flex items-center justify-between rounded-md bg-primary-soft px-3 py-2 text-[0.9375rem] font-semibold"
        >
          <span>{t("billing.cashier.done.change")}</span>
          <MoneyText poisha={changeP} />
        </p>
      ) : null}

      {unlocks.length ? (
        <div className="flex flex-col gap-1.5" data-testid="payment-unlocked">
          <span className="micro">{t("billing.cashier.done.unlocked")}</span>
          {unlocks.map((item) => (
            <span key={item.text} className="flex items-center gap-2 text-[0.8125rem] text-success">
              <item.icon className="size-4" />
              {item.text}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          data-testid="receipt-print"
          disabled={!receipt}
          onClick={() => setReceiptOpen(true)}
        >
          <Printer />
          {t("billing.cashier.done.print")}
        </Button>
        {hasOpenLines ? (
          <Button type="button" onClick={onNewBill} data-testid="bill-rest">
            <Wallet />
            {t("billing.cashier.done.newBill")}
          </Button>
        ) : (
          <Button type="button" onClick={onNextPatient} data-testid="next-patient">
            <UserRoundPlus />
            {t("billing.cashier.done.next")}
          </Button>
        )}
      </div>
      <ReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        detail={detail}
        changeDueP={changeDueP}
      />
    </section>
  )
}

function BalanceDue({
  detail,
  onCollect,
}: {
  detail: InvoiceDetail
  onCollect: (detail: InvoiceDetail) => void
}) {
  const { t, tk, money } = useLocale()
  const timedOut = [...detail.payments].reverse().find((p) => p.status === "timeout")
  const dueP = detail.invoice.totalP - detail.invoice.paidP
  return (
    <SectionCard
      title={timedOut ? t("billing.cashier.timedOut.title") : t("billing.cashier.timedOut.dueTitle")}
      subtitle={detail.invoice.invoiceNo}
      icon={TimerOff}
      size="sm"
    >
      <div className="flex flex-col gap-3" data-testid="balance-due">
        {timedOut ? (
          <p className="text-[0.8125rem] text-foreground/90">
            {t("billing.cashier.timedOut.body", {
              tender: tk(`billing.tender.${timedOut.tender}`),
              amount: money(timedOut.amountP),
            })}
          </p>
        ) : null}
        <ReceivedSoFar payments={detail.payments} />
        <div className="flex items-baseline justify-between rounded-md bg-primary-soft px-3 py-2.5">
          <span className="text-[0.8125rem] font-medium">{t("billing.cashier.timedOut.due")}</span>
          <MoneyText poisha={dueP} className="text-[1.375rem] font-semibold" />
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {t("billing.cashier.mfs.locked")}
        </p>
        <Button type="button" data-testid="collect-balance" onClick={() => onCollect(detail)}>
          <Wallet />
          {t("billing.cashier.timedOut.collect")}
        </Button>
      </div>
    </SectionCard>
  )
}
