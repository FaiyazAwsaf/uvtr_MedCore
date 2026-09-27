"use client"

import * as React from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * A titled card (docs/ui_guidelines.md §4 "Card"): title on the left, an
 * optional control and a turquoise "See all" link on the right, 16px between
 * header and body, 24px padding (16px when `size="sm"`).
 */
export function SectionCard({
  title,
  subtitle,
  icon: Icon,
  action,
  seeAllHref,
  onSeeAll,
  seeAllLabel,
  size = "default",
  className,
  bodyClassName,
  children,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: LucideIcon
  /** A control on the right of the header (select, button) */
  action?: React.ReactNode
  /** Shows a "See all" link to this route */
  seeAllHref?: string
  /** Shows a "See all" button calling this */
  onSeeAll?: () => void
  /** Overrides the "See all" text */
  seeAllLabel?: React.ReactNode
  size?: "default" | "sm"
  className?: string
  bodyClassName?: string
  children?: React.ReactNode
}) {
  const { t } = useLocale()
  const seeAllText = seeAllLabel ?? t("common.seeAll")
  const linkClass =
    "shrink-0 text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"

  return (
    <section
      data-slot="section-card"
      className={cn(
        "surface-card flex min-w-0 flex-col",
        size === "sm" ? "gap-3 p-4" : "gap-4 p-6",
        className
      )}
    >
      <header className="flex min-h-8 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon ? (
            <span className="icon-well flex size-9 shrink-0 items-center justify-center text-link">
              <Icon className="size-[1.125rem]" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2
              className={cn(
                "truncate leading-snug font-semibold",
                size === "sm" ? "text-[0.9375rem]" : "text-[1.0625rem]"
              )}
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {action || seeAllHref || onSeeAll ? (
          <div className="flex shrink-0 items-center gap-3">
            {action}
            {seeAllHref ? (
              <Link href={seeAllHref} className={linkClass}>
                {seeAllText}
              </Link>
            ) : onSeeAll ? (
              <button type="button" onClick={onSeeAll} className={linkClass}>
                {seeAllText}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      {children !== undefined ? (
        <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
      ) : null}
    </section>
  )
}
