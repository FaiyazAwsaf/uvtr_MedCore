"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type { MedicineCatalog } from "@/core/search/medicines"

import { buildLibraryIndex, loadCatalog, type LibraryIndex } from "./catalog"
import { withRxParams } from "./paths"

/*
 * The last catalogue read per database, used as the first render's value so
 * a page or picker that mounts again (navigation, a new Rx line) shows its
 * data at once while the live query re-reads in the background.
 */
const lastCatalog = new Map<string, MedicineCatalog>()
const indexes = new WeakMap<MedicineCatalog, LibraryIndex>()

/** The whole medicine dictionary, live (undefined only on a window's very first read). */
export function useMedicineCatalog(): MedicineCatalog | undefined {
  const db = useDb()
  return useLiveQuery(
    async () => {
      const catalog = await loadCatalog(db)
      lastCatalog.set(db.name, catalog)
      return catalog
    },
    [db],
    lastCatalog.get(db.name)
  )
}

/** The dictionary with its lookup maps and alphabetical lists. */
export function useLibraryIndex(): LibraryIndex | undefined {
  const catalog = useMedicineCatalog()
  return React.useMemo(() => {
    if (!catalog) return undefined
    let index = indexes.get(catalog)
    if (!index) {
      index = buildLibraryIndex(catalog)
      indexes.set(catalog, index)
    }
    return index
  }, [catalog])
}

/** Rx-pad mode: the encounter this library window was opened from, or null. */
export function useRxEncounter(): string | null {
  const params = useSearchParams()
  return params.get("from") === "rx" ? params.get("encounter") || null : null
}

/** Builds library links that keep Rx-pad mode on. */
export function useLibraryHref(): (path: string) => string {
  const encounterId = useRxEncounter()
  return React.useCallback((path: string) => withRxParams(path, encounterId), [encounterId])
}

/**
 * Writes view state (the query, the browse tab and letter) into the address
 * without a navigation, so Back from a medicine page restores the list.
 */
export function writeUrlParams(patch: Record<string, string | null>): void {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(patch)) {
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
  }
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, "", url.toString())
  }
}
