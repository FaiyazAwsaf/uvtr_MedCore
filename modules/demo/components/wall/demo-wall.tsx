"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ExternalLink,
  House,
  Maximize2,
  Minimize2,
} from "lucide-react"

import { DemoPanelTrigger } from "@/components/shell/demo/demo-panel"
import { EventStreamTrigger } from "@/components/shell/demo/event-stream"
import { LangToggle } from "@/components/shell/demo/lang-toggle"
import { Wordmark } from "@/components/shell/demo/wordmark"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { headquarters } from "@/config/brand.config"
import { ROLES } from "@/core/rbac/types"
import {
  findPersona,
  PERSONAS,
  type PersonaSeed,
} from "@/core/seed/content/personas"
import { windowKey } from "@/core/session/windowId"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { personaName, roleLabel } from "../labels"
import { openWindow, personaUrl, windowNameFor } from "../launcher/windows"
import { ROLE_ICONS } from "../role-icons"

/** Default panes: the four demo-layout personas (plan §9). */
const DEFAULT_PANES = [
  "per_doctor_kamal",
  "per_pharmacist_shirin",
  "per_labtech_rubel",
  "per_cashier_rafiq",
]

const storageKey = () => `mc:wall:${windowKey()}`

/** Pane personas chosen in this Wall tab, kept across reloads of the tab. */
function readPanes(): string[] {
  if (typeof window === "undefined") return DEFAULT_PANES
  try {
    const saved = JSON.parse(
      window.sessionStorage.getItem(storageKey()) ?? "null"
    ) as unknown
    if (
      Array.isArray(saved) &&
      saved.length === DEFAULT_PANES.length &&
      saved.every((id) => typeof id === "string" && findPersona(id))
    ) {
      return saved as string[]
    }
  } catch {
    // Unreadable storage: fall back to the default layout.
  }
  return DEFAULT_PANES
}

function writePanes(panes: string[]): void {
  try {
    window.sessionStorage.setItem(storageKey(), JSON.stringify(panes))
  } catch {
    // The layout still applies for this page.
  }
}

/**
 * The Demo Wall (plan §9, "/wall"): four personas side by side in one tab.
 * Each pane is a same-origin iframe named `mc-wall-<n>`, so it has its own
 * per-window session while sharing IndexedDB and the BroadcastChannel bus:
 * live sync works exactly as between separate windows.
 */
export function DemoWall() {
  const { t } = useLocale()
  const [panes, setPanes] = React.useState<string[]>(readPanes)
  const [reloads, setReloads] = React.useState<number[]>(() =>
    DEFAULT_PANES.map(() => 0)
  )
  const [expanded, setExpanded] = React.useState<number | null>(null)

  const choose = (index: number, personaId: string) => {
    const next = panes.map((id, i) => (i === index ? personaId : id))
    setPanes(next)
    writePanes(next)
  }
  const reload = (index: number) =>
    setReloads((current) => current.map((n, i) => (i === index ? n + 1 : n)))

  return (
    <div className="flex h-svh flex-col bg-background" data-testid="demo-wall">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <Wordmark className="text-base" />
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {t("demo.wall.title")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-1"
          nativeButton={false}
          render={<Link href="/" />}
          data-testid="wall-launcher"
        >
          <ArrowLeft />
          {t("demo.wall.launcher")}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <LangToggle />
          <EventStreamTrigger />
          <DemoPanelTrigger />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1.5 p-1.5">
        {panes.map((personaId, index) => (
          <WallPane
            key={index}
            index={index}
            personaId={personaId}
            reload={reloads[index]}
            expanded={expanded === index}
            hidden={expanded !== null && expanded !== index}
            onChoose={(id) => choose(index, id)}
            onReload={() => reload(index)}
            onToggle={() =>
              setExpanded((current) => (current === index ? null : index))
            }
          />
        ))}
      </main>
    </div>
  )
}

function WallPane({
  index,
  personaId,
  reload,
  expanded,
  hidden,
  onChoose,
  onReload,
  onToggle,
}: {
  index: number
  personaId: string
  reload: number
  expanded: boolean
  hidden: boolean
  onChoose: (personaId: string) => void
  onReload: () => void
  onToggle: () => void
}) {
  const { t, tk, num, locale } = useLocale()
  const persona: PersonaSeed = findPersona(personaId) ?? PERSONAS[0]
  const Icon = ROLE_ICONS[persona.role]
  const n = num(index + 1)
  const name = personaName(persona, locale)
  const src = personaUrl(persona.role, persona.id, { scale: "0.9" })
  const toggleLabel = expanded ? t("demo.wall.restore") : t("demo.wall.expand")

  return (
    <section
      aria-label={t("demo.wall.pane", { n })}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-card ring-1 ring-border/70",
        expanded && "col-span-2 row-span-2",
        hidden && "hidden"
      )}
      data-testid={`wall-pane-${index + 1}`}
    >
      <div
        className="flex h-9 shrink-0 items-center gap-1.5 border-b border-hairline px-2"
        onDoubleClick={onToggle}
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[0.625rem] font-semibold">
          {n}
        </span>
        <Icon className="size-3.5 shrink-0 text-primary" />
        <Select
          value={persona.id}
          onValueChange={(value) => value && onChoose(value)}
        >
          <SelectTrigger
            size="sm"
            className="h-7 max-w-[18rem] min-w-0 border-transparent bg-transparent px-1.5 font-medium dark:bg-transparent"
            aria-label={t("demo.wall.choosePersona", { n })}
            data-testid={`wall-persona-${index + 1}`}
          >
            <SelectValue>
              {() => (
                <span className="truncate">
                  {name}
                  <span className="ml-1.5 text-muted-foreground">
                    {roleLabel(persona.role, tk)} ·{" "}
                    {persona.branchId ?? headquarters.code}
                  </span>
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={false}
            align="start"
            className="min-w-64"
          >
            {ROLES.map((role) => {
              const options = PERSONAS.filter((p) => p.role === role)
              if (!options.length) return null
              return (
                <SelectGroup key={role}>
                  <SelectLabel>{roleLabel(role, tk)}</SelectLabel>
                  {options.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="pr-8">
                      <span className="truncate">{personaName(p, locale)}</span>
                      <span className="ml-auto pl-3 font-mono text-[0.625rem] text-muted-foreground">
                        {p.branchId ?? headquarters.code}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )
            })}
          </SelectContent>
        </Select>
        <div className="ml-auto flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onReload}
            aria-label={t("demo.wall.home")}
            title={t("demo.wall.home")}
          >
            <House />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() =>
              openWindow(
                personaUrl(persona.role, persona.id),
                windowNameFor(persona.id)
              )
            }
            aria-label={t("demo.wall.openWindow")}
            title={t("demo.wall.openWindow")}
          >
            <ExternalLink />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            aria-pressed={expanded}
            aria-label={toggleLabel}
            title={toggleLabel}
            data-testid={`wall-expand-${index + 1}`}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </div>
      <iframe
        key={`${persona.id}:${reload}`}
        name={`mc-wall-${index + 1}`}
        src={src}
        title={t("demo.wall.frameTitle", {
          name,
          role: roleLabel(persona.role, tk),
        })}
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </section>
  )
}
