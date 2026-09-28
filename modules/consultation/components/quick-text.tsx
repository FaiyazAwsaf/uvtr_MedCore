"use client"

import * as React from "react"
import { Zap } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { QUICK_TEXTS, type QuickText } from "@/core/seed/content"
import type { Locale } from "@/lib/i18n/config"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Quick texts (objective §3A): typing a shortcut such as ".fluids" followed by
 * a space or a new line expands to the text in the note's language. Returns
 * the expanded value, or null when the text does not end with a shortcut.
 */
export function expandQuickText(value: string, lang: Locale): string | null {
  const match = /(^|\s)(\.[a-z0-9]+)(\s)$/i.exec(value)
  if (!match) return null
  const quick = QUICK_TEXTS.find((q) => q.trigger === match[2].toLowerCase())
  if (!quick) return null
  return value.slice(0, match.index + match[1].length) + quick.text[lang] + match[3]
}

/** Appends a quick text on its own line. */
export function appendQuickText(value: string, quick: QuickText, lang: Locale): string {
  const body = value.replace(/\s+$/, "")
  return body ? `${body}\n${quick.text[lang]}` : quick.text[lang]
}

/** A button that lists the quick texts; picking one hands it to `onPick`. */
export function QuickTextMenu({
  sections,
  lang,
  onPick,
}: {
  /** Only these kinds (default: all) */
  sections?: QuickText["section"][]
  lang: Locale
  onPick: (quick: QuickText) => void
}) {
  const { t } = useLocale()
  const [open, setOpen] = React.useState(false)
  const items = QUICK_TEXTS.filter((q) => !sections || sections.includes(q.section))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button size="xs" variant="neutral" type="button" data-testid="quick-texts">
            <Zap />
            {t("consultation.note.quickTexts")}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 gap-2 p-2">
        <p className="px-1.5 pt-1 text-xs text-muted-foreground">{t("consultation.note.quickTextsHint")}</p>
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {items.map((quick) => (
            <li key={quick.trigger}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-[0.8125rem] hover:bg-primary-soft"
                onClick={() => {
                  onPick(quick)
                  setOpen(false)
                }}
              >
                <span className="w-20 shrink-0 font-mono text-xs text-link" lang="en">
                  {quick.trigger}
                </span>
                <span className="min-w-0 flex-1 text-foreground/90">{quick.text[lang]}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
