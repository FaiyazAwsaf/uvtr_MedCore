"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import type { BranchCode } from "@/config/brand.config"
import { dhakaDate } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import { mayApprovePr } from "@/core/procurement/rules"
import type { NavItem } from "@/core/rbac/types"
import type { PersonaSeed } from "@/core/seed/content/personas"

type CountContext = {
  db: MedcoreDb
  staffId: string | null
  branch: BranchCode | null
  authorities: readonly string[]
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
  /** Brands at or below their reorder level at this branch (objective §3D) */
  "/store": async (ctx) => {
    if (!ctx.branch) return 0
    const onHand = new Map<string, number>()
    for (const level of await ctx.db.stockLevels.where("branchId").equals(ctx.branch).toArray()) {
      onHand.set(level.brandId, (onHand.get(level.brandId) ?? 0) + Math.max(0, level.qty))
    }
    const reorder = await ctx.db.reorderLevels.where("branchId").equals(ctx.branch).toArray()
    return reorder.filter((r) => (onHand.get(r.brandId) ?? 0) <= r.reorderLevel).length
  },
  /** Purchase requests this person may decide (by value tier, never their own) */
  "/store/approvals": async (ctx) => approvableCount(ctx),
  "/finance/approvals": async (ctx) => approvableCount(ctx),
  /** Purchase orders at this branch still waiting for goods */
  "/store/grn": async (ctx) => {
    if (!ctx.branch) return 0
    const pos = await ctx.db.purchaseOrders.where("branchId").equals(ctx.branch).toArray()
    return pos.filter((po) => po.status === "issued" || po.status === "partial").length
  },
  /** Vendor invoices that failed the three-way match */
  "/finance/match": async (ctx) =>
    ctx.db.threeWayMatches.where("status").equals("mismatch").count(),
  /** Settlement lines with no payment and no note yet */
  "/finance/mfs": async (ctx) => {
    const files = await ctx.db.mfsSettlements.toArray()
    return files
      .filter((f) => f.status !== "pending-import")
      .reduce((n, f) => n + f.lines.filter((l) => !l.matchedPaymentId && !l.note).length, 0)
  },
  /** Vendor payables past their due date */
  "/finance/payables": async (ctx) => {
    const payables = await ctx.db.payables.toArray()
    return payables.filter((p) => p.status !== "paid" && p.dueDate < ctx.today).length
  },
  /** Inpatient stays at this branch whose deposit is running low */
  "/cashier/deposits": async (ctx) => {
    if (!ctx.branch) return 0
    const stays = await ctx.db.admissions.where("branchId").equals(ctx.branch).toArray()
    return stays.filter((a) => a.status === "admitted" && a.depositAlertAt !== undefined).length
  },
  /** Beds at this branch waiting to be made ready */
  "/reception/inpatient": async (ctx) => {
    if (!ctx.branch) return 0
    const beds = await ctx.db.beds.where("branchId").equals(ctx.branch).toArray()
    return beds.filter((b) => b.status === "cleaning").length
  },
}

/** Submitted purchase requests the persona may approve; branch personas see their own branch only. */
async function approvableCount(ctx: CountContext): Promise<number> {
  if (!ctx.staffId) return 0
  const submitted = await ctx.db.purchaseRequests.where("status").equals("submitted").toArray()
  const approver = { id: ctx.staffId, authorities: ctx.authorities }
  return submitted.filter(
    (pr) => (!ctx.branch || pr.branchId === ctx.branch) && mayApprovePr(approver, pr)
  ).length
}

const NO_AUTHORITIES: readonly string[] = []

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
  const authorities = persona?.staff?.authorities ?? NO_AUTHORITIES
  const counts = useLiveQuery(async () => {
    const ctx: CountContext = { db, staffId, branch, authorities, today }
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
  }, [db, hrefs, staffId, branch, authorities, today])
  return counts ?? {}
}
