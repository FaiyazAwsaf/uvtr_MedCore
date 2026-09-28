"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Banknote, Plus, ReceiptText, Search, ShoppingCart, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StockBadge } from "@/components/shared/stock-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { BatchRow, BrandRow } from "@/core/db/schema"
import { rankMedicines, type MedicineCatalog } from "@/core/search/medicines"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { usableUnits } from "@/modules/inventory/stock"

import { counterSale } from "../commands"
import { stripSizeOf } from "../rules"
import {
  brandText,
  CategoryBadges,
  PageBody,
  PageHeader,
  unique,
  useActionKey,
  useModuleCommand,
  usePharmacyContext,
} from "./shared"

type CartItem = { brandId: string; qty: number; unitPriceP: number }

/** The medicine dictionary for search (static during the demo). */
function useCatalog(): MedicineCatalog | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [brands, generics, companies, classes] = await Promise.all([
      db.brands.toArray(),
      db.generics.toArray(),
      db.pharmaCompanies.toArray(),
      db.drugClasses.toArray(),
    ])
    return { brands, generics, companies, classes }
  }, [db])
}

/** Usable units per brand at the branch (ok, unexpired batches). */
function useBranchStock(branch: string | null): Map<string, number> | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const out = new Map<string, number>()
    if (!branch) return out
    const levels = await db.stockLevels.where("branchId").equals(branch).toArray()
    const batches = (await db.batches.bulkGet(unique(levels.map((l) => l.batchId)))).filter(
      (b): b is BatchRow => !!b
    )
    const today = dhakaDate(now())
    for (const brandId of unique(levels.map((l) => l.brandId))) {
      out.set(brandId, usableUnits(levels.filter((l) => l.brandId === brandId), batches, today))
    }
    return out
  }, [db, branch])
}

export function CounterScreen() {
  const { t, num, money, locale } = useLocale()
  const db = useDb()
  const { branch, branchLabel } = usePharmacyContext()
  const catalog = useCatalog()
  const stock = useBranchStock(branch)
  const wide = useMediaQuery("(min-width: 1280px)")
  const [query, setQuery] = React.useState("")
  const [cart, setCart] = React.useState<CartItem[]>([])
  const [tendered, setTendered] = React.useState("")
  const [key, renewKey] = useActionKey()
  const sale = useModuleCommand(counterSale)
  const today = dhakaDate(useNow(60_000) || now())

  const brandById = React.useMemo(
    () => new Map((catalog?.brands ?? []).map((b) => [b.id, b])),
    [catalog]
  )
  const hits = React.useMemo(() => {
    if (!catalog || query.trim().length < 2) return []
    return rankMedicines(query, catalog, { kinds: ["brand"], limit: 12 })
  }, [catalog, query])

  const recent = useLiveQuery(async () => {
    if (!branch) return []
    const rows = (await db.dispenses.where("branchId").equals(branch).toArray()).filter(
      (d) => d.saleType === "otc" && dhakaDate(d.at) === today
    )
    const groups = new Map<number, typeof rows>()
    for (const row of rows) groups.set(row.createdAt, [...(groups.get(row.createdAt) ?? []), row])
    return [...groups.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([at, list]) => ({
        at,
        items: unique(list.map((d) => d.brandId)).length,
        units: list.reduce((sum, d) => sum + d.qty, 0),
        totalP: list.reduce((sum, d) => sum + d.qty * d.unitPriceP, 0),
        brands: unique(list.map((d) => d.brandId)),
      }))
  }, [db, branch, today])

  const add = (brand: BrandRow) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.brandId === brand.id)
      const step = stripSizeOf(brand.packSizes) ?? 1
      if (existing) {
        return prev.map((i) => (i.brandId === brand.id ? { ...i, qty: i.qty + step } : i))
      }
      return [...prev, { brandId: brand.id, qty: step, unitPriceP: brand.unitPriceP }]
    })
  }
  const update = (brandId: string, patch: Partial<CartItem>) =>
    setCart((prev) => prev.map((i) => (i.brandId === brandId ? { ...i, ...patch } : i)))

  const totalP = cart.reduce((sum, i) => sum + i.qty * i.unitPriceP, 0)
  const tenderedP = tendered.trim() ? Math.round(Number(tendered) * 100) : undefined
  const changeP = tenderedP !== undefined ? tenderedP - totalP : undefined
  const canSell =
    cart.length > 0 &&
    cart.every((i) => i.qty > 0) &&
    (tenderedP === undefined || tenderedP >= totalP) &&
    !sale.pending

  const sell = async () => {
    const result = await sale.run({
      items: cart.map((i) => ({ brandId: i.brandId, qty: i.qty, unitPriceP: i.unitPriceP })),
      tenderedP,
      idempotencyKey: key,
    })
    renewKey()
    if (!result) return
    toast.success(t("pharmacy.counter.done", { amount: money(result.totalP) }))
    setCart([])
    setTendered("")
  }

  const results = (
    <SectionCard
      title={t("pharmacy.counter.search")}
      icon={Search}
      size="sm"
      bodyClassName="flex flex-col gap-3"
    >
      <Input
        data-testid="counter-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("pharmacy.counter.search")}
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">{t("pharmacy.counter.searchHint")}</p>
      {query.trim().length >= 2 && hits.length === 0 ? (
        <p className="py-4 text-center text-[0.8125rem] text-muted-foreground">
          {t("pharmacy.counter.noMatch")}
        </p>
      ) : null}
      <ul className={cn("flex flex-col divide-y divide-hairline", !wide && "max-h-72 overflow-y-auto")}>
        {hits.map((hit) => {
          const brand = hit.brandId ? brandById.get(hit.brandId) : undefined
          if (!brand) return null
          const usable = stock?.get(brand.id) ?? 0
          const needsRx = brand.category !== "otc" || brand.isAntibiotic
          return (
            <li
              key={hit.id}
              data-testid="counter-result"
              data-brand-id={brand.id}
              className="flex items-center gap-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.875rem] font-medium" lang="en">
                    {hit.label}
                  </span>
                  <CategoryBadges brand={brand} />
                </div>
                <p className="truncate text-xs text-muted-foreground" lang="en">
                  {hit.detail}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span>
                    {t("pharmacy.counter.perUnit", {
                      price: money(brand.unitPriceP),
                      unit: brand.unitLabel[locale],
                    })}
                  </span>
                  <span>{t("pharmacy.counter.mrp", { price: money(brand.mrpP) })}</span>
                  {needsRx ? (
                    <span className="font-medium text-warning">{t("pharmacy.counter.needsRx")}</span>
                  ) : null}
                </p>
              </div>
              <StockBadge status={usable > 0 ? "in-stock" : "out"} qty={usable} />
              <Button
                data-testid="counter-add"
                variant="outline"
                size="sm"
                disabled={usable === 0}
                onClick={() => add(brand)}
              >
                <Plus />
                {t("pharmacy.counter.add")}
              </Button>
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )

  const cartCard = (
    <SectionCard
      title={t("pharmacy.counter.cart")}
      icon={ShoppingCart}
      size="sm"
      action={<SimulatedBadge label={t("pharmacy.counter.cashOnly")} />}
      bodyClassName="flex flex-col gap-3"
    >
      {cart.length === 0 ? (
        <p className="py-6 text-center text-[0.8125rem] text-muted-foreground">
          {t("pharmacy.counter.empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline" data-testid="counter-cart">
          {cart.map((item) => {
            const brand = brandById.get(item.brandId)
            if (!brand) return null
            const above = item.unitPriceP > brand.mrpP
            return (
              <li key={item.brandId} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-medium" lang="en">
                    {brandText(brand)}
                  </span>
                  <CategoryBadges brand={brand} className="mt-0.5" />
                </div>
                <label className="flex flex-col gap-0.5 text-[0.6875rem] text-muted-foreground">
                  {t("pharmacy.common.qty")}
                  <Input
                    type="number"
                    min={1}
                    value={item.qty}
                    onChange={(event) =>
                      update(item.brandId, { qty: Math.max(0, Math.round(Number(event.target.value) || 0)) })
                    }
                    className="nums h-8 w-18 text-center"
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[0.6875rem] text-muted-foreground">
                  {t("pharmacy.counter.unitPrice")}
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={item.unitPriceP / 100}
                    aria-invalid={above || undefined}
                    onChange={(event) =>
                      update(item.brandId, {
                        unitPriceP: Math.max(0, Math.round(Number(event.target.value) * 100) || 0),
                      })
                    }
                    className="nums h-8 w-22 text-right"
                  />
                </label>
                <span className="w-24 text-right text-[0.8125rem] font-semibold">
                  <MoneyText poisha={item.qty * item.unitPriceP} />
                  {above ? (
                    <span className="block text-[0.6875rem] font-normal text-destructive">
                      {t("pharmacy.counter.aboveMrp")}
                    </span>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("pharmacy.counter.remove")}
                  onClick={() => setCart((prev) => prev.filter((i) => i.brandId !== item.brandId))}
                >
                  <Trash2 />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-col gap-2 border-t border-hairline pt-3">
        <div className="flex items-center justify-between text-[0.9375rem] font-semibold">
          <span>{t("pharmacy.counter.total")}</span>
          <MoneyText poisha={totalP} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <Banknote className="size-4" />
            {t("pharmacy.counter.tendered")}
            <Input
              data-testid="counter-tendered"
              type="number"
              min={0}
              value={tendered}
              onChange={(event) => setTendered(event.target.value)}
              className="nums h-8 w-28 text-right"
            />
          </label>
          {changeP !== undefined ? (
            <span
              className={cn(
                "ml-auto text-[0.8125rem] font-medium",
                changeP < 0 ? "text-destructive" : "text-success"
              )}
            >
              {changeP < 0
                ? t("pharmacy.counter.short", { amount: money(-changeP) })
                : `${t("pharmacy.counter.change")}: ${money(changeP)}`}
            </span>
          ) : null}
        </div>
        <Button data-testid="counter-sell" size="lg" disabled={!canSell} onClick={sell}>
          <ReceiptText />
          {t("pharmacy.counter.sell")}
        </Button>
      </div>
    </SectionCard>
  )

  const recentCard = (
    <SectionCard title={t("pharmacy.counter.recent")} size="sm" bodyClassName="flex flex-col">
      {recent && recent.length === 0 ? (
        <EmptyState size="sm" title={t("pharmacy.counter.recentEmpty")} />
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {(recent ?? []).slice(0, 8).map((sale) => (
            <li key={sale.at} className="flex items-center gap-3 py-2 text-[0.8125rem]">
              <DateText value={sale.at} variant="time" className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" lang="en">
                {sale.brands.map((id) => brandText(brandById.get(id))).join(", ")}
              </span>
              <span className="nums text-xs text-muted-foreground">
                {t("pharmacy.common.units", { count: num(sale.units) })}
              </span>
              <MoneyText poisha={sale.totalP} className="font-medium" />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )

  return (
    <PageBody data-testid="counter-screen">
      <PageHeader
        title={t("pharmacy.counter.title")}
        subtitle={`${branchLabel} · ${t("pharmacy.counter.subtitle")}`}
      />
      <div className={cn("grid items-start gap-4", wide && "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        {results}
        <div className="flex min-w-0 flex-col gap-4">
          {cartCard}
          {recentCard}
        </div>
      </div>
    </PageBody>
  )
}
