"use client"

import * as React from "react"
import { Lightbulb, Rocket, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** Lavender banner shell shared by the Release 2 and Release 3 banners. */
function LavenderBanner({
  icon: Icon,
  label,
  title,
  body,
  footnote,
  className,
}: {
  icon: LucideIcon
  label: React.ReactNode
  title: React.ReactNode
  body?: React.ReactNode
  footnote?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-md border border-[color-mix(in_oklch,var(--chart-2)_38%,transparent)] bg-[color-mix(in_oklch,var(--chart-2)_13%,transparent)] px-4 py-3",
        className
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--chart-2)_24%,transparent)] text-[color-mix(in_oklch,var(--chart-2),var(--foreground)_25%)] dark:text-chart-2">
        <Icon className="size-[1.125rem]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="inline-flex h-6 items-center rounded-full bg-chart-2 px-2.5 text-xs font-semibold text-[#2b1640]">
            {label}
          </span>
          <span className="text-[0.8125rem] font-semibold">{title}</span>
        </div>
        {body ? (
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">
            {body}
          </p>
        ) : null}
        {footnote ? (
          <p className="mt-1 text-xs font-medium text-foreground/80">{footnote}</p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * "Release 2" banner (plan §11): telemedicine and other Release 2 previews
 * must never look live.
 */
export function ReleaseBanner({
  title,
  description,
  className,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  className?: string
}) {
  const { t } = useLocale()
  return (
    <LavenderBanner
      icon={Rocket}
      label={t("common.release.r2Label")}
      title={title ?? t("common.release.r2Title")}
      body={description ?? t("common.release.r2Body")}
      className={className}
    />
  )
}

/**
 * "Release 3 roadmap, concept, seeded data" banner for every Tier 3 screen
 * (plan §11, Phase 6). AI screens also state that output needs human approval.
 */
export function ConceptBanner({
  description,
  aiOutput = false,
  className,
}: {
  description?: React.ReactNode
  /** Adds "AI output requires human approval." */
  aiOutput?: boolean
  className?: string
}) {
  const { t } = useLocale()
  return (
    <LavenderBanner
      icon={Lightbulb}
      label={t("common.release.conceptLabel")}
      title={t("common.release.conceptTitle")}
      body={description ?? t("common.release.conceptBody")}
      footnote={aiOutput ? t("common.release.humanApproval") : undefined}
      className={className}
    />
  )
}
