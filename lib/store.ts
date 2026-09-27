"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

/**
 * UI-only state (sidebar, drawers, interface scale). Domain data never lives
 * here: it is read from IndexedDB through the engine.
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

type UiState = {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (value: boolean) => void

  commandOpen: boolean
  setCommandOpen: (value: boolean) => void

  /** Root font-size multiplier driving --ui-scale. */
  uiScale: number
  setUiScale: (value: number) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),

      uiScale: 1,
      setUiScale: (uiScale) =>
        set({
          uiScale: Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, uiScale)),
        }),
    }),
    {
      name: "medcore.ui",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        uiScale: state.uiScale,
      }),
    }
  )
)
