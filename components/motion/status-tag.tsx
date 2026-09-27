"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { TAG_CLASS, type TagHue } from "@/lib/hue"

/** Hue-coded pill for statuses and categories. Stacks freely inside a cell. */
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
      className={cn("tag", TAG_CLASS[hue], className)}
      {...props}
    >
      {dot ? (
        <span className="size-1 rounded-full bg-current opacity-80" />
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
      className={cn("size-1.5 shrink-0 rounded-full", className)}
      style={{ background: `var(--hue-${hue})` }}
    />
  )
}
