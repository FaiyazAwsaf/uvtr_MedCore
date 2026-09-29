import type { Locale } from "@/lib/i18n/config"

export type ThemeChoice = "dark" | "light"

/**
 * Per-window state (plan §3.9). Each window, tab or Demo Wall pane has its
 * own, keyed by `window.name` in sessionStorage.
 */
export type WindowSession = {
  /** null until a persona is picked on the launcher */
  personaId: string | null
  lang: Locale
  theme: ThemeChoice
  /** Root UI scale (0.9 to 1.4); Demo Wall panes default to 0.9 */
  uiScale: number
  /** Active scenario cue card in this window, with display values from its setup */
  cue: {
    scenarioId: string
    step: number
    params?: Record<string, string | number>
  } | null
}
