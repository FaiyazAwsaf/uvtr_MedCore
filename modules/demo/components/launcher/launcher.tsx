"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowRight,
  Columns2,
  LayoutGrid,
  Smartphone,
  TriangleAlert,
  Tv,
} from "lucide-react"

import { DemoPanelTrigger } from "@/components/shell/demo/demo-panel"
import { EventStreamTrigger } from "@/components/shell/demo/event-stream"
import { LangToggle } from "@/components/shell/demo/lang-toggle"
import { Wordmark } from "@/components/shell/demo/wordmark"
import { Button } from "@/components/ui/button"
import { HOME_ROUTE } from "@/core/rbac/routes"
import { ROLES } from "@/core/rbac/types"
import { usePersona } from "@/core/session/persona"
import { PERSONAS } from "@/core/seed/content/personas"
import { useLocale } from "@/lib/i18n/provider"

import { branchLabel, personaName, roleLabel } from "../labels"
import { ROLE_ICONS } from "../role-icons"
import { SeedStatus } from "../seed-status"
import { RoleCard } from "./role-card"
import {
  DISPLAY_BOARD,
  openDemoLayout,
  openWindow,
  PATIENT_APP,
} from "./windows"

const PERSONAS_BY_ROLE = ROLES.map(
  (role) =>
    [
      role,
      PERSONAS.filter((p) => p.role === role).sort((a, b) => a.order - b.order),
    ] as const
)

/**
 * The launcher (plan §9, "/"): quick-start actions for the presenter, this
 * window's persona and the seed status, then a card per role with a persona
 * picker. Works at 960x600 and scales up to the 1920x1200 presenter screen.
 */
export function Launcher() {
  const { t } = useLocale()
  const [popupBlocked, setPopupBlocked] = React.useState(false)
  const blocked = React.useCallback(() => setPopupBlocked(true), [])

  const openLayout = () => setPopupBlocked(openDemoLayout().blocked > 0)
  const openDisplay = () =>
    setPopupBlocked(!openWindow(DISPLAY_BOARD.url, DISPLAY_BOARD.name))
  const openPatientApp = () =>
    setPopupBlocked(
      !openWindow(PATIENT_APP.url, PATIENT_APP.name, PATIENT_APP.features)
    )

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-background/95 px-4 backdrop-blur md:px-6">
        <Wordmark className="text-lg" />
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {t("brand.tagline")}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <LangToggle />
          <EventStreamTrigger />
          <DemoPanelTrigger />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[120rem] flex-1 flex-col gap-6 p-4 md:p-6">
        <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="surface-card flex flex-col gap-4 p-5">
            <div>
              <h1 className="text-[1.375rem] leading-tight font-semibold">
                {t("shell.launcherTitle")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("shell.launcherSubtitle")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={openLayout} data-testid="open-layout">
                <LayoutGrid />
                {t("demo.launcher.openLayout")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href="/wall" />}
                data-testid="open-wall"
              >
                <Columns2 />
                {t("demo.launcher.openWall")}
              </Button>
              <Button size="lg" variant="outline" onClick={openDisplay}>
                <Tv />
                {t("demo.launcher.openDisplay")}
              </Button>
              <Button size="lg" variant="outline" onClick={openPatientApp}>
                <Smartphone />
                {t("demo.launcher.openPatientApp")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("demo.launcher.openLayoutHint")}
            </p>
            {popupBlocked ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning"
                data-testid="popup-blocked"
              >
                <TriangleAlert className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  {t("demo.launcher.popupBlocked")}
                </span>
                <Link
                  href="/wall"
                  className="font-medium text-link hover:underline"
                >
                  {t("demo.launcher.openWall")}
                </Link>
              </div>
            ) : null}
          </div>

          <div className="surface-card flex flex-col gap-4 p-5">
            <ThisWindow />
            <div className="border-t border-hairline pt-4">
              <SeedStatus />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-[1.0625rem] font-semibold">
              {t("demo.launcher.rolesTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("demo.launcher.rolesHint")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {PERSONAS_BY_ROLE.map(([role, personas]) =>
              personas.length ? (
                <RoleCard
                  key={role}
                  role={role}
                  personas={personas}
                  onBlocked={blocked}
                />
              ) : null
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

/** Who this window is signed in as, with a shortcut back to their home screen. */
function ThisWindow() {
  const { t, tk, locale } = useLocale()
  const persona = usePersona()

  if (!persona) {
    return (
      <div className="flex flex-col gap-1">
        <p className="micro">{t("demo.launcher.thisWindow")}</p>
        <p className="text-xs text-muted-foreground">
          {t("demo.launcher.noPersona")}
        </p>
      </div>
    )
  }
  const Icon = ROLE_ICONS[persona.role]
  return (
    <div className="flex flex-col gap-2">
      <p className="micro">{t("demo.launcher.thisWindow")}</p>
      <div className="flex items-center gap-3">
        <span className="icon-well flex size-9 shrink-0 items-center justify-center text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium"
            data-testid="this-window-persona"
          >
            {t("demo.launcher.signedInAs", {
              name: personaName(persona, locale),
            })}
          </p>
          <p className="truncate text-[0.6875rem] text-muted-foreground">
            {roleLabel(persona.role, tk)} ·{" "}
            {branchLabel(persona.branchId, locale)}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        nativeButton={false}
        render={<Link href={HOME_ROUTE[persona.role]} />}
      >
        {t("demo.launcher.continue")}
        <ArrowRight />
      </Button>
    </div>
  )
}
