"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"

import { useWindowTheme } from "@/components/theme-provider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { LOCALE_META, LOCALES } from "@/lib/i18n/config"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** EN / বাং for this window only (the language lives in the window session). */
export function LanguageToggle({ className }: { className?: string }) {
  const { t, locale, setLocale } = useLocale()
  return (
    <div
      role="radiogroup"
      aria-label={t("shell.language")}
      data-slot="language-toggle"
      className={cn(
        "flex h-10 shrink-0 items-center gap-0.5 rounded-md bg-card p-1 shadow-(--card-shadow)",
        className
      )}
    >
      {LOCALES.map((code) => {
        const active = code === locale
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={active}
            lang={code}
            title={LOCALE_META[code].nativeLabel}
            onClick={() => setLocale(code)}
            className={cn(
              "flex h-8 min-w-9 items-center justify-center rounded-sm px-2 text-[0.8125rem] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {LOCALE_META[code].short}
          </button>
        )
      })}
    </div>
  )
}

/** Light or dark for this window only. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useLocale()
  const { theme, toggleTheme } = useWindowTheme()
  const label = theme === "dark" ? t("shell.palette.themeLight") : t("shell.palette.themeDark")
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={label}
            data-slot="theme-toggle"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-md bg-card text-foreground shadow-(--card-shadow) transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40",
              className
            )}
          />
        }
      >
        {theme === "dark" ? <Sun className="size-[1.125rem]" /> : <Moon className="size-[1.125rem]" />}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
