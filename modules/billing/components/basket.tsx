"use client"

import * as React from "react"
import { ListChecks, ShoppingBasket } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { Checkbox } from "@/components/ui/checkbox"
import type { BasketLineRow, Id, ISODate, Ms } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import type { Cover } from "../settle"
import { lineNames, SOURCE_ICON, SOURCE_KEY, SOURCE_ORDER } from "./labels"

const GRID =
  "grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 @min-[34rem]/basket:grid-cols-[1.75rem_minmax(0,1fr)_3rem_6rem_6.5rem]"

/**
 * The patient's open bill grouped by where it came from (consultation,
 * tests, imaging, medicines), with a checkbox per line: the patient chooses
 * what to pay now, medicines especially (plan §9). Lines added by another
 * window while the bill is open slide in with the sync flash.
 */
export function Basket({
  lines,
  selected,
  onChange,
  cover,
  mountedAt,
  laterVisits = {},
}: {
  lines: BasketLineRow[]
  selected: ReadonlySet<Id>
  onChange: (ids: Id[], checked: boolean) => void
  cover: Cover | null
  mountedAt: Ms
  /** Fees for a visit after today, with the visit date */
  laterVisits?: Record<Id, ISODate>
}) {
  const { t, tk, num, money } = useLocale()
  const groups = React.useMemo(
    () =>
      SOURCE_ORDER.map((source) => ({
        source,
        lines: lines.filter((line) => line.sourceType === source),
      })).filter((group) => group.lines.length > 0),
    [lines]
  )
  const selectedCount = lines.filter((line) => selected.has(line.id)).length
  const allIds = lines.map((line) => line.id)
  const allChecked = selectedCount === lines.length && lines.length > 0

  return (
    <SectionCard
      title={t("billing.cashier.basket.title")}
      subtitle={
        lines.length
          ? t("billing.cashier.basket.subtitle", {
              selected: num(selectedCount),
              count: num(lines.length),
            })
          : undefined
      }
      icon={ShoppingBasket}
      size="sm"
      action={
        lines.length > 1 ? (
          <button
            type="button"
            onClick={() => onChange(allIds, !allChecked)}
            className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
          >
            <ListChecks className="size-4" />
            {allChecked
              ? t("billing.cashier.basket.selectNone")
              : t("billing.cashier.basket.selectAll")}
          </button>
        ) : undefined
      }
    >
      {lines.length === 0 ? (
        <EmptyState
          size="sm"
          icon={ShoppingBasket}
          title={t("billing.cashier.basket.empty")}
        />
      ) : (
        <div
          className="@container/basket flex flex-col gap-3"
          data-testid="basket"
        >
          <div
            className={cn(
              GRID,
              "h-9 rounded-md bg-surface-raised px-2 text-[0.8125rem] font-medium"
            )}
          >
            <span />
            <span>{t("billing.cashier.basket.item")}</span>
            <span className="hidden text-right @min-[34rem]/basket:block">
              {t("billing.cashier.basket.qty")}
            </span>
            <span className="hidden text-right @min-[34rem]/basket:block">
              {t("billing.cashier.basket.unitPrice")}
            </span>
            <span className="text-right">
              {t("billing.cashier.basket.amount")}
            </span>
          </div>

          {groups.map((group) => {
            const Icon = SOURCE_ICON[group.source]
            const ids = group.lines.map((line) => line.id)
            const count = ids.filter((id) => selected.has(id)).length
            const groupTotal = group.lines.reduce(
              (sum, l) => sum + l.qty * l.unitPriceP,
              0
            )
            return (
              <div
                key={group.source}
                className="flex flex-col"
                data-testid="basket-group"
              >
                <div className={cn(GRID, "px-2 pb-1")}>
                  <Checkbox
                    checked={count === ids.length}
                    indeterminate={count > 0 && count < ids.length}
                    onCheckedChange={(checked) => onChange(ids, checked)}
                    aria-label={tk(
                      `billing.source.${SOURCE_KEY[group.source]}`
                    )}
                  />
                  <span className="flex min-w-0 items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <Icon className="size-3.5" />
                    <span className="truncate">
                      {tk(`billing.source.${SOURCE_KEY[group.source]}`)}
                    </span>
                  </span>
                  <span className="hidden @min-[34rem]/basket:block" />
                  <span className="hidden @min-[34rem]/basket:block" />
                  <MoneyText
                    poisha={groupTotal}
                    className="text-right text-xs font-medium text-muted-foreground"
                  />
                </div>
                {group.lines.map((line) => (
                  <BasketLine
                    key={line.id}
                    line={line}
                    checked={selected.has(line.id)}
                    onCheckedChange={(checked) => onChange([line.id], checked)}
                    fresh={line.createdAt > mountedAt}
                    corporateClient={
                      line.payerType === "corporate"
                        ? (cover?.client?.name ?? null)
                        : undefined
                    }
                    coPayPct={cover?.coPayPct}
                    laterVisit={laterVisits[line.id]}
                  />
                ))}
              </div>
            )
          })}
          <p className="px-2 text-xs text-muted-foreground">
            {t("billing.cashier.basket.total", {
              amount: money(
                lines.reduce((sum, l) => sum + l.qty * l.unitPriceP, 0)
              ),
            })}
          </p>
        </div>
      )}
    </SectionCard>
  )
}

function BasketLine({
  line,
  checked,
  onCheckedChange,
  fresh,
  corporateClient,
  coPayPct,
  laterVisit,
}: {
  line: BasketLineRow
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  fresh: boolean
  /** undefined: self pay; null: marked corporate but no live cover */
  corporateClient?: { en: string; bn: string } | null
  coPayPct?: number
  laterVisit?: ISODate
}) {
  const { t, locale, num, money, dmy } = useLocale()
  const names = lineNames(line, locale)
  const amount = line.qty * line.unitPriceP
  return (
    <label
      data-testid="basket-line"
      data-line-id={line.id}
      data-source-type={line.sourceType}
      data-selected={checked}
      data-later-visit={laterVisit}
      className={cn(
        GRID,
        "min-h-11 cursor-pointer rounded-md border-b border-hairline px-2 py-2 transition-colors last:border-0 hover:bg-primary-soft",
        !checked && "text-muted-foreground",
        fresh && "flash-sync"
      )}
    >
      <Checkbox
        data-testid="basket-select"
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value)}
        aria-label={names.primary}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "truncate text-[0.8125rem] font-medium",
            checked && "text-foreground"
          )}
        >
          {names.primary}
        </span>
        {names.secondary ? (
          <span className="truncate text-xs text-muted-foreground">
            {names.secondary}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground @min-[34rem]/basket:hidden">
          <span className="nums">
            {t("billing.cashier.basket.qtyTimes", {
              qty: num(line.qty),
              price: money(line.unitPriceP),
            })}
          </span>
        </span>
        {laterVisit ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="tag tag-blue">
              {t("billing.cashier.basket.laterVisit", {
                date: dmy(laterVisit),
              })}
            </span>
          </span>
        ) : null}
        {corporateClient !== undefined ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {corporateClient ? (
              <span className="tag tag-purple">
                {t("billing.cashier.basket.corporate", {
                  client: corporateClient[locale],
                  pct: num(coPayPct ?? 0),
                })}
              </span>
            ) : (
              <span className="tag tag-amber">
                {t("billing.cashier.basket.coverInactive")}
              </span>
            )}
          </span>
        ) : null}
      </span>
      <span className="nums hidden text-right text-[0.8125rem] @min-[34rem]/basket:block">
        {num(line.qty)}
      </span>
      <MoneyText
        poisha={line.unitPriceP}
        className="hidden text-right text-[0.8125rem] @min-[34rem]/basket:block"
      />
      <MoneyText
        poisha={amount}
        className={cn(
          "text-right text-[0.8125rem] font-semibold",
          checked && "text-foreground"
        )}
      />
    </label>
  )
}
