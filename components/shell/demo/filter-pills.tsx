"use client"

import { cn } from "@/lib/utils"

export type FilterOption<T extends string> = {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

/** A row of pill toggles; the selected pill is turquoise (ui_guidelines §4, date pills). */
export function FilterPills<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: FilterOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex flex-wrap gap-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 max-w-full truncate rounded-full px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-surface-raised text-muted-foreground enabled:hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
