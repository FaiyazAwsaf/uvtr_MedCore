"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** Semantic tones shared by status text, pills, timeline dots and banners. */
export type Tone =
  | "success"
  | "destructive"
  | "warning"
  | "info"
  | "muted"
  | "primary"

/**
 * Coloured text per tone. Warning is darkened in light mode, where the raw
 * yellow is too pale to read on white.
 */
export const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  destructive: "text-destructive",
  warning:
    "text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning",
  info: "text-info",
  muted: "text-muted-foreground",
  primary: "text-link",
}

/** Soft pill per tone: a 15% tint of the tone with coloured text. */
export const TONE_SOFT: Record<Tone, string> = {
  success: "bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-success",
  destructive:
    "bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] text-destructive",
  warning:
    "bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning",
  info: "bg-[color-mix(in_oklch,var(--info)_15%,transparent)] text-info",
  muted: "bg-surface-raised text-muted-foreground",
  primary: "bg-primary-soft text-link",
}

/** Solid dot per tone. */
export const TONE_DOT: Record<Tone, string> = {
  success: "bg-success",
  destructive: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
  muted: "bg-muted-foreground",
  primary: "bg-primary",
}

type StatusProps = React.ComponentProps<"span"> & {
  tone?: Tone
  /** Leading dot in the tone colour */
  dot?: boolean
}

/**
 * Status as coloured text, the default in tables and lists
 * (docs/ui_guidelines.md §1: "status shown as coloured text rather than
 * heavy pills").
 */
export function StatusText({
  tone = "muted",
  dot = false,
  className,
  children,
  ...props
}: StatusProps) {
  return (
    <span
      data-slot="status-text"
      className={cn(
        "inline-flex items-center gap-1.5 font-medium whitespace-nowrap",
        TONE_TEXT[tone],
        className
      )}
      {...props}
    >
      {dot ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      ) : null}
      {children}
    </span>
  )
}

/** Soft status pill, for queue states and badges where text alone is too quiet. */
export function StatusPill({
  tone = "muted",
  dot = false,
  className,
  children,
  ...props
}: StatusProps) {
  return (
    <span
      data-slot="status-pill"
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5",
        TONE_SOFT[tone],
        className
      )}
      {...props}
    >
      {dot ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      ) : null}
      {children}
    </span>
  )
}
