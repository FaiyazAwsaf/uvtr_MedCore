"use client"

import { LOCALE_META, LOCALES } from "@/lib/i18n/config"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/** The Bangla label must render in the Bangla face even while the window is in English. */
const BANGLA_FACE = {
  fontFamily: "var(--font-bangla), var(--font-sans), sans-serif",
}

/** EN / বাং switch for this window (the launcher and Demo Wall headers). */
export function LangToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale()
  return (
    <div
      role="group"
      aria-label={LOCALE_META[locale].label}
      className={cn(
        "inline-flex h-7 items-center rounded-full bg-surface-raised p-0.5 text-xs",
        className
      )}
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={locale === option}
          onClick={() => setLocale(option)}
          style={option === "bn" ? BANGLA_FACE : undefined}
          className={cn(
            "h-6 rounded-full px-2.5 font-medium transition-colors",
            locale === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {LOCALE_META[option].short}
        </button>
      ))}
    </div>
  )
}
