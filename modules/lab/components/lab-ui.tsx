"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowDown, ArrowUp, TriangleAlert } from "lucide-react"

import { PatientAvatar } from "@/components/shared/avatars"
import { nameIn } from "@/components/shared/person"
import { StatusPill, TONE_TEXT, type Tone } from "@/components/shared/status"
import { UhidText } from "@/components/shared/uhid-text"
import { branches, type BranchCode } from "@/config/brand.config"
import { ageOn, dhakaDate } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import { useNow } from "@/core/clock/useNow"
import type {
  Container,
  LabTestRow,
  PatientRow,
  ResultFlag,
  ResultRow,
} from "@/core/db/schema"
import { rangeFor } from "@/core/seed/content/analyser-scripts"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { TEXT_ANALYTE } from "../commands"
import {
  CONTAINER_CAP,
  deltaCheck,
  formatRange,
  formatValue,
  previousFor,
  resultText,
} from "../logic"
import { useStageCounts, type StageCounts } from "./use-lab-data"

/* ---------------- Page frame ---------------- */

export function branchLabel(branch: BranchCode, locale: "en" | "bn"): string {
  const row = branches.find((b) => b.code === branch)
  return row ? `${row.name[locale]} (${row.code})` : branch
}

/** Page header: title, subtitle, optional actions, then the specimen-flow strip. */
export function LabPage({
  title,
  subtitle,
  actions,
  branch,
  strip = true,
  children,
  testId,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  branch: BranchCode
  strip?: boolean
  children: React.ReactNode
  testId?: string
}) {
  return (
    <div className="flex flex-col gap-4 py-2" data-testid={testId}>
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.375rem] leading-tight font-semibold">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 max-w-[80ch] text-sm text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      {strip ? <StageStrip branch={branch} /> : null}
      {children}
    </div>
  )
}

const STAGES: {
  key: keyof StageCounts
  href: string
  unit: "specimens" | "tests" | "orders"
}[] = [
  { key: "collect", href: "/lab", unit: "specimens" },
  { key: "transit", href: "/lab/reception", unit: "specimens" },
  { key: "results", href: "/lab/analyser", unit: "tests" },
  { key: "validate", href: "/lab/validation", unit: "tests" },
  { key: "sign", href: "/pathology", unit: "orders" },
]

/**
 * The specimen flow at a glance: live counts per stage, each linking to its
 * screen (the sign-off stage only for the pathologist, who owns that route).
 */
export function StageStrip({ branch }: { branch: BranchCode }) {
  const { t, num } = useLocale()
  const pathname = usePathname()
  const counts = useStageCounts(branch)
  const onPathology = pathname.startsWith("/pathology")
  return (
    <nav
      aria-label={t("lab.stages.label")}
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      data-testid="lab-stage-strip"
    >
      {STAGES.map((stage, index) => {
        const active =
          stage.href === "/lab"
            ? pathname === "/lab"
            : pathname.startsWith(stage.href)
        const linkable = onPathology
          ? stage.key === "sign"
          : stage.key !== "sign"
        const count = counts?.[stage.key]
        const body = (
          <>
            <span
              className={cn(
                "figure text-xl leading-none tabular-nums",
                active
                  ? "text-primary-foreground"
                  : count
                    ? "text-foreground"
                    : "text-muted-foreground"
              )}
            >
              {count === undefined ? "…" : num(count)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.8125rem] leading-tight font-semibold">
                {t(`lab.stages.${stage.key}`)}
              </span>
              <span
                className={cn(
                  "block truncate text-[0.6875rem] leading-tight",
                  active
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground"
                )}
              >
                {index + 1}. {t(`lab.stages.${stage.unit}`)}
              </span>
            </span>
          </>
        )
        const classes = cn(
          "flex min-w-[9.5rem] flex-1 items-center gap-3 rounded-md px-3.5 py-2.5 transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-card hover:bg-surface-raised",
          !linkable && !active && "cursor-default hover:bg-card"
        )
        return linkable && !active ? (
          <Link
            key={stage.key}
            href={stage.href}
            className={classes}
            data-stage={stage.key}
          >
            {body}
          </Link>
        ) : (
          <div
            key={stage.key}
            className={classes}
            data-stage={stage.key}
            aria-current={active ? "page" : undefined}
          >
            {body}
          </div>
        )
      })}
    </nav>
  )
}

/* ---------------- Small parts ---------------- */

/** Tube cap colour dot with the container's name. */
export function ContainerChip({
  container,
  short = false,
  className,
}: {
  container: Container
  short?: boolean
  className?: string
}) {
  const { tk } = useLocale()
  const label = tk(`lab.containers.${container}`)
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-[0.8125rem]",
        className
      )}
      title={label}
    >
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full ring-1 ring-black/20"
        style={{ backgroundColor: CONTAINER_CAP[container] }}
      />
      <span className="truncate">
        {short ? label.replace(/\s*\(.*\)$/, "") : label}
      </span>
    </span>
  )
}

/** Avatar, name, UHID and age/sex in two lines, for worklist rows. */
export function PatientCell({
  patient,
  className,
}: {
  patient: PatientRow | undefined
  className?: string
}) {
  const { t, num, locale } = useLocale()
  const tick = useNow(3_600_000)
  if (!patient) return <span className="text-muted-foreground">-</span>
  const age = ageOn(patient.dob, dhakaDate(tick || now()))
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <PatientAvatar patient={patient} size={32} />
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {nameIn(patient, locale)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <UhidText uhid={patient.uhid} />
          <span aria-hidden>·</span>
          <span className="nums whitespace-nowrap">
            {t("common.years", { count: num(age) })}{" "}
            {t(`common.sexShort.${patient.sex}`)}
          </span>
        </span>
      </span>
    </span>
  )
}

/** Test codes as small chips (full name in the tooltip, Bangla gloss in BN). */
export function TestChips({
  testIds,
  tests,
  className,
}: {
  testIds: string[]
  tests: Map<string, LabTestRow> | undefined
  className?: string
}) {
  const { locale } = useLocale()
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {testIds.map((id, index) => {
        const test = tests?.get(id)
        const title = test
          ? locale === "bn" && test.glossBn
            ? `${test.name} · ${test.glossBn}`
            : test.name
          : id
        return (
          <span
            key={`${id}-${index}`}
            title={title}
            lang="en"
            className="inline-flex h-6 items-center rounded-full bg-surface-raised px-2 font-mono text-[0.6875rem] font-medium text-foreground/90"
          >
            {test?.code ?? id}
          </span>
        )
      })}
    </span>
  )
}

export const FLAG_TONE: Record<ResultFlag, Tone> = {
  N: "muted",
  H: "warning",
  L: "warning",
  HH: "destructive",
  LL: "destructive",
  A: "warning",
}

/** A result flag as coloured text: H, L, HH (critical), LL (critical), A. */
export function FlagText({
  flag,
  className,
}: {
  flag: ResultFlag
  className?: string
}) {
  const { tk } = useLocale()
  if (flag === "N") {
    return <span className={cn("text-muted-foreground", className)}>-</span>
  }
  const critical = flag === "HH" || flag === "LL"
  const Icon =
    flag === "H" || flag === "HH"
      ? ArrowUp
      : flag === "A"
        ? TriangleAlert
        : ArrowDown
  return (
    <span
      title={tk(`lab.flags.${flag}`)}
      className={cn(
        "inline-flex items-center gap-0.5 font-semibold whitespace-nowrap",
        TONE_TEXT[FLAG_TONE[flag]],
        critical &&
          "rounded-sm bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] px-1",
        className
      )}
    >
      <Icon className="size-3.5" />
      <span lang="en">{flag}</span>
    </span>
  )
}

/** "2 outside range · 1 critical" or "All in range", as pills. */
export function FlagSummary({
  results,
}: {
  results: Pick<ResultRow, "flag" | "critical">[]
}) {
  const { t, num } = useLocale()
  const critical = results.filter((r) => r.critical).length
  const abnormal = results.filter((r) => r.flag !== "N" && !r.critical).length
  if (!results.length) return null
  if (!critical && !abnormal) {
    return (
      <StatusPill tone="success" className="h-5 px-2 text-[0.6875rem]">
        {t("lab.common.allNormal")}
      </StatusPill>
    )
  }
  return (
    <span className="flex flex-wrap gap-1">
      {critical ? (
        <StatusPill tone="destructive" className="h-5 px-2 text-[0.6875rem]">
          {t("lab.common.critical", { count: num(critical) })}
        </StatusPill>
      ) : null}
      {abnormal ? (
        <StatusPill tone="warning" className="h-5 px-2 text-[0.6875rem]">
          {t("lab.common.abnormal", { count: num(abnormal) })}
        </StatusPill>
      ) : null}
    </span>
  )
}

/* ---------------- Results table ---------------- */

/**
 * One test's results: analyte, value, unit, flag, the patient's reference
 * range and, optionally, the previous result with the change (delta check).
 * Clinical values, units and ranges stay in Latin digits in both languages.
 */
export function ResultsTable({
  test,
  results,
  patient,
  history,
  showPrevious = false,
  testId,
}: {
  test: LabTestRow
  results: ResultRow[]
  patient: Pick<PatientRow, "dob" | "sex"> | undefined
  history?: ResultRow[]
  showPrevious?: boolean
  testId?: string
}) {
  const { t, dmy } = useLocale()
  const tick = useNow(3_600_000)
  const age = patient ? ageOn(patient.dob, dhakaDate(tick || now())) : 40
  const sex = patient?.sex ?? "M"
  const byCode = new Map(results.map((r) => [r.analyteCode, r]))
  const analytes = test.analytes.length
    ? test.analytes
    : [{ code: TEXT_ANALYTE, name: test.name, decimals: 0, ranges: [] }]

  return (
    <div className="@container overflow-x-auto" data-testid={testId}>
      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
        <thead>
          <tr className="text-left text-xs text-muted-foreground [&_th]:bg-surface-raised [&_th]:px-2.5 [&_th]:py-2 [&_th]:font-medium [&_th:first-child]:rounded-l-md [&_th:last-child]:rounded-r-md">
            <th>{t("lab.common.analyte")}</th>
            <th className="text-right">{t("lab.common.result")}</th>
            <th>{t("lab.common.flag")}</th>
            <th className="hidden @min-[28rem]:table-cell">
              {t("lab.common.range")}
            </th>
            {showPrevious ? (
              <th className="hidden text-right @min-[36rem]:table-cell">
                {t("lab.common.previous")}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {analytes.map((analyte) => {
            const result = byCode.get(analyte.code)
            const range = analyte.ranges.length
              ? rangeFor(analyte, sex, age)
              : undefined
            const previous =
              showPrevious && result && history
                ? previousFor(
                    history,
                    analyte.code,
                    result.labOrderItemId,
                    result.createdAt
                  )
                : undefined
            const delta =
              previous &&
              typeof previous.value === "number" &&
              typeof result?.value === "number"
                ? deltaCheck(analyte.code, result.value, previous.value)
                : undefined
            const critical = !!result?.critical
            return (
              <tr
                key={analyte.code}
                data-analyte={analyte.code}
                className={cn(
                  "[&_td]:border-b [&_td]:border-hairline [&_td]:px-2.5 [&_td]:py-1.5",
                  critical &&
                    "bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)]"
                )}
              >
                <td className="min-w-0">
                  <span className="font-medium">{analyte.name}</span>
                  {result?.source === "manual" ? (
                    <span className="ml-1.5 text-[0.6875rem] text-info">
                      {t("lab.common.manual")}
                    </span>
                  ) : null}
                </td>
                <td className="text-right whitespace-nowrap">
                  {result ? (
                    <span
                      lang="en"
                      className={cn(
                        "font-semibold tabular-nums",
                        analyte.code === TEXT_ANALYTE
                          ? "whitespace-pre-wrap"
                          : "font-mono",
                        result.flag !== "N" && TONE_TEXT[FLAG_TONE[result.flag]]
                      )}
                    >
                      {resultText(result, analyte.decimals)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                  {analyte.units ? (
                    <span
                      lang="en"
                      className="ml-1 text-xs text-muted-foreground"
                    >
                      {analyte.units}
                    </span>
                  ) : null}
                </td>
                <td>{result ? <FlagText flag={result.flag} /> : null}</td>
                <td
                  className="hidden font-mono text-xs text-muted-foreground @min-[28rem]:table-cell"
                  lang="en"
                >
                  {formatRange(range, analyte.decimals)}
                </td>
                {showPrevious ? (
                  <td className="hidden text-right text-xs whitespace-nowrap @min-[36rem]:table-cell">
                    {previous && typeof previous.value === "number" ? (
                      <span className="inline-flex flex-col items-end">
                        <span className="font-mono tabular-nums" lang="en">
                          {formatValue(previous.value, analyte.decimals)}
                          {delta ? (
                            <span
                              className={cn(
                                "ml-1.5",
                                delta.flagged
                                  ? "font-semibold text-destructive"
                                  : "text-muted-foreground"
                              )}
                              title={t("lab.common.deltaCheck")}
                            >
                              ({delta.diff >= 0 ? "+" : ""}
                              {Math.round(delta.pct)}%)
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[0.6875rem] text-muted-foreground">
                          {dmy(previous.createdAt)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("lab.common.noPrevious")}
                      </span>
                    )}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
