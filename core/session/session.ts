"use client"

import * as React from "react"

import { LOCALES, type Locale } from "@/lib/i18n/config"

import type { WindowSession } from "./types"
import { windowKey } from "./windowId"

export const DEFAULT_SESSION: WindowSession = {
  personaId: null,
  lang: "en",
  theme: "dark",
  uiScale: 1,
  cue: null,
}

const listeners = new Set<() => void>()
let cache: WindowSession | null = null

const storageKey = () => `mc:session:${windowKey()}`

function read(): WindowSession {
  let session: WindowSession = DEFAULT_SESSION
  try {
    const raw = window.sessionStorage.getItem(storageKey())
    if (raw) session = { ...DEFAULT_SESSION, ...(JSON.parse(raw) as Partial<WindowSession>) }
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return applyUrlOverrides(session)
}

/**
 * `?persona=<id>&lang=bn&scale=0.9` sets this window's session (the launcher,
 * Demo Wall and scenario launchers use it). The params are then removed from
 * the address so a later reload keeps any change made in the window.
 */
function applyUrlOverrides(session: WindowSession): WindowSession {
  const url = new URL(window.location.href)
  const persona = url.searchParams.get("persona")
  const lang = url.searchParams.get("lang")
  const scale = url.searchParams.get("scale")
  if (!persona && !lang && !scale) return session
  const next = { ...session }
  if (persona) next.personaId = persona
  if (lang && (LOCALES as readonly string[]).includes(lang)) next.lang = lang as Locale
  if (scale && Number.isFinite(Number(scale))) next.uiScale = Number(scale)
  for (const param of ["persona", "lang", "scale"]) url.searchParams.delete(param)
  window.history.replaceState(window.history.state, "", url.toString())
  write(next)
  return next
}

function write(session: WindowSession): void {
  try {
    window.sessionStorage.setItem(storageKey(), JSON.stringify(session))
  } catch {
    // The in-memory cache still carries the session for this page.
  }
}

export function getSession(): WindowSession {
  if (typeof window === "undefined") return DEFAULT_SESSION
  if (!cache) cache = read()
  return cache
}

export function updateSession(patch: Partial<WindowSession>): void {
  cache = { ...getSession(), ...patch }
  write(cache)
  listeners.forEach((listener) => listener())
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** This window's session. Defaults during server render and hydration. */
export function useSession(): WindowSession {
  return React.useSyncExternalStore(subscribeSession, getSession, () => DEFAULT_SESSION)
}
