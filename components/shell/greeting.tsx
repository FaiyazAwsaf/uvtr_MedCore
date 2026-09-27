"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Hand } from "lucide-react"

import { firstNameOf } from "@/components/shared/person"
import { branches, headquarters } from "@/config/brand.config"
import { dhakaDate, dhakaTime } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { PersonaSeed } from "@/core/seed/content/personas"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

type DayPart = "morning" | "afternoon" | "evening"

/** Morning until 11:59, afternoon to 16:59, evening otherwise (Dhaka, demo clock). */
export function dayPartAt(ms: number): DayPart {
  const hour = Number(dhakaTime(ms).slice(0, 2))
  // Early-shift staff (midnight to noon) are greeted with "morning".
  if (hour < 12) return "morning"
  if (hour >= 12 && hour < 17) return "afternoon"
  return "evening"
}

/** The room code of a doctor's session today, if the seed has one. */
function useDoctorRoom(persona: PersonaSeed, today: string): string | null {
  const db = useDb()
  const staffId = persona.role === "doctor" ? persona.staff?.id : undefined
  const room = useLiveQuery(async () => {
    if (!staffId) return null
    const doctor = await db.doctors.where("staffId").equals(staffId).first()
    if (!doctor) return null
    const session = await db.sessions
      .where("[doctorId+date]")
      .equals([doctor.id, today])
      .first()
    if (!session) return null
    return (await db.rooms.get(session.roomId))?.code ?? null
  }, [db, staffId, today])
  return room ?? null
}

/** A persona's display name in the window's language. */
export function personaName(persona: PersonaSeed, locale: "en" | "bn"): string {
  if (persona.staff) return locale === "bn" ? persona.staff.nameBn : persona.staff.nameEn
  return persona.patientName?.[locale] ?? persona.id
}

/** "Dhanmondi (B1)", or the network HQ for branchless personas. */
export function branchLabel(persona: PersonaSeed, locale: "en" | "bn"): string {
  const branch = persona.branchId
    ? branches.find((b) => b.code === persona.branchId)
    : undefined
  return branch ? `${branch.name[locale]} (${branch.code})` : headquarters.name[locale]
}

/**
 * The top bar greeting (docs/ui_guidelines.md §3): "Good morning, Dr. Kamal"
 * by the demo-clock hour, and a context line: designation, branch, and the
 * room for doctors in session.
 */
export function Greeting({
  persona,
  className,
}: {
  persona: PersonaSeed
  className?: string
}) {
  const { t, locale, digits } = useLocale()
  const nowMs = useNow(60_000)
  const part = dayPartAt(nowMs)
  const room = useDoctorRoom(persona, dhakaDate(nowMs))
  const name = firstNameOf(personaName(persona, locale))
  const context = [
    persona.staff?.designation[locale],
    branchLabel(persona, locale),
    room ? t("shell.roomLabel", { room: digits(room) }) : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div data-slot="greeting" className={cn("min-w-0", className)}>
      <h1 className="flex min-w-0 items-center gap-2 text-[1.1875rem] leading-tight font-semibold tracking-tight @min-[60rem]/topbar:text-[1.375rem]">
        <span className="truncate">{t(`shell.greeting.${part}`, { name })}</span>
        {/* The sample's waving hand, drawn as an icon so it needs no emoji font */}
        <Hand
          aria-hidden
          className="size-5.5 shrink-0 -rotate-12 fill-warning/85 stroke-[1.6] text-[color-mix(in_oklch,var(--warning),black_35%)]"
        />
      </h1>
      <p className="mt-1 truncate text-[0.8125rem] text-muted-foreground">
        {context}
      </p>
    </div>
  )
}
