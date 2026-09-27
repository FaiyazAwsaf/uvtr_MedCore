"use client"

import { create } from "zustand"

import type { BranchCode } from "@/config/brand.config"
import type { ReplayOutcome } from "@/core/sync/replay"

/**
 * Drawer and replay state for this window. It lives at module level (not in
 * component state) because cutting or reconnecting this window's branch
 * remounts the whole app on the other database: the open drawer, its tab and
 * an in-flight replay's progress must survive that remount. Not persisted:
 * every window keeps its own.
 */

export type PanelTab = "controls" | "scenarios" | "engine" | "data"

export type ReplayState =
  | { status: "running"; done: number; total: number; conflicts: number }
  | { status: "done"; outcome: ReplayOutcome }
  | { status: "error" }

export type NetworkAction = "cut" | "reconnect"

type DemoUiState = {
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  panelTab: PanelTab
  setPanelTab: (tab: PanelTab) => void

  streamOpen: boolean
  setStreamOpen: (open: boolean) => void
  /** Highest event seq seen in the stream, per database name */
  seen: Record<string, number>
  markSeen: (dbName: string, seq: number) => void

  replay: Partial<Record<BranchCode, ReplayState>>
  setReplay: (branch: BranchCode, state: ReplayState | undefined) => void
  pending: Partial<Record<BranchCode, NetworkAction>>
  setPending: (branch: BranchCode, action: NetworkAction | undefined) => void

  /** Patient picked in the engine check, kept while the drawer is closed */
  enginePatientId: string | null
  setEnginePatientId: (id: string | null) => void
}

export const useDemoUi = create<DemoUiState>()((set) => ({
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  panelTab: "controls",
  setPanelTab: (panelTab) => set({ panelTab }),

  streamOpen: false,
  setStreamOpen: (streamOpen) => set({ streamOpen }),
  seen: {},
  markSeen: (dbName, seq) =>
    set((state) =>
      state.seen[dbName] === seq
        ? state
        : { seen: { ...state.seen, [dbName]: seq } }
    ),

  replay: {},
  setReplay: (branch, replay) =>
    set((state) => ({ replay: { ...state.replay, [branch]: replay } })),
  pending: {},
  setPending: (branch, action) =>
    set((state) => ({ pending: { ...state.pending, [branch]: action } })),

  enginePatientId: null,
  setEnginePatientId: (enginePatientId) => set({ enginePatientId }),
}))
