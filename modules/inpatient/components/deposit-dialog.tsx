"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { Check, CircleAlert, CreditCard, LoaderCircle, Printer, Smartphone, Wallet, WifiOff } from "lucide-react"
import { toast } from "sonner"

import { IdentityBanner } from "@/components/shared/identity-banner"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
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
import { Skeleton } from "@/components/ui/skeleton"
import { rules } from "@/config/rules.config"
import type { BranchCode } from "@/config/brand.config"
import { useDb, useDbInfo } from "@/core/db/DbProvider"
import type { Id, Poisha } from "@/core/db/schema"
import { TENDER_ICON } from "@/modules/billing/components/labels"
import { parseTaka, takaText } from "@/modules/billing/pricing"
import { openShiftFor } from "@/modules/billing/queries"
import { mfsTrxId, terminalRef } from "@/modules/billing/simulated"
import { useActionKey } from "@/modules/pharmacy/components/shared"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { takeDeposit, type DepositResult } from "../commands"
import { billOf, stayById, type StayView } from "../queries"
import { QUICK_DEPOSITS_P, restoreAmountP } from "../stay"
import { DepositReceiptSheet } from "./deposit-receipt"
import {
  BalanceText,
  ProblemAlert,
  useDemoNow,
  useInpatientCommand,
  useWardText,
} from "./shared"

type Tender = "cash" | "card" | "bkash" | "nagad"
const TENDERS: Tender[] = ["cash", "card", "bkash", "nagad"]
const isMfs = (tender: Tender) => tender === "bkash" || tender === "nagad"

/**
 * Take a deposit against a stay (plan §9 `/cashier/deposits`) on the cashier's
 * open shift: cash with the amount received and change; card through the
 * simulated terminal; bKash or Nagad through a simulated "customer approved
 * in the app" step that gives the transaction id before anything is saved.
 * Ends on the printable deposit receipt.
 */
export function DepositDialog({
  admissionId,
  branch,
  cashierId,
  onOpenChange,
}: {
  admissionId: Id | null
  branch: BranchCode
  cashierId: Id
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={!!admissionId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[34rem]" data-testid="deposit-dialog">
        {admissionId ? (
          <DepositBody
            key={admissionId}
            admissionId={admissionId}
            branch={branch}
            cashierId={cashierId}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DepositBody({
  admissionId,
  branch,
  cashierId,
  onClose,
}: {
  admissionId: Id
  branch: BranchCode
  cashierId: Id
  onClose: () => void
}) {
  const db = useDb()
  const { t } = useLocale()
  const stay = useLiveQuery(async () => await stayById(db, admissionId), [db, admissionId])
  const shift = useLiveQuery(
    async () => (await openShiftFor(db, cashierId, branch)) ?? null,
    [db, cashierId, branch]
  )
  const [done, setDone] = React.useState<DepositResult | null>(null)

  if (stay === undefined || shift === undefined) {
    return <Skeleton className="h-72 w-full" />
  }
  if (!stay) {
    return <p className="text-sm text-muted-foreground">{t("inpatient.drawer.gone")}</p>
  }
  if (done) {
    return <DepositDone stay={stay} result={done} onAnother={() => setDone(null)} onClose={onClose} />
  }
  return <DepositForm stay={stay} hasShift={!!shift} onDone={setDone} onClose={onClose} />
}

function DepositForm({
  stay,
  hasShift,
  onDone,
  onClose,
}: {
  stay: StayView
  hasShift: boolean
  onDone: (result: DepositResult) => void
  onClose: () => void
}) {
  const { t, tk, money, digits } = useLocale()
  const { isEdge } = useDbInfo()
  const wardText = useWardText()
  const nowMs = useDemoNow()
  const bill = billOf(stay, nowMs)
  const [amountText, setAmountText] = React.useState("")
  const [tender, setTender] = React.useState<Tender>("cash")
  const [receivedText, setReceivedText] = React.useState("")
  const [approval, setApproval] = React.useState<{ tender: Tender; amountP: Poisha; ref: string } | null>(null)
  const [declined, setDeclined] = React.useState(false)
  const [actionKey, renewKey] = useActionKey()
  const command = useInpatientCommand(takeDeposit)

  const amountP = parseTaka(amountText) ?? 0
  const receivedP = tender === "cash" && receivedText ? parseTaka(receivedText) : null
  const approved = approval && approval.tender === tender && approval.amountP === amountP ? approval : null
  const mfsBlocked = isMfs(tender) && isEdge
  const afterP = bill ? bill.balanceP + amountP : 0
  const restoreP = bill ? restoreAmountP(bill.balanceP, rules.depositThresholdP) : 0
  const cashOk = tender !== "cash" || receivedP === null || receivedP >= amountP
  const ready =
    hasShift &&
    amountP > 0 &&
    cashOk &&
    (tender === "cash" || !!approved) &&
    !mfsBlocked &&
    !command.pending

  const quick = [...new Set([...(restoreP > 0 ? [restoreP] : []), ...QUICK_DEPOSITS_P])]

  const approve = () => {
    const seed = `${actionKey}:${tender}:${amountP}`
    setDeclined(false)
    setApproval({
      tender,
      amountP,
      ref: tender === "card" ? terminalRef(seed) : mfsTrxId(tender, seed),
    })
  }

  const save = async () => {
    if (!ready) return
    const result = await command.run({
      admissionId: stay.admission.id,
      amountP,
      tender,
      tenderedP: tender === "cash" && receivedP !== null ? receivedP : undefined,
      ref: tender === "cash" ? undefined : approved?.ref,
      idempotencyKey: actionKey,
    })
    if (!result) return
    renewKey()
    toast(t("inpatient.deposit.done.title"), {
      description: `${result.receiptNo} · ${money(amountP)}`,
      icon: <Wallet className="size-4 text-primary" />,
    })
    onDone(result)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("inpatient.deposit.title")}</DialogTitle>
        <DialogDescription>
          <span lang="en" className="font-mono">
            {stay.admission.admissionNo}
          </span>
          {stay.ward && stay.bed ? ` · ${t("inpatient.common.wardBed", { ward: wardText(stay.ward).name, bed: stay.bed.code })}` : ""}
        </DialogDescription>
      </DialogHeader>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <IdentityBanner patientId={stay.admission.patientId} compact />

        {bill ? (
          <div className="grid grid-cols-2 gap-3 rounded-md bg-surface-raised px-4 py-3 text-[0.8125rem]">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{t("inpatient.deposit.leftNow")}</span>
              <BalanceText balanceP={bill.balanceP} low={bill.low} className="text-base" />
            </div>
            <div className="flex flex-col gap-0.5" data-testid="deposit-after" data-balance={afterP}>
              <span className="text-xs text-muted-foreground">{t("inpatient.deposit.leftAfter")}</span>
              <BalanceText
                balanceP={afterP}
                low={afterP < rules.depositThresholdP}
                className="text-base"
              />
            </div>
            {amountP > 0 ? (
              <p
                className={cn(
                  "col-span-2 text-xs",
                  afterP >= rules.depositThresholdP ? "text-success" : "text-muted-foreground"
                )}
              >
                {afterP >= rules.depositThresholdP
                  ? stay.admission.depositAlertAt !== undefined
                    ? t("inpatient.deposit.clears", { amount: money(rules.depositThresholdP) })
                    : null
                  : t("inpatient.deposit.stillLow", { amount: money(rules.depositThresholdP) })}
              </p>
            ) : null}
          </div>
        ) : null}

        {!hasShift ? (
          <Alert variant="destructive" data-testid="deposit-no-shift">
            <CircleAlert />
            <AlertDescription>
              {t("inpatient.deposit.noShift")}{" "}
              <Link href="/cashier/shift" className="font-medium text-link underline-offset-4 hover:underline">
                {t("inpatient.deposits.shift.openLink")}
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="deposit-amount" className="text-[0.8125rem] font-medium">
            {t("inpatient.deposit.amount")}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
              ৳
            </span>
            <Input
              id="deposit-amount"
              data-testid="deposit-amount"
              inputMode="decimal"
              autoComplete="off"
              aria-label={t("inpatient.deposit.amountLabel")}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              aria-invalid={amountText !== "" && amountP <= 0}
              className="nums pl-7 text-right text-base font-semibold"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((p, index) => (
              <Button
                key={p}
                type="button"
                size="xs"
                variant={index === 0 && restoreP > 0 ? "outline" : "neutral"}
                data-testid="deposit-quick"
                data-amount={p}
                onClick={() => setAmountText(takaText(p))}
              >
                {index === 0 && restoreP > 0 ? t("inpatient.deposit.restore", { amount: money(p) }) : money(p)}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-medium">{t("inpatient.deposit.tender")}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
            {TENDERS.map((option) => {
              const Icon = TENDER_ICON[option]
              const active = option === tender
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid="deposit-tender"
                  data-tender={option}
                  onClick={() => {
                    setTender(option)
                    setDeclined(false)
                  }}
                  className={cn(
                    "flex h-9 items-center justify-center gap-1.5 rounded-md border text-[0.8125rem] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    active
                      ? "border-primary bg-primary-soft text-link"
                      : "border-border text-foreground hover:bg-surface-raised"
                  )}
                >
                  <Icon className="size-4" />
                  {tk(`billing.tender.${option}`)}
                </button>
              )
            })}
          </div>

          {tender === "cash" ? (
            <div className="flex items-center gap-2 text-[0.8125rem]">
              <label htmlFor="deposit-received" className="shrink-0 text-muted-foreground">
                {t("inpatient.deposit.received")}
              </label>
              <Input
                id="deposit-received"
                data-testid="deposit-received"
                inputMode="decimal"
                autoComplete="off"
                placeholder={amountP > 0 ? takaText(amountP) : ""}
                value={receivedText}
                onChange={(event) => setReceivedText(event.target.value)}
                className="nums h-8 min-w-0 flex-1 text-right"
              />
              {receivedP !== null ? (
                <span
                  data-testid="deposit-change"
                  className={cn("nums shrink-0 font-semibold", receivedP < amountP && "text-destructive")}
                >
                  {receivedP < amountP
                    ? t("inpatient.deposit.short", { amount: money(amountP - receivedP) })
                    : t("inpatient.deposit.change", { amount: money(receivedP - amountP) })}
                </span>
              ) : null}
            </div>
          ) : mfsBlocked ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <WifiOff className="size-3.5" />
              {t("inpatient.deposit.mfs.offline")}
            </p>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-2.5">
              <p className="flex items-center justify-between gap-2 text-[0.8125rem]">
                <span className="flex min-w-0 items-center gap-1.5">
                  {tender === "card" ? (
                    <CreditCard className="size-4 shrink-0 text-link" />
                  ) : (
                    <Smartphone className="size-4 shrink-0 text-link" />
                  )}
                  <span className="min-w-0">
                    {tender === "card"
                      ? t("inpatient.deposit.card.waiting", { amount: money(amountP) })
                      : stay.patient?.phone
                        ? t("inpatient.deposit.mfs.request", {
                            amount: money(amountP),
                            phone: digits(stay.patient.phone),
                          })
                        : t("inpatient.deposit.mfs.requestNoPhone", { amount: money(amountP) })}
                  </span>
                </span>
                <SimulatedBadge />
              </p>
              {approved ? (
                <p
                  data-testid="deposit-approved"
                  className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-success"
                >
                  <Check className="size-4" />
                  <span>
                    {t("inpatient.deposit.approved", { ref: "" })}
                    <span lang="en" className="font-mono">
                      {approved.ref}
                    </span>
                  </span>
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    data-testid="deposit-approve"
                    disabled={amountP <= 0}
                    onClick={approve}
                  >
                    {tender === "card" ? t("inpatient.deposit.card.approve") : t("inpatient.deposit.mfs.approve")}
                  </Button>
                  {tender === "card" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive-outline"
                      data-testid="deposit-decline"
                      disabled={amountP <= 0}
                      onClick={() => {
                        setApproval(null)
                        setDeclined(true)
                      }}
                    >
                      {t("inpatient.deposit.card.decline")}
                    </Button>
                  ) : null}
                </div>
              )}
              {declined && tender === "card" ? (
                <p className="text-xs font-medium text-destructive">{t("inpatient.deposit.card.declined")}</p>
              ) : null}
            </div>
          )}
        </div>

        <ProblemAlert problem={command.problem} />

        <DialogFooter>
          <Button type="button" variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" data-testid="deposit-save" disabled={!ready}>
            {command.pending ? <LoaderCircle className="animate-spin" /> : <Wallet />}
            {command.pending
              ? t("inpatient.deposit.saving")
              : t("inpatient.deposit.save", { amount: money(amountP) })}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function DepositDone({
  stay,
  result,
  onAnother,
  onClose,
}: {
  stay: StayView
  result: DepositResult
  onAnother: () => void
  onClose: () => void
}) {
  const db = useDb()
  const { t, money } = useLocale()
  const deposit = useLiveQuery(() => db.deposits.get(result.depositId), [db, result.depositId])
  const cashier = useLiveQuery(
    async () => (deposit?.cashierId ? await db.staff.get(deposit.cashierId) : undefined),
    [db, deposit?.cashierId]
  )
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("inpatient.deposit.done.title")}</DialogTitle>
        <DialogDescription>
          {t("inpatient.deposit.done.body", {
            receiptNo: result.receiptNo,
            left: money(result.balanceP),
          })}{" "}
          {result.alertCleared ? t("inpatient.deposit.done.cleared") : null}
        </DialogDescription>
      </DialogHeader>
      <div
        data-testid="deposit-receipt"
        data-receipt-no={result.receiptNo}
        data-alert-cleared={String(result.alertCleared)}
        className="-mx-2 max-h-[55svh] overflow-y-auto rounded-md bg-surface-raised p-3"
      >
        {deposit ? (
          <DepositReceiptSheet
            stay={stay}
            deposit={deposit}
            balanceP={result.balanceP}
            changeDueP={result.changeDueP}
            cashier={cashier}
          />
        ) : (
          <Skeleton className="h-48 w-full" />
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onAnother}>
          {t("inpatient.deposit.done.another")}
        </Button>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.done")}
        </Button>
        <Button type="button" data-testid="deposit-print" onClick={() => window.print()}>
          <Printer />
          {t("inpatient.deposit.done.print")}
        </Button>
      </DialogFooter>
    </>
  )
}

