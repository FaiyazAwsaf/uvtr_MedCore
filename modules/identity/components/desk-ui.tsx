"use client"

import * as React from "react"
import { DateField } from "@/components/shared/date-field"
import { ChevronDown, CircleAlert, ShieldAlert } from "lucide-react"

import { PatientAvatar } from "@/components/shared/avatars"
import { ageOf, nameIn, otherName } from "@/components/shared/person"
import { UhidText } from "@/components/shared/uhid-text"
import { useNow } from "@/core/clock/useNow"
import type { PatientRow } from "@/core/db/schema"
import type { RuleViolation } from "@/core/engine/errors"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { useRuleText } from "./desk-command"

/** Page heading used by the front desk screens (22px / 600, muted subtitle). */
export function DeskHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[1.375rem] leading-tight font-semibold">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** "62 y · M" in the window's language (months under two years). */
export function useAgeSex() {
  const { t, num } = useLocale()
  const nowMs = useNow(60_000)
  return React.useCallback(
    (person: Pick<PatientRow, "dob" | "sex" | "dobEstimated">) => {
      const age = ageOf(person.dob, nowMs)
      const text = t(age.unit === "years" ? "common.years" : "common.months", {
        count: num(age.value),
      })
      return `${person.dobEstimated ? "~" : ""}${text} · ${t(`common.sexShort.${person.sex}`)}`
    },
    [t, num, nowMs]
  )
}

/**
 * A person in a list (HAZ-01): photo, name in the window's language with the
 * other script beside it, age and sex, and an extra line. No clinical data.
 */
export function PersonLine({
  patient,
  meta,
  size = 40,
  showUhid = true,
  className,
}: {
  patient: Pick<
    PatientRow,
    "id" | "uhid" | "nameEn" | "nameBn" | "dob" | "sex" | "photoSeed" | "dobEstimated"
  >
  /** Extra items after age and sex (relation, phone, time) */
  meta?: React.ReactNode
  size?: number
  showUhid?: boolean
  className?: string
}) {
  const { locale } = useLocale()
  const ageSex = useAgeSex()
  const secondary = otherName(patient, locale)
  return (
    <span className={cn("flex min-w-0 flex-1 items-center gap-3", className)}>
      <PatientAvatar patient={patient} size={size} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{nameIn(patient, locale)}</span>
          {secondary ? (
            <span className="hidden truncate text-xs text-muted-foreground @[28rem]:inline">
              {secondary}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="nums whitespace-nowrap text-foreground/85">{ageSex(patient)}</span>
          {meta}
          {showUhid ? <UhidText uhid={patient.uhid} className="text-[0.6875rem]" /> : null}
        </span>
      </span>
    </span>
  )
}

/** A labelled form control with an optional hint and error line. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  optional?: boolean
  className?: string
  children: React.ReactNode
}) {
  const { t } = useLocale()
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-1.5 text-[0.8125rem] font-medium">
        {label}
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">({t("common.optional")})</span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * Outlined native select with a chevron (docs/ui_guidelines.md §4 "Select").
 * Native so it works with a keyboard, a scanner wedge and Playwright alike.
 */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative min-w-0">
      <select
        className={cn(
          "h-10 w-full min-w-0 appearance-none rounded-md border border-border bg-transparent pr-9 pl-3 text-sm text-foreground outline-none [color-scheme:light] focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:opacity-50 aria-invalid:border-destructive dark:[color-scheme:dark] [&>option]:bg-popover",
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

/** A row of pill-shaped radio options (native radios, so they are keyboard and test friendly). */
export function ChoicePills<T extends string>({
  name,
  value,
  options,
  onChange,
  invalid,
  className,
  ...props
}: {
  name: string
  value: T | ""
  options: { value: T; label: React.ReactNode }[]
  onChange: (value: T) => void
  invalid?: boolean
  className?: string
} & Omit<React.ComponentProps<"div">, "onChange">) {
  return (
    <div
      role="radiogroup"
      aria-invalid={invalid || undefined}
      className={cn("flex flex-wrap gap-1.5", className)}
      {...props}
    >
      {options.map((option) => {
        const checked = option.value === value
        return (
          <label
            key={option.value}
            data-value={option.value}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
              checked
                ? "border-primary bg-primary text-primary-foreground"
                : invalid
                  ? "border-destructive/60 bg-surface-raised text-foreground/85"
                  : "border-transparent bg-surface-raised text-foreground/85 hover:text-foreground"
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        )
      })}
    </div>
  )
}

/** A date typed as DD-MM-YYYY (the shared field; plan §3.11). */
export const DmyInput = DateField

/** A refused rule shown next to the form or row it concerns. */
export function RuleAlert({
  rule,
  action,
  className,
}: {
  rule: Pick<RuleViolation, "code" | "params" | "audit">
  action?: React.ReactNode
  className?: string
}) {
  const { t } = useLocale()
  const ruleText = useRuleText()
  const Icon = rule.audit ? ShieldAlert : CircleAlert
  return (
    <div
      role="alert"
      data-testid="rule-alert"
      data-code={rule.code}
      className={cn(
        "flex items-start gap-3 rounded-md border border-[color-mix(in_oklch,var(--destructive)_30%,transparent)] bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)] px-3.5 py-3 text-[0.8125rem]",
        className
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="leading-relaxed text-foreground">{ruleText(rule)}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span lang="en" className="font-mono">
            {rule.code}
          </span>
          {rule.audit ? <span>{t("shell.feedback.audited")}</span> : null}
        </p>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  )
}
