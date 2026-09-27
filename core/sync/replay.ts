import type { BranchCode } from "@/config/brand.config"
import { verifyChain } from "@/core/audit/verify"
import { now } from "@/core/clock/clock"
import { getControlDb } from "@/core/db/control"
import { getCentralDb, getEdgeDb, type MedcoreDb } from "@/core/db/database"
import { newId } from "@/core/db/ids"
import { counterKey, uhidFromSerial } from "@/core/db/numbering"
import type {
  BaseRow,
  ChangeOp,
  NotificationRow,
  Origin,
  OutboxRow,
  PatientRow,
  SmsRow,
} from "@/core/db/schema"
import { isTableName, TABLE_SPECS, type Row, type TableName } from "@/core/db/tables"
import { commit, publishCommit, toActorRef, writeCommit } from "@/core/engine/commit"
import { commitLockName, withLock } from "@/core/engine/locks"
import { TxImpl } from "@/core/engine/tx"
import { SYSTEM_ACTOR, type Actor } from "@/core/engine/types"
import { publish } from "@/core/events/bus"
import { findLikelyDuplicates } from "@/core/search/fuzzy"

import { recordNetworkChange } from "./offline"

/** Identity fields go to the data steward when both sides changed them. */
const IDENTITY_FIELDS = new Set(["nameEn", "nameBn", "dob", "sex", "nid", "brn"])
/** Contact fields: last writer wins by event time. */
const CONTACT_FIELDS = new Set(["phone", "address", "attendantPhone", "phoneVerified"])

export type ReplayProgress = { done: number; total: number; conflicts: number }

export type ReplayOutcome = {
  count: number
  conflicts: number
  skipped: number
  edgeChainOk: boolean
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

async function replayInsert(
  tx: TxImpl,
  op: Extract<ChangeOp, { kind: "insert" }>,
  entry: OutboxRow,
  branch: BranchCode
): Promise<number> {
  const table = op.table as TableName
  if (await tx.find(table, op.row.id)) return 0 // already applied: idempotent

  let row: BaseRow = { ...op.row }
  // Messages and app notifications held offline are released on central confirmation.
  if (table === "sms" && (row as SmsRow).status === "held-offline") {
    row = { ...row, status: "queued" } as SmsRow
  }
  if (table === "notifications" && (row as NotificationRow).held) {
    row = { ...row, held: false } as NotificationRow
  }

  if (table === "patients") {
    const patient = row as PatientRow
    let { uhid, aliases } = patient
    if (patient.uhid.startsWith("P-")) {
      uhid = uhidFromSerial(await tx.nextNumber(counterKey.uhid()))
      aliases = [...aliases, patient.uhid]
    }
    const active = await tx.list("patients", "identityStatus", "active")
    const candidates = findLikelyDuplicates(
      {
        nameEn: patient.nameEn,
        dob: patient.dob,
        phone: patient.phone,
        nid: patient.nid,
        brn: patient.brn,
      },
      active,
      { excludeId: patient.id }
    )
    if (candidates.length) {
      tx.insertRaw(
        "patients",
        { ...patient, uhid, aliases, identityStatus: "under-review" },
        entry.at
      )
      const review = tx.insert("reviewQueue", {
        kind: "sync-duplicate",
        branchId: branch,
        patientIds: [patient.id, ...candidates.map((c) => c.patientId)],
        status: "open",
        detail: candidates
          .map((c) => `${c.patientId}:${c.score}:${c.reasons.join("+")}`)
          .join(" "),
      })
      tx.emit("IdentityConflictQueued", {
        branchId: branch,
        refs: { patientId: patient.id, reviewId: review.id },
        params: { candidates: candidates.length },
      })
      return 1
    }
    tx.insertRaw("patients", { ...patient, uhid, aliases }, entry.at)
    return 0
  }

  tx.insertRaw(table, row as Row<TableName>, entry.at)
  return 0
}

async function replayUpdate(
  tx: TxImpl,
  op: Extract<ChangeOp, { kind: "update" }>,
  entry: OutboxRow,
  branch: BranchCode
): Promise<number> {
  const table = op.table as TableName
  const central = (await tx.find(table, op.id)) as Record<string, unknown> | undefined
  if (!central) {
    tx.insert("syncExceptions", {
      kind: "version-conflict",
      branchId: branch,
      table,
      rowId: op.id,
      detail: "Row missing on central",
      status: "open",
    })
    return 1
  }
  const deltaFields = new Set(TABLE_SPECS[table].deltaFields ?? [])
  const after = op.after as unknown as Record<string, unknown>
  const centralMoved = (central.version as number) !== op.baseVersion
  const patch: Record<string, unknown> = {}
  const identityConflicts: { field: string; edgeValue: unknown; centralValue: unknown }[] = []
  const overwritten: string[] = []

  for (const [field, edgeBefore] of Object.entries(op.before)) {
    const edgeAfter = after[field]
    const centralNow = central[field]
    if (deltaFields.has(field)) {
      // Counters merge as deltas: both sides' movements are facts.
      patch[field] = (centralNow as number) + ((edgeAfter as number) - (edgeBefore as number))
      continue
    }
    if (!centralMoved || same(centralNow, edgeBefore)) {
      patch[field] = edgeAfter
      continue
    }
    if (table === "patients" && IDENTITY_FIELDS.has(field)) {
      identityConflicts.push({ field, edgeValue: edgeAfter, centralValue: centralNow })
      continue
    }
    if (table === "patients" && CONTACT_FIELDS.has(field)) {
      if (entry.at >= (central.updatedAt as number)) patch[field] = edgeAfter
      continue
    }
    patch[field] = edgeAfter
    overwritten.push(field)
  }

  if (Object.keys(patch).length) {
    await tx.update(table, op.id, patch as never)
  }
  if (identityConflicts.length) {
    const review = tx.insert("reviewQueue", {
      kind: "identity-conflict",
      branchId: branch,
      patientIds: [op.id],
      fields: identityConflicts,
      status: "open",
    })
    tx.emit("IdentityConflictQueued", {
      branchId: branch,
      refs: { patientId: op.id, reviewId: review.id },
      params: { candidates: 0 },
    })
  }
  if (overwritten.length) {
    tx.insert("syncExceptions", {
      kind: "version-conflict",
      branchId: branch,
      table,
      rowId: op.id,
      detail: `Edge value applied over a newer central change: ${overwritten.join(", ")}`,
      status: "open",
    })
  }
  return identityConflicts.length ? 1 : 0
}

async function replayDelete(
  tx: TxImpl,
  op: Extract<ChangeOp, { kind: "delete" }>
): Promise<void> {
  const table = op.table as TableName
  if (await tx.find(table, op.id)) await tx.remove(table, op.id)
}

/**
 * Apply one outbox entry to central as one atomic commit. Idempotent: an
 * entry whose commit id is already recorded in `appliedCommits` is skipped.
 */
export async function replayEntry(
  central: MedcoreDb,
  entry: OutboxRow,
  branch: BranchCode
): Promise<{ applied: boolean; conflicts: number }> {
  const origin: Origin = `edge:${branch}`
  const outcome = await withLock(commitLockName(central.name), async () => {
    if (await central.appliedCommits.get(entry.commitId)) {
      return { applied: false, conflicts: 0, events: [], commitId: "" }
    }
    // Rules were enforced on the edge when the work happened; replay applies facts.
    const actor: Actor = { ...entry.actor, authorities: ["*"] }
    const tx = new TxImpl(central, actor, newId("cm"), now(), origin, true)
    let conflicts = 0
    for (const op of entry.ops) {
      if (!isTableName(op.table)) continue
      if (op.kind === "insert") conflicts += await replayInsert(tx, op, entry, branch)
      else if (op.kind === "update") conflicts += await replayUpdate(tx, op, entry, branch)
      else await replayDelete(tx, op)
    }
    // Stock that ends negative is reported, never reversed (PRD §16).
    for (const change of tx.changes()) {
      if (change.table !== "stockLevels" || !change.after) continue
      const level = change.after as Row<"stockLevels">
      if (level.qty < 0) {
        tx.insert("syncExceptions", {
          kind: "stock-negative",
          branchId: branch,
          table: "stockLevels",
          rowId: level.id,
          detail: `Stock for ${level.brandId} at ${level.branchId} is ${level.qty} after replay`,
          status: "open",
        })
      }
    }
    const events = await writeCommit(central, tx, {
      command: entry.command,
      actor: toActorRef(entry.actor),
      origin,
      emitted: tx.pendingEvents,
      emittedOrigin: "central",
      carriedEvents: entry.events,
      originAt: entry.at,
      appliedCommit: { commitId: entry.commitId, origin },
    })
    return { applied: true, conflicts, events, commitId: tx.commitId }
  })
  if (outcome.applied) {
    publishCommit(central, entry.command, entry.actor, outcome.commitId, outcome.events)
  }
  return { applied: outcome.applied, conflicts: outcome.conflicts }
}

/** Counters never go backwards: central keeps the higher of the two values. */
async function mergeCounters(edge: MedcoreDb, central: MedcoreDb): Promise<void> {
  await withLock(commitLockName(central.name), async () => {
    const edgeCounters = await edge.counters.toArray()
    const centralCounters = new Map(
      (await central.counters.toArray()).map((c) => [c.id, c.value])
    )
    const raised = edgeCounters.filter((c) => c.value > (centralCounters.get(c.id) ?? 0))
    if (raised.length) await central.counters.bulkPut(raised)
  })
}

/**
 * Reconnect a branch (plan §3.7): replay its outbox onto central in edge order,
 * merge counters, bring it back online and switch its windows to central.
 */
export async function reconnectBranch(
  branch: BranchCode,
  onProgress?: (progress: ReplayProgress) => void
): Promise<ReplayOutcome> {
  const control = getControlDb()
  const row = await control.network.get(branch)
  if (!row || row.status === "online") {
    return { count: 0, conflicts: 0, skipped: 0, edgeChainOk: true }
  }
  await control.network.put({ ...row, status: "syncing" })
  publish({ kind: "network", branchId: branch })

  const central = getCentralDb()
  const edge = getEdgeDb(branch)
  const edgeChain = await verifyChain(edge)
  const entries = await edge.outbox.orderBy("seq").toArray()
  let conflicts = 0
  let skipped = 0
  for (let i = 0; i < entries.length; i++) {
    const result = await replayEntry(central, entries[i], branch)
    conflicts += result.conflicts
    if (!result.applied) skipped += 1
    onProgress?.({ done: i + 1, total: entries.length, conflicts })
  }
  await mergeCounters(edge, central)

  await control.network.put({
    branchId: branch,
    status: "online",
    queuedCount: 0,
    lastReplay: { count: entries.length, conflicts, at: now() },
  })
  await commit(
    recordNetworkChange,
    { branch, status: "online", count: entries.length, conflicts },
    { db: central, actor: SYSTEM_ACTOR }
  )
  // The edge store is left as is: branch windows may still be switching back,
  // and the next cut wipes and re-copies it (replay is idempotent regardless).
  publish({ kind: "network", branchId: branch })
  return { count: entries.length, conflicts, skipped, edgeChainOk: edgeChain.ok }
}
