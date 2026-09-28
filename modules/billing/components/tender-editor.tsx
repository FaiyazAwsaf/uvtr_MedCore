"use client"

import * as React from "react"
import { Check, CircleAlert, CreditCard, Smartphone, X } from "lucide-react"

import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Poisha } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { COUNTER_TENDERS, isMfs, parseTaka, takaText, type CounterTender } from "../pricing"
import { terminalRef } from "../simulated"
import { TENDER_ICON, TENDER_TAG } from "./labels"

/**
 * One tender being entered. `amount` null means "the rest": that row always
 * takes whatever the other rows leave of the amount due, so a split such as
 * bKash ৳1,000 plus the rest in cash needs one number typed.
 */
export type TenderDraft = {
  key: string
  tender: CounterTender
  amount: string | null
  /** Cash handed over (cash rows), for the change */
  received: string
  card: "idle" | "waiting" | "approved" | "declined"
  ref?: string
  /** The amount the terminal approved; editing the amount needs a new approval */
  approvedP?: Poisha
}

export type ResolvedTender = TenderDraft & {
  amountP: Poisha
  receivedP: Poisha | null
  valid: boolean
}

/** Amounts for every row (the "rest" row filled in) and whether each is ready. */
export function resolveTenders(drafts: TenderDraft[], dueP: Poisha): ResolvedTender[] {
  const manual = drafts.reduce(
    (sum, draft) => sum + (draft.amount === null ? 0 : (parseTaka(draft.amount) ?? 0)),
    0
  )
  return drafts.map((draft) => {
    const amountP = draft.amount === null ? Math.max(0, dueP - manual) : (parseTaka(draft.amount) ?? 0)
    const receivedP = draft.tender === "cash" && draft.received ? parseTaka(draft.received) : null
    const valid =
      amountP > 0 &&
      (draft.tender !== "card" || (draft.card === "approved" && draft.approvedP === amountP)) &&
      (draft.tender !== "cash" || !draft.received || (receivedP !== null && receivedP >= amountP))
    return { ...draft, amountP, receivedP, valid }
  })
}

export function newDraft(tender: CounterTender, key: string): TenderDraft {
  return { key, tender, amount: null, received: "", card: "idle" }
}

/**
 * Tender entry (plan §9): cash with the amount received and change, card
 * through the simulated terminal (approve or decline), bKash and Nagad as a
 * simulated push to the customer's phone, and any mix of them.
 */
export function TenderEditor({
  drafts,
  onChange,
  dueP,
  seed,
  walletPhone,
  disabled,
}: {
  drafts: TenderDraft[]
  onChange: (drafts: TenderDraft[]) => void
  dueP: Poisha
  /** Stable per payment dialog; seeds simulated terminal codes */
  seed: string
  walletPhone?: string
  disabled?: boolean
}) {
  const { t, money } = useLocale()
  const resolved = resolveTenders(drafts, dueP)
  const allocatedP = resolved.reduce((sum, row) => sum + row.amountP, 0)
  const leftP = dueP - allocatedP

  const add = (tender: CounterTender) => {
    // The previous "rest" row keeps the amount it showed; the new row takes the rest.
    const frozen = drafts.map((draft, index) =>
      draft.amount === null ? { ...draft, amount: takaText(resolved[index].amountP) } : draft
    )
    onChange([...frozen, newDraft(tender, `${tender}-${drafts.length}-${seed}`)])
  }
  const update = (key: string, patch: Partial<TenderDraft>) =>
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  const remove = (key: string) => onChange(drafts.filter((draft) => draft.key !== key))

  return (
    <div className="flex flex-col gap-3" data-testid="tender-editor">
      <div className="grid grid-cols-2 gap-2 @min-[22rem]/checkout:grid-cols-4">
        {COUNTER_TENDERS.map((tender) => {
          const Icon = TENDER_ICON[tender]
          return (
            <Button
              key={tender}
              type="button"
              variant="neutral"
              size="sm"
              data-testid="tender-add"
              data-tender={tender}
              disabled={disabled}
              onClick={() => add(tender)}
              className="justify-start"
            >
              <Icon />
              {t(`billing.tender.${tender}`)}
            </Button>
          )
        })}
      </div>

      {resolved.length === 0 ? (
        <p className="rounded-md bg-surface-raised px-3 py-2.5 text-[0.8125rem] text-muted-foreground">
          {dueP > 0 ? t("billing.cashier.tenders.hint") : t("billing.cashier.tenders.nothingDue")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {resolved.map((row) => (
            <li key={row.key}>
              <TenderRow
                row={row}
                seed={seed}
                walletPhone={walletPhone}
                disabled={disabled}
                onUpdate={(patch) => update(row.key, patch)}
                onRemove={() => remove(row.key)}
              />
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 ? (
        <p
          data-testid="tender-balance"
          data-left={leftP}
          className={cn(
            "flex items-center gap-1.5 text-[0.8125rem]",
            leftP === 0 ? "text-success" : "text-destructive"
          )}
        >
          {leftP === 0 ? <Check className="size-4" /> : <CircleAlert className="size-4" />}
          {leftP === 0
            ? t("billing.cashier.tenders.balanced")
            : leftP > 0
              ? t("billing.cashier.tenders.left", { amount: money(leftP) })
              : t("billing.cashier.tenders.over", { amount: money(-leftP) })}
        </p>
      ) : null}
    </div>
  )
}

function TenderRow({
  row,
  seed,
  walletPhone,
  disabled,
  onUpdate,
  onRemove,
}: {
  row: ResolvedTender
  seed: string
  walletPhone?: string
  disabled?: boolean
  onUpdate: (patch: Partial<TenderDraft>) => void
  onRemove: () => void
}) {
  const { t, money, digits } = useLocale()
  const Icon = TENDER_ICON[row.tender]
  const cardReady = row.card === "approved" && row.approvedP === row.amountP
  const changeP = row.receivedP !== null ? row.receivedP - row.amountP : null

  return (
    <div
      data-testid="tender-row"
      data-tender={row.tender}
      className="flex flex-col gap-2 rounded-md bg-surface-raised/60 p-2.5 dark:bg-surface-raised/45"
    >
      <div className="flex items-center gap-2">
        <span className={cn("tag h-6 shrink-0 gap-1 px-2", TENDER_TAG[row.tender])}>
          <Icon className="size-3.5" />
          {t(`billing.tender.${row.tender}`)}
        </span>
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[0.8125rem] text-muted-foreground">
            ৳
          </span>
          <Input
            data-testid="tender-amount"
            data-tender={row.tender}
            inputMode="decimal"
            aria-label={t("billing.cashier.tenders.amountOf", {
              tender: t(`billing.tender.${row.tender}`),
            })}
            disabled={disabled}
            value={row.amount === null ? takaText(row.amountP) : row.amount}
            onChange={(event) => onUpdate({ amount: event.target.value, card: row.card === "approved" ? "idle" : row.card })}
            className={cn(
              "nums h-8 pl-6 text-right font-medium",
              row.amount === null && "text-link"
            )}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={t("billing.cashier.tenders.remove")}
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>

      {row.tender === "cash" ? (
        <div className="flex items-center gap-2 text-[0.8125rem]">
          <label className="shrink-0 text-muted-foreground" htmlFor={`${row.key}-received`}>
            {t("billing.cashier.tenders.received")}
          </label>
          <Input
            id={`${row.key}-received`}
            data-testid="tender-received"
            inputMode="decimal"
            placeholder={takaText(row.amountP)}
            disabled={disabled}
            value={row.received}
            onChange={(event) => onUpdate({ received: event.target.value })}
            className="nums h-8 min-w-0 flex-1 text-right"
          />
          <span
            data-testid="tender-change"
            className={cn(
              "nums shrink-0 font-semibold",
              changeP !== null && changeP < 0 ? "text-destructive" : "text-foreground"
            )}
          >
            {changeP !== null && changeP < 0
              ? t("billing.cashier.tenders.short", { amount: money(-changeP) })
              : t("billing.cashier.tenders.change", { amount: money(Math.max(0, changeP ?? 0)) })}
          </span>
        </div>
      ) : null}

      {row.tender === "card" ? (
        <div className="flex flex-col gap-2">
          {cardReady ? (
            <p
              data-testid="card-approved"
              className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-success"
            >
              <Check className="size-4" />
              {t("billing.cashier.tenders.cardApproved", { ref: row.ref ?? "" })}
            </p>
          ) : row.card === "waiting" ? (
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-2.5">
              <p className="flex items-center justify-between gap-2 text-[0.8125rem]">
                <span className="flex items-center gap-1.5">
                  <CreditCard className="size-4 text-link" />
                  {t("billing.cashier.tenders.terminalWaiting", { amount: money(row.amountP) })}
                </span>
                <SimulatedBadge />
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  data-testid="card-approve"
                  className="flex-1"
                  onClick={() =>
                    onUpdate({
                      card: "approved",
                      approvedP: row.amountP,
                      ref: terminalRef(`${seed}:${row.key}:${row.amountP}`),
                    })
                  }
                >
                  {t("billing.cashier.tenders.terminalApprove")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive-outline"
                  data-testid="card-decline"
                  className="flex-1"
                  onClick={() => onUpdate({ card: "declined", approvedP: undefined, ref: undefined })}
                >
                  {t("billing.cashier.tenders.terminalDecline")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="card-run"
                disabled={disabled || row.amountP <= 0}
                onClick={() => onUpdate({ card: "waiting" })}
              >
                <CreditCard />
                {t("billing.cashier.tenders.runCard")}
              </Button>
              {row.card === "declined" ? (
                <span className="text-xs font-medium text-destructive" data-testid="card-declined">
                  {t("billing.cashier.tenders.cardDeclined")}
                </span>
              ) : (
                <SimulatedBadge />
              )}
            </div>
          )}
        </div>
      ) : null}

      {isMfs(row.tender) ? (
        <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Smartphone className="size-3.5" />
            {walletPhone
              ? t("billing.cashier.tenders.pushTo", { phone: digits(walletPhone) })
              : t("billing.cashier.tenders.pushNoPhone")}
          </span>
          <SimulatedBadge />
        </p>
      ) : null}
    </div>
  )
}
