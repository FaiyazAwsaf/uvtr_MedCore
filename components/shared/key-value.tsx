"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** True inside a KeyValueGrid (which is the <dl>); standalone rows are their own <dl>. */
const InGridContext = React.createContext(false)

/**
 * One labelled value: a muted caption above (or beside, with
 * `layout="inline"`) the value. `mono` for identifiers and codes.
 */
export function KeyValue({
  label,
  value,
  mono = false,
  layout = "stacked",
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
  layout?: "stacked" | "inline"
  className?: string
}) {
  const inGrid = React.useContext(InGridContext)
  const Root = inGrid ? "div" : "dl"
  return (
    <Root
      data-slot="key-value"
      className={cn(
        "min-w-0",
        layout === "inline"
          ? "flex items-baseline justify-between gap-4 py-1.5"
          : "flex flex-col gap-0.5",
        className
      )}
    >
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-[0.8125rem] font-medium text-foreground",
          layout === "inline" ? "text-right" : "truncate",
          mono && "font-mono tracking-tight"
        )}
      >
        {value ?? "-"}
      </dd>
    </Root>
  )
}

export type KeyValueItem = {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
  /** Span two columns (long values) */
  wide?: boolean
}

/** A grid of labelled values that reflows by width (1 to `columns` columns). */
export function KeyValueGrid({
  items,
  columns = 2,
  className,
}: {
  items: KeyValueItem[]
  columns?: 2 | 3 | 4
  className?: string
}) {
  return (
    <div data-slot="key-value-grid" className="@container/kv">
      <dl
        className={cn(
          "grid grid-cols-1 gap-x-6 gap-y-3.5 @min-[22rem]/kv:grid-cols-2",
          columns >= 3 && "@min-[36rem]/kv:grid-cols-3",
          columns >= 4 && "@min-[48rem]/kv:grid-cols-4",
          className
        )}
      >
        <InGridContext.Provider value={true}>
          {items.map((item, index) => (
            <KeyValue
              key={index}
              label={item.label}
              value={item.value}
              mono={item.mono}
              className={item.wide ? "@min-[22rem]/kv:col-span-2" : undefined}
            />
          ))}
        </InGridContext.Provider>
      </dl>
    </div>
  )
}
