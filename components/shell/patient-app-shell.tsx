"use client"

import * as React from "react"
import Link from "next/link"
import { LayoutGrid, Smartphone } from "lucide-react"

import { PersonaAvatar } from "@/components/shared/avatars"
import { HospitalLogo, HospitalWordmark } from "@/components/shared/hospital-brand"
import { PhoneFrame } from "@/components/shared/phone-frame"
import { roleLabel } from "@/components/shared/roles"
import { CueCard } from "@/components/shell/demo/cue-card"
import { DemoPanelTrigger } from "@/components/shell/demo/demo-panel"
import { EventStreamTrigger } from "@/components/shell/demo/event-stream"
import { personaName } from "@/components/shell/greeting"
import { LanguageToggle, ThemeToggle } from "@/components/shell/toggles"
import { Button } from "@/components/ui/button"
import { hospital } from "@/config/brand.config"
import { canAccess } from "@/core/rbac/routes"
import { setPersona, usePersona } from "@/core/session/persona"
import { updateSession } from "@/core/session/session"
import { windowKey } from "@/core/session/windowId"
import { PERSONAS } from "@/core/seed/content/personas"
import { useLocale } from "@/lib/i18n/provider"

/**
 * The patient app opens in the light theme the first time a window shows it
 * (patient phones usually are; docs/ui_guidelines.md §6). After that the
 * window's own theme choice sticks.
 */
function useLightByDefault() {
  React.useEffect(() => {
    try {
      const key = `mc:app-theme-init:${windowKey()}`
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, "1")
      updateSession({ theme: "light" })
    } catch {
      // Storage unavailable: keep the window theme.
    }
  }, [])
}

/** Hospital colour as --primary for the whole patient app (never UVTR turquoise). */
const BRAND_STYLE = { "--hospital": hospital.colors.primary } as React.CSSProperties
const BRAND_CLASSES =
  "[--primary:var(--hospital)] [--ring:var(--hospital)] [--primary-foreground:#ffffff] [--primary-soft:color-mix(in_oklch,var(--hospital)_14%,transparent)] [--link:color-mix(in_oklch,var(--hospital),black_8%)] dark:[--link:color-mix(in_oklch,var(--hospital),white_32%)]"

/** Wrong or missing persona: offer the patient persona, hospital-branded. */
function PatientGate({ signedIn }: { signedIn: string | null }) {
  const { t, tk, locale } = useLocale()
  const patients = PERSONAS.filter((persona) => persona.role === "patient")
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <HospitalLogo size={56} />
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">
          {signedIn ? t("shell.guard.deniedTitle") : t("shell.guard.noPersonaTitle")}
        </h1>
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          {signedIn
            ? t("shell.guard.deniedBody", {
                roles: roleLabel("patient", tk),
                persona: signedIn,
              })
            : t("shell.guard.noPersonaBody")}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        {patients.map((persona) => (
          <button
            key={persona.id}
            type="button"
            onClick={() => setPersona(persona.id)}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary-soft"
          >
            <PersonaAvatar persona={persona} size={36} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {personaName(persona, locale)}
            </span>
          </button>
        ))}
      </div>
      <Button nativeButton={false} render={<Link href="/" />} variant="outline" size="sm">
        {t("shell.persona.openLauncher")}
      </Button>
    </div>
  )
}

/**
 * The patient app frame (plan §9 `/app`): the hospital brand from
 * brand.config (its colour replaces turquoise), a phone frame, and, beside
 * the phone on wide windows, the demo controls (language, theme, event
 * stream, demo panel, launcher). Guards the route to the patient persona.
 */
export function PatientAppShell({ children }: { children: React.ReactNode }) {
  const { t, locale } = useLocale()
  const persona = usePersona()
  useLightByDefault()

  const allowed = !!persona && canAccess(persona.role, "/app")

  return (
    <div
      data-slot="patient-app"
      style={BRAND_STYLE}
      className={`${BRAND_CLASSES} flex min-h-svh w-full items-center justify-center gap-6 bg-background text-foreground min-[30rem]:bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--hospital)_16%,transparent),transparent_60%)] min-[30rem]:py-4`}
    >
      <PhoneFrame>
        {allowed ? (
          children
        ) : (
          <PatientGate signedIn={persona ? personaName(persona, locale) : null} />
        )}
      </PhoneFrame>

      <aside
        aria-label={t("shell.patientApp.caption")}
        className="hidden w-48 flex-col items-start gap-4 min-[48rem]:flex"
      >
        <HospitalWordmark className="max-w-full" />
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Smartphone className="size-3.5" />
          {t("shell.patientApp.caption")} · {t("shell.patientApp.device")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EventStreamTrigger />
          <DemoPanelTrigger />
        </div>
        <Button nativeButton={false} render={<Link href="/" />} variant="neutral" size="sm">
          <LayoutGrid />
          {t("shell.persona.openLauncher")}
        </Button>
      </aside>
      <CueCard />
    </div>
  )
}
