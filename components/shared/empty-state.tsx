"use client"

import * as React from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type EmptyStateAction = {
  label: React.ReactNode
  href?: string
  onClick?: () => void
}

export type EmptyStateProps = {
  /** A lucide icon component or any node (rendered in a muted circular well) */
  icon?: LucideIcon | React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** A turquoise text link: `{ label, href }` or `{ label, onClick }`, or any node */
  action?: EmptyStateAction | React.ReactNode
  size?: "default" | "sm"
  className?: string
}

function isAction(value: unknown): value is EmptyStateAction {
  return (
    typeof value === "object" &&
    value !== null &&
    !React.isValidElement(value) &&
    "label" in value
  )
}

function isComponent(value: unknown): value is LucideIcon {
  return (
    typeof value === "function" ||
    (typeof value === "object" &&
      value !== null &&
      "$$typeof" in value &&
      "render" in value)
  )
}

/**
 * Empty state (docs/ui_guidelines.md §4): a muted icon in a circular well, one
 * line of text, an optional hint, and a turquoise action link.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "default",
  className,
}: EmptyStateProps) {
  const Icon = isComponent(icon) ? icon : null
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-1 flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2 p-6" : "gap-3 p-10",
        className
      )}
    >
      {icon ? (
        <span
          className={cn(
            "icon-well flex items-center justify-center text-muted-foreground",
            size === "sm" ? "size-10 [&_svg]:size-[1.125rem]" : "size-12 [&_svg]:size-5"
          )}
        >
          {Icon ? <Icon /> : (icon as React.ReactNode)}
        </span>
      ) : null}
      <p className={cn("font-medium", size === "sm" ? "text-[0.8125rem]" : "text-sm")}>
        {title}
      </p>
      {description ? (
        <p className="max-w-[40ch] text-[0.8125rem] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {isAction(action) ? (
        action.href ? (
          <Link
            href={action.href}
            className="text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
          >
            {action.label}
          </button>
        )
      ) : (
        (action as React.ReactNode)
      )}
    </div>
  )
}
