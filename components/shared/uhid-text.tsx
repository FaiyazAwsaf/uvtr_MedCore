"use client"

import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * A UHID, grouped for reading (1000-0000-01-8) in mono. Identifiers always use
 * Latin digits, in Bangla too, so they scan and match (plan §3.11, D13).
 * Provisional offline UHIDs (P-B1-000001) are shown as they are.
 */
export function UhidText({
  uhid,
  withLabel = false,
  className,
}: {
  uhid: string
  /** Prefix with "UHID" */
  withLabel?: boolean
  className?: string
}) {
  const { t, uhid: format } = useLocale()
  return (
    <span
      data-slot="uhid-text"
      translate="no"
      className={cn("inline-flex items-baseline gap-1.5 whitespace-nowrap", className)}
    >
      {withLabel ? (
        <span className="text-muted-foreground">{t("common.uhid")}</span>
      ) : null}
      <span lang="en" dir="ltr" className="font-mono tracking-tight tabular-nums">
        {format(uhid)}
      </span>
    </span>
  )
}
