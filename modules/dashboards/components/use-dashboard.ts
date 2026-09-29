"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import { useDb } from "@/core/db/DbProvider"
import type { ISODate } from "@/core/db/schema"

import {
  baselineAsAt,
  dayRowOf,
  todayRows,
  type DayRow,
} from "../metrics"
import {
  loadBalances,
  loadDailyStats,
  loadExceptions,
  loadLiveFacts,
  loadSpecialtyNames,
  loadStock,
} from "../queries"

/**
 * The dashboard's live reads, one query per concern so a change re-runs only
 * what it touches, and the day rows (history from daily stats, today as the
 * baseline plus live records). History is memoised on its own: a checkout
 * re-computes only today's handful of rows.
 */
export function useDashboardData(today: ISODate) {
  const db = useDb()
  const stats = useLiveQuery(() => loadDailyStats(db, today), [db, today])
  const live = useLiveQuery(() => loadLiveFacts(db, today), [db, today])
  const stock = useLiveQuery(() => loadStock(db), [db])
  const balances = useLiveQuery(() => loadBalances(db, today), [db, today])
  const exceptions = useLiveQuery(() => loadExceptions(db), [db])
  const specialties = useLiveQuery(() => loadSpecialtyNames(db), [db])

  const history = React.useMemo<DayRow[] | undefined>(
    () => stats?.filter((s) => s.date !== today).map(dayRowOf),
    [stats, today]
  )
  const baseline = React.useMemo(
    () => stats?.filter((s) => s.date === today),
    [stats, today]
  )
  const current = React.useMemo<DayRow[] | undefined>(
    () => (baseline && live ? todayRows(baseline, live, today) : undefined),
    [baseline, live, today]
  )
  const rows = React.useMemo<DayRow[] | undefined>(
    () => (history && current ? [...history, ...current] : undefined),
    [history, current]
  )
  const asAt = React.useMemo(
    () => (baseline ? baselineAsAt(baseline, today) : undefined),
    [baseline, today]
  )

  return { rows, asAt, stock, balances, exceptions, specialties }
}
