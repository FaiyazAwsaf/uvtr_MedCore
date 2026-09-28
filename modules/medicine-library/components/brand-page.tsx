"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowRight, BadgePercent, WifiOff } from "lucide-react"

import { branches } from "@/config/brand.config"
import { KeyValueGrid, type KeyValueItem } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill } from "@/components/shared/status"
import { StockBadge } from "@/components/shared/stock-badge"
import { useDb, useDbInfo } from "@/core/db/DbProvider"
import type { BrandRow, OfferRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { useLibraryHref, useLibraryIndex } from "../hooks"
import { libraryPaths } from "../paths"
import { branchStockRows, myBranchStock, type BranchStockRow } from "../stock"
import { CategoryBadges, KindIcon, useFormLabel } from "./bits"
import { LibraryLoading, LibraryNotFound, LibraryShell } from "./library-shell"
import { Monograph } from "./monograph"

/**
 * "/library/brand/[id]" (objective §3C): strength, form, manufacturer, DAR
 * number, packs, unit price and MRP, the sale-type badge and "See all brands
 * of this generic". Staff extras: stock per branch, live, and the offers on
 * this brand, which appear only here after the medicine is chosen (HAZ-04).
 */
export function BrandPage({ id }: { id: string }) {
  const { t, locale, num } = useLocale()
  const index = useLibraryIndex()
  const href = useLibraryHref()
  const formLabel = useFormLabel()

  if (!index) return <LibraryLoading />
  const brand = index.brandById.get(id)
  if (!brand) return <LibraryNotFound title={t("library.brand.notFound")} />

  const generic = index.genericById.get(brand.genericId)
  const company = index.companyById.get(brand.companyId)
  const cls = generic ? index.classById.get(generic.classId) : undefined
  const siblings = index.brandsByGeneric.get(brand.genericId)?.length ?? 0
  const unit = brand.unitLabel[locale]
  const pack = brand.packSizes[0]

  const details: KeyValueItem[] = [
    {
      label: t("library.brand.generic"),
      value: generic ? (
        <Link href={href(libraryPaths.generic(generic.id))} lang="en" className="text-link hover:underline">
          {generic.name}
        </Link>
      ) : null,
    },
    { label: t("library.brand.strength"), value: <span lang="en">{brand.strength}</span> },
    { label: t("library.brand.form"), value: formLabel(brand.form) },
    {
      label: t("library.brand.manufacturer"),
      value: company ? (
        <Link href={href(libraryPaths.company(company.id))} lang="en" className="text-link hover:underline">
          {company.name}
        </Link>
      ) : null,
    },
    {
      label: t("library.brand.class"),
      value: cls ? (
        <Link href={href(libraryPaths.class(cls.id))} lang="en" className="text-link hover:underline">
          {cls.name}
        </Link>
      ) : null,
    },
    { label: t("library.brand.darNo"), value: <span data-testid="brand-dar">{brand.darNo}</span>, mono: true },
    {
      label: t("library.brand.packSizes"),
      value: <span lang="en">{brand.packSizes.map((p) => p.label).join(", ")}</span>,
    },
    {
      label: t("library.brand.saleType"),
      value: <CategoryBadges category={brand.category} isAntibiotic={brand.isAntibiotic} />,
    },
  ]
  if (pack?.stripSize && pack.stripSize < pack.units) {
    details.push({
      label: t("library.brand.stripPrice", { count: num(pack.stripSize) }),
      value: <MoneyText poisha={brand.unitPriceP * pack.stripSize} />,
    })
  }
  if (pack && pack.units > 1) {
    details.push({
      label: t("library.brand.packPrice", { pack: pack.label }),
      value: <MoneyText poisha={brand.unitPriceP * pack.units} />,
    })
  }

  return (
    <LibraryShell
      rxBrandId={brand.id}
      crumbs={[
        ...(generic ? [{ label: generic.name, href: libraryPaths.generic(generic.id) }] : []),
        { label: `${brand.name} ${brand.strength}` },
      ]}
    >
      <header
        data-testid="brand-page"
        data-brand-id={brand.id}
        className="surface-card flex flex-wrap items-start gap-4 p-5"
      >
        <KindIcon kind="brand" className="size-12" />
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
          <h1 lang="en" className="text-[1.375rem] leading-tight font-semibold">
            {brand.name} <span className="font-medium text-muted-foreground">{brand.strength}</span>
          </h1>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{formLabel(brand.form)}</span>
            {generic ? (
              <>
                <span aria-hidden>·</span>
                <Link href={href(libraryPaths.generic(generic.id))} lang="en" className="text-link hover:underline">
                  {generic.name}
                </Link>
              </>
            ) : null}
            {company ? (
              <>
                <span aria-hidden>·</span>
                <Link href={href(libraryPaths.company(company.id))} lang="en" className="hover:text-foreground hover:underline">
                  {company.name}
                </Link>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <CategoryBadges category={brand.category} isAntibiotic={brand.isAntibiotic} />
            {generic ? (
              <Link
                href={href(libraryPaths.generic(generic.id))}
                data-testid="see-all-brands"
                className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
              >
                {t("library.brand.seeAllBrands")}
                <span className="nums rounded-full bg-primary-soft px-1.5 text-[0.6875rem]">{num(siblings)}</span>
                <ArrowRight className="size-3.5" />
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-stretch gap-5 rounded-md bg-surface-raised px-4 py-3">
          <PriceFigure
            label={t("library.brand.unitPrice")}
            testId="brand-price"
            poisha={brand.unitPriceP}
            caption={t("library.brand.perUnit", { unit })}
          />
          <span aria-hidden className="w-px bg-hairline" />
          <PriceFigure
            label={t("library.brand.mrp")}
            testId="brand-mrp"
            poisha={brand.mrpP}
            caption={t("library.brand.perUnit", { unit })}
            muted
          />
        </div>
      </header>

      <div className="@container">
        <div className="grid items-start gap-4 @min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
          <aside className="flex min-w-0 flex-col gap-4 @min-[60rem]:col-start-2 @min-[60rem]:row-start-1">
            <BranchStockCard brand={brand} />
            <OffersCard brandId={brand.id} />
          </aside>
          <div className="flex min-w-0 flex-col gap-4 @min-[60rem]:col-start-1 @min-[60rem]:row-start-1">
            <SectionCard title={t("library.brand.details")} size="sm">
              <KeyValueGrid items={details} columns={3} />
              <p className="mt-3 text-xs text-muted-foreground">{t("library.brand.priceRule")}</p>
            </SectionCard>
            {generic ? (
              <Monograph
                generic={generic}
                title={t("library.brand.clinical")}
                subtitle={t("library.brand.clinicalSubtitle", { generic: generic.name })}
                seeAllHref={href(libraryPaths.generic(generic.id))}
                seeAllLabel={t("library.brand.openGeneric")}
              />
            ) : null}
          </div>
        </div>
      </div>
    </LibraryShell>
  )
}

/** A price with its label and unit caption, in the brand header. */
function PriceFigure({
  label,
  testId,
  poisha,
  caption,
  muted = false,
}: {
  label: string
  testId: string
  poisha: number
  caption: string
  muted?: boolean
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        data-testid={testId}
        data-poisha={poisha}
        className={cn("text-lg leading-snug font-semibold", muted && "text-foreground/85")}
      >
        <MoneyText poisha={poisha} />
      </span>
      <span className="text-xs text-muted-foreground">{caption}</span>
    </div>
  )
}

/** Staff-only stock at each branch, live across windows (a dispense elsewhere updates it). */
function BranchStockCard({ brand }: { brand: BrandRow }) {
  const { t, locale } = useLocale()
  const db = useDb()
  const { isEdge, branch, network } = useDbInfo()
  const data = useLiveQuery(async () => {
    const [levels, reorders] = await Promise.all([
      db.stockLevels.where("brandId").equals(brand.id).toArray(),
      db.reorderLevels.where("brandId").equals(brand.id).toArray(),
    ])
    return { levels, reorders }
  }, [db, brand.id])

  const rows = React.useMemo(
    () =>
      data
        ? branchStockRows(brand.id, data.levels, data.reorders, {
            myBranch: branch,
            isEdge,
            network,
          })
        : [],
    [data, brand.id, branch, isEdge, network]
  )
  const summary =
    data && branch ? myBranchStock(brand.id, data.levels, data.reorders, branch, isEdge) : null
  const branchName = (code: string) => branches.find((b) => b.code === code)?.name[locale] ?? code

  return (
    <SectionCard
      title={t("library.stock.title")}
      size="sm"
      action={
        <StatusPill tone="muted" className="h-5 px-2 text-[0.6875rem]">
          {t("library.stock.staffOnly")}
        </StatusPill>
      }
      bodyClassName="flex flex-col gap-3"
    >
      {summary && branch ? (
        <div
          data-testid="my-branch-stock"
          data-status={summary.status}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-raised px-3 py-2"
        >
          <span className="text-[0.8125rem]">
            <span className="text-muted-foreground">{t("library.stock.yourBranch")}:</span>{" "}
            <span className="font-medium">
              {branchName(branch)} ({branch})
            </span>
          </span>
          <StockBadge
            status={summary.status}
            qty={summary.status === "other-branch" ? undefined : summary.onHand}
            branch={summary.otherBranches[0]}
          />
        </div>
      ) : null}
      {isEdge ? (
        <p className="flex items-start gap-2 text-xs text-warning">
          <WifiOff className="mt-px size-3.5 shrink-0" />
          {t("library.stock.offlineNote")}
        </p>
      ) : null}
      <ul className="flex flex-col">
        {rows.map((row) => (
          <BranchRow key={row.code} row={row} />
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("library.stock.note")}</p>
    </SectionCard>
  )
}

function BranchRow({ row }: { row: BranchStockRow }) {
  const { t, locale, num } = useLocale()
  const flash = useFlashOnChange(`${row.onHand}:${row.status}`)
  return (
    <li
      data-testid="branch-stock"
      data-branch={row.code}
      data-status={row.status}
      data-qty={row.onHand}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-2 py-2.5 last:border-b-0",
        row.mine && "rounded-md border-transparent bg-primary-soft",
        flash && "flash-sync"
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
          {row.name[locale]}
          <span className="font-mono text-[0.6875rem] text-muted-foreground">{row.code}</span>
          {row.mine ? (
            <span className="rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold text-primary-foreground">
              {t("library.stock.you")}
            </span>
          ) : null}
        </span>
        <span className="nums text-xs text-muted-foreground">
          {row.status === "unavailable-offline"
            ? null
            : row.stocked
              ? [
                  t("library.stock.reorderAt", { count: num(row.reorderLevel) }),
                  row.inTransitIn > 0 ? t("library.stock.inTransit", { count: num(row.inTransitIn) }) : null,
                  row.branchOffline ? t("library.stock.branchOffline") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("library.stock.notStocked")}
        </span>
      </span>
      {row.stocked || row.status === "unavailable-offline" ? (
        <StockBadge status={row.status} qty={row.onHand} asAt={row.asAt} />
      ) : (
        <StatusPill tone="muted">{t("library.stock.notStocked")}</StatusPill>
      )}
    </li>
  )
}

/** True for about 1.2 s after `value` changes (the cross-window sync flash). */
function useFlashOnChange(value: string): boolean {
  const [flash, setFlash] = React.useState(false)
  const previous = React.useRef(value)
  React.useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    setFlash(true)
    const timer = window.setTimeout(() => setFlash(false), 1200)
    return () => window.clearTimeout(timer)
  }, [value])
  return flash
}

/**
 * Offers on this brand (set by finance or admin). HAZ-04: they are shown
 * only here, after the medicine has been chosen, and never in search results
 * or lists.
 */
function OffersCard({ brandId }: { brandId: string }) {
  const { t, locale } = useLocale()
  const db = useDb()
  const offers = useLiveQuery(
    () => db.offers.where("brandId").equals(brandId).filter((o) => o.active).toArray(),
    [db, brandId]
  )
  const scope = (offer: OfferRow) => {
    if (!offer.branchId) return t("library.offers.allBranches")
    const name = branches.find((b) => b.code === offer.branchId)?.name[locale] ?? offer.branchId
    return t("library.offers.onlyAt", { branch: `${name} (${offer.branchId})` })
  }
  return (
    <SectionCard title={t("library.offers.title")} size="sm" bodyClassName="flex flex-col gap-3">
      {offers && offers.length ? (
        <ul className="flex flex-col gap-2">
          {offers.map((offer) => (
            <li
              key={offer.id}
              data-testid="brand-offer"
              className="flex items-start gap-3 rounded-md bg-[color-mix(in_oklch,var(--chart-2)_12%,transparent)] px-3 py-2.5"
            >
              <BadgePercent className="mt-0.5 size-4 shrink-0 text-chart-2" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[0.8125rem] font-medium">{offer.text[locale]}</span>
                <span className="text-xs text-muted-foreground">{scope(offer)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : offers ? (
        <p
          data-testid="brand-offers-none"
          className="flex items-center gap-2 rounded-md bg-surface-raised px-3 py-2.5 text-[0.8125rem] text-muted-foreground"
        >
          <BadgePercent className="size-4 shrink-0" />
          {t("library.offers.none")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("library.offers.note")}</p>
    </SectionCard>
  )
}

