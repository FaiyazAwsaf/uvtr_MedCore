"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

import type { GenericRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

import type { LibraryIndex } from "../catalog"
import { useLibraryHref } from "../hooks"
import { libraryPaths } from "../paths"
import { useCountLabel } from "./bits"

/** Generics as links with their drug class and brand count (alphabetical input). */
export function GenericList({
  generics,
  index,
  showClass = false,
  brandsOf,
}: {
  generics: GenericRow[]
  index: LibraryIndex
  /** Show each generic's class (lists that span several classes) */
  showClass?: boolean
  /** Count only these brands (e.g. one company's); default: all brands of the generic */
  brandsOf?: (generic: GenericRow) => number
}) {
  const href = useLibraryHref()
  const count = useCountLabel()
  const { t } = useLocale()
  if (!generics.length) {
    return <p className="text-[0.8125rem] text-muted-foreground">{t("common.noResults")}</p>
  }
  return (
    <ul className="-mx-1.5 flex flex-col">
      {generics.map((generic) => {
        const brands = brandsOf ? brandsOf(generic) : (index.brandsByGeneric.get(generic.id)?.length ?? 0)
        const cls = showClass ? index.classById.get(generic.classId) : undefined
        return (
          <li key={generic.id}>
            <Link
              href={href(libraryPaths.generic(generic.id))}
              data-testid="generic-row"
              data-id={generic.id}
              className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-2 transition-colors hover:bg-surface-raised"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span lang="en" className="truncate text-[0.8125rem] font-medium">
                  {generic.name}
                </span>
                {cls ? (
                  <span lang="en" className="truncate text-xs text-muted-foreground">
                    {cls.name}
                  </span>
                ) : null}
              </span>
              <span className="nums shrink-0 text-xs text-muted-foreground">{count("brands", brands)}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
