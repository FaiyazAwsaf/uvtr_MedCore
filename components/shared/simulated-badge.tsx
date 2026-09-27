"use client"

import { Zap } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * "Simulated" pill shown next to every external connector (plan §3.13, §11):
 * card terminal, bKash/Nagad, SMS, analyser, label printer, OTP and exports.
 */
export function SimulatedBadge({
  className,
  label,
}: {
  className?: string
  /** Overrides the default "Simulated" text */
  label?: string
}) {
  const { t } = useLocale()
  return (
    <span
      data-slot="simulated-badge"
      title={label ?? t("common.simulated")}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border px-2 text-[0.6875rem] font-medium whitespace-nowrap text-muted-foreground",
        className
      )}
    >
      <Zap className="size-3 fill-current" />
      {label ?? t("common.simulated")}
    </span>
  )
}
