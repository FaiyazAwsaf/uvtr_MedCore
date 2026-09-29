"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { formatTyping, isoToDmy, latinDigits, parseDmy } from "@/lib/i18n/dmy"
import { useLocale } from "@/lib/i18n/provider"

/**
 * A date typed as DD-MM-YYYY (plan §3.11), whatever the browser's locale: the
 * native date input shows MM/DD/YYYY on an English-US browser. The value in
 * and out is an ISO date, "" while incomplete or outside `min` / `max`.
 * Bangla digits are accepted and an ISO date pasted as is works too.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  "aria-invalid": ariaInvalid,
  ...props
}: {
  value: string
  onChange: (iso: string) => void
  /** Earliest allowed ISO date */
  min?: string
  /** Latest allowed ISO date */
  max?: string
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "min" | "max">) {
  const { t } = useLocale()
  const [text, setText] = React.useState(() => isoToDmy(value))
  const [seen, setSeen] = React.useState(value)
  if (value !== seen) {
    // Follow a value set from outside (cleared, prefilled, a quick-pick chip).
    setSeen(value)
    if (parseDmy(text) !== value) setText(isoToDmy(value))
  }
  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max)
  const complete = latinDigits(text).replace(/\D/g, "").length === 8
  const parsed = parseDmy(text)
  const invalid = complete && (!parsed || !inRange(parsed))
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={t("common.dmyPlaceholder")}
      value={text}
      aria-invalid={invalid || !!ariaInvalid || undefined}
      onChange={(event) => {
        const next = formatTyping(event.target.value)
        setText(next)
        const iso = parseDmy(next)
        const out = iso && inRange(iso) ? iso : ""
        setSeen(out)
        onChange(out)
      }}
      {...props}
      className={["nums", props.className].filter(Boolean).join(" ")}
    />
  )
}
