"use client"

import * as React from "react"
import { motion } from "motion/react"
import { ArrowUpRight, SlidersHorizontal } from "lucide-react"

import { EmptyState as SharedEmptyState } from "@/components/shared/empty-state"
import { cn } from "@/lib/utils"

/**
 * A card panel (docs/ui_guidelines.md §4 "Card"): the card surface, 14px
 * radius, 24px padding, title on the left and controls on the right. The
 * optional filter and expand buttons keep the base project's behaviour.
 */
export function Panel({
  title,
  subtitle,
  actions,
  onExpand,
  onFilter,
  className,
  bodyClassName,
  children,
  delay = 0,
}: {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  onExpand?: () => void
  onFilter?: () => void
  className?: string
  bodyClassName?: string
  children: React.ReactNode
  delay?: number
}) {
  return (
    <motion.section
      data-slot="panel"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg bg-card text-card-foreground shadow-(--card-shadow)",
        className
      )}
    >
      {title || actions || onExpand || onFilter ? (
        <header className="flex items-start justify-between gap-3 px-6 pt-5 pb-4">
          <div className="min-w-0">
            {title ? (
              <h3 className="truncate text-[1.0625rem] leading-snug font-semibold">
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {onFilter ? (
              <button
                onClick={onFilter}
                className="flex size-8 items-center justify-center rounded-full bg-surface-raised text-muted-foreground transition-colors hover:text-foreground"
              >
                <SlidersHorizontal className="size-4" />
              </button>
            ) : null}
            {onExpand ? (
              <button
                onClick={onExpand}
                className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
              >
                <ArrowUpRight className="size-4" />
              </button>
            ) : null}
          </div>
        </header>
      ) : null}
      <div
        className={cn(
          "min-h-0 flex-1 px-6 pb-6",
          !(title || actions || onExpand || onFilter) && "pt-6",
          bodyClassName
        )}
      >
        {children}
      </div>
    </motion.section>
  )
}

/** Page title row: 22px / 600 title, muted subtitle, actions on the right. */
export function PageHeader({
  title,
  subtitle,
  children,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex flex-wrap items-end justify-between gap-3 pt-1 pb-4",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="truncate text-[1.375rem] leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 truncate text-[0.8125rem] text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {children}
        </div>
      ) : null}
    </header>
  )
}

/** Kept for the base API; renders the shared EmptyState. */
export function EmptyState({
  icon,
  title,
  hint,
  className,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  hint?: React.ReactNode
  className?: string
}) {
  return (
    <SharedEmptyState
      icon={icon}
      title={title}
      description={hint}
      className={className}
    />
  )
}
