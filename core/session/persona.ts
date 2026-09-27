"use client"

import * as React from "react"

import type { Actor } from "@/core/engine/types"
import { findPersona, type PersonaSeed } from "@/core/seed/content/personas"

import { updateSession, useSession } from "./session"

/** The Actor a persona commits as (authorities come with the staff record). */
export function actorFor(persona: PersonaSeed): Actor {
  return {
    staffId: persona.staff?.id ?? persona.patientId ?? persona.id,
    personaId: persona.id,
    role: persona.role,
    branchId: persona.branchId,
    name: persona.staff?.nameEn ?? persona.patientName?.en ?? persona.id,
    authorities: persona.staff?.authorities ?? [],
  }
}

/** This window's persona, or null before one is picked. */
export function usePersona(): PersonaSeed | null {
  const { personaId } = useSession()
  return React.useMemo(
    () => (personaId ? (findPersona(personaId) ?? null) : null),
    [personaId]
  )
}

/** This window's acting identity for commits, or null before a persona is picked. */
export function useActor(): Actor | null {
  const persona = usePersona()
  return React.useMemo(() => (persona ? actorFor(persona) : null), [persona])
}

export function setPersona(personaId: string | null): void {
  updateSession({ personaId, cue: null })
}
