"use client"

import * as React from "react"

import { SectionCard } from "@/components/shared/section-card"
import { useLocale } from "@/lib/i18n/provider"

import { genericsOfCompany } from "../catalog"
import { useLibraryIndex } from "../hooks"
import { libraryPaths } from "../paths"
import { KindIcon, useCountLabel } from "./bits"
import { BrandTable } from "./brand-table"
import { GenericList } from "./generic-list"
import { LibraryLoading, LibraryNotFound, LibraryShell } from "./library-shell"

/** "/library/company/[id]": a manufacturer, its brands and the generics it makes, alphabetical. */
export function CompanyPage({ id }: { id: string }) {
  const { t } = useLocale()
  const index = useLibraryIndex()
  const count = useCountLabel()

  if (!index) return <LibraryLoading />
  const company = index.companyById.get(id)
  if (!company) return <LibraryNotFound title={t("library.company.notFound")} />

  const brands = index.brandsByCompany.get(company.id) ?? []
  const generics = genericsOfCompany(index, company.id)
  const brandsOf = (genericId: string) => brands.filter((b) => b.genericId === genericId).length

  return (
    <LibraryShell
      crumbs={[
        { label: t("library.groups.company"), href: `${libraryPaths.home}?browse=companies` },
        { label: company.name },
      ]}
    >
      <header
        data-testid="company-page"
        data-company-id={company.id}
        className="surface-card flex flex-wrap items-start gap-4 p-5"
      >
        <KindIcon kind="company" className="size-12" />
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
          <h1 lang="en" className="text-[1.375rem] leading-tight font-semibold">
            {company.name}
          </h1>
          {company.about ? (
            <p lang="en" className="max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
              {company.about}
            </p>
          ) : null}
        </div>
        <div className="nums flex shrink-0 flex-col items-end gap-0.5 text-[0.8125rem] text-muted-foreground">
          <span className="font-medium text-foreground">{count("brands", brands.length)}</span>
          <span>{count("generics", generics.length)}</span>
        </div>
      </header>

      <div className="@container">
        <div className="grid items-start gap-4 @min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
          <SectionCard
            title={t("library.company.brandsTitle", { company: company.shortName })}
            subtitle={t("library.generic.brandsNote")}
            size="sm"
            className="min-w-0"
          >
            <div data-testid="company-brands">
              <BrandTable brands={brands} index={index} show={["generic"]} />
            </div>
          </SectionCard>
          <SectionCard title={t("library.company.genericsTitle")} size="sm" className="min-w-0">
            <GenericList
              generics={generics}
              index={index}
              showClass
              brandsOf={(generic) => brandsOf(generic.id)}
            />
          </SectionCard>
        </div>
      </div>
    </LibraryShell>
  )
}
