"use client"

import * as React from "react"
import Link from "next/link"
import { CircleAlert, LoaderCircle, ShieldCheck, Wallet } from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { TONE_TEXT } from "@/components/shared/status"
import {
  useSupervisorOverride,
  type SupervisorApproval,
} from "@/components/shared/supervisor-override-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { newId } from "@/core/db/ids"
import type { BasketLineRow, Id, PatientRow, Poisha, ShiftRow } from "@/core/db/schema"
import { findPersona } from "@/core/seed/content/personas"
import { useActor } from "@/core/session/persona"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { checkout, collectBalance, type CheckoutResult } from "../commands"
import { computeBill, discountLimit } from "../pricing"
import type { Cover } from "../settle"
import { resolveTenders, TenderEditor, type TenderDraft } from "./tender-editor"
import { useBillingCommand, useProblemText } from "./use-billing-command"

type Approval = SupervisorApproval & { pct: number }

export type CheckoutTarget =
  | { kind: "bill"; lines: BasketLineRow[]; cover: Cover | null }
  | { kind: "balance"; invoiceId: Id; invoiceNo: string; totalP: Poisha; paidP: Poisha }

function SummaryRow({
  label,
  children,
  strong = false,
  testId,
}: {
  label: React.ReactNode
  children: React.ReactNode
  strong?: boolean
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-baseline justify-between gap-3",
        strong ? "text-[0.9375rem] font-semibold" : "text-[0.8125rem] text-muted-foreground"
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className={cn("shrink-0", strong ? "text-foreground" : "text-foreground/90")}>
        {children}
      </span>
    </div>
  )
}

/**
 * The payment panel (plan §9 `/cashier`): what the chosen lines come to, the
 * discount (the cashier's own authority, or a supervisor's inline approval
 * above it, INV-16), the company's share for corporate cover, and the
 * tenders. The panel mints ONE idempotency key when it opens, so however
 * many times Pay is pressed, one payment is committed.
 */
export function CheckoutPanel({
  target,
  patient,
  shift,
  onDone,
  onCancel,
}: {
  target: CheckoutTarget
  patient: PatientRow
  /** undefined while loading, null when the cashier has no open shift */
  shift: ShiftRow | null | undefined
  onDone: (result: CheckoutResult) => void
  onCancel?: () => void
}) {
  const { t, money, num, locale } = useLocale()
  const actor = useActor()
  const override = useSupervisorOverride()
  const problemText = useProblemText()
  const [idempotencyKey] = React.useState(() => newId("pay"))
  const [drafts, setDrafts] = React.useState<TenderDraft[]>([])
  const [pctText, setPctText] = React.useState("")
  const [approval, setApproval] = React.useState<Approval | null>(null)
  const pay = useBillingCommand(checkout)
  const collect = useBillingCommand(collectBalance)
  const busy = pay.pending || collect.pending
  const problem = pay.problem ?? collect.problem

  const limit = discountLimit(actor?.authorities ?? [])
  const pct = target.kind === "bill" ? Math.min(100, Number(pctText.replace(/[^\d]/g, "")) || 0) : 0
  const needsApproval = pct > limit && (!approval || approval.pct < pct)

  const bill = target.kind === "bill" ? computeBill(target.lines, pct, target.cover) : null
  const dueP = bill ? bill.patientDueP : target.kind === "balance" ? target.totalP - target.paidP : 0
  const resolved = resolveTenders(drafts, dueP)
  const allocatedP = resolved.reduce((sum, row) => sum + row.amountP, 0)
  const tendersReady =
    dueP === 0 ? resolved.length === 0 : resolved.length > 0 && allocatedP === dueP && resolved.every((row) => row.valid)
  const noLines = target.kind === "bill" && target.lines.length === 0
  const canPay = !!shift && !noLines && !needsApproval && tendersReady && !busy

  const approverName = (value: Approval) => {
    const persona = findPersona(value.approverPersonaId)
    return (locale === "bn" ? persona?.staff?.nameBn : persona?.staff?.nameEn) ?? value.approverName
  }

  const askApproval = async () => {
    if (!bill || !needsApproval) return
    const granted = await override.request({
      authority: `discount:${pct}`,
      title: t("billing.cashier.discount.approvalTitle"),
      description: t("billing.cashier.discount.approvalBody", {
        pct: num(pct),
        amount: money(bill.discountP),
        total: money(bill.subtotalP),
      }),
    })
    if (granted) setApproval({ ...granted, pct })
  }

  const submit = async () => {
    if (!canPay) return
    const tenders = resolved.map((row) => ({
      tender: row.tender,
      amountP: row.amountP,
      tenderedP: row.tender === "cash" && row.receivedP !== null ? row.receivedP : undefined,
      ref: row.tender === "card" ? row.ref : undefined,
    }))
    const result =
      target.kind === "bill"
        ? await pay.run({
            patientId: patient.id,
            basketLineIds: target.lines.map((line) => line.id),
            discountPct: pct,
            discountApproval:
              approval && pct > limit
                ? { approverStaffId: approval.approverStaffId, reason: approval.reason, pinVerified: true }
                : undefined,
            tenders,
            idempotencyKey,
          })
        : await collect.run({ invoiceId: target.invoiceId, tenders, idempotencyKey })
    if (result) onDone(result)
  }

  const wallet = patient.phone ?? patient.attendantPhone

  return (
    <SectionCard
      title={
        target.kind === "bill"
          ? t("billing.cashier.summary.title")
          : t("billing.cashier.summary.balanceTitle")
      }
      subtitle={target.kind === "balance" ? target.invoiceNo : undefined}
      icon={Wallet}
      size="sm"
      action={
        onCancel ? (
          <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
            {t("common.back")}
          </Button>
        ) : undefined
      }
      className="@container/checkout"
    >
      <div className="flex flex-col gap-4" data-testid="checkout-panel">
        {bill ? (
          <div className="flex flex-col gap-2">
            <SummaryRow
              label={t("billing.cashier.summary.items", { count: num(target.kind === "bill" ? target.lines.length : 0) })}
            >
              <MoneyText poisha={bill.subtotalP} />
            </SummaryRow>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-[0.8125rem] text-muted-foreground">
                <label htmlFor="discount-input" className="flex items-center gap-2">
                  {t("billing.cashier.discount.label")}
                  <span className="relative">
                    <Input
                      id="discount-input"
                      data-testid="discount-input"
                      inputMode="numeric"
                      value={pctText}
                      placeholder="0"
                      disabled={busy || noLines}
                      onChange={(event) => setPctText(event.target.value.replace(/[^\d০-৯]/g, "").slice(0, 3))}
                      onBlur={() => void askApproval()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void askApproval()
                      }}
                      className="nums h-8 w-16 pr-6 text-right"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">
                      %
                    </span>
                  </span>
                </label>
                <MoneyText
                  poisha={-bill.discountP}
                  className={cn(bill.discountP > 0 ? "text-foreground/90" : "")}
                />
              </div>
              {approval && pct > limit && !needsApproval ? (
                <span
                  data-testid="discount-approved"
                  className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--success)_15%,transparent)] px-2.5 py-1 text-xs font-medium text-success"
                >
                  <ShieldCheck className="size-3.5" />
                  {t("billing.cashier.discount.approvedBy", {
                    name: approverName(approval),
                    pct: num(approval.pct),
                  })}
                </span>
              ) : needsApproval ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("text-xs", TONE_TEXT.warning)}>
                    {t("billing.cashier.discount.aboveLimit", { pct: num(limit) })}
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    data-testid="discount-approve"
                    onClick={() => void askApproval()}
                  >
                    <ShieldCheck />
                    {t("billing.cashier.discount.ask")}
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("billing.cashier.discount.limit", { pct: num(limit) })}
                </span>
              )}
            </div>

            <Separator />
            <SummaryRow label={t("billing.cashier.summary.total")} strong testId="bill-total">
              <MoneyText poisha={bill.totalP} />
            </SummaryRow>
            {bill.corporateShareP > 0 && target.kind === "bill" ? (
              <SummaryRow
                label={t("billing.cashier.summary.corporate", {
                  client: target.cover?.client?.name[locale] ?? "",
                })}
                testId="bill-corporate"
              >
                <MoneyText poisha={-bill.corporateShareP} />
              </SummaryRow>
            ) : null}
            {bill.uncoveredCorporate > 0 ? (
              <p className={cn("text-xs", TONE_TEXT.warning)}>{t("billing.cashier.summary.coverInactive")}</p>
            ) : null}
          </div>
        ) : target.kind === "balance" ? (
          <div className="flex flex-col gap-2">
            <SummaryRow label={t("billing.cashier.summary.invoiceTotal")}>
              <MoneyText poisha={target.totalP} />
            </SummaryRow>
            <SummaryRow label={t("billing.cashier.summary.alreadyPaid")}>
              <MoneyText poisha={-target.paidP} />
            </SummaryRow>
            <Separator />
          </div>
        ) : null}

        <div className="flex items-baseline justify-between gap-3 rounded-md bg-primary-soft px-3 py-2.5">
          <span className="text-[0.8125rem] font-medium">{t("billing.cashier.summary.patientPays")}</span>
          <MoneyText poisha={dueP} className="text-[1.375rem] font-semibold text-foreground" />
        </div>

        <TenderEditor
          drafts={drafts}
          onChange={(next) => {
            pay.clearProblem()
            collect.clearProblem()
            setDrafts(next)
          }}
          dueP={dueP}
          seed={idempotencyKey}
          walletPhone={wallet}
          disabled={busy || noLines}
        />

        {problem ? (
          <Alert variant="destructive" data-testid="checkout-problem">
            <CircleAlert />
            <AlertDescription>{problemText(problem)}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            data-testid="cashier-pay"
            disabled={!canPay}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Wallet />}
            {busy
              ? t("billing.cashier.paying")
              : dueP > 0
                ? t("billing.cashier.pay", { amount: money(dueP) })
                : t("billing.cashier.payNothingDue")}
          </Button>
          {shift === null ? (
            <p className={cn("text-xs", TONE_TEXT.warning)}>
              {t("billing.cashier.noShiftHint")}{" "}
              <Link href="/cashier/shift" className="font-medium text-link underline-offset-4 hover:underline">
                {t("billing.cashier.openShiftLink")}
              </Link>
            </p>
          ) : noLines ? (
            <p className="text-xs text-muted-foreground">{t("billing.cashier.selectHint")}</p>
          ) : null}
        </div>
      </div>
      {override.dialog}
    </SectionCard>
  )
}
