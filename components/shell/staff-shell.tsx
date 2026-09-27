"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { AccessDenied, NoPersonaScreen } from "@/components/shell/access"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { CommandPalette, useShellHotkeys } from "@/components/shell/command-palette"
import { CueCard } from "@/components/shell/demo/cue-card"
import { OfflineBanner } from "@/components/shell/network"
import { TopBar } from "@/components/shell/top-bar"
import { canAccess } from "@/core/rbac/routes"
import { usePersona } from "@/core/session/persona"

/**
 * The staff app frame (docs/ui_guidelines.md §3): sidebar, top bar, the
 * offline banner and the scrolling content area, plus the command palette and
 * the scenario cue card. Guards the route: no persona shows a prompt, an
 * off-role route shows AccessDenied inside the frame.
 */
export function StaffShell({ children }: { children: React.ReactNode }) {
  const persona = usePersona()
  const pathname = usePathname()
  useShellHotkeys()

  if (!persona) return <NoPersonaScreen pathname={pathname} />

  const allowed = canAccess(persona.role, pathname)

  return (
    <div
      data-slot="staff-shell"
      className="flex h-svh w-full overflow-hidden bg-background text-foreground"
    >
      <AppSidebar persona={persona} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar persona={persona} />
        <OfflineBanner />
        <main
          id="main"
          className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 pt-2 pb-6 xl:px-6"
        >
          {allowed ? (
            children
          ) : (
            <AccessDenied persona={persona} pathname={pathname} />
          )}
        </main>
      </div>
      <CommandPalette persona={persona} />
      <CueCard />
    </div>
  )
}
