"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { motion } from "motion/react"
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Search,
} from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/motion/card-shell"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

export type { ColumnDef }

/**
 * Per-column display options, set as `meta` on a column definition:
 * - `align: "right"` for figures (tabular numerals)
 * - `hideBelow` drops a low-priority column when the table is narrow
 *   (container widths, so a 960x600 window keeps the table readable)
 * - `className` for extra cell classes (e.g. "font-mono" for IDs)
 */
export type DataTableColumnMeta = {
  align?: "right"
  hideBelow?: "sm" | "md" | "lg"
  className?: string
}

const HIDE_BELOW: Record<NonNullable<DataTableColumnMeta["hideBelow"]>, string> =
  {
    sm: "hidden @min-[32rem]/table:table-cell",
    md: "hidden @min-[42rem]/table:table-cell",
    lg: "hidden @min-[52rem]/table:table-cell",
  }

function metaOf(meta: unknown): DataTableColumnMeta {
  return (meta ?? {}) as DataTableColumnMeta
}

/**
 * The worklist table (docs/ui_guidelines.md §4 "Table"): a raised header band
 * with a rounded top and sort arrows, 44px rows (36px compact) with hairline
 * dividers and a soft turquoise tint on hover or selection, an optional
 * checkbox column, and a paginated footer. Show statuses as coloured text
 * (StatusText) and actions as turquoise text links.
 */
export function DataTable<T>({
  data,
  columns,
  globalFilter,
  onGlobalFilterChange,
  selectable = false,
  onRowClick,
  rowId,
  emptyIcon,
  emptyTitle,
  emptyHint,
  className,
  toolbar,
  pageSize = 50,
  density = "default",
  bare = false,
  rowClassName,
}: {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  globalFilter?: string
  onGlobalFilterChange?: (value: string) => void
  selectable?: boolean
  onRowClick?: (row: T) => void
  rowId?: (row: T) => string
  emptyIcon?: React.ReactNode
  emptyTitle?: React.ReactNode
  emptyHint?: React.ReactNode
  className?: string
  toolbar?: React.ReactNode
  pageSize?: number
  /** 44px rows by default; 36px when compact */
  density?: "default" | "compact"
  /** Render without the card surface (when already inside a SectionCard) */
  bare?: boolean
  /** Extra classes per row, e.g. "flash-sync" for a row that just changed */
  rowClassName?: (row: T) => string | undefined
}) {
  const { t, num } = useLocale()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [selected, setSelected] = React.useState<Record<string, boolean>>({})

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Paginated rather than virtualised: a busy worklist runs to
    // thousands of rows, and rendering them all stalls the first paint.
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    getRowId: rowId ? (row) => rowId(row) : undefined,
  })

  const rows = table.getRowModel().rows
  const selectedCount = Object.values(selected).filter(Boolean).length
  const allSelected = rows.length > 0 && selectedCount === rows.length
  const rowHeight = density === "compact" ? "h-9" : "h-11"

  return (
    <div
      data-slot="data-table"
      className={cn(
        "@container/table flex min-h-0 flex-col",
        !bare && "rounded-lg bg-card p-4 shadow-(--card-shadow) @min-[48rem]/table:p-5",
        className
      )}
    >
      {toolbar || selectable ? (
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 pb-4">
          {toolbar}
          {selectedCount > 0 ? (
            <motion.span
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              className="nums ml-auto rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-link"
            >
              {t("common.selected", { count: num(selectedCount) })}
            </motion.span>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {selectable ? (
                  <th
                    className={cn(
                      "w-10 rounded-l-md bg-surface-raised pr-0 pl-3",
                      rowHeight
                    )}
                  >
                    <Checkbox
                      checked={allSelected}
                      indeterminate={selectedCount > 0 && !allSelected}
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked
                            ? Object.fromEntries(
                                rows.map((row) => [row.id, true])
                              )
                            : {}
                        )
                      }
                    />
                  </th>
                ) : null}
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  const meta = metaOf(header.column.columnDef.meta)
                  return (
                    <th
                      key={header.id}
                      onClick={
                        sortable
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                      className={cn(
                        "bg-surface-raised px-3 font-medium whitespace-nowrap text-foreground first:rounded-l-md last:rounded-r-md",
                        rowHeight,
                        meta.align === "right" ? "text-right" : "text-left",
                        sortable && "cursor-pointer select-none hover:text-link",
                        meta.hideBelow && HIDE_BELOW[meta.hideBelow]
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5",
                          meta.align === "right" && "flex-row-reverse"
                        )}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3.5 text-primary" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3.5 text-primary" />
                        ) : sortable ? (
                          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                        ) : null}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <motion.tr
                key={row.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(index, 18) * 0.012 }}
                onClick={() => onRowClick?.(row.original)}
                data-state={selected[row.id] ? "selected" : undefined}
                className={cn(
                  "group/row transition-colors hover:bg-primary-soft data-[state=selected]:bg-primary-soft",
                  onRowClick && "cursor-pointer",
                  rowClassName?.(row.original)
                )}
              >
                {selectable ? (
                  <td
                    className={cn(
                      "border-b border-hairline pr-0 pl-3",
                      rowHeight
                    )}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      checked={!!selected[row.id]}
                      onCheckedChange={(checked) =>
                        setSelected((prev) => ({
                          ...prev,
                          [row.id]: !!checked,
                        }))
                      }
                    />
                  </td>
                ) : null}
                {row.getVisibleCells().map((cell) => {
                  const meta = metaOf(cell.column.columnDef.meta)
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "border-b border-hairline px-3 align-middle",
                        rowHeight,
                        meta.align === "right" && "nums text-right tabular-nums",
                        meta.hideBelow && HIDE_BELOW[meta.hideBelow],
                        meta.className
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  )
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <EmptyState
            icon={emptyIcon ?? <Search />}
            title={emptyTitle ?? t("common.noResults")}
            hint={emptyHint ?? t("common.noResultsHint")}
          />
        ) : null}
      </div>

      {table.getPageCount() > 1 ? (
        <div className="flex h-11 shrink-0 items-center gap-2 pt-3">
          <span className="nums text-xs text-muted-foreground">
            {num(table.getState().pagination.pageIndex * pageSize + 1)}
            {" - "}
            {num(
              Math.min(
                (table.getState().pagination.pageIndex + 1) * pageSize,
                table.getFilteredRowModel().rows.length
              )
            )}{" "}
            {t("common.of")} {num(table.getFilteredRowModel().rows.length)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label={t("common.previous")}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="nums px-1.5 text-xs text-muted-foreground">
              {num(table.getState().pagination.pageIndex + 1)} /{" "}
              {num(table.getPageCount())}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label={t("common.next")}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Filled search input for table toolbars (leading muted icon). */
export function TableSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const { t } = useLocale()
  return (
    <div className={cn("relative w-full max-w-88 min-w-40 flex-1", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t("common.search")}
        className="h-10 w-full rounded-md border border-border bg-surface-raised/60 pr-3 pl-9 text-sm text-foreground transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 dark:bg-card"
      />
    </div>
  )
}
