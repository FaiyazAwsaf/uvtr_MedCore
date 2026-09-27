import { getBranch, headquarters, type BranchCode } from "@/config/brand.config"
import type { ActorRef } from "@/core/db/schema"
import { EVENT_CATALOG } from "@/core/events/registry"
import type { EventDef } from "@/core/events/types"
import type { Role } from "@/core/rbac/types"
import { PERSONAS, type PersonaSeed } from "@/core/seed/content/personas"
import type { Locale } from "@/lib/i18n/config"

/**
 * Display helpers shared by the launcher, Demo Wall, event stream, demo panel
 * and audit viewer. Every lookup degrades to a readable fallback so a missing
 * key or an unknown id never breaks a screen.
 */

export type Tk = (
  key: string,
  params?: Record<string, string | number>
) => string
export type Num = (value: number) => string

/** A persona's display name in the active language. */
export function personaName(persona: PersonaSeed, locale: Locale): string {
  if (persona.staff)
    return locale === "bn" ? persona.staff.nameBn : persona.staff.nameEn
  return persona.patientName?.[locale] ?? persona.id
}

export function personaByStaffId(
  staffId: string | undefined
): PersonaSeed | undefined {
  if (!staffId) return undefined
  return PERSONAS.find(
    (p) => p.staff?.id === staffId || p.patientId === staffId
  )
}

/** Name for a staff id (or "system"), in the active language. */
export function staffName(
  staffId: string | undefined,
  locale: Locale,
  tk: Tk
): string {
  if (!staffId || staffId === "system") return tk("demo.common.system")
  const persona = personaByStaffId(staffId)
  return persona ? personaName(persona, locale) : staffId
}

/** Name of the actor on an event or audit row, in the active language. */
export function actorName(
  actor: ActorRef | undefined,
  locale: Locale,
  tk: Tk
): string {
  if (!actor || actor.staffId === "system" || actor.role === "system") {
    return tk("demo.common.system")
  }
  const persona = personaByStaffId(actor.staffId)
  return persona ? personaName(persona, locale) : actor.name || actor.staffId
}

export function roleLabel(role: Role | "system" | undefined, tk: Tk): string {
  if (!role || role === "system") return tk("demo.common.system")
  const label = tk(`demo.roles.${role}`)
  return label === `demo.roles.${role}` ? role : label
}

/** "Dhanmondi" for a branch, the headquarters name for network level. */
export function branchName(
  code: BranchCode | null | undefined,
  locale: Locale
): string {
  if (!code) return headquarters.name[locale]
  try {
    return getBranch(code).name[locale]
  } catch {
    return code
  }
}

/** "Dhanmondi (B1)", or the headquarters name for network level. */
export function branchLabel(
  code: BranchCode | null | undefined,
  locale: Locale
): string {
  return code
    ? `${branchName(code, locale)} (${code})`
    : headquarters.name[locale]
}

/** Counts in event params read in the window's language; ids stay Latin. */
export function localizeParams(
  params: Record<string, string | number> | undefined,
  num: Num
): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    out[key] = typeof value === "number" ? num(value) : value
  }
  return out
}

/**
 * The event's label in the active language. `known` is false when the label
 * key has no translation yet (an event added by another module), in which
 * case the raw event type is shown instead. Never throws.
 */
export function eventLabel(
  event: {
    type?: string
    summaryKey?: string
    params?: Record<string, string | number>
  },
  tk: Tk,
  num: Num
): { text: string; known: boolean } {
  const fallback = event.type || "Event"
  const key = event.summaryKey
  if (typeof key !== "string" || !key) return { text: fallback, known: false }
  try {
    const text = tk(key, localizeParams(event.params, num))
    if (!text || text === key) return { text: fallback, known: false }
    return { text, known: true }
  } catch {
    return { text: fallback, known: false }
  }
}

/** A consumer chip label; falls back to the key's last segment. */
export function consumerLabel(key: string, tk: Tk): string {
  try {
    const text = tk(key)
    if (text && text !== key) return text
  } catch {
    // fall through to the readable fallback
  }
  return key.split(".").pop() ?? key
}

export function eventDef(type: string | undefined): EventDef | undefined {
  return type ? EVENT_CATALOG[type] : undefined
}

export const SEVERITY_TEXT: Record<
  NonNullable<EventDef["severity"]>,
  string
> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  critical: "text-destructive",
}

export const SEVERITY_DOT: Record<NonNullable<EventDef["severity"]>, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
}
