"use client"

import * as React from "react"
import { WifiOff } from "lucide-react"
import type { z } from "zod"

import { KpiCard, type KpiVariant } from "@/components/shared/kpi-card"
import { SegmentedPills } from "@/components/motion/segmented"
import { branches, type BranchCode } from "@/config/brand.config"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import type { CommandDef } from "@/core/engine/types"
import { useCommand } from "@/core/engine/useCommand"
import { useDbInfo } from "@/core/db/DbProvider"
import { usePersona } from "@/core/session/persona"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { TENDER_ICON, TENDER_TAG } from "@/modules/billing/components/labels"
import type { Tender } from "@/core/db/schema"

export { LiveChip, PageBody, PageHeader, useActionKey } from "@/modules/pharmacy/components/shared"

/* ---------------- Context ---------------- */

/** Today on the demo clock (Dhaka), re-evaluated every minute and on a fast-forward. */
export function useToday(): string {
  const at = useNow(60_000)
  return at ? dhakaDate(at) : ""
}

/** This window's finance persona: staff id and whether it holds the CFO's authority. */
export function useFinancePersona() {
  const persona = usePersona()
  return {
    persona,
    staffId: persona?.staff?.id ?? null,
    authorities: persona?.staff?.authorities ?? [],
  }
}

/** Run a finance command as this window's persona; refusals open the shared engine dialogs. */
export function useFinanceCommand<S extends z.ZodType, O>(def: CommandDef<S, O>) {
  return useCommand(def)
}

/* ---------------- Branch filter (finance personas are network level) ---------------- */

export type BranchFilterValue = BranchCode | "all"

export function useBranchFilter(): [BranchFilterValue, (value: BranchFilterValue) => void] {
  return React.useState<BranchFilterValue>("all")
}

export const branchOrNull = (value: BranchFilterValue): BranchCode | null =>
  value === "all" ? null : value

/** "All branches" plus one pill per branch, by code. */
export function BranchFilter({
  value,
  onChange,
  className,
}: {
  value: BranchFilterValue
  onChange: (value: BranchFilterValue) => void
  className?: string
}) {
  const { t, locale } = useLocale()
  return (
    <div data-testid="finance-branch-filter" className={cn("min-w-0", className)}>
      <SegmentedPills<BranchFilterValue>
        size="sm"
        value={value}
        onChange={onChange}
        options={[
          { value: "all", label: t("finance.common.allBranches") },
          ...branches.map((b) => ({
            value: b.code,
            label: (
              <span title={b.name[locale]}>
                <span className="hidden @min-[44rem]/page:inline">{b.name[locale]} </span>
                <span lang="en">{b.code}</span>
              </span>
            ),
          })),
        ]}
      />
    </div>
  )
}

export function branchLabel(code: BranchCode | null | undefined, locale: "en" | "bn"): string {
  const branch = branches.find((b) => b.code === code)
  return branch ? `${branch.name[locale]} (${branch.code})` : (code ?? "")
}

/* ---------------- Offline branches (HAZ-15) ---------------- */

/**
 * Finance works on the central store: while a branch is offline its counters
 * write to the branch server, so their work since then is not in these
 * figures until it reconnects. Says so for each offline branch.
 */
export function OfflineBranchesNotice() {
  const { network } = useDbInfo()
  const { t, time, locale } = useLocale()
  const offline = network.filter((n) => n.status !== "online")
  if (!offline.length) return null
  return (
    <div data-testid="finance-offline-notice" className="flex flex-col gap-1">
      {offline.map((n) => (
        <p
          key={n.branchId}
          className="flex items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] px-3 py-2 text-[0.8125rem] font-medium"
        >
          <WifiOff className="size-4 shrink-0" />
          {t("finance.common.offline", {
            branch: branchLabel(n.branchId, locale),
            time: n.since ? time(n.since) : "",
          })}
        </p>
      ))}
    </div>
  )
}

/* ---------------- KPI row (compact in a 960x600 quadrant) ---------------- */

const KPI_CARD =
  "min-h-[5.5rem] gap-2 p-4 @min-[60rem]/kpis:min-h-[7rem] @min-[60rem]/kpis:gap-3 @min-[60rem]/kpis:p-5"

/** A KPI value that shrinks in a narrow card instead of being cut off. */
export function Figure({ children }: { children: React.ReactNode }) {
  return <span className="text-[1.25rem] @min-[15rem]/kpi:text-[1.625rem]">{children}</span>
}

/** A caption that only shows when the card is wide enough for it. */
export function Caption({ children }: { children: React.ReactNode }) {
  return <span className="hidden @min-[14rem]/kpi:inline">{children}</span>
}

export type FinanceKpi = {
  key: string
  variant: KpiVariant
  icon: React.ComponentProps<typeof KpiCard>["icon"]
  title: React.ReactNode
  value: React.ReactNode
  caption?: React.ReactNode
  href?: string
  testId?: string
}

/** Four gradient KPI cards: 2x2 in a quadrant, four across once the row is wide. */
export function FinanceKpis({ items, label }: { items: FinanceKpi[]; label: string }) {
  return (
    <section aria-label={label} className="@container/kpis">
      <div className="grid grid-cols-2 gap-3 @min-[44rem]/kpis:grid-cols-4 @min-[66rem]/kpis:gap-4">
        {items.map((item) => (
          <div key={item.key} data-testid={item.testId} className="min-w-0">
            <KpiCard
              variant={item.variant}
              icon={item.icon}
              className={cn(KPI_CARD, "h-full")}
              title={<span className="line-clamp-2 whitespace-normal">{item.title}</span>}
              value={<Figure>{item.value}</Figure>}
              caption={item.caption ? <Caption>{item.caption}</Caption> : undefined}
              href={item.href}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---------------- Small pieces ---------------- */

/** A tender as its hue-coded tag with the icon (billing's labels). */
export function TenderTag({ tender, className }: { tender: Tender; className?: string }) {
  const { tk } = useLocale()
  const Icon = TENDER_ICON[tender]
  return (
    <span className={cn("tag gap-1", TENDER_TAG[tender], className)}>
      <Icon className="size-3.5" />
      {tk(`billing.tender.${tender}`)}
    </span>
  )
}

/** A document number or reference: mono, Latin digits in both languages. */
export function DocNo({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span lang="en" translate="no" className={cn("font-mono text-xs tracking-tight", className)}>
      {children}
    </span>
  )
}

/** "August 2026" / "আগস্ট ২০২৬" for a YYYY-MM month. */
export function useMonthLabel(): (month: string) => string {
  const { date } = useLocale()
  return React.useCallback(
    (month: string) => (month ? date(`${month}-15T06:00:00Z`, { month: "long", year: "numeric" }) : ""),
    [date]
  )
}

/**
 * Calendar days as select options, DD-MM-YYYY in the window's language (a
 * native date input would show the browser's own format): `from` then the
 * next `count - 1` days, or the previous ones when `count` is negative.
 */
export function useDayOptions(from: string, count: number): { value: string; label: string }[] {
  const { dmy, date } = useLocale()
  return React.useMemo(() => {
    if (!from) return []
    const step = count < 0 ? -1 : 1
    return Array.from({ length: Math.abs(count) }, (_, i) => {
      const day = addDaysISO(from, i * step)
      return { value: day, label: `${dmy(day)}, ${date(`${day}T06:00:00Z`, { weekday: "short" })}` }
    })
  }, [from, count, dmy, date])
}

/** Save a text file in the browser (the simulated connectors' downloads). */
export function downloadText(fileName: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** Parse taka typed by a person ("1,500", "1500.50", "১৫০০") into poisha, or null. */
export { parseTaka, takaText } from "@/modules/billing/pricing"
