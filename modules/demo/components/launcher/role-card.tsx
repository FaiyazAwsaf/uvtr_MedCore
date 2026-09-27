"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, LogIn } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { headquarters } from "@/config/brand.config"
import { HOME_ROUTE } from "@/core/rbac/routes"
import type { Role } from "@/core/rbac/types"
import type { PersonaSeed } from "@/core/seed/content/personas"
import { setPersona } from "@/core/session/persona"
import { useLocale } from "@/lib/i18n/provider"

import { branchLabel, personaName, roleLabel } from "../labels"
import { ROLE_ICONS } from "../role-icons"
import { openWindow, personaUrl, windowNameFor } from "./windows"

/**
 * One role on the launcher: pick a persona (default first), read who they
 * are and what they demonstrate, then open them here or in their own window.
 */
export function RoleCard({
  role,
  personas,
  onBlocked,
}: {
  role: Role
  personas: PersonaSeed[]
  onBlocked: () => void
}) {
  const { t, tk, num, locale } = useLocale()
  const router = useRouter()
  const initial = personas.find((p) => p.isDefault) ?? personas[0]
  const [selectedId, setSelectedId] = React.useState(initial.id)
  const persona = personas.find((p) => p.id === selectedId) ?? initial
  const Icon = ROLE_ICONS[role]
  const designation = persona.staff?.designation[locale]

  const openHere = () => {
    setPersona(persona.id)
    router.push(HOME_ROUTE[role])
  }
  const openNew = () => {
    if (!openWindow(personaUrl(role, persona.id), windowNameFor(persona.id)))
      onBlocked()
  }

  return (
    <article
      className="surface-card flex flex-col gap-3 p-4"
      data-testid={`role-card-${role}`}
    >
      <header className="flex items-center gap-3">
        <span className="icon-well flex size-10 shrink-0 items-center justify-center text-primary">
          <Icon className="size-[1.125rem]" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-[0.9375rem] font-semibold">
            {roleLabel(role, tk)}
          </h3>
          <p className="text-[0.6875rem] text-muted-foreground">
            {personas.length === 1
              ? t("demo.launcher.personaOne")
              : t("demo.launcher.personaMany", { count: num(personas.length) })}
          </p>
        </div>
      </header>

      {personas.length > 1 ? (
        <Select
          value={selectedId}
          onValueChange={(value) => value && setSelectedId(value)}
        >
          <SelectTrigger
            className="w-full"
            aria-label={t("demo.launcher.persona")}
          >
            <SelectValue>
              {(value: string | null) => {
                const selected = personas.find((p) => p.id === value)
                return selected ? personaName(selected, locale) : ""
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {personas.map((p) => (
              <SelectItem key={p.id} value={p.id} className="pr-8">
                <span className="truncate">{personaName(p, locale)}</span>
                <span className="ml-auto pl-3 font-mono text-[0.625rem] text-muted-foreground">
                  {p.branchId ?? headquarters.code}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <div className="flex flex-1 flex-col gap-1">
        <p className="text-sm font-medium" data-testid={`role-persona-${role}`}>
          {personaName(persona, locale)}
        </p>
        <p className="text-xs text-muted-foreground">
          {designation ? `${designation} · ` : ""}
          {branchLabel(persona.branchId, locale)}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-foreground/80">
          {persona.blurb[locale]}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="flex-1"
          onClick={openHere}
          data-testid={`open-here-${role}`}
        >
          <LogIn />
          {t("demo.launcher.openHere")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={openNew}
          data-testid={`open-window-${role}`}
        >
          <ExternalLink />
          {t("demo.launcher.openNewWindow")}
        </Button>
      </div>
    </article>
  )
}
