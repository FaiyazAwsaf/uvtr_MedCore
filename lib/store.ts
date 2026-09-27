"use client"

import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"

import { updateSession } from "@/core/session/session"
import { windowKey } from "@/core/session/windowId"

/**
 * UI-only state (sidebar, command palette, interface scale). Domain data never
 * lives here: it is read from IndexedDB through the engine.
 *
 * Everything that must differ between windows is per window. Demo Wall iframes
 * share localStorage AND sessionStorage with their parent, so per-window state
 * is keyed by `window.name` (see core/session/windowId.ts). The interface scale
 * belongs to the window session (`session.uiScale`); `uiScale` below is only a
 * mirror of it, kept in step by <UiScaleProvider />.
 */

export const UI_SCALE_MIN = 0.9
export const UI_SCALE_MAX = 1.4
export const UI_SCALE_STEP = 0.05

export const UI_SCALE_PRESETS = [
  { value: 0.9, labelKey: "shell.scaleCompact" },
  { value: 1, labelKey: "shell.scaleDefault" },
  { value: 1.15, labelKey: "shell.scaleLarge" },
  { value: 1.3, labelKey: "shell.scaleLarger" },
] as const

/** Below this window width the sidebar is an icon rail unless the user opened it. */
export const SIDEBAR_RAIL_BELOW_PX = 1100

/** A safe scale: finite, and inside the supported range. */
export function clampUiScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Number(value.toFixed(2))))
}

/** Set this window's interface scale (stored in the window session). */
export function setWindowUiScale(value: number): void {
  const next = clampUiScale(value)
  updateSession({ uiScale: next })
  useUi.setState({ uiScale: next })
}

function isNarrowWindow(): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth < SIDEBAR_RAIL_BELOW_PX
}

type UiState = {
  /**
   * This window's sidebar choice. `null` follows the window width (an icon
   * rail below 1100px); `true` or `false` is an explicit choice (Cmd/Ctrl+B).
   */
  sidebarCollapsed: boolean | null
  /** Flip the sidebar; returns to automatic when the result matches the width rule. */
  toggleSidebar: () => void
  setSidebarCollapsed: (value: boolean | null) => void

  commandOpen: boolean
  setCommandOpen: (value: boolean) => void

  /** Mirror of this window's `session.uiScale` (the session is the source of truth). */
  uiScale: number
  setUiScale: (value: number) => void
}

/** sessionStorage, namespaced by this window's name so Demo Wall panes do not collide. */
const windowStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.sessionStorage.getItem(`${name}:${windowKey()}`)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      window.sessionStorage.setItem(`${name}:${windowKey()}`, value)
    } catch {
      // Storage unavailable: the in-memory state still works for this page.
    }
  },
  removeItem: (name) => {
    try {
      window.sessionStorage.removeItem(`${name}:${windowKey()}`)
    } catch {
      // ignore
    }
  },
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: null,
      toggleSidebar: () => {
        const auto = isNarrowWindow()
        const current = get().sidebarCollapsed ?? auto
        const next = !current
        set({ sidebarCollapsed: next === auto ? null : next })
      },
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),

      uiScale: 1,
      setUiScale: (value) => setWindowUiScale(value),
    }),
    {
      name: "mc:ui",
      storage: createJSONStorage(() => windowStorage),
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    }
  )
)
