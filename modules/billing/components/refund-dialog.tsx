"use client"

import * as React from "react"
import {
  CircleAlert,
  CircleCheck,
  HandCoins,
  LoaderCircle,
  MessageSquare,
  ShieldCheck,
  Undo2,
} from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText } from "@/components/shared/status"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { newId } from "@/core/db/ids"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { cancelLine, refund } from "../commands"
import type { RefundInvoiceView, RefundLineView } from "../queries"
import type { RefundOutcome } from "../refund-tx"
import {
  allocateRefund,
  APPROVAL_AUTHORITY,
  cancelApproval,
  CASHIER_REFUND_LIMIT_P,
  isExternalRefund,
  refundApproval,
  type RefundApprovalKind,
} from "../refunds"
import { keepTogether } from "./invoice-panel"
import { lineNames, TENDER_ICON, TENDER_TAG } from "./labels"
import { STAGE_TONE } from "./refund-labels"
import { useBillingCommand, useProblemText } from "./use-billing-command"

export type RefundMode = "cancel" | "refund" | "goodwill"

/**
 * Cancelling or refunding one paid line (plan §9 `/cashier/refunds`). Before
 * anything is committed it says what will happen at this stage, how the
 * money goes back (split pro rata over the tenders that paid), and which fee
 * share is reversed. Approvals are inline (supervisor override, simulated
 * PIN); a validated test can be tried and is refused and audited by the
 * engine, with a goodwill refund offered instead. After the commit it shows
 * the credit note, each tender's refund and the fee-share reversal.
 */
export function RefundDialog({
  view,
  line,
  initialMode,
  initialReason = "",
  onClose,
}: {
  view: RefundInvoiceView
  line: RefundLineView
  initialMode: RefundMode
  /** Prefilled reason (the refund-requested list knows why) */
  initialReason?: string
  onClose: () => void
}) {
  const { t, tk, money, locale } = useLocale()
  const override = useSupervisorOverride()
  const problemText = useProblemText()
  const [mode, setMode] = React.useState<RefundMode>(initialMode)
  const [reason, setReason] = React.useState(initialReason)
  const [idempotencyKey, setIdempotencyKey] = React.useState(() =>
    newId("refund")
  )
  const [outcome, setOutcome] = React.useState<RefundOutcome | null>(null)
  const cancel = useBillingCommand(cancelLine)
  const give = useBillingCommand(refund)
  const busy = cancel.pending || give.pending
  const problem = mode === "cancel" ? cancel.problem : give.problem
  const blocked = cancel.problem?.code === "CANCEL_AFTER_VALIDATION"

  const amountP = line.line.netP
  const { info } = line
  const approval: RefundApprovalKind | null =
    mode === "cancel"
      ? cancelApproval(info.rule, amountP)
      : refundApproval(mode === "goodwill" ? "goodwill" : "refund", amountP)
  const split = allocateRefund(amountP, view.pool)
  const names = lineNames(
    { ...line.line, descriptionBn: line.descriptionBn },
    locale
  )
  const reasonOk = reason.trim().length >= 3

  const outcomeKey =
    mode === "cancel"
      ? `billing.refunds.dialog.outcome.${info.stage}`
      : `billing.refunds.dialog.outcome.${mode}`
  const aboveLimit = approval === "refund"

  const commitWith = async (granted?: {
    approverStaffId: string
    reason: string
  }) => {
    const base = {
      reason: reason.trim(),
      smsLang: locale,
      idempotencyKey,
      approval: granted
        ? { ...granted, pinVerified: true as const }
        : undefined,
    }
    const result =
      mode === "cancel"
        ? await cancel.run({ invoiceLineId: line.line.id, ...base })
        : await give.run({
            invoiceLineIds: [line.line.id],
            kind: mode === "goodwill" ? "goodwill" : "refund",
            ...base,
          })
    if (result) setOutcome(result)
    else setIdempotencyKey(newId("refund"))
  }

  const ask = async () => {
    if (!approval || !reasonOk || busy) return
    const granted = await override.request({
      authority: APPROVAL_AUTHORITY[approval],
      title: t(`billing.refunds.dialog.approvalTitle.${approval}`),
      description: t("billing.refunds.dialog.approvalBody", {
        item: names.primary,
        invoiceNo: view.invoice.invoiceNo,
        amount: money(amountP),
        patient: view.patient ? nameIn(view.patient, locale) : "",
      }),
    })
    if (granted) {
      await commitWith({
        approverStaffId: granted.approverStaffId,
        reason: granted.reason,
      })
    }
  }

  const switchToGoodwill = () => {
    cancel.clearProblem()
    setMode("goodwill")
    setIdempotencyKey(newId("refund"))
  }

  const title =
    mode === "cancel"
      ? t("billing.refunds.dialog.cancelTitle")
      : mode === "goodwill"
        ? t("billing.refunds.dialog.goodwillTitle")
        : t("billing.refunds.dialog.refundTitle")

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        className="gap-4 sm:max-w-lg"
        data-testid="refund-dialog"
        data-mode={mode}
        data-line-id={line.line.id}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="icon-well flex size-10 shrink-0 items-center justify-center text-link">
              {outcome ? (
                <CircleCheck className="size-5 text-success" />
              ) : (
                <Undo2 className="size-5" />
              )}
            </span>
            <div className="min-w-0">
              <DialogTitle>
                {outcome
                  ? t("billing.refunds.dialog.done.title", {
                      amount: money(outcome.amountP),
                    })
                  : title}
              </DialogTitle>
              <DialogDescription className="truncate">
                {names.primary} ·{" "}
                <span lang="en" className="font-mono text-xs">
                  {view.invoice.invoiceNo}
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {outcome ? (
          <RefundDone outcome={outcome} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-raised px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {t("billing.refunds.dialog.stageNow")}
              </span>
              <StatusText
                tone={STAGE_TONE[info.stage]}
                dot
                data-testid="refund-stage"
                data-stage={info.stage}
              >
                {tk(`billing.stage.${info.stage}`)}
              </StatusText>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="micro">
                {t("billing.refunds.dialog.whatHappens")}
              </span>
              <p
                className="text-[0.8125rem] leading-relaxed"
                data-testid="refund-outcome"
              >
                {tk(outcomeKey, { amount: money(amountP) })}
              </p>
              {aboveLimit ? (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  {t("billing.refunds.dialog.aboveLimit", {
                    limit: money(CASHIER_REFUND_LIMIT_P),
                  })}
                </p>
              ) : null}
            </div>

            {info.rule !== "blocked" || mode !== "cancel" ? (
              <div className="flex flex-col gap-1.5">
                <span className="micro">
                  {t("billing.refunds.dialog.split")}
                </span>
                <ul className="flex flex-col rounded-md bg-surface-raised/60 px-3 py-1 dark:bg-surface-raised/45">
                  {split.map((slice) => {
                    const Icon = TENDER_ICON[slice.tender]
                    return (
                      <li
                        key={slice.paymentId}
                        data-testid="refund-preview-tender"
                        data-tender={slice.tender}
                        className="flex items-center gap-2 border-b border-hairline py-1.5 text-[0.8125rem] last:border-0"
                      >
                        <span
                          className={cn(
                            "tag h-6 w-7 justify-center px-0",
                            TENDER_TAG[slice.tender]
                          )}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {tk(
                            `billing.refunds.dialog.tenderRow.${slice.tender}`
                          )}
                        </span>
                        {isExternalRefund(slice.tender) ? (
                          <SimulatedBadge />
                        ) : null}
                        <MoneyText
                          poisha={slice.amountP}
                          className="font-medium"
                        />
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}

            {line.accruals.length &&
            (mode !== "cancel" || info.rule !== "blocked") ? (
              <div className="flex flex-col gap-1.5">
                <span className="micro">
                  {t("billing.refunds.dialog.feeShare")}
                </span>
                {line.accruals.map((accrual) => (
                  <div
                    key={accrual.id}
                    className="flex items-center justify-between gap-2 text-[0.8125rem]"
                  >
                    <span className="truncate">
                      {accrual.doctor?.[locale] ?? accrual.doctorId}
                    </span>
                    <MoneyText poisha={-accrual.shareP} colorize />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="refund-reason">
                {t("billing.refunds.dialog.reason")}
              </Label>
              <Textarea
                id="refund-reason"
                data-testid="cancel-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("billing.refunds.dialog.reasonPlaceholder")}
                className="min-h-14"
              />
            </div>

            {problem ? (
              <Alert
                variant="destructive"
                data-testid="refund-problem"
                data-code={problem.code}
              >
                <CircleAlert />
                <AlertDescription>{problemText(problem)}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {outcome ? (
            <Button type="button" data-testid="refund-close" onClick={onClose}>
              {t("billing.refunds.dialog.done.close")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="neutral"
                onClick={onClose}
                disabled={busy}
              >
                {t("common.close")}
              </Button>
              {mode === "cancel" && info.rule === "blocked" ? (
                <>
                  <Button
                    type="button"
                    variant="destructive-outline"
                    data-testid="cancel-confirm"
                    disabled={!reasonOk || busy || blocked}
                    onClick={() => void commitWith()}
                  >
                    {busy ? <LoaderCircle className="animate-spin" /> : null}
                    {t("billing.refunds.dialog.tryCancel")}
                  </Button>
                  <Button
                    type="button"
                    variant={blocked ? "default" : "outline"}
                    data-testid="refund-goodwill"
                    disabled={busy}
                    onClick={switchToGoodwill}
                  >
                    <HandCoins />
                    {t("billing.refunds.dialog.goodwillInstead")}
                  </Button>
                </>
              ) : approval ? (
                <Button
                  type="button"
                  data-testid="refund-approve"
                  disabled={!reasonOk || busy}
                  onClick={() => void ask()}
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ShieldCheck />
                  )}
                  {t("billing.refunds.dialog.askSupervisor")}
                </Button>
              ) : (
                <Button
                  type="button"
                  data-testid="cancel-confirm"
                  disabled={!reasonOk || busy}
                  onClick={() => void commitWith()}
                >
                  {busy ? <LoaderCircle className="animate-spin" /> : <Undo2 />}
                  {mode === "cancel"
                    ? t("billing.refunds.dialog.confirmCancel", {
                        amount: money(amountP),
                      })
                    : t("billing.refunds.dialog.confirmRefund", {
                        amount: money(amountP),
                      })}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
        {override.dialog}
      </DialogContent>
    </Dialog>
  )
}

/** What the commit did: credit note, a refund per tender, fee-share reversals, the SMS. */
export function RefundDone({ outcome }: { outcome: RefundOutcome }) {
  const { t, tk, money, locale } = useLocale()
  return (
    <div
      className="flex flex-col gap-3"
      data-testid="refund-done"
      data-credit-note-id={outcome.creditNoteId}
    >
      <div className="flex items-center justify-between gap-3 rounded-md bg-primary-soft px-3 py-2.5">
        <span className="text-xs text-muted-foreground">
          {t("billing.refunds.dialog.done.creditNote")}
        </span>
        <span
          lang="en"
          className="font-mono text-sm font-semibold"
          data-testid="credit-note-no"
        >
          {outcome.creditNoteNo}
        </span>
      </div>
      <ul className="flex flex-col">
        {outcome.refunds.map((part) => {
          const Icon = TENDER_ICON[part.tender]
          return (
            <li
              key={part.refundId}
              data-testid="refund-tender"
              data-tender={part.tender}
              className="flex items-center gap-2 border-b border-hairline py-2 text-[0.8125rem] last:border-0"
            >
              <span
                className={cn(
                  "tag h-6 w-7 justify-center px-0",
                  TENDER_TAG[part.tender]
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {tk(`billing.refunds.dialog.tenderRow.${part.tender}`)}
                </span>
                <span
                  lang="en"
                  className="truncate font-mono text-[0.6875rem] text-muted-foreground"
                >
                  {part.refundNo}
                  {part.ref
                    ? ` · ${t("billing.refunds.dialog.done.ref", { ref: part.ref })}`
                    : ""}
                </span>
              </span>
              {isExternalRefund(part.tender) ? <SimulatedBadge /> : null}
              <MoneyText poisha={part.amountP} className="font-semibold" />
            </li>
          )
        })}
      </ul>
      {outcome.reversals.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="micro">{t("billing.refunds.history.reversal")}</span>
          {outcome.reversals.map((reversal) => (
            <div
              key={reversal.accrualId}
              data-testid="fee-share-reversal"
              data-doctor-id={reversal.doctorId}
              className="flex items-center justify-between gap-2 text-[0.8125rem]"
            >
              <span className="truncate">
                {locale === "bn" ? reversal.doctorBn : reversal.doctor}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("billing.refunds.dialog.done.reversal", {
                  share: money(reversal.shareP),
                  wht: money(reversal.whtP),
                })}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <MessageSquare className="size-3.5" />
        {outcome.smsTo ? (
          <span className="whitespace-nowrap">
            {t("billing.refunds.dialog.done.sms", {
              phone: keepTogether(outcome.smsTo),
            })}
          </span>
        ) : null}
        <span>{t("billing.refunds.dialog.done.body")}</span>
        <SimulatedBadge />
      </p>
    </div>
  )
}
