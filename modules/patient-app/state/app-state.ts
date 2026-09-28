"use client"

import * as React from "react"

import type { Id } from "@/core/db/schema"
import { windowKey } from "@/core/session/windowId"

/**
 * Patient-app state for THIS window (plan §3.9: everything per window), kept
 * in sessionStorage next to the window session so a reload keeps it and
 * another window or Demo Wall pane has its own.
 */
export type AppWindowState = {
  /** The first-launch language choice and splash are done */
  launched: boolean
  /** Patient id signed in with the OTP in this window, null when signed out */
  signedInAs: Id | null
  /** The family member whose records are shown (validated on every read) */
  memberId: Id | null
}

export const DEFAULT_APP_STATE: AppWindowState = {
  launched: false,
  signedInAs: null,
  memberId: null,
}

const listeners = new Set<() => void>()
let cache: AppWindowState | null = null

const storageKey = () => `mc:app:${windowKey()}`

function read(): AppWindowState {
  try {
    const raw = window.sessionStorage.getItem(storageKey())
    if (raw)
      return {
        ...DEFAULT_APP_STATE,
        ...(JSON.parse(raw) as Partial<AppWindowState>),
      }
  } catch {
    // Storage unavailable or corrupt: start from the first launch.
  }
  return DEFAULT_APP_STATE
}

export function getAppState(): AppWindowState {
  if (typeof window === "undefined") return DEFAULT_APP_STATE
  if (!cache) cache = read()
  return cache
}

export function updateAppState(patch: Partial<AppWindowState>): void {
  cache = { ...getAppState(), ...patch }
  try {
    window.sessionStorage.setItem(storageKey(), JSON.stringify(cache))
  } catch {
    // The in-memory copy still carries the state for this page.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAppState(): AppWindowState {
  return React.useSyncExternalStore(
    subscribe,
    getAppState,
    () => DEFAULT_APP_STATE
  )
}
