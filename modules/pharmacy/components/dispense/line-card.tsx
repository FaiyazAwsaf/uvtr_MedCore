"use client"

import * as React from "react"
import {
  ArrowLeftRight,
  CircleAlert,
  Hourglass,
  Minus,
  PackageX,
  Plus,
  Replace,
  ShieldAlert,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react"

import { rules } from "@/config/rules.config"
import type { BranchCode } from "@/config/brand.config"
import { MoneyText } from "@/components/shared/money-text"
import { StatusPill } from "@/components/shared/status"
import { StockBadge } from "@/components/shared/stock-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { addDaysISO } from "@/core/clock/dates"
import type { BatchRow, StockLevelRow } from "@/core/db/schema"
import { doseInstruction, findDosePattern } from "@/core/seed/content"
import { fefoAllocate, type StockStatus } from "@/core/stock/availability"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { usableUnits } from "@/modules/inventory/stock"

import {
  courseEndDate,
  dispenseBlock,
  expiresBeforeCourseEnd,
  outstandingOf,
  packBreakdown,
  roundToStrips,
  stripSizeOf,
} from "../../rules"
import { branchName, brandText, CategoryBadges, LineStatusPill, unique } from "../shared"
import type { LineData } from "./use-dispense-data"

export type LineChoice = { selected: boolean; qty: number }

/** What a line allows right now: the block, what is owed, what is on the shelf. */
export function lineFacts(
  data: LineData,
  branch: BranchCode,
  batches: Map<string, BatchRow>,
  today: string,
  nowMs: number
) {
  const block = dispenseBlock(data.line, nowMs)
  const outstanding = outstandingOf(data.line)
  const here = data.levels.filter((l) => l.branchId === branch)
  const batchList = here.map((l) => batches.get(l.batchId)).filter((b): b is BatchRow => !!b)
  const usable = usableUnits(here, batchList, today)
  const max = block ? 0 : Math.min(outstanding, usable)
  return { block, outstanding, here, batchList, usable, max }
}

/** The default choice: take everything owed that the shelf can cover. */
export function defaultChoice(facts: ReturnType<typeof lineFacts>): LineChoice {
  return { selected: facts.max > 0, qty: facts.max }
}

export function LineCard({
  data,
  branch,
  batches,
  today,
  nowMs,
  choice,
  onChoice,
  onBoughtElsewhere,
  onSubstitute,
  onRequestTransfer,
  transferPending,
}: {
  data: LineData
  branch: BranchCode
  batches: Map<string, BatchRow>
  today: string
  nowMs: number
  choice: LineChoice
  onChoice: (choice: LineChoice) => void
  onBoughtElsewhere: () => void
  onSubstitute: () => void
  onRequestTransfer: (from: BranchCode, qty: number) => void
  transferPending: boolean
}) {
  const { t, tk, num, dmy, locale } = useLocale()
  const { line, brand, generic } = data
  const facts = lineFacts(data, branch, batches, today, nowMs)
  const { block, outstanding, here, batchList, usable, max } = facts
  const final = block === "final"
  const stripSize = brand ? stripSizeOf(brand.packSizes) : undefined
  const qty = Math.min(choice.qty, max)
  const taking = choice.selected && qty > 0 && !block
  const picks = brand && taking
    ? fefoAllocate(qty, branch, brand.id, here, batchList, today).picks
    : []
  const heldBack = here
    .filter((l) => l.qty > 0)
    .map((level) => ({ level, batch: batches.get(level.batchId) }))
    .filter(
      (x): x is { level: StockLevelRow; batch: BatchRow } =>
        !!x.batch && (x.batch.status !== "ok" || x.batch.expiry < today)
    )

  // Course cover for the units handed over now (a partial covers fewer days).
  const perDay = findDosePattern(line.dosePattern)?.perDay ?? 0
  const coverEnd =
    perDay > 0 && qty > 0
      ? addDaysISO(today, Math.max(1, Math.ceil(qty / perDay)) - 1)
      : courseEndDate(today, line.durationDays)
  const dose = doseInstruction(line.dosePattern, line.mealTiming, line.durationDays)

  const otherBranches = unique(data.levels.map((l) => l.branchId))
    .filter((code) => code !== branch)
    .map((code) => {
      const levels = data.levels.filter((l) => l.branchId === code)
      const list = levels.map((l) => batches.get(l.batchId)).filter((b): b is BatchRow => !!b)
      return { code, usable: usableUnits(levels, list, today) }
    })
    .filter((b) => b.usable > 0)
    .sort((a, b) => a.code.localeCompare(b.code))
  const status: StockStatus =
    usable > 0 ? "in-stock" : otherBranches.length ? "other-branch" : "out"

  const setQty = (value: number) =>
    onChoice({ selected: value > 0, qty: Math.max(0, Math.min(max, Math.round(value))) })
  const pack = packBreakdown(qty, stripSize)
  const rest = outstanding - qty

  return (
    <article
      data-testid="dispense-line"
      data-rx-line-id={line.id}
      data-status={line.status}
      className={cn(
        "@container/line surface-card flex flex-col gap-3 p-4",
        taking && "ring-1 ring-primary/50",
        final && "opacity-80"
      )}
    >
      <header className="flex items-start gap-3">
        <Checkbox
          data-testid="dispense-select"
          aria-label={t("pharmacy.dispense.line.select")}
          checked={taking}
          disabled={!!block || max === 0}
          onCheckedChange={(checked) =>
            onChoice({ selected: !!checked, qty: checked && choice.qty === 0 ? max : choice.qty })
          }
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-[0.9375rem] leading-snug font-semibold" lang="en">
              {brand ? brandText(brand) : line.nonDictionaryName}
            </h3>
            <span className="text-xs text-muted-foreground">
              {brand ? brand.unitLabel[locale] : line.form}
            </span>
            {brand ? <CategoryBadges brand={brand} /> : null}
          </div>
          <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground" lang="en">
            {generic?.name}
            {generic?.glossBn && locale === "bn" ? (
              <span lang="bn"> · {generic.glossBn}</span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <LineStatusPill status={line.status} />
          {!final ? (
            line.paymentCleared ? (
              <StatusPill tone="success" className="h-5 px-2 text-[0.6875rem]">
                {t("pharmacy.dispense.line.paid")}
              </StatusPill>
            ) : (
              <StatusPill tone="warning" className="h-5 px-2 text-[0.6875rem]">
                {t("pharmacy.dispense.line.unpaid")}
              </StatusPill>
            )
          ) : null}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.8125rem] @min-[34rem]/line:grid-cols-4">
        <Fact label={t("pharmacy.dispense.line.dose")} wide>
          <span className="font-medium">{dose[locale]}</span>
        </Fact>
        <Fact label={t("pharmacy.dispense.line.prescribed")}>
          <span className="nums">{num(line.qtyPrescribed)}</span>
        </Fact>
        <Fact label={t("pharmacy.dispense.line.given")}>
          <span className="nums">{num(line.dispensedQty)}</span>
        </Fact>
        <Fact label={t("pharmacy.dispense.line.outstanding")}>
          <span className={cn("nums font-semibold", outstanding > 0 && !final && "text-warning")}>
            {num(final ? 0 : outstanding)}
          </span>
        </Fact>
        <Fact label={t("pharmacy.dispense.line.duration")}>
          {line.durationDays > 0
            ? t("pharmacy.dispense.line.days", { count: num(line.durationDays) })
            : t("pharmacy.dispense.line.continue")}
        </Fact>
      </dl>

      {line.status === "partial" && line.balanceUntil ? (
        <p className={cn("text-xs", block === "balance-expired" ? "text-destructive" : "text-muted-foreground")}>
          {block === "balance-expired"
            ? t("pharmacy.dispense.line.balanceExpired", { date: dmy(line.balanceUntil) })
            : t("pharmacy.dispense.line.balanceUntil", { date: dmy(line.balanceUntil) })}
        </p>
      ) : null}

      {block === "unpaid" ? (
        <Notice tone="warning" icon={CircleAlert}>
          {t("pharmacy.dispense.line.unpaidHint")}
        </Notice>
      ) : null}
      {block === "no-brand" ? (
        <Notice tone="warning" icon={CircleAlert}>
          {t("pharmacy.dispense.line.nonDictionary")}
        </Notice>
      ) : null}
      {block === "awaiting-prescriber" ? (
        <Notice tone="info" icon={Hourglass}>
          {t("pharmacy.dispense.line.awaitingPrescriber", {
            brand: brandText(data.proposedBrand),
          })}
        </Notice>
      ) : null}

      {!final && brand && block !== "awaiting-prescriber" ? (
        <div className="flex flex-col gap-2 rounded-md bg-surface-raised/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("pharmacy.dispense.line.fefo")}
            </span>
            <StockBadge
              status={status}
              qty={usable > 0 ? usable : otherBranches[0]?.usable}
              branch={usable > 0 ? undefined : otherBranches[0]?.code}
              className="ml-auto"
            />
          </div>
          {usable === 0 ? (
            <p className="flex items-center gap-1.5 text-[0.8125rem] text-destructive">
              <PackageX className="size-4" />
              {t("pharmacy.dispense.line.noStock", { branch: branchName(branch, locale) })}
            </p>
          ) : null}
          {picks.length ? (
            <ul className="flex flex-col gap-1">
              {picks.map((pick) => {
                const early = expiresBeforeCourseEnd(pick.batch.expiry, coverEnd)
                return (
                  <li
                    key={pick.batch.id}
                    data-testid="dispense-batch"
                    data-batch-id={pick.batch.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]"
                  >
                    <span className="font-mono text-xs" lang="en">
                      {pick.batch.batchNo}
                    </span>
                    <span className={cn("nums", early ? "text-warning" : "text-muted-foreground")}>
                      {t("pharmacy.dispense.line.exp", { date: dmy(pick.batch.expiry) })}
                    </span>
                    <span className="nums ml-auto font-medium">
                      {t("pharmacy.dispense.line.take", { qty: num(pick.take) })}
                    </span>
                    {early && coverEnd ? (
                      <span className="flex w-full items-start gap-1.5 text-xs text-warning">
                        <TriangleAlert className="mt-px size-3.5 shrink-0" />
                        {t("pharmacy.dispense.line.expiresBeforeCourse", {
                          batch: pick.batch.batchNo,
                          expiry: dmy(pick.batch.expiry),
                          end: dmy(coverEnd),
                        })}
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
          {heldBack.map(({ batch }) => (
            <p
              key={batch.id}
              className="flex items-center gap-2 text-xs text-muted-foreground line-through decoration-muted-foreground/50"
            >
              <span className="font-mono" lang="en">
                {batch.batchNo}
              </span>
              <span className="no-underline">
                {batch.status === "quarantine"
                  ? t("pharmacy.dispense.line.blocked.quarantine")
                  : t("pharmacy.dispense.line.blocked.expired")}
              </span>
            </p>
          ))}

          {max > 0 ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor={`qty-${line.id}`}>
                {t("pharmacy.dispense.line.qty")}
              </label>
              <div className="flex items-center gap-1">
                <Button
                  variant="neutral"
                  size="icon-sm"
                  aria-label={t("pharmacy.dispense.line.less")}
                  onClick={() => setQty(qty - (stripSize ?? 1))}
                  disabled={qty <= 0}
                >
                  <Minus />
                </Button>
                <Input
                  id={`qty-${line.id}`}
                  data-testid="dispense-qty"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={max}
                  value={choice.selected ? qty : 0}
                  onChange={(event) => setQty(Number(event.target.value) || 0)}
                  className="nums h-8 w-20 text-center"
                />
                <Button
                  variant="neutral"
                  size="icon-sm"
                  aria-label={t("pharmacy.dispense.line.more")}
                  onClick={() => setQty(Math.max(qty, 0) + (stripSize ?? 1))}
                  disabled={qty >= max}
                >
                  <Plus />
                </Button>
              </div>
              {stripSize && taking ? (
                <span className="nums text-xs text-muted-foreground">
                  {pack.strips && pack.loose
                    ? t("pharmacy.dispense.line.pack", {
                        strips: num(pack.strips),
                        size: num(stripSize),
                        loose: num(pack.loose),
                      })
                    : pack.strips
                      ? t("pharmacy.dispense.line.packStrips", {
                          strips: num(pack.strips),
                          size: num(stripSize),
                        })
                      : t("pharmacy.dispense.line.packLoose", { loose: num(pack.loose) })}
                </span>
              ) : null}
              <span className="ml-auto flex gap-1">
                {stripSize && taking && roundToStrips(qty, stripSize, max) !== qty ? (
                  <Button
                    variant="link"
                    size="xs"
                    onClick={() => setQty(roundToStrips(qty, stripSize, max))}
                  >
                    {t("pharmacy.dispense.line.wholeStrips")}
                  </Button>
                ) : null}
                {qty !== max ? (
                  <Button variant="link" size="xs" onClick={() => setQty(max)}>
                    {t("pharmacy.dispense.line.allDue", { qty: num(max) })}
                  </Button>
                ) : null}
              </span>
            </div>
          ) : null}

          {taking && rest > 0 ? (
            <p className="text-xs text-warning">
              {usable < outstanding && qty === usable
                ? t("pharmacy.dispense.line.shortfall", {
                    available: num(usable),
                    rest: num(rest),
                    days: num(rules.dispenseBalanceDays),
                  })
                : t("pharmacy.dispense.line.partialChoice", {
                    rest: num(rest),
                    days: num(rules.dispenseBalanceDays),
                  })}
            </p>
          ) : null}
          {brand.category === "controlled" && taking ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <ShieldAlert className="size-3.5" />
              {t("pharmacy.dispense.line.controlledNote")}
            </p>
          ) : null}
        </div>
      ) : null}

      {!final && block !== "awaiting-prescriber" ? (
        <footer className="flex flex-wrap items-center gap-2">
          {taking && data.basket ? (
            <span className="text-xs text-muted-foreground">
              <MoneyText poisha={qty * data.basket.unitPriceP} />
            </span>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {otherBranches.length && outstanding > usable && brand ? (
              data.transfers.length ? (
                <StatusPill tone="info" className="h-7">
                  <ArrowLeftRight />
                  {tk("pharmacy.dispense.line.transferRequested", {
                    transferNo: data.transfers[0].transferNo,
                  })}
                </StatusPill>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={transferPending}
                  onClick={() =>
                    onRequestTransfer(
                      otherBranches[0].code,
                      Math.min(outstanding - usable, otherBranches[0].usable)
                    )
                  }
                >
                  <ArrowLeftRight />
                  {t("pharmacy.dispense.line.requestTransfer", {
                    branch: branchName(otherBranches[0].code, locale),
                  })}
                </Button>
              )
            ) : null}
            {brand ? (
              <Button
                data-testid="substitution-request"
                variant="neutral"
                size="sm"
                onClick={onSubstitute}
              >
                <Replace />
                {t("pharmacy.dispense.line.substitute")}
              </Button>
            ) : null}
            <Button
              data-testid="bought-elsewhere"
              variant="neutral"
              size="sm"
              onClick={onBoughtElsewhere}
            >
              <ShoppingBag />
              {t("pharmacy.dispense.line.boughtElsewhere")}
            </Button>
          </span>
        </footer>
      ) : null}
    </article>
  )
}

function Fact({
  label,
  children,
  wide = false,
}: {
  label: React.ReactNode
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: "warning" | "info"
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2 text-[0.8125rem]",
        tone === "warning"
          ? "bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning"
          : "bg-[color-mix(in_oklch,var(--info)_14%,transparent)] text-info"
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
