"use client"

import { usePathname } from "next/navigation"
import { Construction } from "lucide-react"

import type { TranslationKey } from "@/lib/i18n"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Placeholder for a route whose screen is not built yet. Every route in plan §9
 * exists from Phase 0 so workstreams only replace their own page files. It
 * fills whatever frame it is in (the staff content area, the phone screen, or
 * the whole window).
 */
export function StubPage({
  sectionKey,
  phase,
}: {
  sectionKey: TranslationKey
  phase: number
}) {
  const { t, num } = useLocale()
  const pathname = usePathname()
  return (
    <div className="flex min-h-[60svh] flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="icon-well flex size-12 items-center justify-center text-primary">
        <Construction className="size-5" />
      </span>
      <p className="text-lg font-semibold">{t(sectionKey)}</p>
      <p className="font-mono text-xs text-muted-foreground">{pathname}</p>
      <p className="max-w-[42ch] text-sm text-muted-foreground">
        {t("shell.comingSoon", { phase: num(phase) })}
      </p>
    </div>
  )
}
