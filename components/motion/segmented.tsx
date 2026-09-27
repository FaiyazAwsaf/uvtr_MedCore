"use client"

import * as React from "react"
import { motion } from "motion/react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

export type SegmentOption<T extends string> = {
  value: T
  label: React.ReactNode
  count?: React.ReactNode
  icon?: React.ReactNode
}

/**
 * A row of pills (the sample's date pills and filters): the selected pill is
 * filled turquoise with dark text and slides between options; the others sit
 * on the raised surface.
 */
export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "default",
  id,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  size?: "sm" | "default"
  id?: string
}) {
  const layoutId = React.useId()
  return (
    <div
      data-slot="segmented-pills"
      role="tablist"
      className={cn("flex items-center gap-1.5 overflow-x-auto", className)}
      id={id}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative shrink-0 rounded-full font-medium whitespace-nowrap transition-colors outline-none",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              size === "sm"
                ? "h-7 px-3 text-xs"
                : "h-9 px-4 text-[0.8125rem]",
              active
                ? "text-primary-foreground"
                : "bg-surface-raised text-foreground/80 hover:text-foreground"
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 520, damping: 38 }}
                className="absolute inset-0 rounded-full bg-primary"
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-1.5 [&_svg]:size-4">
              {option.icon}
              {option.label}
              {option.count !== undefined ? (
                <span
                  className={cn(
                    "nums rounded-full px-1.5 text-[0.6875rem] tabular-nums",
                    active
                      ? "bg-primary-foreground/15"
                      : "bg-foreground/8 text-muted-foreground"
                  )}
                >
                  {option.count}
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Page-level underline tabs with a sliding turquoise indicator. */
export function UnderlineTabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const layoutId = React.useId()
  return (
    <div
      data-slot="underline-tabs"
      role="tablist"
      className={cn(
        "flex items-center gap-6 overflow-x-auto border-b border-hairline",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex h-10 shrink-0 items-center gap-1.5 text-sm font-medium transition-colors outline-none",
              "focus-visible:text-foreground [&_svg]:size-4",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.icon}
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "nums rounded-full px-1.5 text-[0.6875rem]",
                  active
                    ? "bg-primary-soft text-link"
                    : "bg-surface-raised text-muted-foreground"
                )}
              >
                {option.count}
              </span>
            ) : null}
            {active ? (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 520, damping: 38 }}
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Outlined "label | value v" filter control (the sample's "Monthly v"). */
export function CompoundFilter({
  label,
  children,
  className,
  onClick,
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <button
      data-slot="compound-filter"
      onClick={onClick}
      className={cn(
        "group inline-flex h-10 shrink-0 items-center overflow-hidden rounded-md border border-border bg-transparent text-[0.8125rem] transition-colors hover:bg-surface-raised/60",
        "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 focus-visible:outline-none",
        className
      )}
    >
      <span className="border-r border-border px-3 text-muted-foreground">
        {label}
      </span>
      <span className="flex items-center gap-1.5 px-3 font-medium">
        {children}
        <ChevronDown className="size-4 text-muted-foreground" />
      </span>
    </button>
  )
}
