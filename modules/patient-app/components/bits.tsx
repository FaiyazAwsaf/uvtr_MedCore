"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import { LoaderCircle } from "lucide-react"

import { GeneratedAvatar } from "@/components/shared/avatars"
import type { StaffRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** Screen heading: a large title, an optional subtitle and an action on the right. */
export function ScreenTitle({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-end justify-between gap-3 pt-1 pb-3">
      <div className="min-w-0">
        <h1 className="text-[1.375rem] leading-tight font-semibold">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-[0.8125rem] leading-snug text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/** The app's card: the surface token, a large radius and roomy padding. */
export const AppCard = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & { flash?: boolean }
>(function AppCard({ className, flash, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "surface-card rounded-[1.25rem] p-4",
        flash && "ring-2 ring-primary/60",
        className
      )}
      {...props}
    />
  )
})

/** Muted section label above a group of cards. */
export function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mt-5 mb-2 flex items-center justify-between gap-3 px-1">
      <h2 className="text-[0.9375rem] font-semibold">{children}</h2>
      {action}
    </div>
  )
}

/** Circular icon well in the hospital colour. */
export function IconWell({
  icon: Icon,
  className,
}: {
  icon: LucideIcon
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-link",
        className
      )}
    >
      <Icon className="size-5" />
    </span>
  )
}

/** A doctor's generated portrait (white coat and stethoscope). */
export function DoctorAvatar({
  staff,
  size = 44,
}: {
  staff:
    | Pick<StaffRow, "id" | "avatarSeed" | "sex" | "nameEn" | "nameBn">
    | undefined
  size?: number
}) {
  const { locale } = useLocale()
  return (
    <GeneratedAvatar
      seed={staff?.avatarSeed ?? staff?.id ?? "doctor"}
      sex={staff?.sex ?? "M"}
      role="doctor"
      size={size}
      title={
        staff ? (locale === "bn" ? staff.nameBn : staff.nameEn) : undefined
      }
    />
  )
}

/** Centered spinner with a caption, for screens waiting on their first read. */
export function AppLoading() {
  const { t } = useLocale()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-[0.8125rem] text-muted-foreground">
      <LoaderCircle className="size-6 animate-spin text-primary" />
      {t("patientApp.common.loading")}
    </div>
  )
}

/** Two linked segments that switch between sibling screens (Reports | Prescriptions). */
export function SegmentLinks({
  items,
  label,
}: {
  items: { href: string; label: React.ReactNode }[]
  label: string
}) {
  const pathname = usePathname()
  return (
    <nav
      aria-label={label}
      className="mb-1 grid grid-cols-2 gap-1 rounded-full bg-surface-raised p-1"
    >
      {items.map((item) => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center justify-center rounded-full text-[0.875rem] font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-(--card-shadow)"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

/** Segmented control (buttons) for choices inside a screen. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: React.ReactNode }[]
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-surface-raised p-1",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-h-10 items-center justify-center rounded-full px-3 text-[0.8125rem] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active
                ? "bg-card text-foreground shadow-(--card-shadow)"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** The record id in `?focus=` (a notification or booking opened this screen on it). */
export function useFocusId(): string | null {
  return useSearchParams().get("focus")
}

/**
 * Scrolls a card into view and rings it briefly when it is the focused
 * record, e.g. the appointment just booked or the report a notification named.
 */
export function useFocusRing(active: boolean): {
  ref: React.RefObject<HTMLDivElement | null>
  flash: boolean
} {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [flash, setFlash] = React.useState(false)
  React.useEffect(() => {
    if (!active) return
    const start = window.setTimeout(() => {
      ref.current?.scrollIntoView({ block: "start", behavior: "smooth" })
      setFlash(true)
    }, 150)
    const stop = window.setTimeout(() => setFlash(false), 2400)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(stop)
    }
  }, [active])
  return { ref, flash }
}
