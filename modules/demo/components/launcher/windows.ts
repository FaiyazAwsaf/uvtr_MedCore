import { HOME_ROUTE } from "@/core/rbac/routes"
import type { Role } from "@/core/rbac/types"

/**
 * Window helpers for the launcher and Demo Wall. Every window gets a stable
 * `mc-` name so its per-window session (persona, language) survives reloads
 * and re-opening the same persona reuses its window (plan §3.9).
 */

/** Landing route for a persona, with the session override the window applies. */
export function personaUrl(
  role: Role,
  personaId: string,
  extra?: Record<string, string>
): string {
  const params = new URLSearchParams({ persona: personaId, ...extra })
  return `${HOME_ROUTE[role]}?${params.toString()}`
}

export function windowNameFor(personaId: string): string {
  return `mc-win-${personaId}`
}

/** Opens (or reuses) a named window. Returns null when a pop-up blocker stopped it. */
export function openWindow(
  url: string,
  name: string,
  features?: string
): Window | null {
  const win = window.open(url, name, features)
  if (!win || win.closed || typeof win.closed === "undefined") return null
  return win
}

/** Doctor, Pharmacy, Lab and Cashier: the four-window demo layout (plan §15). */
export const DEMO_LAYOUT: { personaId: string; role: Role }[] = [
  { personaId: "per_doctor_kamal", role: "doctor" },
  { personaId: "per_pharmacist_shirin", role: "pharmacist" },
  { personaId: "per_labtech_rubel", role: "labtech" },
  { personaId: "per_cashier_rafiq", role: "cashier" },
]

/**
 * The patient app in a phone-sized window. It has its own window name, so it
 * never reuses a full-size tab opened for the same persona.
 */
export const PATIENT_APP = {
  url: "/app?persona=per_patient_tanvir",
  name: "mc-phone-per_patient_tanvir",
  features: "popup=yes,width=420,height=860",
}

export const DISPLAY_BOARD = { url: "/display/B1", name: "mc-display-B1" }

/**
 * Opens the four layout windows tiled as 960x600 quadrants of the screen
 * (smaller when the screen is smaller). Browsers allow one pop-up per click
 * unless the site is allowed, so the caller shows a hint when any is blocked.
 */
export function openDemoLayout(): { opened: number; blocked: number } {
  const screen = window.screen as Screen & {
    availLeft?: number
    availTop?: number
  }
  const width = Math.min(960, Math.floor((screen.availWidth || 1920) / 2))
  const height = Math.min(600, Math.floor((screen.availHeight || 1200) / 2))
  const originLeft = screen.availLeft ?? 0
  const originTop = screen.availTop ?? 0
  let blocked = 0
  DEMO_LAYOUT.forEach((slot, i) => {
    const left = originLeft + (i % 2) * width
    const top = originTop + Math.floor(i / 2) * height
    const win = openWindow(
      personaUrl(slot.role, slot.personaId),
      windowNameFor(slot.personaId),
      `popup=yes,left=${left},top=${top},width=${width},height=${height}`
    )
    if (!win) {
      blocked += 1
      return
    }
    try {
      // The features size the page area; this makes the whole window one quadrant.
      win.moveTo(left, top)
      win.resizeTo(width, height)
    } catch {
      // Some browsers refuse to move windows; the requested position still applies.
    }
  })
  return { opened: DEMO_LAYOUT.length - blocked, blocked }
}
