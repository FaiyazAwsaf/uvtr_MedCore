"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { TAG_CLASS, type TagHue } from "@/lib/hue"

/**
 * Hue-coded soft pill (docs/ui_guidelines.md §4 "Status tag"): a 15% tint with
 * coloured text, for queue states and categories. For plain statuses in
 * tables prefer coloured text (StatusText).
 */
export function StatusTag({
  hue = "slate",
  dot = false,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { hue?: TagHue; dot?: boolean }) {
  return (
    <span
      data-slot="status-tag"
      className={cn(
        "tag h-6 gap-1.5 border-transparent px-2.5 text-xs",
        TAG_CLASS[hue],
        className
      )}
      {...props}
    >
      {dot ? (
        <span className="size-1.5 rounded-full bg-current opacity-90" />
      ) : null}
      {children}
    </span>
  )
}

export function HueDot({
  hue,
  className,
}: {
  hue: TagHue
  className?: string
}) {
  return (
    <span
      data-slot="hue-dot"
      className={cn("size-2 shrink-0 rounded-full", className)}
      style={{ background: `var(--hue-${hue})` }}
    />
  )
}
