"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import type { BranchCode } from "@/config/brand.config"
import { usePersona } from "@/core/session/persona"

import { getControlDb } from "./control"
import { getCentralDb, getEdgeDb, type MedcoreDb } from "./database"
import type { NetworkRow } from "./schema"

export type DbInfo = {
  /** The database this window reads and writes */
  db: MedcoreDb
  /** True while this window's branch is offline (working on its edge store) */
  isEdge: boolean
  /** This window's branch (null for network-level personas and no persona) */
  branch: BranchCode | null
  /** Every branch's network state */
  network: NetworkRow[]
}

const DbContext = React.createContext<DbInfo | null>(null)

/**
 * Chooses this window's database (plan §3.2): central normally, the branch's
 * edge store while that branch is offline. The subtree remounts when it
 * switches, so every live query re-subscribes to the right store.
 */
export function DbProvider({ children }: { children: React.ReactNode }) {
  const persona = usePersona()
  const branch = persona?.branchId ?? null
  // undefined until the first read: render nothing rather than briefly
  // showing central data in a window whose branch is offline.
  const network = useLiveQuery(() => getControlDb().network.toArray(), [])
  const isEdge =
    !!branch &&
    !!network?.some((n) => n.branchId === branch && n.status !== "online")
  const db = isEdge && branch ? getEdgeDb(branch) : getCentralDb()
  const value = React.useMemo<DbInfo>(
    () => ({ db, isEdge, branch, network: network ?? [] }),
    [db, isEdge, branch, network]
  )
  if (!network) return null
  return (
    <DbContext.Provider value={value}>
      <React.Fragment key={db.name}>{children}</React.Fragment>
    </DbContext.Provider>
  )
}

export function useDbInfo(): DbInfo {
  const context = React.useContext(DbContext)
  if (!context) throw new Error("useDbInfo must be used inside <DbProvider>")
  return context
}

/** The database this window reads and writes. Use with `useLiveQuery`. */
export function useDb(): MedcoreDb {
  return useDbInfo().db
}
