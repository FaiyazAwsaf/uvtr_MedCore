"use client"

import * as React from "react"
import { Ban, HandCoins, ReceiptText, Undo2 } from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText, type Tone } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import type { Id } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import type { RefundInvoiceView, RefundLineView } from "../queries"
import { isExternalRefund } from "../refunds"
import { merchantRefundRef } from "../simulated"
import { lineNames, SOURCE_ICON, TENDER_ICON, TENDER_TAG } from "./labels"
import type { RefundMode } from "./refund-dialog"
import { STAGE_TONE } from "./refund-labels"

/**
 * One paid invoice on the refunds screen: how it was paid, each line with
 * the stage of its work and the one action that stage allows, and the
 * refunds already made on it (credit notes, tenders, fee-share reversals).
 * Everything is live, so a lab step in another window changes the stage here.
 */
export function RefundInvoiceCard({
  view,
  focused = false,
  onAction,
}: {
  view: RefundInvoiceView
  focused?: boolean
  onAction: (line: RefundLineView, mode: RefundMode) => void
}) {
  const { t, tk, dmy, time, money } = useLocale()
  const ref = React.useRef<HTMLElement>(null)
  const { invoice } = view
  React.useEffect(() => {
    if (focused)
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [focused])

  const status: { key: string; tone: Tone } =
    invoice.status === "refunded"
      ? { key: "refunded", tone: "muted" }
      : invoice.refundedP > 0
        ? { key: "partRefunded", tone: "warning" }
        : { key: "paid", tone: "success" }

  return (
    <section
      ref={ref}
      data-testid="refund-invoice"
      data-invoice-id={invoice.id}
      data-status={invoice.status}
      className={cn(
        "surface-card flex flex-col gap-3 p-4",
        focused && "flash-sync"
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="icon-well flex size-9 shrink-0 items-center justify-center text-link">
            <ReceiptText className="size-[1.125rem]" />
          </span>
          <div className="min-w-0">
            <p
              lang="en"
              className="truncate font-mono text-[0.8125rem] font-semibold"
            >
              {invoice.invoiceNo}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("billing.refunds.invoice.paidOn", {
                date: dmy(view.paidAt),
                time: time(view.paidAt),
              })}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <MoneyText
            poisha={invoice.totalP}
            className="text-base font-semibold"
          />
          <StatusText tone={status.tone} className="text-xs">
            {invoice.refundedP > 0
              ? `${tk(`billing.refunds.invoice.status.${status.key}`)} · ${t("billing.refunds.invoice.refunded", { amount: money(invoice.refundedP) })}`
              : tk(`billing.refunds.invoice.status.${status.key}`)}
          </StatusText>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{t("billing.refunds.invoice.paidBy")}</span>
        {view.payments.map((payment) => {
          const Icon = TENDER_ICON[payment.tender]
          return (
            <span
              key={payment.id}
              className={cn("tag gap-1", TENDER_TAG[payment.tender])}
            >
              <Icon className="size-3" />
              {tk(`billing.tender.${payment.tender}`)} {money(payment.amountP)}
            </span>
          )
        })}
      </div>

      <ul className="flex flex-col border-t border-hairline">
        {view.lines.map((line) => (
          <RefundLineRow key={line.line.id} line={line} onAction={onAction} />
        ))}
      </ul>

      {view.refunds.length ? <RefundHistory view={view} /> : null}
    </section>
  )
}

function RefundLineRow({
  line,
  onAction,
}: {
  line: RefundLineView
  onAction: (line: RefundLineView, mode: RefundMode) => void
}) {
  const { t, tk, locale } = useLocale()
  const { info } = line
  const Icon = SOURCE_ICON[line.line.sourceType]
  const names = lineNames(
    { ...line.line, descriptionBn: line.descriptionBn },
    locale
  )
  const done = info.stage === "line-cancelled" || info.stage === "line-refunded"
  return (
    <li
      data-testid="refund-line"
      data-line-id={line.line.id}
      data-stage={info.stage}
      data-action={info.action}
      className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-0"
    >
      <span className="icon-well flex size-8 shrink-0 items-center justify-center text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-[0.8125rem] font-medium",
            done && "text-muted-foreground"
          )}
        >
          {names.primary}
        </p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
          <StatusText tone={STAGE_TONE[info.stage]} dot>
            {tk(`billing.stage.${info.stage}`)}
          </StatusText>
          {names.secondary ? (
            <span className="truncate text-muted-foreground">
              {names.secondary}
            </span>
          ) : null}
        </p>
      </div>
      <MoneyText
        poisha={line.line.netP}
        className={cn(
          "text-[0.8125rem] font-semibold",
          done && "text-muted-foreground line-through"
        )}
      />
      <div className="flex w-[7.5rem] shrink-0 justify-end">
        {info.action === "cancel" ? (
          <Button
            type="button"
            size="sm"
            variant="destructive-outline"
            data-testid="cancel-line"
            data-action="cancel"
            onClick={() => onAction(line, "cancel")}
          >
            <Ban />
            {t("billing.refunds.action.cancel")}
          </Button>
        ) : info.action === "refund" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="cancel-line"
            data-action="refund"
            onClick={() => onAction(line, "refund")}
          >
            <Undo2 />
            {t("billing.refunds.action.refund")}
          </Button>
        ) : info.action === "goodwill" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="cancel-line"
            data-action="goodwill"
            onClick={() => onAction(line, "goodwill")}
          >
            <HandCoins />
            {t("billing.refunds.action.goodwill")}
          </Button>
        ) : info.stage === "medicine" ? (
          <span className="text-right text-[0.6875rem] leading-tight text-muted-foreground">
            {t("billing.refunds.action.pharmacy")}
          </span>
        ) : info.stage === "consult-open" ? (
          <span className="text-right text-[0.6875rem] leading-tight text-muted-foreground">
            {t("billing.refunds.action.reception")}
          </span>
        ) : null}
      </div>
    </li>
  )
}

function RefundHistory({ view }: { view: RefundInvoiceView }) {
  const { t, tk, money, locale, dmy, time } = useLocale()
  const byNote = new Map<Id, RefundInvoiceView["refunds"]>()
  for (const r of view.refunds) {
    const key = r.creditNoteId ?? r.id
    byNote.set(key, [...(byNote.get(key) ?? []), r])
  }
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-raised/60 px-3 py-2.5 dark:bg-surface-raised/45">
      <span className="micro">{t("billing.refunds.history.title")}</span>
      {[...byNote.entries()].map(([noteId, rows]) => {
        const note = view.creditNotes.find((n) => n.id === noteId)
        const approver = rows.find((r) => r.approver)?.approver
        const at = rows[0].createdAt
        return (
          <div
            key={noteId}
            data-testid="invoice-credit-note"
            className="flex flex-col gap-1"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span lang="en" className="font-mono text-xs font-semibold">
                {note
                  ? t("billing.refunds.history.creditNote", {
                      creditNoteNo: note.creditNoteNo,
                    })
                  : ""}
              </span>
              <span className="text-[0.6875rem] text-muted-foreground">
                {dmy(at)} {time(at)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {rows.map((r) => {
                const ref = merchantRefundRef(r.tender, r.id)
                return (
                  <span
                    key={r.id}
                    className={cn("tag gap-1", TENDER_TAG[r.tender])}
                    title={ref}
                  >
                    {tk(`billing.tender.${r.tender}`)} {money(r.amountP)}
                  </span>
                )
              })}
              {rows.some((r) => isExternalRefund(r.tender)) ? (
                <SimulatedBadge />
              ) : null}
            </div>
            {approver ? (
              <span className="text-[0.6875rem] text-muted-foreground">
                {t("billing.refunds.history.approvedBy", {
                  name: approver[locale],
                })}
              </span>
            ) : null}
          </div>
        )
      })}
      {view.reversals.length ? (
        <div className="flex flex-col gap-1 border-t border-hairline pt-2">
          <span className="micro">{t("billing.refunds.history.reversal")}</span>
          {view.reversals.map((reversal) => (
            <div
              key={reversal.id}
              data-testid="invoice-fee-share-reversal"
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate">
                {reversal.doctor?.[locale] ?? reversal.doctorId}
              </span>
              <MoneyText poisha={reversal.shareP} colorize />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
