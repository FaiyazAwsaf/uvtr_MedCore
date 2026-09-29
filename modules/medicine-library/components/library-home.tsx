"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight, Search, SearchX, X } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { SectionCard } from "@/components/shared/section-card"
import type { MedicineHit, MedicineHitKind } from "@/core/search/medicines"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import {
  RESULT_KINDS,
  brandCount,
  searchLibrary,
  type LibraryIndex,
} from "../catalog"
import { useLibraryHref, useLibraryIndex, writeUrlParams } from "../hooks"
import { hitPath } from "../paths"
import { AzBrowse } from "./az-browse"
import { CategoryBadges, Highlight, KindIcon, useCountLabel, useFormLabel } from "./bits"
import { LibraryLoading, LibraryShell } from "./library-shell"

/** Rows shown per group before "Show all". */
const CAP: Record<MedicineHitKind, number> = { brand: 10, generic: 5, company: 5, class: 5 }

/** Clickable examples under the empty search box (the demo's four searches). */
const EXAMPLES = ["Napa", "paracetamol", "Beximco", "PPI"]

const resultKey = (hit: Pick<MedicineHit, "kind" | "id">) => `${hit.kind}:${hit.id}`

/**
 * "/library": the Medex-style medicine library (objective §3C). Instant
 * typeahead over brands, generics, companies and drug classes, grouped by
 * kind; with an empty box, an A to Z browse. The query and the browse
 * position live in the address, so Back from a medicine returns here intact.
 */
export function LibraryHome() {
  const { t, num } = useLocale()
  const index = useLibraryIndex()
  const params = useSearchParams()
  const [query, setQuery] = React.useState(() => params.get("q") ?? "")

  React.useEffect(() => {
    const timer = window.setTimeout(() => writeUrlParams({ q: query.trim() || null }), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  if (!index) return <LibraryLoading />

  return (
    <LibraryShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-[1.375rem] leading-tight font-semibold">{t("library.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("library.subtitle")}</p>
      </header>
      <LibrarySearch index={index} query={query} onQuery={setQuery} />
      {query.trim() ? null : (
        <p className="-mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("library.search.examples")}</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              lang="en"
              onClick={() => setQuery(example)}
              className="rounded-full bg-surface-raised px-2.5 py-1 font-medium text-foreground/85 transition-colors hover:bg-primary-soft hover:text-link"
            >
              {example}
            </button>
          ))}
          <span className="nums ml-auto hidden sm:inline">
            {t("library.counts.brands", { count: num(index.brands.length) })} ·{" "}
            {t("library.counts.generics", { count: num(index.generics.length) })} ·{" "}
            {t("library.counts.companies", { count: num(index.companies.length) })}
          </span>
        </p>
      )}
      {query.trim() ? null : <AzBrowse index={index} />}
    </LibraryShell>
  )
}

/**
 * The search box and its grouped results. Up and down move through the
 * visible results, Enter opens the highlighted one (the first by default),
 * Escape clears the box.
 */
function LibrarySearch({
  index,
  query,
  onQuery,
}: {
  index: LibraryIndex
  query: string
  onQuery: (query: string) => void
}) {
  const { t, num } = useLocale()
  const router = useRouter()
  const href = useLibraryHref()
  const listId = React.useId()
  const [expanded, setExpanded] = React.useState<Partial<Record<MedicineHitKind, boolean>>>({})
  const [active, setActive] = React.useState(0)
  const searching = query.trim().length > 0

  const groups = React.useMemo(() => searchLibrary(query, index.catalog), [query, index])
  const visible = React.useMemo(
    () =>
      RESULT_KINDS.flatMap((kind) =>
        expanded[kind] ? groups[kind] : groups[kind].slice(0, CAP[kind])
      ),
    [groups, expanded]
  )
  const total = RESULT_KINDS.reduce((sum, kind) => sum + groups[kind].length, 0)
  const activeHit = visible[Math.min(active, visible.length - 1)]
  const optionId = (hit: MedicineHit) => `${listId}-${hit.kind}-${hit.id}`

  const changeQuery = (next: string) => {
    onQuery(next)
    setActive(0)
    setExpanded({})
  }

  React.useEffect(() => {
    if (!activeHit) return
    document.getElementById(`${listId}-${activeHit.kind}-${activeHit.id}`)?.scrollIntoView({ block: "nearest" })
  }, [activeHit, listId])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      changeQuery("")
      return
    }
    if (!visible.length) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, visible.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === "Enter" && activeHit) {
      event.preventDefault()
      router.push(href(hitPath(activeHit)))
    }
  }

  const side = (["generic", "company", "class"] as const).filter((kind) => groups[kind].length)
  const hasBrands = groups.brand.length > 0

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          data-testid="library-search"
          type="search"
          aria-controls={listId}
          aria-label={t("library.search.label")}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("library.search.placeholder")}
          className="h-12 w-full rounded-lg border border-border bg-input-fill pr-11 pl-12 text-[0.9375rem] text-foreground shadow-(--card-shadow) transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            aria-label={t("library.search.clear")}
            onClick={() => changeQuery("")}
            className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-raised hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {searching ? (
        <div id={listId} aria-label={t("library.search.label")} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span data-testid="library-result-count" className="nums font-medium text-foreground/85">
              {total === 1
                ? t("library.search.oneResult")
                : t("library.search.results", { count: num(total) })}
            </span>
            <span>{t("library.search.order")}</span>
            <span className="ml-auto hidden md:inline">{t("library.search.keys")}</span>
          </div>
          {total === 0 ? (
            <div className="surface-card">
              <EmptyState
                icon={SearchX}
                title={t("library.search.empty", { query: query.trim() })}
                description={t("library.search.emptyHint")}
                action={{ label: t("library.search.clear"), onClick: () => changeQuery("") }}
              />
            </div>
          ) : (
            <div className="@container">
              <div
                className={cn(
                  "grid items-start gap-4",
                  side.length && hasBrands && "@min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]"
                )}
              >
                {side.length ? (
                  <div className="flex min-w-0 flex-col gap-4 @min-[60rem]:col-start-2 @min-[60rem]:row-start-1">
                    {side.map((kind) => (
                      <ResultGroup
                        key={kind}
                        kind={kind}
                        hits={groups[kind]}
                        index={index}
                        query={query}
                        expanded={!!expanded[kind]}
                        onToggle={() => setExpanded((e) => ({ ...e, [kind]: !e[kind] }))}
                        activeKey={activeHit ? resultKey(activeHit) : null}
                        onHover={(hit) => setActive(visible.indexOf(hit))}
                        optionId={optionId}
                      />
                    ))}
                  </div>
                ) : null}
                {hasBrands ? (
                  <div className="min-w-0 @min-[60rem]:col-start-1 @min-[60rem]:row-start-1">
                    <ResultGroup
                      kind="brand"
                      hits={groups.brand}
                      index={index}
                      query={query}
                      expanded={!!expanded.brand}
                      onToggle={() => setExpanded((e) => ({ ...e, brand: !e.brand }))}
                      activeKey={activeHit ? resultKey(activeHit) : null}
                      onHover={(hit) => setActive(visible.indexOf(hit))}
                      optionId={optionId}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </>
  )
}

function ResultGroup({
  kind,
  hits,
  index,
  query,
  expanded,
  onToggle,
  activeKey,
  onHover,
  optionId,
}: {
  kind: MedicineHitKind
  hits: MedicineHit[]
  index: LibraryIndex
  query: string
  expanded: boolean
  onToggle: () => void
  activeKey: string | null
  onHover: (hit: MedicineHit) => void
  optionId: (hit: MedicineHit) => string
}) {
  const { t, num } = useLocale()
  const shown = expanded ? hits : hits.slice(0, CAP[kind])
  return (
    <SectionCard
      size="sm"
      title={
        <span className="flex items-center gap-2">
          {t(`library.groups.${kind}`)}
          <span className="nums rounded-full bg-surface-raised px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
            {num(hits.length)}
          </span>
        </span>
      }
      action={
        hits.length > CAP[kind] ? (
          <button
            type="button"
            onClick={onToggle}
            className="text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
          >
            {expanded
              ? t("library.search.showFewer")
              : t("library.search.showAll", { count: num(hits.length) })}
          </button>
        ) : undefined
      }
      bodyClassName="-mx-1.5"
    >
      <div className="flex flex-col">
        {shown.map((hit) => (
          <ResultRow
            key={resultKey(hit)}
            id={optionId(hit)}
            hit={hit}
            index={index}
            query={query}
            active={activeKey === resultKey(hit)}
            onHover={() => onHover(hit)}
          />
        ))}
      </div>
    </SectionCard>
  )
}

function ResultRow({
  id,
  hit,
  index,
  query,
  active,
  onHover,
}: {
  id: string
  hit: MedicineHit
  index: LibraryIndex
  query: string
  active: boolean
  onHover: () => void
}) {
  const href = useLibraryHref()
  const formLabel = useFormLabel()
  const count = useCountLabel()
  const { t } = useLocale()

  let secondary: string
  let aside: string | null = null
  if (hit.kind === "brand") {
    secondary = [hit.genericName, hit.form ? formLabel(hit.form) : null].filter(Boolean).join(" · ")
    aside = hit.companyName ?? null
  } else if (hit.kind === "generic") {
    secondary = hit.className ?? t("library.kind.generic")
    aside = count("brands", brandCount(index, hit))
  } else if (hit.kind === "company") {
    secondary = hit.detail
    aside = count("brands", brandCount(index, hit))
  } else {
    secondary = hit.detail || t("library.browse.topLevel")
    aside = count("brands", brandCount(index, hit))
  }

  return (
    <Link
      id={id}
      href={href(hitPath(hit))}
      data-active={active || undefined}
      data-testid="library-result"
      data-kind={hit.kind}
      data-id={hit.id}
      onMouseMove={active ? undefined : onHover}
      className={cn(
        "group flex min-w-0 items-center gap-3 rounded-md px-2.5 py-2 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
        active ? "bg-primary-soft" : "hover:bg-surface-raised"
      )}
    >
      <KindIcon kind={hit.kind} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span lang="en" className="truncate text-sm font-medium">
            <Highlight text={hit.label} query={query} />
          </span>
          {hit.kind === "brand" && hit.category ? (
            <CategoryBadges
              category={hit.category}
              isAntibiotic={hit.isAntibiotic}
              size="sm"
              className="shrink-0"
            />
          ) : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">{secondary}</span>
      </span>
      {aside ? (
        <span className="hidden shrink-0 text-xs text-muted-foreground @min-[28rem]:inline">
          {aside}
        </span>
      ) : null}
      <ChevronRight
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform",
          active && "translate-x-0.5 text-link"
        )}
      />
    </Link>
  )
}
