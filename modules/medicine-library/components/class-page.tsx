"use client"

import * as React from "react"
import Link from "next/link"

import { SectionCard } from "@/components/shared/section-card"
import { useLocale } from "@/lib/i18n/provider"

import { brandsInClass, genericsInClass } from "../catalog"
import { useLibraryHref, useLibraryIndex } from "../hooks"
import { libraryPaths } from "../paths"
import { KindIcon, useCountLabel } from "./bits"
import { BrandTable } from "./brand-table"
import { GenericList } from "./generic-list"
import { LibraryLoading, LibraryNotFound, LibraryShell } from "./library-shell"

/**
 * "/library/class/[id]": a drug class with its parent and subclasses, the
 * generics in it and their brands (subclasses included), alphabetical.
 */
export function ClassPage({ id }: { id: string }) {
  const { t } = useLocale()
  const index = useLibraryIndex()
  const href = useLibraryHref()
  const count = useCountLabel()

  if (!index) return <LibraryLoading />
  const cls = index.classById.get(id)
  if (!cls) return <LibraryNotFound title={t("library.class.notFound")} />

  const parent = cls.parentId ? index.classById.get(cls.parentId) : undefined
  const children = index.childClasses.get(cls.id) ?? []
  const generics = genericsInClass(index, cls.id)
  const brands = brandsInClass(index, cls.id)

  return (
    <LibraryShell
      crumbs={[
        parent
          ? { label: parent.name, href: libraryPaths.class(parent.id) }
          : { label: t("library.groups.class"), href: `${libraryPaths.home}?browse=classes` },
        { label: cls.name },
      ]}
    >
      <header
        data-testid="class-page"
        data-class-id={cls.id}
        className="surface-card flex flex-wrap items-start gap-4 p-5"
      >
        <KindIcon kind="class" className="size-12" />
        <div className="flex min-w-[14rem] flex-1 flex-col gap-2">
          <h1 lang="en" className="text-[1.375rem] leading-tight font-semibold">
            {cls.name}
          </h1>
          {parent ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span>{t("library.class.partOf")}:</span>
              <Link href={href(libraryPaths.class(parent.id))} lang="en" className="text-link hover:underline">
                {parent.name}
              </Link>
            </p>
          ) : null}
          {children.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-sm text-muted-foreground">{t("library.class.subclasses")}:</span>
              {children.map((child) => (
                <Link
                  key={child.id}
                  href={href(libraryPaths.class(child.id))}
                  lang="en"
                  className="inline-flex h-7 items-center rounded-full bg-surface-raised px-2.5 text-xs font-medium transition-colors hover:bg-primary-soft hover:text-link"
                >
                  {child.name}
                </Link>
              ))}
            </div>
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
            title={t("library.class.brandsTitle", { class: cls.name })}
            subtitle={t("library.generic.brandsNote")}
            size="sm"
            className="min-w-0"
          >
            <div data-testid="class-brands">
              <BrandTable brands={brands} index={index} show={["generic"]} />
            </div>
          </SectionCard>
          <SectionCard title={t("library.class.genericsTitle")} size="sm" className="min-w-0">
            <GenericList generics={generics} index={index} showClass={children.length > 0} />
          </SectionCard>
        </div>
      </div>
    </LibraryShell>
  )
}
