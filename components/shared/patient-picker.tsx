"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Search, TriangleAlert, X } from "lucide-react"

import { PatientAvatar } from "@/components/shared/avatars"
import { ageOf, nameIn, otherName } from "@/components/shared/person"
import { StatusPill } from "@/components/shared/status"
import { UhidText } from "@/components/shared/uhid-text"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import type { PatientRow } from "@/core/db/schema"
import { nameKeys } from "@/core/search/fuzzy"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

const LIMIT = 12

function uniqueRows(rows: (PatientRow | undefined)[]): PatientRow[] {
  const seen = new Set<string>()
  const out: PatientRow[] = []
  for (const row of rows) {
    if (row && !seen.has(row.id)) {
      seen.add(row.id)
      out.push(row)
    }
  }
  return out
}

/**
 * Patient search (plan §9 reception): UHID (with or without dashes, provisional
 * P-B1-... too), phone, NID or BRN, or name. Names match through the
 * Bangla-tolerant search keys (`nameKeys`), so "Md" finds "Mohammad" and a
 * Bangla query finds the Bangla name. Merged records are left out.
 */
export async function searchPatients(
  db: MedcoreDb,
  rawQuery: string,
  limit = LIMIT
): Promise<PatientRow[]> {
  const query = rawQuery.trim()
  if (!query) return []

  // Provisional or alias UHIDs: P-B1-000123
  if (/^p-?b\d/i.test(query)) {
    const upper = query.toUpperCase()
    const rows = await Promise.all([
      db.patients.where("provisionalUhid").startsWith(upper).limit(limit).toArray(),
      db.patients.where("aliases").startsWith(upper).limit(limit).toArray(),
      db.patients.where("uhid").startsWith(upper).limit(limit).toArray(),
    ])
    return uniqueRows(rows.flat()).filter((p) => p.identityStatus !== "merged")
  }

  const digits = query.replace(/[\s-]/g, "")
  if (/^\+?\d+$/.test(digits)) {
    if (digits.length < 3) return []
    const local = digits.replace(/^\+?88/, "")
    const dashed = local.length > 5 ? `${local.slice(0, 5)}-${local.slice(5)}` : local
    const rows = await Promise.all([
      db.patients.where("uhid").startsWith(digits).limit(limit).toArray(),
      db.patients.where("aliases").startsWith(digits).limit(limit).toArray(),
      db.patients.where("phone").startsWith(local).limit(limit).toArray(),
      db.patients.where("phone").startsWith(dashed).limit(limit).toArray(),
      db.patients.where("nid").startsWith(digits).limit(limit).toArray(),
      db.patients.where("brn").startsWith(digits).limit(limit).toArray(),
    ])
    return uniqueRows(rows.flat())
      .filter((p) => p.identityStatus !== "merged")
      .slice(0, limit)
  }

  const tokens = nameKeys(query).filter((token) => token.length >= 2)
  if (!tokens.length) return []
  // The longest token narrows best through the multi-entry index; the rest
  // are checked in memory (each must prefix-match one of the patient's keys).
  const [lead, ...rest] = [...tokens].sort((a, b) => b.length - a.length)
  const candidates = await db.patients
    .where("nameSearchKeys")
    .startsWith(lead)
    .limit(200)
    .toArray()
  return uniqueRows(candidates)
    .filter(
      (p) =>
        p.identityStatus !== "merged" &&
        rest.every((token) => p.nameSearchKeys.some((key) => key.startsWith(token)))
    )
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn))
    .slice(0, limit)
}

export type PatientPickerProps = {
  onSelect: (patient: PatientRow) => void
  placeholder?: string
  autoFocus?: boolean
  /** Keep the query in the box after picking (default clears it) */
  keepQuery?: boolean
  limit?: number
  className?: string
}

/**
 * Search box with a live result list (keyboard: up, down, Enter, Escape).
 * Each result shows the photo, name in both scripts, age, sex, relation and
 * UHID so the right person is picked (HAZ-01).
 */
export function PatientPicker({
  onSelect,
  placeholder,
  autoFocus,
  keepQuery = false,
  limit = LIMIT,
  className,
}: PatientPickerProps) {
  const db = useDb()
  const { t } = useLocale()
  const nowMs = useNow(60_000)
  const listId = React.useId()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)

  const results = useLiveQuery(
    () => searchPatients(db, query, limit),
    [db, query, limit]
  )

  const trimmed = query.trim()
  const tooShort =
    trimmed.length > 0 &&
    (/^[\d\s+-]+$/.test(trimmed)
      ? trimmed.replace(/\D/g, "").length < 3
      : trimmed.length < 2)

  const pick = (patient: PatientRow) => {
    onSelect(patient)
    setOpen(false)
    if (!keepQuery) setQuery("")
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results?.length) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActive((index) => (index + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => (index - 1 + results.length) % results.length)
    } else if (event.key === "Enter") {
      event.preventDefault()
      const patient = results[Math.min(active, results.length - 1)]
      if (patient) pick(patient)
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }

  const showList = open && trimmed.length > 0

  return (
    <div data-slot="patient-picker" className={cn("relative w-full", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-label={t("common.patientPicker.label")}
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder ?? t("common.patientPicker.placeholder")}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-md border border-border bg-surface-raised/60 pr-9 pl-9 text-sm text-foreground transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 dark:bg-card"
        />
        {query ? (
          <button
            type="button"
            aria-label={t("common.clear")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("")
              setActive(0)
            }}
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-raised hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {showList ? (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[min(24rem,60svh)] overflow-y-auto rounded-md border border-border/60 bg-popover p-1.5 shadow-xl"
        >
          {tooShort ? (
            <p className="px-3 py-4 text-center text-[0.8125rem] text-muted-foreground">
              {t("common.patientPicker.hint")}
            </p>
          ) : results && results.length === 0 ? (
            <p className="px-3 py-4 text-center text-[0.8125rem] text-muted-foreground">
              {t("common.patientPicker.empty")}
            </p>
          ) : (
            (results ?? []).map((patient, index) => (
              <PatientOption
                key={patient.id}
                patient={patient}
                nowMs={nowMs}
                active={index === active}
                onHover={() => setActive(index)}
                onPick={() => pick(patient)}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

function PatientOption({
  patient,
  nowMs,
  active,
  onHover,
  onPick,
}: {
  patient: PatientRow
  nowMs: number
  active: boolean
  onHover: () => void
  onPick: () => void
}) {
  const { t, num, locale, digits } = useLocale()
  const age = ageOf(patient.dob, nowMs)
  const secondary = otherName(patient, locale)
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left transition-colors",
        active ? "bg-primary-soft" : "hover:bg-surface-raised"
      )}
    >
      <PatientAvatar patient={patient} size={36} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{nameIn(patient, locale)}</span>
          {secondary ? (
            <span className="truncate text-xs text-muted-foreground">{secondary}</span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="nums whitespace-nowrap">
            {t(age.unit === "years" ? "common.years" : "common.months", {
              count: num(age.value),
            })}{" "}
            · {t(`common.sexShort.${patient.sex}`)}
          </span>
          {patient.relationToHead ? (
            <span className="whitespace-nowrap">
              {t(`common.relation.${patient.relationToHead}`)}
            </span>
          ) : null}
          {patient.phone ? (
            <span className="nums whitespace-nowrap">{digits(patient.phone)}</span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <UhidText uhid={patient.uhid} className="text-xs text-foreground/85" />
        {patient.allergies.length ? (
          <TriangleAlert
            className="size-3.5 text-destructive"
            aria-label={t("common.allergies")}
          />
        ) : null}
        {patient.identityStatus === "under-review" ? (
          <StatusPill tone="warning" className="h-5 px-2 text-[0.625rem]">
            {t("common.underReview")}
          </StatusPill>
        ) : null}
      </span>
    </button>
  )
}
