"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ChevronDown,
  CircleCheck,
  Hourglass,
  MapPin,
  ReceiptText,
  Smartphone,
  Wallet,
} from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusPill, type Tone } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { hospital } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { MINUTE } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import { newId } from "@/core/db/ids"
import type {
  BasketLineRow,
  InvoiceRow,
  PaymentRow,
  ReceiptRow,
} from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { confirmMfs, payOnline } from "@/modules/billing/commands"

import {
  invoiceDue,
  lastTimedOut,
  lineAmount,
  openChargesByBranch,
  pendingOnlinePayments,
  sortInvoices,
  type OpenCharges,
} from "../lib/bills"
import {
  AppCard,
  AppLoading,
  ScreenTitle,
  SectionLabel,
  Segmented,
  useFocusId,
  useFocusRing,
} from "./bits"
import { branchName, useMember } from "./data"
import { useAppCommand, useProblemText } from "./use-app-command"

type Method = "bkash" | "nagad"

const INVOICE_TONE: Record<InvoiceRow["status"], Tone> = {
  unpaid: "destructive",
  partial: "warning",
  paid: "success",
  void: "muted",
  refunded: "info",
}

/** The simulated MFS apps' own colours, for their icon wells only. */
const METHOD_WELL: Record<Method, string> = {
  bkash: "bg-[#e2136e] text-white",
  nagad: "bg-[#f6921e] text-white",
}

/** The member's bills, charges and payments (live). */
function useBills() {
  const db = useDb()
  const member = useMember()
  return useLiveQuery(async () => {
    const [basket, invoices, payments, receipts] = await Promise.all([
      db.basketLines
        .where("[patientId+status]")
        .equals([member.id, "open"])
        .toArray(),
      db.invoices.where("patientId").equals(member.id).toArray(),
      db.payments.where("patientId").equals(member.id).toArray(),
      db.receipts.where("patientId").equals(member.id).toArray(),
    ])
    return { basket, invoices: sortInvoices(invoices), payments, receipts }
  }, [db, member.id])
}

export function BillsScreen() {
  const { t, locale } = useLocale()
  const member = useMember()
  const bills = useBills()
  const focusId = useFocusId()
  const [method, setMethod] = React.useState<Method>("bkash")
  const [paid, setPaid] = React.useState<{ receiptNo?: string } | null>(null)

  const pay = useAppCommand(payOnline)
  const approve = useAppCommand(confirmMfs)
  const problemText = useProblemText()
  const problem = pay.problem ?? approve.problem

  /**
   * Pay from the phone (`billing.payOnline`): chosen open lines of one branch,
   * or the balance of an invoice whose push expired. It creates the invoice
   * and a PENDING bKash or Nagad payment, which the patient then approves.
   */
  const payWithMfs = async (
    target: { basketLineIds: string[] } | { invoiceId: string }
  ) => {
    setPaid(null)
    approve.clearProblem()
    await pay.run({
      patientId: member.id,
      tender: method,
      smsLang: locale,
      idempotencyKey: newId("apppay"),
      ...target,
    })
  }

  /** The customer approves the push in bKash or Nagad (simulated): `billing.confirmMfs`. */
  const approvePayment = async (payment: PaymentRow) => {
    pay.clearProblem()
    const result = await approve.run({
      paymentId: payment.id,
      smsLang: locale,
      idempotencyKey: `mfs-confirm:${payment.id}`,
    })
    if (result) setPaid({ receiptNo: result.receiptNo })
  }

  const hospitalName = hospital.shortName[locale]
  if (!bills) return <AppLoading />
  const charges = openChargesByBranch(bills.basket)
  const pending = pendingOnlinePayments(bills.payments)
  const invoiceNo = (id: string) =>
    bills.invoices.find((i) => i.id === id)?.invoiceNo ?? ""
  const empty = !charges.length && !bills.invoices.length

  return (
    <>
      <ScreenTitle
        title={t("patientApp.bills.title")}
        subtitle={t("patientApp.bills.subtitle", { hospital: hospitalName })}
      />

      {paid ? (
        <p
          role="status"
          data-testid="app-bill-paid"
          className="mb-3 flex items-center gap-2 rounded-2xl bg-[color-mix(in_oklch,var(--success)_15%,transparent)] px-3 py-3 text-[0.875rem] font-semibold text-success"
        >
          <CircleCheck className="size-5 shrink-0" />
          {paid.receiptNo
            ? t("patientApp.bills.paidNow", { receiptNo: paid.receiptNo })
            : t("patientApp.notifications.paymentReceived")}
        </p>
      ) : null}
      {problem ? (
        <p
          role="alert"
          className="mb-3 rounded-2xl bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] px-3 py-2.5 text-[0.8125rem] font-medium text-destructive"
        >
          {problemText(problem)}
        </p>
      ) : null}

      {pending.map((payment) => (
        <PendingCard
          key={payment.id}
          payment={payment}
          invoiceNo={invoiceNo(payment.invoiceId)}
          busy={approve.pending}
          onApprove={() => approvePayment(payment)}
        />
      ))}

      {empty ? (
        <AppCard className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-raised text-muted-foreground">
            <ReceiptText className="size-5" />
          </span>
          <p className="text-[0.9375rem] font-semibold">
            {t("patientApp.bills.empty")}
          </p>
          <p className="max-w-[30ch] text-[0.8125rem] text-muted-foreground">
            {t("patientApp.bills.emptyHint")}
          </p>
        </AppCard>
      ) : null}

      {charges.length ? (
        <>
          <SectionLabel>{t("patientApp.bills.dueNow")}</SectionLabel>
          <div className="flex flex-col gap-3">
            {charges.map((group) => (
              <OpenChargesCard
                key={group.branchId}
                group={group}
                method={method}
                onMethod={setMethod}
                busy={pay.pending}
                onPay={(ids) => payWithMfs({ basketLineIds: ids })}
              />
            ))}
          </div>
        </>
      ) : !empty ? (
        <p className="mt-2 px-1 text-[0.8125rem] text-muted-foreground">
          {t("patientApp.bills.nothingDue")}
        </p>
      ) : null}

      {bills.invoices.length ? (
        <>
          <SectionLabel>{t("patientApp.bills.invoices")}</SectionLabel>
          <div className="flex flex-col gap-3">
            {bills.invoices.map((invoice) => (
              <InvoiceCard
                key={invoice.id}
                invoice={invoice}
                payments={bills.payments}
                receipts={bills.receipts}
                focused={focusId === invoice.id}
                method={method}
                busy={pay.pending}
                onPayBalance={() => payWithMfs({ invoiceId: invoice.id })}
              />
            ))}
          </div>
        </>
      ) : null}
      <p className="mt-4 px-1 text-center text-xs text-muted-foreground">
        {t("patientApp.bills.counterNote", { hospital: hospitalName })}
      </p>
    </>
  )
}

function MethodPicker({
  method,
  onMethod,
}: {
  method: Method
  onMethod: (m: Method) => void
}) {
  const { t } = useLocale()
  return (
    <Segmented<Method>
      label={t("patientApp.bills.payWith")}
      value={method}
      onChange={onMethod}
      options={(["bkash", "nagad"] as const).map((m) => ({
        value: m,
        label: (
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-md",
                METHOD_WELL[m]
              )}
            >
              <Smartphone className="size-3" />
            </span>
            {t(`patientApp.bills.method.${m}`)}
          </span>
        ),
      }))}
    />
  )
}

/** Open charges at one branch: tick what to pay and send a bKash or Nagad request. */
function OpenChargesCard({
  group,
  method,
  onMethod,
  busy,
  onPay,
}: {
  group: OpenCharges
  method: Method
  onMethod: (m: Method) => void
  busy: boolean
  onPay: (ids: string[]) => void
}) {
  const { t, locale, money, num } = useLocale()
  const [excluded, setExcluded] = React.useState<Set<string>>(() => new Set())
  const chosen = group.lines.filter((l) => !excluded.has(l.id))
  const totalP = chosen.reduce((sum, l) => sum + lineAmount(l), 0)
  const toggle = (line: BasketLineRow) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(line.id)) next.delete(line.id)
      else next.add(line.id)
      return next
    })

  return (
    <AppCard data-testid="app-bill-open" data-branch-id={group.branchId}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[0.9375rem] font-semibold">
          <MapPin className="size-4 text-link" />
          {branchName(group.branchId, locale)}
        </p>
        <MoneyText
          poisha={group.totalP}
          className="text-[0.9375rem] font-semibold"
        />
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("patientApp.bills.choose")}
      </p>
      <ul className="mt-2 divide-y divide-hairline">
        {group.lines.map((line) => (
          <li key={line.id}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
              <Checkbox
                checked={!excluded.has(line.id)}
                onCheckedChange={() => toggle(line)}
                data-testid="app-bill-line"
                data-line-id={line.id}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] leading-snug font-medium">
                  {locale === "bn" && line.descriptionBn
                    ? line.descriptionBn
                    : line.description}
                </span>
                {line.qty > 1 ? (
                  <span className="text-xs text-muted-foreground">
                    {num(line.qty)} × {money(line.unitPriceP)}
                  </span>
                ) : null}
              </span>
              <MoneyText
                poisha={lineAmount(line)}
                className="text-[0.8125rem] font-semibold"
              />
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-col gap-2">
        <MethodPicker method={method} onMethod={onMethod} />
        <Button
          data-testid="app-bill-pay"
          data-branch-id={group.branchId}
          size="lg"
          className="h-12 w-full text-base"
          disabled={!chosen.length || busy}
          onClick={() => onPay(chosen.map((l) => l.id))}
        >
          <Wallet />
          {busy
            ? t("patientApp.bills.paying")
            : `${t("patientApp.bills.pay", { amount: money(totalP) })} · ${t(`patientApp.bills.method.${method}`)}`}
        </Button>
      </div>
    </AppCard>
  )
}

/** A bKash or Nagad request waiting for the patient's approval (simulated). */
function PendingCard({
  payment,
  invoiceNo,
  busy,
  onApprove,
}: {
  payment: PaymentRow
  invoiceNo: string
  busy: boolean
  onApprove: () => void
}) {
  const { t, money, time } = useLocale()
  const method = payment.tender as Method
  const methodName = t(`patientApp.bills.method.${method}`)
  return (
    <AppCard
      data-testid="app-bill-pending"
      data-payment-id={payment.id}
      className="mb-3 border-2 border-primary/50"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-2xl",
            METHOD_WELL[method]
          )}
        >
          <Smartphone className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold">
            {t("patientApp.bills.waitingTitle")}
            <SimulatedBadge className="h-5" />
          </p>
          <p className="mt-0.5 text-[0.8125rem]">
            {t("patientApp.bills.waitingBody", {
              method: methodName,
              amount: money(payment.amountP),
              invoiceNo,
            })}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Hourglass className="size-3.5 shrink-0" />
            {t("patientApp.bills.expires", {
              time: time(
                payment.requestedAt + rules.mfsPendingTimeoutMin * MINUTE
              ),
            })}
          </p>
        </div>
      </div>
      <Button
        data-testid="app-bill-approve"
        data-payment-id={payment.id}
        size="lg"
        className="mt-3 h-12 w-full text-base"
        disabled={busy}
        onClick={onApprove}
      >
        <CircleCheck />
        {busy
          ? t("patientApp.bills.approving")
          : t("patientApp.bills.approve", { method: methodName })}
      </Button>
    </AppCard>
  )
}

function InvoiceCard({
  invoice,
  payments,
  receipts,
  focused,
  method,
  busy,
  onPayBalance,
}: {
  invoice: InvoiceRow
  payments: PaymentRow[]
  receipts: ReceiptRow[]
  focused: boolean
  method: Method
  busy: boolean
  onPayBalance: () => void
}) {
  const { t, locale, dmy, money } = useLocale()
  const db = useDb()
  const [open, setOpen] = React.useState(false)
  const { ref, flash } = useFocusRing(focused)
  const lines = useLiveQuery(
    async () =>
      open
        ? db.invoiceLines.where("invoiceId").equals(invoice.id).toArray()
        : [],
    [db, invoice.id, open]
  )
  const due = invoiceDue(invoice)
  const waiting = payments.some(
    (p) => p.invoiceId === invoice.id && p.status === "pending"
  )
  const expired =
    due > 0 && !waiting ? lastTimedOut(payments, invoice.id) : undefined
  const receipt = receipts
    .filter((r) => r.invoiceId === invoice.id)
    .sort((a, b) => b.at - a.at)[0]

  return (
    <AppCard
      ref={ref}
      flash={flash}
      data-testid="app-bill"
      data-invoice-id={invoice.id}
      data-invoice-no={invoice.invoiceNo}
      data-status={invoice.status}
      className="scroll-mt-20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            lang="en"
            className="truncate font-mono text-[0.8125rem] font-semibold"
          >
            {invoice.invoiceNo}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {dmy(invoice.createdAt)} · {branchName(invoice.branchId, locale)}
          </p>
        </div>
        <StatusPill tone={INVOICE_TONE[invoice.status]} dot>
          {t(`patientApp.bills.status.${invoice.status}`)}
        </StatusPill>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-surface-raised px-2 py-1.5">
          <dt className="text-[0.6875rem] text-muted-foreground">
            {t("patientApp.bills.total")}
          </dt>
          <dd className="text-[0.875rem] font-semibold">
            <MoneyText poisha={invoice.totalP} />
          </dd>
        </div>
        <div className="rounded-xl bg-surface-raised px-2 py-1.5">
          <dt className="text-[0.6875rem] text-muted-foreground">
            {t("patientApp.bills.paid")}
          </dt>
          <dd className="text-[0.875rem] font-semibold">
            <MoneyText poisha={invoice.paidP} />
          </dd>
        </div>
        <div className="rounded-xl bg-surface-raised px-2 py-1.5">
          <dt className="text-[0.6875rem] text-muted-foreground">
            {t("patientApp.bills.balance")}
          </dt>
          <dd
            className={cn(
              "text-[0.875rem] font-semibold",
              due > 0 && "text-destructive"
            )}
          >
            <MoneyText poisha={due} />
          </dd>
        </div>
      </dl>
      {invoice.refundedP > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("patientApp.bills.refunded", { amount: money(invoice.refundedP) })}
        </p>
      ) : null}
      {receipt ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ReceiptText className="size-3.5" />
          {t("patientApp.bills.receipt")}
          <span lang="en" className="font-mono">
            {receipt.receiptNo}
          </span>
        </p>
      ) : null}
      {expired ? (
        <p
          className="mt-2 rounded-xl bg-surface-raised px-3 py-2 text-xs"
          data-testid="app-bill-timed-out"
        >
          {t("patientApp.bills.timedOut", {
            method: t(`patientApp.bills.method.${expired.tender as Method}`),
            amount: money(expired.amountP),
          })}
        </p>
      ) : null}
      {due > 0 && !waiting ? (
        <Button
          data-testid="app-bill-pay"
          data-invoice-id={invoice.id}
          size="lg"
          className="mt-3 h-12 w-full"
          disabled={busy}
          onClick={onPayBalance}
        >
          <Wallet />
          {`${t("patientApp.bills.payBalance", { amount: money(due) })} · ${t(`patientApp.bills.method.${method}`)}`}
        </Button>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full bg-surface-raised text-[0.8125rem] font-medium"
      >
        {open
          ? t("patientApp.bills.hideItems")
          : t("patientApp.bills.showItems")}
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && lines ? (
        <ul className="mt-2 divide-y divide-hairline">
          {lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center justify-between gap-3 py-2 text-[0.8125rem]"
            >
              <span
                className={cn(
                  "min-w-0",
                  line.status !== "active" &&
                    "text-muted-foreground line-through"
                )}
              >
                {line.description}
              </span>
              <MoneyText poisha={line.netP} className="shrink-0 font-medium" />
            </li>
          ))}
        </ul>
      ) : null}
    </AppCard>
  )
}
