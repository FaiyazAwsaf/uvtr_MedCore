"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { SegmentedPills, type SegmentOption } from "@/components/motion/segmented"
import { SectionCard } from "@/components/shared/section-card"
import type { DrugClassRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import {
  LETTERS,
  azBuckets,
  brandFamilies,
  brandsInClass,
  type BrandFamily,
  type LibraryIndex,
} from "../catalog"
import { useLibraryHref, writeUrlParams } from "../hooks"
import { libraryPaths } from "../paths"
import { KindIcon, useCountLabel, useFormLabel } from "./bits"

type BrowseTab = "brands" | "generics" | "companies" | "classes"
const TABS: BrowseTab[] = ["brands", "generics", "companies", "classes"]

type Entry =
  | { tab: "brands"; name: string; family: BrandFamily }
  | { tab: "generics"; name: string; id: string }
  | { tab: "companies"; name: string; id: string }

/**
 * A to Z browse of brands, generics and companies, plus the drug class tree.
 * Every list is alphabetical (HAZ-04).
 */
export function AzBrowse({ index }: { index: LibraryIndex }) {
  const { t, num } = useLocale()
  const params = useSearchParams()
  const [tab, setTab] = React.useState<BrowseTab>(() => {
    const value = params.get("browse")
    return TABS.includes(value as BrowseTab) ? (value as BrowseTab) : "brands"
  })
  const [letter, setLetter] = React.useState<string | null>(() => params.get("letter"))

  const families = React.useMemo(() => brandFamilies(index.brands), [index])
  const entries = React.useMemo<Entry[]>(() => {
    if (tab === "brands") return families.map((family) => ({ tab, name: family.name, family }))
    if (tab === "generics") return index.generics.map((g) => ({ tab, name: g.name, id: g.id }))
    if (tab === "companies") return index.companies.map((c) => ({ tab, name: c.name, id: c.id }))
    return []
  }, [tab, families, index])
  const buckets = React.useMemo(() => azBuckets(entries, (e) => e.name), [entries])
  const letters = buckets.has("#") ? [...LETTERS, "#"] : LETTERS
  const current =
    letter && buckets.has(letter) ? letter : (letters.find((l) => buckets.has(l)) ?? "A")
  const shown = buckets.get(current) ?? []

  React.useEffect(() => {
    writeUrlParams({
      browse: tab === "brands" ? null : tab,
      letter: tab === "classes" ? null : current,
    })
  }, [tab, current])

  const tabOptions: SegmentOption<BrowseTab>[] = [
    { value: "brands", label: t("library.browse.tabs.brands"), count: num(index.brands.length) },
    { value: "generics", label: t("library.browse.tabs.generics"), count: num(index.generics.length) },
    { value: "companies", label: t("library.browse.tabs.companies"), count: num(index.companies.length) },
    { value: "classes", label: t("library.browse.tabs.classes"), count: num(index.catalog.classes.length) },
  ]

  return (
    <SectionCard
      title={t("library.browse.title")}
      subtitle={t("library.browse.subtitle")}
      size="sm"
      className="@container"
      bodyClassName="flex flex-col gap-3"
    >
      <SegmentedPills options={tabOptions} value={tab} onChange={setTab} size="sm" />
      {tab === "classes" ? (
        <ClassTree index={index} />
      ) : (
        <>
          <div
            role="toolbar"
            aria-label={t("library.browse.title")}
            className="flex flex-wrap gap-1"
          >
            {letters.map((l) => {
              const count = buckets.get(l)?.length ?? 0
              const selected = l === current
              return (
                <button
                  key={l}
                  type="button"
                  lang="en"
                  data-testid="library-az"
                  data-letter={l}
                  aria-pressed={selected}
                  aria-label={t("library.browse.letterAria", { letter: l })}
                  disabled={count === 0}
                  onClick={() => setLetter(l)}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md text-[0.8125rem] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : count
                        ? "bg-surface-raised text-foreground/85 hover:bg-primary-soft hover:text-link"
                        : "text-muted-foreground/45"
                  )}
                >
                  {l}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {shown.length
              ? t("library.browse.letter", { letter: current })
              : t("library.browse.emptyLetter", { letter: current })}
          </p>
          <ul className="grid gap-2 @min-[34rem]:grid-cols-2 @min-[52rem]:grid-cols-3 @min-[76rem]:grid-cols-4">
            {shown.map((entry) =>
              entry.tab === "brands" ? (
                <BrandFamilyItem key={entry.family.key} family={entry.family} index={index} />
              ) : (
                <SimpleItem key={entry.id} entry={entry} index={index} />
              )
            )}
          </ul>
        </>
      )}
    </SectionCard>
  )
}

/** One brand name with a chip per strength and form ("500 mg · Tablet"). */
function BrandFamilyItem({ family, index }: { family: BrandFamily; index: LibraryIndex }) {
  const href = useLibraryHref()
  const formLabel = useFormLabel()
  const generic = index.genericById.get(family.genericId)
  const company = index.companyById.get(family.companyId)
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-hairline p-3">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span lang="en" className="truncate text-sm font-semibold">
          {family.name}
        </span>
        <span className="truncate text-xs text-muted-foreground">{company?.shortName}</span>
      </div>
      {generic ? (
        <Link
          href={href(libraryPaths.generic(generic.id))}
          lang="en"
          className="-mt-1 truncate text-xs text-link underline-offset-4 hover:underline"
        >
          {generic.name}
        </Link>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {family.variants.map((brand) => (
          <Link
            key={brand.id}
            href={href(libraryPaths.brand(brand.id))}
            data-testid="library-az-entry"
            data-kind="brand"
            data-id={brand.id}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-raised px-2.5 text-xs font-medium transition-colors hover:bg-primary-soft hover:text-link"
          >
            <span lang="en">{brand.strength}</span>
            <span className="text-muted-foreground">· {formLabel(brand.form)}</span>
          </Link>
        ))}
      </div>
    </li>
  )
}

function SimpleItem({
  entry,
  index,
}: {
  entry: Extract<Entry, { tab: "generics" | "companies" }>
  index: LibraryIndex
}) {
  const href = useLibraryHref()
  const count = useCountLabel()
  const kind = entry.tab === "generics" ? "generic" : "company"
  const secondary =
    entry.tab === "generics"
      ? index.classById.get(index.genericById.get(entry.id)?.classId ?? "")?.name
      : index.companyById.get(entry.id)?.shortName
  const brands =
    entry.tab === "generics"
      ? (index.brandsByGeneric.get(entry.id)?.length ?? 0)
      : (index.brandsByCompany.get(entry.id)?.length ?? 0)
  return (
    <li className="min-w-0">
      <Link
        href={href(entry.tab === "generics" ? libraryPaths.generic(entry.id) : libraryPaths.company(entry.id))}
        data-testid="library-az-entry"
        data-kind={kind}
        data-id={entry.id}
        className="flex min-w-0 items-center gap-3 rounded-md border border-hairline p-3 transition-colors hover:bg-surface-raised"
      >
        <KindIcon kind={kind} className="size-8" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span lang="en" className="truncate text-sm font-semibold">
            {entry.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {secondary ? `${secondary} · ` : ""}
            {count("brands", brands)}
          </span>
        </span>
      </Link>
    </li>
  )
}

/** Top-level drug classes with their subclasses, alphabetical. */
function ClassTree({ index }: { index: LibraryIndex }) {
  const href = useLibraryHref()
  const count = useCountLabel()
  const row = (cls: DrugClassRow, strong = false) => (
    <Link
      key={cls.id}
      href={href(libraryPaths.class(cls.id))}
      data-testid="library-az-entry"
      data-kind="class"
      data-id={cls.id}
      className={cn(
        "flex min-w-0 items-baseline justify-between gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-surface-raised",
        strong ? "text-sm font-semibold" : "text-[0.8125rem]"
      )}
    >
      <span lang="en" className="truncate">
        {cls.name}
      </span>
      <span className="nums shrink-0 text-xs font-normal text-muted-foreground">
        {count("brands", brandsInClass(index, cls.id).length)}
      </span>
    </Link>
  )
  return (
    <ul className="grid gap-2 @min-[34rem]:grid-cols-2 @min-[52rem]:grid-cols-3 @min-[76rem]:grid-cols-4">
      {index.rootClasses.map((root) => (
        <li key={root.id} className="flex min-w-0 flex-col gap-0.5 rounded-md border border-hairline p-2">
          {row(root, true)}
          <div className="ml-2 flex flex-col border-l border-hairline pl-1.5">
            {(index.childClasses.get(root.id) ?? []).map((child) => row(child))}
          </div>
        </li>
      ))}
    </ul>
  )
}
