"use client"

import * as React from "react"
import { PencilLine, Pill, Search } from "lucide-react"

import { StatusPill } from "@/components/shared/status"
import { Input } from "@/components/ui/input"
import type { BrandRow } from "@/core/db/schema"
import { rankMedicines } from "@/core/search/medicines"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import type { MedicineCatalogRows } from "@/modules/consultation/components/data"

export type MedicinePick = { kind: "brand"; brandId: string } | { kind: "free"; name: string }

/** Short printed form prefix, e.g. "Tab." (medicine names stay English, plan §3.11). */
export const FORM_PREFIX: Record<string, string> = {
  tablet: "Tab.",
  capsule: "Cap.",
  syrup: "Syp.",
  suspension: "Susp.",
  injection: "Inj.",
  cream: "Cream",
  drops: "Drops",
  inhaler: "Inh.",
  suppository: "Supp.",
  sachet: "Sachet",
}

export function brandLabel(brand: Pick<BrandRow, "name" | "strength">): string {
  return `${brand.name} ${brand.strength}`.trim()
}

/**
 * Brand and generic search for the Rx pad (objective §3B): the shared
 * dictionary ranked by text relevance, then A to Z (HAZ-04: never by stock,
 * price or offers). A name outside the dictionary can still be written.
 */
export function MedicineSearch({
  catalog,
  onPick,
  disabled = false,
  autoFocus = false,
}: {
  catalog: MedicineCatalogRows
  onPick: (pick: MedicinePick) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  const { t } = useLocale()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const listId = React.useId()

  const hits = React.useMemo(
    () =>
      query.trim().length < 2
        ? []
        : rankMedicines(query, catalog, { kinds: ["brand"], limit: 10 }).flatMap((hit) => {
            const brand = hit.brandId ? catalog.brandById.get(hit.brandId) : undefined
            return brand ? [{ hit, brand }] : []
          }),
    [query, catalog]
  )
  const free = query.trim()
  const options = hits.length + (free.length >= 2 ? 1 : 0)

  const choose = (index: number) => {
    if (index < hits.length) onPick({ kind: "brand", brandId: hits[index].brand.id })
    else if (free.length >= 2) onPick({ kind: "free", name: free })
    setQuery("")
    setActive(0)
    setOpen(false)
  }

  return (
    <div className="relative" data-testid="rx-search-box">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        data-testid="rx-search"
        role="combobox"
        aria-expanded={open && options > 0}
        aria-controls={listId}
        aria-label={t("prescribing.search.label")}
        placeholder={t("prescribing.search.placeholder")}
        className="pl-9"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setActive((i) => Math.min(options - 1, i + 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive((i) => Math.max(0, i - 1))
          } else if (e.key === "Enter" && options > 0) {
            e.preventDefault()
            choose(active)
          } else if (e.key === "Escape") {
            setQuery("")
            setOpen(false)
          }
        }}
      />
      {open && free.length >= 2 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-md border border-border/60 bg-popover p-1 shadow-xl"
        >
          {hits.length === 0 ? (
            <li className="px-2.5 py-2 text-[0.8125rem] text-muted-foreground">{t("prescribing.search.noMatch")}</li>
          ) : null}
          {hits.map(({ hit, brand }, i) => (
            <li
              key={brand.id}
              role="option"
              aria-selected={i === active}
              data-testid="rx-option"
              data-brand-id={brand.id}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(i)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5",
                i === active && "bg-primary-soft"
              )}
            >
              <Pill className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1" lang="en">
                <div className="truncate text-[0.8125rem] font-semibold">
                  <span className="mr-1 font-normal text-muted-foreground">{FORM_PREFIX[brand.form] ?? ""}</span>
                  {hit.label}
                </div>
                <div className="truncate text-xs text-muted-foreground">{hit.detail}</div>
              </div>
              {brand.isAntibiotic ? (
                <StatusPill tone="warning" className="h-5 px-2 text-[0.625rem]">
                  {t("prescribing.search.antibiotic")}
                </StatusPill>
              ) : null}
              <StatusPill
                tone={brand.category === "controlled" ? "destructive" : brand.category === "otc" ? "muted" : "info"}
                className="h-5 px-2 text-[0.625rem]"
              >
                {t(`prescribing.search.category.${brand.category}`)}
              </StatusPill>
            </li>
          ))}
          <li
            role="option"
            aria-selected={active === hits.length}
            data-testid="rx-option-free"
            onMouseDown={(e) => {
              e.preventDefault()
              choose(hits.length)
            }}
            onMouseEnter={() => setActive(hits.length)}
            className={cn(
              "mt-1 flex cursor-pointer items-center gap-2.5 rounded-sm border-t border-hairline px-2.5 py-2 text-[0.8125rem] text-muted-foreground",
              active === hits.length && "bg-primary-soft text-foreground"
            )}
          >
            <PencilLine className="size-4 shrink-0" />
            {t("prescribing.search.free", { name: free })}
          </li>
          <li className="px-2.5 pt-1 pb-0.5 text-[0.6875rem] text-muted-foreground">{t("prescribing.search.hint")}</li>
        </ul>
      ) : null}
    </div>
  )
}
