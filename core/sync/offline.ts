import { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { getControlDb } from "@/core/db/control"
import { getCentralDb, getEdgeDb, type MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { commitLockName, withLock } from "@/core/engine/locks"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { publish } from "@/core/events/bus"

import { getNetworkRow } from "./network"

/** Records network changes in the central event stream. */
export const recordNetworkChange = defineCommand({
  name: "sync.networkChanged",
  roles: "any",
  input: z.object({
    branch: z.string(),
    status: z.enum(["offline", "online"]),
    count: z.number().optional(),
    conflicts: z.number().optional(),
  }),
  async run(tx, input) {
    const branchId = input.branch as BranchCode
    if (input.status === "offline") {
      tx.emit("BranchWentOffline", { branchId, params: { branch: input.branch } })
      return
    }
    tx.emit("BranchReconnected", { branchId, params: { branch: input.branch } })
    tx.emit("EdgeEventsReplayed", {
      branchId,
      params: {
        branch: input.branch,
        count: input.count ?? 0,
        conflicts: input.conflicts ?? 0,
      },
    })
  },
})

/**
 * Replace every table in `to` with the contents of `from` (the edge node's
 * starting snapshot). The outbox is never copied.
 */
export async function copyDatabase(from: MedcoreDb, to: MedcoreDb): Promise<void> {
  await from.open()
  await to.open()
  const names = from.tables.map((t) => t.name).filter((name) => name !== "outbox")
  const snapshot = await Promise.all(
    names.map(async (name) => [name, await from.table(name).toArray()] as const)
  )
  await to.transaction("rw", to.tables, async () => {
    for (const table of to.tables) await table.clear()
    for (const [name, rows] of snapshot) {
      if (rows.length) await to.table(name).bulkPut(rows)
    }
  })
}

/** Empty every table of a database (keeps the connection and schema). */
export async function clearDatabase(db: MedcoreDb): Promise<void> {
  await db.open()
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
}

/**
 * "Cut internet at <branch>" (plan §3.7). The branch edge store starts as a
 * copy of central; the branch's windows switch to it; central carries on
 * without seeing the branch's new work until reconnect.
 */
export async function cutBranch(branch: BranchCode): Promise<void> {
  const current = await getNetworkRow(branch)
  if (current.status !== "online") return
  const central = getCentralDb()
  const edge = getEdgeDb(branch)
  await withLock(commitLockName(central.name), async () => {
    await withLock(commitLockName(edge.name), () => copyDatabase(central, edge))
    const lastEvent = await central.events.orderBy("seq").last()
    await getControlDb().network.put({
      branchId: branch,
      status: "offline",
      since: now(),
      snapshotSeq: lastEvent?.seq ?? 0,
      edgeDbName: edge.name,
      queuedCount: 0,
    })
  })
  await commit(
    recordNetworkChange,
    { branch, status: "offline" },
    { db: central, actor: SYSTEM_ACTOR }
  )
  publish({ kind: "network", branchId: branch })
}
