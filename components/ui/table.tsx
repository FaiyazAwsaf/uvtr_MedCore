"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Tables (docs/ui_guidelines.md §4): a raised header band with a rounded top,
 * 44px rows (36px with `data-density="compact"` on <Table>), hairline row
 * dividers and a soft turquoise tint on hover or selection. Show statuses as
 * coloured text (StatusText) and actions as turquoise text links.
 */
function Table({
  className,
  density = "default",
  ...props
}: React.ComponentProps<"table"> & { density?: "default" | "compact" }) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        data-density={density}
        className={cn(
          "group/table w-full caption-bottom border-separate border-spacing-0 text-[0.8125rem]",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_th]:bg-surface-raised [&_th:first-child]:rounded-l-md [&_th:last-child]:rounded-r-md",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child_td]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "font-semibold [&_td]:border-t [&_td]:border-hairline [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "transition-colors hover:bg-primary-soft has-aria-expanded:bg-primary-soft data-[state=selected]:bg-primary-soft in-[thead]:hover:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-11 px-3 text-left align-middle text-[0.8125rem] font-medium whitespace-nowrap text-foreground group-data-[density=compact]/table:h-9 has-[[role=checkbox]]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-11 border-b border-hairline px-3 align-middle whitespace-nowrap group-data-[density=compact]/table:h-9 has-[[role=checkbox]]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
