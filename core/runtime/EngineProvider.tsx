"use client"

import * as React from "react"

import { startClockSync } from "@/core/clock/control"
import { runWhileLeader } from "@/core/clock/leader"
import { startSweeper } from "@/core/clock/sweeper"
import { getCentralDb, getEdgeDb } from "@/core/db/database"
import { DbProvider } from "@/core/db/DbProvider"
import { ensureSeeded } from "@/core/demo/reset"
import { subscribe } from "@/core/events/bus"
import { ensureNetworkRows, offlineBranches } from "@/core/sync/network"
import { useT } from "@/lib/i18n/provider"

function EngineLoading() {
  const t = useT()
  return (
    <div className="flex min-h-svh items-center justify-center bg-background text-sm text-muted-foreground">
      {t("shell.loadingData")}
    </div>
  )
}

/**
 * Starts the client-side engine for this window: seeds on first load, keeps
 * the demo clock in sync, runs the sweeper while this window is the leader,
 * and reloads the window after a demo reset. Renders a loading state until
 * the data is ready.
 */
export function EngineProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    ;(async () => {
      await ensureNetworkRows()
      await ensureSeeded()
      if (alive) setReady(true)
    })().catch((error) => console.error("engine start failed", error))
    return () => {
      alive = false
    }
  }, [])

  React.useEffect(() => startClockSync(), [])

  React.useEffect(
    () =>
      runWhileLeader(() =>
        startSweeper(async () => [
          getCentralDb(),
          ...(await offlineBranches()).map((branch) => getEdgeDb(branch)),
        ])
      ),
    []
  )

  React.useEffect(
    () =>
      subscribe((message) => {
        if (message.kind === "reset") window.location.reload()
      }),
    []
  )

  if (!ready) return <EngineLoading />
  return <DbProvider>{children}</DbProvider>
}
