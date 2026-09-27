"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, LayoutGrid } from "lucide-react"

import { PersonaAvatar } from "@/components/shared/avatars"
import { roleLabel } from "@/components/shared/roles"
import { branchLabel, personaName } from "@/components/shell/greeting"
import { UiScaleStepper } from "@/components/shell/ui-scale"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { HOME_ROUTE } from "@/core/rbac/routes"
import { ROLES, type Role } from "@/core/rbac/types"
import { setPersona } from "@/core/session/persona"
import { PERSONAS, type PersonaSeed } from "@/core/seed/content/personas"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** Every persona, grouped by role in the plan's role order. */
export function personasByRole(): { role: Role; personas: PersonaSeed[] }[] {
  return ROLES.map((role) => ({
    role,
    personas: PERSONAS.filter((p) => p.role === role).sort((a, b) => a.order - b.order),
  })).filter((group) => group.personas.length)
}

/** Switch this window's persona and go to that role's home screen. */
export function useSwitchPersona() {
  const router = useRouter()
  return React.useCallback(
    (persona: PersonaSeed) => {
      setPersona(persona.id)
      router.push(HOME_ROUTE[persona.role])
    },
    [router]
  )
}

/**
 * The avatar block (name, role, chevron) is the persona switcher
 * (docs/ui_guidelines.md §3): it lists every persona by role, plus this
 * window's display size and the launcher.
 */
export function PersonaSwitcher({
  persona,
  className,
}: {
  persona: PersonaSeed
  className?: string
}) {
  const { t, tk, locale } = useLocale()
  const switchTo = useSwitchPersona()
  const router = useRouter()
  const groups = React.useMemo(() => personasByRole(), [])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-slot="persona-switcher"
        aria-label={t("shell.persona.menuLabel")}
        className={cn(
          "flex h-12 min-w-0 shrink-0 items-center gap-3 rounded-md py-1 pr-2 pl-1 text-left transition-colors outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-expanded:bg-card",
          className
        )}
      >
        <PersonaAvatar persona={persona} size={40} />
        <span className="hidden min-w-0 flex-col @min-[76rem]/topbar:flex">
          <span className="max-w-[11rem] truncate text-[0.9375rem] leading-tight font-semibold">
            {personaName(persona, locale)}
          </span>
          <span className="max-w-[11rem] truncate text-xs leading-tight text-muted-foreground">
            {roleLabel(persona.role, tk)}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[min(21rem,calc(100vw-2rem))] p-0"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3 px-4 pt-4 pb-3">
            <PersonaAvatar persona={persona} size={44} />
            <span className="min-w-0">
              <span className="block text-xs font-normal text-muted-foreground">
                {t("shell.persona.signedInAs")}
              </span>
              <span className="block truncate text-[0.9375rem] font-semibold text-foreground">
                {personaName(persona, locale)}
              </span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {persona.staff?.designation[locale] ?? roleLabel(persona.role, tk)} ·{" "}
                {branchLabel(persona, locale)}
              </span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="max-h-[min(24rem,calc(var(--available-height)-11rem))] overflow-y-auto p-1.5">
          {groups.map((group) => (
            <DropdownMenuGroup key={group.role}>
              <DropdownMenuLabel>{roleLabel(group.role, tk)}</DropdownMenuLabel>
              {group.personas.map((option) => {
                const current = option.id === persona.id
                return (
                  <DropdownMenuItem
                    key={option.id}
                    onClick={() => (current ? undefined : switchTo(option))}
                    className={cn("gap-3", current && "bg-primary-soft")}
                  >
                    <PersonaAvatar persona={option} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {personaName(option, locale)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.staff?.designation[locale] ?? roleLabel(option.role, tk)}
                      </span>
                    </span>
                    <span
                      translate="no"
                      className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground"
                    >
                      {option.branchId ?? "HQ"}
                    </span>
                    {current ? <Check className="size-4 shrink-0 text-primary" /> : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          ))}
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="px-4 py-2.5">
          <UiScaleStepper />
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="p-1.5">
          <DropdownMenuItem onClick={() => router.push("/")}>
            <LayoutGrid />
            {t("shell.persona.openLauncher")}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
