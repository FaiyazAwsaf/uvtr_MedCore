"use client"

import { Check, Languages } from "lucide-react"

import { HospitalLogo } from "@/components/shared/hospital-brand"
import { hospital } from "@/config/brand.config"
import { dictionaries, lookup } from "@/lib/i18n"
import { LOCALE_META, LOCALES, type Locale } from "@/lib/i18n/config"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { updateAppState } from "../state/app-state"

/** A string in both languages: the language is not chosen yet (PRD §10.18). */
function both(key: string): Record<Locale, string> {
  return { en: lookup(dictionaries.en, key), bn: lookup(dictionaries.bn, key) }
}

/**
 * First launch in a window: the hospital's splash (brand.config colour, logo
 * and name; never UVTR) and the language choice. The app then continues to
 * the OTP sign-in in the chosen language.
 */
export function LaunchScreen() {
  const { locale, setLocale } = useLocale()
  const tagline = both("patientApp.launch.tagline")
  const choose = both("patientApp.launch.chooseLanguage")
  const later = both("patientApp.launch.changeLater")

  const pick = (next: Locale) => {
    setLocale(next)
    updateAppState({ launched: true })
  }

  return (
    <div className="flex flex-1 flex-col bg-primary text-primary-foreground">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 py-10 text-center">
        <span className="rounded-[1.6rem] bg-white p-3 shadow-[0_18px_40px_-14px_rgb(0_0_0/0.45)]">
          <HospitalLogo size={76} />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="text-[1.625rem] leading-tight font-semibold" lang="en">
            {hospital.name.en}
          </p>
          <p className="text-lg font-medium opacity-90" lang="bn">
            {hospital.name.bn}
          </p>
        </div>
        <div className="flex flex-col gap-1 text-[0.875rem] opacity-90">
          <p lang="en">{tagline.en}</p>
          <p lang="bn">{tagline.bn}</p>
        </div>
      </div>

      <div className="rounded-t-[2rem] bg-background px-6 pt-6 pb-8 text-foreground">
        <p className="flex items-center gap-2 text-[0.9375rem] font-semibold">
          <Languages className="size-5 text-link" />
          <span lang="en">{choose.en}</span>
          <span className="text-muted-foreground">·</span>
          <span lang="bn">{choose.bn}</span>
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {LOCALES.map((code) => {
            const current = code === locale
            return (
              <button
                key={code}
                type="button"
                lang={code}
                data-testid={`app-lang-${code}`}
                onClick={() => pick(code)}
                className={cn(
                  "flex min-h-14 items-center justify-between rounded-2xl border px-5 text-left text-[1.0625rem] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  current
                    ? "border-primary bg-primary-soft text-foreground"
                    : "border-border hover:border-primary hover:bg-primary-soft"
                )}
              >
                <span>{LOCALE_META[code].nativeLabel}</span>
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full",
                    current
                      ? "bg-primary text-primary-foreground"
                      : "border border-border"
                  )}
                >
                  {current ? <Check className="size-4" /> : null}
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {later[locale]}
        </p>
      </div>
    </div>
  )
}
