"use client"

import * as React from "react"
import Link from "next/link"

import { SectionCard } from "@/components/shared/section-card"
import { useLocale } from "@/lib/i18n/provider"

import { useLibraryHref, useLibraryIndex } from "../hooks"
import { libraryPaths } from "../paths"
import { GenericBadges, KindIcon, useCountLabel } from "./bits"
import { BrandTable } from "./brand-table"
import { LibraryLoading, LibraryNotFound, LibraryShell } from "./library-shell"
import { Monograph } from "./monograph"

/**
 * "/library/generic/[id]" (objective §3C): the monograph (indications,
 * dosage, contraindications, side effects, pregnancy category; interactions
 * as a Release 2 note) and every brand of the generic with its price per
 * unit, alphabetical (HAZ-04: never by price, stock or margin).
 */
export function GenericPage({ id }: { id: string }) {
  const { t, isBangla } = useLocale()
  const index = useLibraryIndex()
  const href = useLibraryHref()
  const count = useCountLabel()

  if (!index) return <LibraryLoading />
  const generic = index.genericById.get(id)
  if (!generic) return <LibraryNotFound title={t("library.generic.notFound")} />

  const cls = index.classById.get(generic.classId)
  const parent = cls?.parentId ? index.classById.get(cls.parentId) : undefined
  const brands = index.brandsByGeneric.get(generic.id) ?? []
  const companies = new Set(brands.map((b) => b.companyId)).size

  return (
    <LibraryShell
      crumbs={[
        ...(cls ? [{ label: cls.name, href: libraryPaths.class(cls.id) }] : []),
        { label: generic.name },
      ]}
    >
      <header
        data-testid="generic-page"
        data-generic-id={generic.id}
        className="surface-card flex flex-wrap items-start gap-4 p-5"
      >
        <KindIcon kind="generic" className="size-12" />
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h1 lang="en" className="text-[1.375rem] leading-tight font-semibold">
              {generic.name}
            </h1>
            {isBangla && generic.glossBn ? (
              <span className="text-sm text-muted-foreground">{generic.glossBn}</span>
            ) : null}
          </div>
          {cls ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span>{t("library.generic.class")}:</span>
              <Link href={href(libraryPaths.class(cls.id))} lang="en" className="text-link hover:underline">
                {cls.name}
              </Link>
              {parent ? (
                <>
                  <span aria-hidden>·</span>
                  <Link href={href(libraryPaths.class(parent.id))} lang="en" className="hover:text-foreground hover:underline">
                    {parent.name}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <GenericBadges generic={generic} />
        </div>
        <div className="nums flex shrink-0 flex-col items-end gap-0.5 text-[0.8125rem] text-muted-foreground">
          <span className="font-medium text-foreground">{count("brands", brands.length)}</span>
          <span>{count("companies", companies)}</span>
        </div>
      </header>

      <div className="@container">
        <div className="grid items-start gap-4 @min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
          <SectionCard
            title={t("library.generic.brandsTitle", { generic: generic.name })}
            subtitle={t("library.generic.brandsNote")}
            size="sm"
            className="min-w-0"
          >
            <div data-testid="generic-brands">
              <BrandTable
                brands={brands}
                index={index}
                show={["company"]}
                emptyTitle={t("library.generic.noBrands")}
              />
            </div>
          </SectionCard>
          <Monograph generic={generic} title={t("library.brand.clinical")} />
        </div>
      </div>
    </LibraryShell>
  )
}
