"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import type { BranchCode } from "@/config/brand.config"
import { dhakaDate } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import type { NavItem } from "@/core/rbac/types"
import type { PersonaSeed } from "@/core/seed/content/personas"

type CountContext = {
  db: MedcoreDb
  staffId: string | null
  branch: BranchCode | null
  today: string
}

type CountQuery = (ctx: CountContext) => Promise<number>

async function doctorIdOf(ctx: CountContext): Promise<string | undefined> {
  if (!ctx.staffId) return undefined
  return (await ctx.db.doctors.where("staffId").equals(ctx.staffId).first())?.id
}

/**
 * Live counts for the sidebar's yellow badges, keyed by nav href. Each is one
 * or two indexed reads, so every window can run them on every commit. Routes
 * without an entry simply show no badge; add entries here as worklists land.
 */
const NAV_COUNTS: Record<string, CountQuery> = {
  /** Patients waiting in this doctor's sessions today */
  "/doctor": async (ctx) => {
    const doctorId = await doctorIdOf(ctx)
    if (!doctorId) return 0
    const sessions = await ctx.db.sessions
      .where("[doctorId+date]")
      .equals([doctorId, ctx.today])
      .toArray()
    let waiting = 0
    for (const session of sessions) {
      waiting += await ctx.db.queueTokens
        .where("[sessionId+status]")
        .equals([session.id, "waiting"])
        .count()
    }
    return waiting
  },
  /** Unread results, corrections and substitution requests */
  "/doctor/inbox": async (ctx) => {
    const doctorId = await doctorIdOf(ctx)
    if (!doctorId) return 0
    return ctx.db.inboxItems.where("[doctorId+status]").equals([doctorId, "unread"]).count()
  },
  /** Prescriptions waiting at this branch's pharmacy */
  "/pharmacy": async (ctx) =>
    ctx.branch
      ? ctx.db.pharmacyQueue.where("[branchId+status]").equals([ctx.branch, "waiting"]).count()
      : 0,
  /** Paid samples waiting to be collected */
  "/lab": async (ctx) =>
    ctx.branch
      ? ctx.db.specimens
          .where("[branchId+status]")
          .equals([ctx.branch, "awaiting-collection"])
          .count()
      : 0,
  /** Validated results waiting for the pathologist's sign-off */
  "/pathology": async (ctx) =>
    ctx.branch
      ? ctx.db.labOrderItems
          .where("[branchId+status]")
          .equals([ctx.branch, "validated"])
          .count()
      : 0,
  /** Possible duplicates and identity conflicts to resolve */
  "/reception/review": async (ctx) => {
    const open = await ctx.db.reviewQueue.where("status").equals("open").toArray()
    return open.filter((item) => !ctx.branch || item.branchId === ctx.branch).length
  },
  /** Purchase requests submitted for approval */
  "/store/approvals": async (ctx) => {
    const submitted = await ctx.db.purchaseRequests.where("status").equals("submitted").toArray()
    return submitted.filter((pr) => !ctx.branch || pr.branchId === ctx.branch).length
  },
}

/** Badge counts for a role's nav items, live across windows. */
export function useNavCounts(
  items: NavItem[],
  persona: PersonaSeed | null
): Record<string, number> {
  const db = useDb()
  // The demo day moves with the clock (fast-forward past midnight).
  const today = dhakaDate(useNow(60_000) || now())
  const hrefs = React.useMemo(
    () => items.map((item) => item.href).filter((href) => href in NAV_COUNTS),
    [items]
  )
  const staffId = persona?.staff?.id ?? null
  const branch = persona?.branchId ?? null
  const counts = useLiveQuery(async () => {
    const ctx: CountContext = { db, staffId, branch, today }
    const entries = await Promise.all(
      hrefs.map(async (href) => {
        try {
          return [href, await NAV_COUNTS[href](ctx)] as const
        } catch {
          return [href, 0] as const
        }
      })
    )
    return Object.fromEntries(entries) as Record<string, number>
  }, [db, hrefs, staffId, branch, today])
  return counts ?? {}
}
