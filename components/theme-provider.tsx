"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

import { updateSession, useSession } from "@/core/session/session"
import type { ThemeChoice } from "@/core/session/types"

/**
 * Theme is per window (plan §3.9): it lives in this window's session, not in
 * next-themes' localStorage key, because Demo Wall iframes share localStorage
 * and would otherwise flip each other's theme. next-themes still does the DOM
 * work (class on <html>, color-scheme, no transitions while switching), driven
 * through `forcedTheme`, so its storage is never read.
 */
function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useSession()
  return (
    <NextThemesProvider
      attribute="class"
      themes={["light", "dark"]}
      defaultTheme="dark"
      forcedTheme={theme}
      enableSystem={false}
      disableTransitionOnChange
      storageKey="mc:theme-unused"
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

/** This window's theme and a setter that writes the window session. */
function useWindowTheme(): {
  theme: ThemeChoice
  setTheme: (theme: ThemeChoice) => void
  toggleTheme: () => void
} {
  const { theme } = useSession()
  return React.useMemo(
    () => ({
      theme,
      setTheme: (next: ThemeChoice) => updateSession({ theme: next }),
      toggleTheme: () =>
        updateSession({ theme: theme === "dark" ? "light" : "dark" }),
    }),
    [theme]
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

/** Pressing "d" (outside a text field) flips this window's theme. */
function ThemeHotkey() {
  const { toggleTheme } = useWindowTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() !== "d") return
      if (isTypingTarget(event.target)) return
      toggleTheme()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggleTheme])

  return null
}

export { ThemeProvider, useWindowTheme }
