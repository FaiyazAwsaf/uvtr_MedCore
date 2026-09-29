"use client"

import * as React from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Minus,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { SCENARIOS } from "@/core/scenarios/registry"
import { updateSession, useSession } from "@/core/session/session"
import { localizeDigits } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/**
 * Floating scenario cue card (plan §10), bottom-left. Shown while this
 * window's `session.cue` names a registered scenario: its title and cue
 * steps with the current one highlighted. Renders nothing otherwise.
 */
export function CueCard() {
  const { t, tk, num, locale } = useLocale()
  const { cue } = useSession()
  const [minimised, setMinimised] = React.useState(false)
  const scenario = cue
    ? SCENARIOS.find((s) => s.id === cue.scenarioId)
    : undefined
  if (!cue || !scenario) return null

  const total = scenario.cueKeys.length
  const step = Math.min(Math.max(cue.step, 0), Math.max(total - 1, 0))
  const title = tk(scenario.titleKey)
  const params = cue.params ?? {}
  // Numbers read in the window's numerals; strings (names, UHIDs, Rx and
  // accession numbers) are shown as the setup gave them.
  const shown = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === "number" ? localizeDigits(String(value), locale) : value,
    ])
  )
  const go = (next: number) =>
    updateSession({ cue: { scenarioId: scenario.id, step: next, params } })
  const close = () => updateSession({ cue: null })
  const progress = t("demo.cue.step", { n: num(step + 1), total: num(total) })

  if (minimised) {
    return (
      <button
        type="button"
        onClick={() => setMinimised(false)}
        aria-label={t("demo.cue.expand")}
        className="fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        data-testid="cue-card"
      >
        <span className="font-mono text-primary">{scenario.id}</span>
        <span className="truncate">{progress}</span>
        <ChevronUp className="size-3.5 text-muted-foreground" />
      </button>
    )
  }

  return (
    <aside
      aria-label={t("demo.cue.label")}
      className="fixed bottom-4 left-4 z-40 flex max-h-[min(24rem,calc(100svh-6rem))] w-[20rem] max-w-[calc(100vw-2rem)] flex-col rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      data-testid="cue-card"
      data-scenario-id={scenario.id}
      data-step={step}
    >
      <header className="flex items-start gap-2 border-b border-hairline px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="micro">
            {t("demo.cue.label")} ·{" "}
            <span className="font-mono normal-case">{scenario.id}</span>
          </p>
          <p className="mt-1 text-sm leading-snug font-semibold">{title}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("demo.cue.minimise")}
          title={t("demo.cue.minimise")}
          onClick={() => setMinimised(true)}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("demo.cue.close")}
          title={t("demo.cue.close")}
          onClick={close}
        >
          <X />
        </Button>
      </header>

      <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {scenario.cueKeys.map((key, i) => (
          <li
            key={key}
            // On short screens (a 960x600 demo quadrant) only the current step
            // shows, so the card does not cover the page; Previous and Next
            // still walk through every step.
            className={cn(i !== step && "[@media(max-height:720px)]:hidden")}
          >
            <button
              type="button"
              onClick={() => go(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                i === step
                  ? "bg-primary-soft text-foreground"
                  : i < step
                    ? "text-muted-foreground hover:bg-muted"
                    : "hover:bg-muted"
              )}
            >
              <span
                className={cn(
                  "mt-px flex size-4 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-semibold",
                  i === step
                    ? "bg-primary text-primary-foreground"
                    : i < step
                      ? "bg-surface-raised text-muted-foreground"
                      : "bg-surface-raised text-foreground"
                )}
              >
                {i < step ? <Check className="size-2.5" /> : num(i + 1)}
              </span>
              <span className={cn(i === step && "font-medium")}>
                {tk(key, shown)}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <footer className="flex items-center gap-2 border-t border-hairline px-3 py-2">
        <span className="flex-1 text-[0.6875rem] text-muted-foreground">
          {progress}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={step === 0}
          onClick={() => go(step - 1)}
        >
          <ChevronLeft />
          {t("demo.cue.previous")}
        </Button>
        {step < total - 1 ? (
          <Button size="sm" onClick={() => go(step + 1)}>
            {t("demo.cue.next")}
            <ChevronRight />
          </Button>
        ) : (
          <Button size="sm" onClick={close}>
            <Check />
            {t("demo.cue.finish")}
          </Button>
        )}
      </footer>
    </aside>
  )
}
