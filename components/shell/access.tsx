"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldX, UserRound } from "lucide-react"

import { PersonaAvatar } from "@/components/shared/avatars"
import { roleLabel, rolesList } from "@/components/shared/roles"
import { branchLabel, personaName } from "@/components/shell/greeting"
import { Wordmark } from "@/components/shell/app-sidebar"
import { activeHref } from "@/components/shell/nav"
import { Button } from "@/components/ui/button"
import { NAV_ITEMS } from "@/core/rbac/registry"
import { accessFor, canAccess, HOME_ROUTE } from "@/core/rbac/routes"
import type { NavItem } from "@/core/rbac/types"
import { setPersona } from "@/core/session/persona"
import { PERSONAS, type PersonaSeed } from "@/core/seed/content/personas"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Personas that may open a route, fewest clicks first: when many roles can
 * (the library, the audit log), only each role's default persona is offered.
 */
export function personasFor(pathname: string, exclude?: string): PersonaSeed[] {
  const allowed = PERSONAS.filter(
    (persona) => persona.id !== exclude && canAccess(persona.role, pathname)
  )
  const list = allowed.length > 6 ? allowed.filter((p) => p.isDefault) : allowed
  return list.slice(0, 8)
}

/** Buttons that switch this window to a persona and stay on the route. */
function PersonaChoices({ personas }: { personas: PersonaSeed[] }) {
  const { tk, locale } = useLocale()
  return (
    <div className="grid w-full gap-2 sm:grid-cols-2">
      {personas.map((persona) => (
        <button
          key={persona.id}
          type="button"
          onClick={() => setPersona(persona.id)}
          className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left transition-colors outline-none hover:border-primary hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <PersonaAvatar persona={persona} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {personaName(persona, locale)}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {roleLabel(persona.role, tk)} · {branchLabel(persona, locale)}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** The sidebar entry (any role) that owns a pathname, for "you are opening X". */
function screenFor(pathname: string): NavItem | undefined {
  const href = activeHref(NAV_ITEMS, pathname)
  return href ? NAV_ITEMS.find((item) => item.href === href) : undefined
}

/**
 * No persona in this window yet (the URL was opened directly): a friendly
 * prompt to pick one who can open this screen, or to go to the launcher.
 */
export function NoPersonaScreen({ pathname }: { pathname: string }) {
  const { t, tk } = useLocale()
  const choices = personasFor(pathname)
  const screen = screenFor(pathname)
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-10">
      <Wordmark className="text-[1.75rem]" />
      <div className="surface-card flex w-full max-w-xl flex-col items-center gap-5 p-6 text-center sm:p-8">
        <span className="icon-well flex size-12 items-center justify-center text-link">
          <UserRound className="size-6" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-[1.375rem] font-semibold">{t("shell.guard.noPersonaTitle")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("shell.guard.noPersonaBody")}
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
          {screen ? (
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
              <span>{tk(screen.groupKey)}</span>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span>{tk(screen.labelKey)}</span>
            </p>
          ) : null}
          <p lang="en" className="font-mono text-xs text-muted-foreground">
            {pathname}
          </p>
        </div>
        {choices.length ? (
          <div className="flex w-full flex-col gap-2 text-left">
            <span className="text-[0.8125rem] font-medium text-muted-foreground">
              {t("shell.guard.openAs")}
            </span>
            <PersonaChoices personas={choices} />
          </div>
        ) : null}
        <Button nativeButton={false} render={<Link href="/" />} variant="outline">
          {t("shell.persona.openLauncher")}
        </Button>
      </div>
    </div>
  )
}

/**
 * The persona's role may not open this route (plan §3.10): "This screen is
 * for <role>. You are signed in as <persona>." Offers the persona's home
 * screen, or a switch to someone who can open it.
 */
export function AccessDenied({
  persona,
  pathname,
  className,
}: {
  persona: PersonaSeed
  pathname: string
  className?: string
}) {
  const { t, tk, locale } = useLocale()
  const access = accessFor(pathname)
  const roles =
    access === "all-staff"
      ? t("shell.roles.allStaff")
      : access === "public"
        ? ""
        : rolesList(access, tk, locale)
  const choices = personasFor(pathname, persona.id).slice(0, 4)

  return (
    <div
      data-slot="access-denied"
      className={cn(
        "flex flex-1 flex-col items-center justify-center py-10",
        className
      )}
    >
      <div className="surface-card flex w-full max-w-xl flex-col items-center gap-5 p-6 text-center sm:p-8">
        <span className="flex size-12 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] text-warning">
          <ShieldX className="size-6" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-[1.375rem] font-semibold">{t("shell.guard.deniedTitle")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("shell.guard.deniedBody", {
              roles,
              persona: `${personaName(persona, locale)} (${roleLabel(persona.role, tk)})`,
            })}
          </p>
          <p lang="en" className="font-mono text-xs text-muted-foreground">
            {pathname}
          </p>
        </div>
        <Button nativeButton={false} render={<Link href={HOME_ROUTE[persona.role]} />}>
          {t("shell.guard.goHome")}
        </Button>
        {choices.length ? (
          <div className="flex w-full flex-col gap-2 text-left">
            <span className="text-[0.8125rem] font-medium text-muted-foreground">
              {t("shell.guard.switchTo")}
            </span>
            <PersonaChoices personas={choices} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
