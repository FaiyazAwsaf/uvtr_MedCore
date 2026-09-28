"use client"

import * as React from "react"
import { Building2, FlaskConical, Layers, Pill, type LucideIcon } from "lucide-react"

import { StatusPill } from "@/components/shared/status"
import type { BrandRow, DosageForm, GenericRow } from "@/core/db/schema"
import type { MedicineHitKind } from "@/core/search/medicines"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

export const KIND_ICON: Record<MedicineHitKind, LucideIcon> = {
  brand: Pill,
  generic: FlaskConical,
  company: Building2,
  class: Layers,
}

/** A circular icon well for a medicine, generic, company or class. */
export function KindIcon({
  kind,
  className,
}: {
  kind: MedicineHitKind
  className?: string
}) {
  const Icon = KIND_ICON[kind]
  return (
    <span
      aria-hidden
      className={cn(
        "icon-well flex size-9 shrink-0 items-center justify-center text-link",
        className
      )}
    >
      <Icon className="size-[1.0625rem]" />
    </span>
  )
}

/** "Tablet", "Suspension" … in the window's language. */
export function useFormLabel(): (form: DosageForm) => string {
  const { t } = useLocale()
  return React.useCallback((form: DosageForm) => t(`library.form.${form}`), [t])
}

/**
 * Sale-type badges (objective §3C): OTC, Rx only or Controlled, plus
 * Antibiotic. Antibiotics and non-OTC medicines are dispensed only against
 * a signed prescription (INV-06).
 */
export function CategoryBadges({
  category,
  isAntibiotic,
  size = "default",
  className,
}: {
  category: BrandRow["category"]
  isAntibiotic?: boolean
  size?: "default" | "sm"
  className?: string
}) {
  const { t } = useLocale()
  const pill = size === "sm" ? "h-5 px-2 text-[0.6875rem]" : undefined
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <StatusPill
        data-testid="brand-category"
        data-category={category}
        title={t(`library.category.hint.${category}`)}
        tone={category === "otc" ? "success" : category === "rx" ? "info" : "destructive"}
        className={pill}
      >
        {t(`library.category.${category}`)}
      </StatusPill>
      {isAntibiotic ? (
        <StatusPill
          data-testid="brand-antibiotic"
          title={t("library.category.hint.antibiotic")}
          tone="warning"
          className={pill}
        >
          {t("library.category.antibiotic")}
        </StatusPill>
      ) : null}
    </span>
  )
}

/** Badges for a generic: antibiotic and controlled class. */
export function GenericBadges({
  generic,
  className,
}: {
  generic: GenericRow
  className?: string
}) {
  const { t } = useLocale()
  if (!generic.isAntibiotic && !generic.controlledClass) return null
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {generic.controlledClass ? (
        <StatusPill tone="destructive">
          {t("library.category.controlled")} · {t(`library.controlled.${generic.controlledClass}`)}
        </StatusPill>
      ) : null}
      {generic.isAntibiotic ? (
        <StatusPill tone="warning">{t("library.category.antibiotic")}</StatusPill>
      ) : null}
    </span>
  )
}

/**
 * The typed text highlighted inside a name (case-insensitive, first match).
 * Names are clinical English, so a plain substring match is enough.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase()
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[0.1875rem] bg-primary-soft px-px text-link">
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  )
}

/** "12 brands" / "1 brand" with localised digits. */
export function useCountLabel() {
  const { t, num } = useLocale()
  return React.useCallback(
    (kind: "brands" | "generics" | "companies", count: number) => {
      if (count === 1) {
        return kind === "brands"
          ? t("library.counts.oneBrand")
          : kind === "generics"
            ? t("library.counts.oneGeneric")
            : t("library.counts.oneCompany")
      }
      return t(`library.counts.${kind}`, { count: num(count) })
    },
    [t, num]
  )
}
