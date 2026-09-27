"use client"

import * as React from "react"
import { AArrowDown, AArrowUp, Check, Type } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { getSession, useSession } from "@/core/session/session"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import {
  clampUiScale,
  setWindowUiScale,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_PRESETS,
  UI_SCALE_STEP,
  useUi,
} from "@/lib/store"
import type { TranslationKey } from "@/lib/i18n"

/** This window's interface scale (from the window session). */
export function useUiScale(): number {
  return clampUiScale(useSession().uiScale)
}

/** Step this window's scale up or down by `delta` (call from event handlers). */
export function stepUiScale(delta: number): void {
  setWindowUiScale(clampUiScale(getSession().uiScale) + delta)
}

/**
 * Pushes this window's scale onto the root element. Every size in the app is
 * expressed in rem, so this grows type, spacing, controls and icons together.
 * The scale lives in the window session (Demo Wall panes open with
 * `?scale=0.9`), so each pane keeps its own size.
 */
export function UiScaleProvider() {
  const uiScale = useUiScale()

  React.useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(uiScale))
    useUi.setState({ uiScale })
  }, [uiScale])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return
      if (event.key === "=" || event.key === "+") {
        event.preventDefault()
        stepUiScale(UI_SCALE_STEP)
      } else if (event.key === "-") {
        event.preventDefault()
        stepUiScale(-UI_SCALE_STEP)
      } else if (event.key === "0") {
        event.preventDefault()
        setWindowUiScale(1)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return null
}

/** Compact "- 90% +" control, used inside menus. */
export function UiScaleStepper({ className }: { className?: string }) {
  const { t, num } = useLocale()
  const uiScale = useUiScale()
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="flex-1 truncate text-[0.8125rem] text-muted-foreground">
        {t("shell.uiScale")}
      </span>
      <Button
        variant="neutral"
        size="icon-xs"
        title={t("shell.decrease")}
        aria-label={t("shell.decrease")}
        disabled={uiScale <= UI_SCALE_MIN}
        onClick={() => stepUiScale(-UI_SCALE_STEP)}
      >
        <AArrowDown />
      </Button>
      <span className="nums w-11 text-center text-[0.8125rem] font-medium tabular-nums">
        {num(Math.round(uiScale * 100))}%
      </span>
      <Button
        variant="neutral"
        size="icon-xs"
        title={t("shell.increase")}
        aria-label={t("shell.increase")}
        disabled={uiScale >= UI_SCALE_MAX}
        onClick={() => stepUiScale(UI_SCALE_STEP)}
      >
        <AArrowUp />
      </Button>
    </div>
  )
}

/** Top-bar button with a popover of presets and fine steps. */
export function UiScaleControl() {
  const { t, num } = useLocale()
  const uiScale = useUiScale()

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            title={t("shell.uiScale")}
            className="gap-1 px-2"
          >
            <Type />
            <span className="nums text-xs tabular-nums">
              {num(Math.round(uiScale * 100))}%
            </span>
          </Button>
        }
      />
      <PopoverContent align="end" className="w-64 gap-0 p-0">
        <div className="px-4 py-3">
          <div className="text-sm font-semibold">{t("shell.uiScale")}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("shell.uiScaleHint")}
          </p>
        </div>

        <div className="border-t border-hairline px-4 py-2.5">
          <UiScaleStepper />
        </div>

        <div className="flex flex-col border-t border-hairline p-1.5">
          {UI_SCALE_PRESETS.map((preset) => {
            const activePreset = Math.abs(uiScale - preset.value) < 0.001
            return (
              <button
                key={preset.value}
                onClick={() => setWindowUiScale(preset.value)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md px-2.5 text-left transition-colors",
                  activePreset
                    ? "bg-primary-soft text-foreground"
                    : "hover:bg-surface-raised"
                )}
              >
                <span
                  className="w-6 shrink-0 text-center font-medium"
                  style={{ fontSize: `${preset.value * 0.8}rem` }}
                >
                  A
                </span>
                <span className="flex-1 truncate text-[0.8125rem]">
                  {t(preset.labelKey as TranslationKey)}
                </span>
                <span className="nums text-xs text-muted-foreground">
                  {num(Math.round(preset.value * 100))}%
                </span>
                {activePreset ? (
                  <Check className="size-3.5 shrink-0 text-primary" />
                ) : null}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
