"use client"

import * as React from "react"
import { ChevronDown, CircleAlert, ShieldCheck, type LucideIcon } from "lucide-react"
import type { z } from "zod"

import { KpiCard, KpiGrid, type KpiVariant } from "@/components/shared/kpi-card"
import { ruleMessage } from "@/components/shared/rule-message"
import { StatusText, type Tone } from "@/components/shared/status"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { branches, type BranchCode } from "@/config/brand.config"
import { useDb, useDbInfo } from "@/core/db/DbProvider"
import type { BedRow, Poisha, WardRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { RuleViolation } from "@/core/engine/errors"
import { feedbackFor, useEngineFeedback } from "@/core/engine/feedback"
import type { CommandDef } from "@/core/engine/types"
import { useActor, usePersona } from "@/core/session/persona"
import { now } from "@/core/clock/clock"
import { useNow } from "@/core/clock/useNow"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { inpatientEn } from "../i18n/en"
import { reasonKey, WARD_KIND_KEY } from "../stay"

/* ------------------------------------------------------------------ *
 * Context
 * ------------------------------------------------------------------ */

export function branchLabel(code: BranchCode | null | undefined, locale: "en" | "bn"): string {
  const branch = branches.find((b) => b.code === code)
  return branch ? `${branch.name[locale]} (${branch.code})` : (code ?? "")
}

/** This window's persona for the inpatient screens: branch, staff id and database mode. */
export function useInpatientContext() {
  const persona = usePersona()
  const { locale } = useLocale()
  const { isEdge } = useDbInfo()
  const branch = persona?.branchId ?? null
  return {
    persona,
    branch,
    branchText: branchLabel(branch, locale),
    staffId: persona?.staff?.id ?? null,
    isEdge,
  }
}

/**
 * The demo-clock moment the screens compute interim bills at: exact (not
 * rounded to the tick), re-read every `intervalMs` and at once when the demo
 * clock moves, so a stay admitted a moment ago gains its day on "+1 day"
 * exactly as the sweeper sees it.
 */
export function useDemoNow(intervalMs = 30_000): number {
  const tick = useNow(intervalMs)
  // `tick` changes on every interval and clock change; read the exact time then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => now(), [tick])
}

/* ------------------------------------------------------------------ *
 * Commands with inline rule messages
 * ------------------------------------------------------------------ */

const OWN_RULES = new Set(Object.keys(inpatientEn.inpatient.rules))

export type Problem = { code: string; params: Record<string, string | number> }

/**
 * Run an inpatient command as this window's persona. A refusal with one of
 * this module's rule codes comes back as an inline message next to the
 * action; conflicts ("Record changed"), denials and engine rules open the
 * shared engine dialogs. A second call while one is running is ignored.
 */
export function useInpatientCommand<S extends z.ZodType, O>(def: CommandDef<S, O>) {
  const db = useDb()
  const actor = useActor()
  const show = useEngineFeedback((state) => state.show)
  const [pending, setPending] = React.useState(false)
  const [problem, setProblem] = React.useState<Problem | null>(null)
  const inFlight = React.useRef(false)

  const run = React.useCallback(
    async (input: z.input<S>): Promise<O | undefined> => {
      if (!actor) {
        show({ kind: "no-persona", command: def.name })
        return undefined
      }
      if (inFlight.current) return undefined
      inFlight.current = true
      setPending(true)
      setProblem(null)
      try {
        return (await commit(def, input, { db, actor })).result
      } catch (caught) {
        if (caught instanceof RuleViolation && OWN_RULES.has(caught.code)) {
          setProblem({ code: caught.code, params: caught.params })
        } else {
          show(feedbackFor(caught, def.name))
        }
        return undefined
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [db, actor, def, show]
  )

  const clear = React.useCallback(() => setProblem(null), [])
  return { run, pending, problem, clear }
}

/** The message for a rule code in this window's language, params formatted. */
export function useRuleText(): (problem: Problem) => string {
  const { locale, tk, num, money, dmy, uhid } = useLocale()
  return React.useCallback(
    (problem: Problem) =>
      ruleMessage(problem.code, problem.params, { locale, tk, num, money, dmy, uhid }, "inpatient"),
    [locale, tk, num, money, dmy, uhid]
  )
}

/** An inline refusal under a form. */
export function ProblemAlert({ problem, className }: { problem: Problem | null; className?: string }) {
  const text = useRuleText()
  if (!problem) return null
  return (
    <Alert variant="destructive" className={className} data-testid="inpatient-problem" data-code={problem.code}>
      <CircleAlert />
      <AlertDescription>{text(problem)}</AlertDescription>
    </Alert>
  )
}

/* ------------------------------------------------------------------ *
 * Labels
 * ------------------------------------------------------------------ */

export const BED_TONE: Record<BedRow["status"], Tone> = {
  vacant: "success",
  occupied: "primary",
  cleaning: "warning",
  reserved: "info",
}

/** Left accent of a bed tile per status. */
export const BED_ACCENT: Record<BedRow["status"], string> = {
  vacant: "border-l-success",
  occupied: "border-l-primary",
  cleaning: "border-l-warning",
  reserved: "border-l-info",
}

/** Status dot of a bed tile. */
export const BED_DOT: Record<BedRow["status"], string> = {
  vacant: "bg-success",
  occupied: "bg-primary",
  cleaning: "bg-warning",
  reserved: "bg-info",
}

export function BedStatusText({
  status,
  className,
}: {
  status: BedRow["status"]
  className?: string
}) {
  const { tk } = useLocale()
  return (
    <StatusText tone={BED_TONE[status]} dot className={className}>
      {tk(`inpatient.bedStatus.${status}`)}
    </StatusText>
  )
}

export function useWardText() {
  const { tk, locale } = useLocale()
  return React.useCallback(
    (ward: Pick<WardRow, "code" | "name" | "kind">) => ({
      name: `${ward.code} · ${ward.name[locale]}`,
      kind: tk(`inpatient.wardKind.${WARD_KIND_KEY[ward.kind]}`),
    }),
    [tk, locale]
  )
}

/** A stored admission reason in this window's language (presets are translated). */
export function useReasonText() {
  const { tk } = useLocale()
  return React.useCallback(
    (reason: string) => {
      const key = reasonKey(reason)
      return key ? tk(`inpatient.reasons.${key}`) : reason
    },
    [tk]
  )
}

/** Deposit left, or the amount owed when the charges have overtaken the deposits. */
export function BalanceText({
  balanceP,
  low,
  className,
}: {
  balanceP: Poisha
  low: boolean
  className?: string
}) {
  const { t, money } = useLocale()
  return (
    <span
      className={cn(
        "nums font-semibold whitespace-nowrap tabular-nums",
        low ? "text-destructive" : "text-foreground",
        className
      )}
    >
      {balanceP < 0 ? t("inpatient.common.owes", { amount: money(-balanceP) }) : money(balanceP)}
    </span>
  )
}

/** "Administrative record: ... Not a clinical record." (plan §11) */
export function NotClinicalNote({ className }: { className?: string }) {
  const { t } = useLocale()
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <ShieldCheck className="size-3.5 shrink-0 text-link" />
      {t("inpatient.common.notClinical")}
    </p>
  )
}

/* ------------------------------------------------------------------ *
 * Form controls
 * ------------------------------------------------------------------ */

/** A native select in the input style (keyboard and test friendly). */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative min-w-0">
      <select
        className={cn(
          "h-10 w-full min-w-0 appearance-none rounded-md border border-border bg-transparent pr-9 pl-3 text-sm text-foreground outline-none [color-scheme:light] focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:opacity-50 aria-invalid:border-destructive dark:[color-scheme:dark] [&>optgroup]:bg-popover [&>option]:bg-popover",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * KPI row: gradient cards when wide, compact chips in a quadrant
 * ------------------------------------------------------------------ */

export type Kpi = {
  key: string
  icon: LucideIcon
  title: React.ReactNode
  value: React.ReactNode
  caption?: React.ReactNode
  variant: KpiVariant
}

export function KpiRow({ items, label }: { items: Kpi[]; label: string }) {
  const wide = useMediaQuery("(min-width: 1280px)")
  if (wide) {
    return (
      <section aria-label={label}>
        <KpiGrid>
          {items.map((kpi) => (
            <KpiCard
              key={kpi.key}
              variant={kpi.variant}
              icon={kpi.icon}
              title={kpi.title}
              value={kpi.value}
              caption={kpi.caption}
            />
          ))}
        </KpiGrid>
      </section>
    )
  }
  return (
    <section aria-label={label} className="flex flex-wrap gap-2">
      {items.map((kpi) => (
        <span
          key={kpi.key}
          data-testid={`kpi-${kpi.key}`}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-card px-3.5 text-[0.8125rem]"
        >
          <kpi.icon className="size-4 text-link" />
          <span className="text-muted-foreground">{kpi.title}</span>
          <span className="nums font-semibold">{kpi.value}</span>
        </span>
      ))}
    </section>
  )
}
