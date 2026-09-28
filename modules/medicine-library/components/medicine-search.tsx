"use client"

import * as React from "react"
import { Search, X } from "lucide-react"

import {
  rankMedicines,
  type MedicineHit,
  type MedicineHitKind,
} from "@/core/search/medicines"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { useMedicineCatalog } from "../hooks"
import { CategoryBadges, Highlight, KindIcon, useFormLabel } from "./bits"

const DEFAULT_KINDS: MedicineHitKind[] = ["brand"]

export type MedicineSearchProps = {
  /** Called with the chosen hit (a brand hit carries brandId, genericId, strength, form, company) */
  onPick: (hit: MedicineHit) => void
  /**
   * What to list. Default: brands only (typing a generic still lists its
   * brands). Add "generic", "company" or "class" to pick those too.
   */
  kinds?: MedicineHitKind[]
  placeholder?: string
  autoFocus?: boolean
  /** Keep the typed text after a pick (default clears it) */
  keepQuery?: boolean
  /** Most options shown (default 12) */
  limit?: number
  /** Extra content at the right of an option, e.g. a stock badge */
  renderMeta?: (hit: MedicineHit) => React.ReactNode
  disabled?: boolean
  className?: string
}

/**
 * Medicine picker for the Rx pad (WS-B), the OTC counter (WS-E) and purchase
 * requests (WS-H): a search box with a live list of the dictionary. Options
 * show the brand and strength, generic, dosage form, manufacturer and sale
 * type, ranked by relevance and then alphabetically (HAZ-04: never by stock,
 * price or offers; offers are never shown here). Keyboard: up and down move,
 * Enter picks, Escape closes. The dictionary is ranked in memory, so the list
 * follows each keystroke immediately.
 */
export function MedicineSearch({
  onPick,
  kinds = DEFAULT_KINDS,
  placeholder,
  autoFocus,
  keepQuery = false,
  limit = 12,
  renderMeta,
  disabled,
  className,
}: MedicineSearchProps) {
  const { t } = useLocale()
  const catalog = useMedicineCatalog()
  const listId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const kindsKey = kinds.join(",")

  const hits = React.useMemo(
    () =>
      catalog && query.trim()
        ? rankMedicines(query, catalog, { limit, kinds: kindsKey.split(",") as MedicineHitKind[] })
        : [],
    [catalog, query, limit, kindsKey]
  )

  const optionId = (index: number) => `${listId}-option-${index}`
  const showList = open && query.trim().length > 0

  // Keep the keyboard-selected option in view.
  React.useEffect(() => {
    if (!showList) return
    document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: "nearest" })
  }, [active, showList, listId])

  const pick = (hit: MedicineHit) => {
    onPick(hit)
    setOpen(false)
    setActive(0)
    if (!keepQuery) setQuery("")
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (showList) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
    if (!hits.length) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActive((index) => (index + 1) % hits.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      setActive((index) => (index - 1 + hits.length) % hits.length)
    } else if (event.key === "Enter" && showList) {
      event.preventDefault()
      const hit = hits[Math.min(active, hits.length - 1)]
      if (hit) pick(hit)
    }
  }

  return (
    <div data-slot="medicine-search" className={cn("relative w-full", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          data-testid="medicine-search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits.length ? optionId(active) : undefined}
          aria-label={t("library.picker.label")}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          value={query}
          placeholder={placeholder ?? t("library.picker.placeholder")}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-md border border-border bg-input-fill pr-9 pl-9 text-sm text-foreground transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:opacity-50"
        />
        {query ? (
          <button
            type="button"
            aria-label={t("common.clear")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("")
              setActive(0)
              inputRef.current?.focus()
            }}
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-raised hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {showList ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t("library.picker.label")}
          className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[min(24rem,60svh)] overflow-y-auto rounded-md border border-border/60 bg-popover p-1.5 shadow-xl"
        >
          {!catalog ? (
            <p className="px-3 py-4 text-center text-[0.8125rem] text-muted-foreground">
              {t("library.picker.loading")}
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-4 text-center text-[0.8125rem] text-muted-foreground">
              {t("library.picker.empty")}
            </p>
          ) : (
            hits.map((hit, index) => (
              <MedicineOption
                key={`${hit.kind}:${hit.id}`}
                id={optionId(index)}
                hit={hit}
                query={query}
                active={index === active}
                meta={renderMeta?.(hit)}
                onHover={() => setActive(index)}
                onPick={() => pick(hit)}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

function MedicineOption({
  id,
  hit,
  query,
  active,
  meta,
  onHover,
  onPick,
}: {
  id: string
  hit: MedicineHit
  query: string
  active: boolean
  meta?: React.ReactNode
  onHover: () => void
  onPick: () => void
}) {
  const { t } = useLocale()
  const formLabel = useFormLabel()
  const secondary =
    hit.kind === "brand"
      ? [hit.genericName, hit.form ? formLabel(hit.form) : undefined, hit.companyName]
      : hit.kind === "generic"
        ? [t("library.kind.generic"), hit.className]
        : hit.kind === "company"
          ? [t("library.kind.company"), hit.detail]
          : [t("library.kind.class"), hit.detail]

  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-testid="medicine-option"
      data-kind={hit.kind}
      data-id={hit.id}
      data-brand-id={hit.brandId}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={active ? undefined : onHover}
      onClick={onPick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-sm px-2.5 py-2 text-left transition-colors",
        active ? "bg-primary-soft" : "hover:bg-surface-raised"
      )}
    >
      <KindIcon kind={hit.kind} className="size-8" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span lang="en" className="truncate text-sm font-medium">
            <Highlight text={hit.label} query={query} />
          </span>
          {hit.kind === "brand" && hit.category ? (
            <CategoryBadges category={hit.category} isAntibiotic={hit.isAntibiotic} size="sm" />
          ) : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {secondary.filter(Boolean).join(" · ")}
        </span>
      </span>
      {meta ? <span className="flex shrink-0 items-center">{meta}</span> : null}
    </div>
  )
}
