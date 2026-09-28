"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Pill } from "lucide-react"

import { DataTable, type ColumnDef } from "@/components/motion/data-table"
import { MoneyText } from "@/components/shared/money-text"
import type { BrandRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

import type { LibraryIndex } from "../catalog"
import { useLibraryHref } from "../hooks"
import { libraryPaths } from "../paths"
import { CategoryBadges, useFormLabel } from "./bits"

export type BrandTableColumn = "generic" | "company"

/**
 * Brands with their price per unit, in the order given (callers pass an
 * alphabetical list). Sorting is switched off on every column: HAZ-04 forbids
 * ordering medicines by price, stock or margin.
 */
export function BrandTable({
  brands,
  index,
  show,
  emptyTitle,
}: {
  brands: BrandRow[]
  index: LibraryIndex
  /** The context column: the generic (company and class pages) or the company (generic page) */
  show: BrandTableColumn[]
  emptyTitle?: React.ReactNode
}) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const href = useLibraryHref()
  const formLabel = useFormLabel()
  const withGeneric = show.includes("generic")
  const withCompany = show.includes("company")

  const columns = React.useMemo<ColumnDef<BrandRow, unknown>[]>(() => {
    const cols: ColumnDef<BrandRow, unknown>[] = [
      {
        id: "brand",
        header: t("library.table.brand"),
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            href={href(libraryPaths.brand(row.original.id))}
            data-testid="brand-row"
            data-id={row.original.id}
            lang="en"
            onClick={(event) => event.stopPropagation()}
            className="font-medium text-foreground hover:text-link hover:underline"
          >
            {row.original.name}{" "}
            <span className="font-normal text-muted-foreground">{row.original.strength}</span>
          </Link>
        ),
      },
      {
        id: "form",
        header: t("library.table.form"),
        enableSorting: false,
        cell: ({ row }) => formLabel(row.original.form),
        meta: { hideBelow: "sm" },
      },
    ]
    if (withGeneric) {
      cols.push({
        id: "generic",
        header: t("library.table.generic"),
        enableSorting: false,
        cell: ({ row }) => {
          const generic = index.genericById.get(row.original.genericId)
          return generic ? (
            <Link
              href={href(libraryPaths.generic(generic.id))}
              lang="en"
              onClick={(event) => event.stopPropagation()}
              className="text-link hover:underline"
            >
              {generic.name}
            </Link>
          ) : null
        },
        meta: { hideBelow: "md" },
      })
    }
    if (withCompany) {
      cols.push({
        id: "company",
        header: t("library.table.company"),
        enableSorting: false,
        cell: ({ row }) => {
          const company = index.companyById.get(row.original.companyId)
          return company ? (
            <Link
              href={href(libraryPaths.company(company.id))}
              lang="en"
              onClick={(event) => event.stopPropagation()}
              className="text-link hover:underline"
            >
              {company.shortName}
            </Link>
          ) : null
        },
        meta: { hideBelow: "md" },
      })
    }
    cols.push(
      {
        id: "pack",
        header: t("library.table.pack"),
        enableSorting: false,
        cell: ({ row }) => (
          <span lang="en" className="text-muted-foreground">
            {row.original.packSizes[0]?.label}
          </span>
        ),
        meta: { hideBelow: "lg" },
      },
      {
        id: "category",
        header: t("library.table.saleType"),
        enableSorting: false,
        cell: ({ row }) => (
          <CategoryBadges category={row.original.category} isAntibiotic={row.original.isAntibiotic} size="sm" />
        ),
        meta: { hideBelow: "lg" },
      },
      {
        id: "price",
        header: t("library.table.pricePerUnit"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col items-end leading-tight">
            <MoneyText poisha={row.original.unitPriceP} className="font-medium" />
            <span className="text-[0.6875rem] text-muted-foreground">
              {row.original.unitLabel[locale]}
            </span>
          </span>
        ),
        meta: { align: "right" },
      },
      {
        id: "mrp",
        header: t("library.table.mrp"),
        enableSorting: false,
        cell: ({ row }) => <MoneyText poisha={row.original.mrpP} className="text-muted-foreground" />,
        meta: { align: "right", hideBelow: "sm" },
      }
    )
    return cols
  }, [t, locale, href, formLabel, index, withGeneric, withCompany])

  return (
    <DataTable
      data={brands}
      columns={columns}
      rowId={(brand) => brand.id}
      onRowClick={(brand) => router.push(href(libraryPaths.brand(brand.id)))}
      emptyIcon={<Pill />}
      emptyTitle={emptyTitle}
      density="compact"
      bare
      pageSize={100}
    />
  )
}
