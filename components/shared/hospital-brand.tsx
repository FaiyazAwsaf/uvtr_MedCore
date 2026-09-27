"use client"

import * as React from "react"

import { hospital } from "@/config/brand.config"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * The hospital's logo mark, generated from brand.config (monogram on the
 * hospital colour with a small cross) until real assets are supplied. The
 * hospital-facing surfaces (patient app, Rx, reports, display board) use it;
 * the staff app never does.
 */
export function HospitalLogo({
  size = 32,
  className,
}: {
  size?: number
  className?: string
}) {
  const sizeRem = `${size / 16}rem`
  return (
    <svg
      data-slot="hospital-logo"
      viewBox="0 0 40 40"
      role="img"
      aria-label={hospital.name.en}
      style={{ width: sizeRem, height: sizeRem }}
      className={cn("shrink-0", className)}
    >
      <rect width="40" height="40" rx="11" fill={hospital.colors.primary} />
      <rect x="27" y="6" width="8" height="2.6" rx="1.3" fill="#fff" opacity="0.9" />
      <rect x="29.7" y="3.3" width="2.6" height="8" rx="1.3" fill="#fff" opacity="0.9" />
      <text
        x="19"
        y="27.5"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        letterSpacing="-0.5"
        fill={hospital.colors.primaryForeground}
      >
        {hospital.monogram}
      </text>
    </svg>
  )
}

/** Logo mark plus the hospital name in the window's language. */
export function HospitalWordmark({
  short = false,
  size = 32,
  className,
}: {
  short?: boolean
  size?: number
  className?: string
}) {
  const { locale } = useLocale()
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2.5", className)}>
      <HospitalLogo size={size} />
      <span className="truncate text-[0.9375rem] leading-tight font-semibold">
        {(short ? hospital.shortName : hospital.name)[locale]}
      </span>
    </span>
  )
}
