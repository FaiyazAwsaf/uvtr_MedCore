"use client"

import * as React from "react"
import { Search, Star, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Diagnosis } from "@/core/db/schema"
import { ICD10, type Icd10Entry } from "@/core/seed/content"
import { textScore } from "@/core/search/medicines"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** ICD-10 entries for a query: code, label or Bangla gloss; the doctor's specialty breaks ties. */
export function searchIcd(query: string, specialty: string | undefined, limit = 8): Icd10Entry[] {
  const q = query.trim()
  if (!q) return []
  return ICD10.map((entry) => ({
    entry,
    score: Math.max(
      entry.code.toLowerCase().startsWith(q.toLowerCase()) ? 95 : 0,
      textScore(q, entry.label),
      textScore(q, entry.glossBn)
    ),
  }))
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(!!specialty && !!b.entry.specialties?.includes(specialty)) -
          Number(!!specialty && !!a.entry.specialties?.includes(specialty)) ||
        a.entry.code.localeCompare(b.entry.code)
    )
    .slice(0, limit)
    .map((hit) => hit.entry)
}

/**
 * The diagnosis picker: the doctor searches ICD-10 and chooses. Nothing is
 * suggested from the note or the scribe (plan §11).
 */
export function IcdPicker({
  value,
  onChange,
  specialty,
  readOnly = false,
}: {
  value: Diagnosis[]
  onChange: (next: Diagnosis[]) => void
  specialty?: string
  readOnly?: boolean
}) {
  const { t, locale } = useLocale()
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const [open, setOpen] = React.useState(false)
  const listId = React.useId()
  const hits = React.useMemo(
    () => searchIcd(query, specialty).filter((e) => !value.some((d) => d.icd10 === e.code)),
    [query, specialty, value]
  )

  const add = (entry: Icd10Entry) => {
    onChange([...value, { icd10: entry.code, label: entry.label, primary: value.length === 0 }])
    setQuery("")
    setActive(0)
  }
  const remove = (code: string) => {
    const next = value.filter((d) => d.icd10 !== code)
    if (next.length && !next.some((d) => d.primary)) next[0] = { ...next[0], primary: true }
    onChange(next)
  }
  const makePrimary = (code: string) =>
    onChange(value.map((d) => ({ ...d, primary: d.icd10 === code })))

  return (
    <div className="flex flex-col gap-2" data-testid="icd-picker">
      {value.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((d) => (
            <li
              key={d.icd10}
              data-testid="icd-selected"
              data-code={d.icd10}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5 text-xs",
                d.primary ? "bg-primary-soft text-foreground ring-1 ring-primary/40" : "bg-surface-raised"
              )}
            >
              <span className="font-mono font-semibold" lang="en">
                {d.icd10}
              </span>
              <span className="truncate" lang="en">
                {d.label}
              </span>
              {d.primary ? (
                <span className="text-[0.6875rem] font-semibold text-link">{t("consultation.icd.primary")}</span>
              ) : null}
              {!readOnly ? (
                <>
                  {!d.primary ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="size-5"
                      title={t("consultation.icd.makePrimary")}
                      aria-label={t("consultation.icd.makePrimary")}
                      onClick={() => makePrimary(d.icd10)}
                    >
                      <Star />
                    </Button>
                  ) : null}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5"
                    title={t("consultation.icd.remove")}
                    aria-label={t("consultation.icd.remove")}
                    onClick={() => remove(d.icd10)}
                  >
                    <X />
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">{t("consultation.icd.none")}</p>
      )}

      {!readOnly ? (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            data-testid="icd-search"
            placeholder={t("consultation.icd.search")}
            className="h-9 pl-9"
            role="combobox"
            aria-expanded={open && !!query}
            aria-controls={listId}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
              setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((i) => Math.min(hits.length - 1, i + 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((i) => Math.max(0, i - 1))
              } else if (e.key === "Enter" && hits[active]) {
                e.preventDefault()
                add(hits[active])
              } else if (e.key === "Escape") {
                setQuery("")
              }
            }}
          />
          {open && query.trim() ? (
            <ul
              id={listId}
              role="listbox"
              className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-border/60 bg-popover p-1 shadow-xl"
            >
              {hits.length ? (
                hits.map((entry, i) => (
                  <li
                    key={entry.code}
                    role="option"
                    aria-selected={i === active}
                    data-testid="icd-option"
                    data-code={entry.code}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      add(entry)
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex cursor-pointer items-baseline gap-2 rounded-sm px-2.5 py-1.5 text-[0.8125rem]",
                      i === active && "bg-primary-soft"
                    )}
                  >
                    <span className="w-14 shrink-0 font-mono font-semibold" lang="en">
                      {entry.code}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span lang="en">{entry.label}</span>
                      {locale === "bn" ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">{entry.glossBn}</span>
                      ) : null}
                    </span>
                  </li>
                ))
              ) : (
                <li className="px-2.5 py-2 text-[0.8125rem] text-muted-foreground">{t("consultation.icd.noMatch")}</li>
              )}
            </ul>
          ) : null}
        </div>
      ) : null}
      <p className="text-[0.6875rem] text-muted-foreground">{t("consultation.icd.doctorOnly")}</p>
    </div>
  )
}
