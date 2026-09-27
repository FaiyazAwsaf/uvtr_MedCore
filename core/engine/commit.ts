import Dexie, { type Table } from "dexie"
import type { z } from "zod"

import { chainAudit, GENESIS_HASH, type UnchainedAudit } from "@/core/audit/chain"
import { now } from "@/core/clock/clock"
import type { MedcoreDb } from "@/core/db/database"
import { newId } from "@/core/db/ids"
import type {
  ActorRef,
  AuditRow,
  BaseRow,
  ChangeOp,
  EventRow,
  Id,
  Ms,
  Origin,
} from "@/core/db/schema"
import { TABLE_SPECS, type TableName } from "@/core/db/tables"
import { publish } from "@/core/events/bus"
import { EVENT_CATALOG } from "@/core/events/registry"

import {
  ConflictError,
  NotFoundError,
  PermissionDenied,
  RuleViolation,
  ValidationError,
} from "./errors"
import { changedFields, runInvariants } from "./invariants"
import { commitLockName, withLock } from "./locks"
import { TxImpl } from "./tx"
import type { Actor, Change, CommandDef, CommitResult, Tx } from "./types"

/* ================================================================== *
 * Helpers shared with offline replay
 * ================================================================== */

export function toActorRef(actor: ActorRef): ActorRef {
  const { staffId, personaId, role, branchId, name } = actor
  return { staffId, personaId, role, branchId, name }
}

export function originFor(db: MedcoreDb): Origin {
  return db.kind === "edge" && db.edgeBranch ? `edge:${db.edgeBranch}` : "central"
}

const BASE_KEYS = new Set([
  "id",
  "version",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "origin",
  "originAt",
])

function domainFields(row: BaseRow): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (!BASE_KEYS.has(key)) out[key] = value
  }
  return out
}

function pick(row: BaseRow, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) out[field] = (row as Record<string, unknown>)[field]
  return out
}

function patientIdOf(table: TableName, row: BaseRow | undefined): Id | undefined {
  const field = TABLE_SPECS[table].patientField
  if (!field || !row) return undefined
  const value = (row as Record<string, unknown>)[field]
  return typeof value === "string" ? value : undefined
}

/** Audit rows for a set of changes (before chaining). */
export function auditRowsFor(
  changes: readonly Change[],
  meta: {
    commitId: Id
    command: string
    at: Ms
    actor: ActorRef
    origin: Origin
    reason?: string
    approvedBy?: Id
  }
): UnchainedAudit[] {
  const rows: UnchainedAudit[] = []
  for (const change of changes) {
    const common = {
      commitId: meta.commitId,
      command: meta.command,
      at: meta.at,
      actor: meta.actor,
      entity: change.table,
      entityId: change.id,
      patientId: patientIdOf(change.table, change.after ?? change.before),
      reason: meta.reason,
      approvedBy: meta.approvedBy,
      origin: meta.origin,
    }
    if (change.kind === "insert" && change.after) {
      rows.push({ ...common, action: "insert", after: domainFields(change.after) })
    } else if (change.kind === "update" && change.before && change.after) {
      const fields = changedFields(change.before, change.after)
      if (!fields.length) continue
      rows.push({
        ...common,
        action: "update",
        before: pick(change.before, fields),
        after: pick(change.after, fields),
      })
    } else if (change.kind === "delete" && change.before) {
      rows.push({ ...common, action: "delete", before: domainFields(change.before) })
    }
  }
  return rows
}

/** Outbox ops for an edge commit (plan §3.7). */
export function opsFor(changes: readonly Change[]): ChangeOp[] {
  return changes.map((change): ChangeOp => {
    if (change.kind === "insert") {
      return { kind: "insert", table: change.table, row: change.after! }
    }
    if (change.kind === "update") {
      const fields = changedFields(change.before!, change.after!)
      return {
        kind: "update",
        table: change.table,
        id: change.id,
        baseVersion: change.before!.version,
        before: pick(change.before!, fields),
        after: change.after!,
      }
    }
    return { kind: "delete", table: change.table, id: change.id, before: change.before! }
  })
}

type WriteMeta = {
  command: string
  actor: ActorRef
  origin: Origin
  /** Events built from tx.emit() */
  emitted: TxImpl["pendingEvents"]
  /** Pre-built events carried over by replay (re-sequenced here) */
  carriedEvents?: EventRow[]
  /**
   * Origin for events emitted in this commit, when it differs from `origin`.
   * Replay passes "central": decisions made while syncing happen centrally.
   */
  emittedOrigin?: Origin
  originAt?: Ms
  idempotency?: { key: string; result: unknown }
  appliedCommit?: { commitId: Id; origin: Origin }
}

/**
 * Apply one transaction's buffered changes, events, audit rows, counters,
 * idempotency record and (on edge) outbox entry in ONE IndexedDB transaction.
 * Must be called while holding the commit lock.
 */
export async function writeCommit(
  db: MedcoreDb,
  tx: TxImpl,
  meta: WriteMeta
): Promise<EventRow[]> {
  const changes = tx.changes()
  const at = tx.now()

  const lastEvent = await db.events.orderBy("seq").last()
  let seq = lastEvent?.seq ?? 0
  const events: EventRow[] = []
  for (const pending of meta.emitted) {
    const def = EVENT_CATALOG[pending.type]
    const opts = pending.opts
    seq += 1
    events.push({
      seq,
      id: newId("ev"),
      type: pending.type,
      v: opts.v ?? 1,
      at,
      realAt: Date.now(),
      actor: meta.actor,
      branchId: opts.branchId !== undefined ? opts.branchId : meta.actor.branchId,
      patientId: opts.refs?.patientId,
      refs: opts.refs ?? {},
      summaryKey: def?.labelKey ?? `events.${pending.type}`,
      params: opts.params ?? {},
      consumers: def?.consumers ?? [],
      commitId: tx.commitId,
      command: meta.command,
      origin: meta.emittedOrigin ?? meta.origin,
      originAt: meta.emittedOrigin ? undefined : meta.originAt,
    })
  }
  for (const carried of meta.carriedEvents ?? []) {
    seq += 1
    events.push({
      ...carried,
      seq,
      originAt: carried.originAt ?? carried.at,
      replayedAt: at,
    })
  }

  const lastAudit = await db.audit.orderBy("seq").last()
  const audit: AuditRow[] = chainAudit(
    auditRowsFor(changes, {
      commitId: tx.commitId,
      command: meta.command,
      at: meta.originAt ?? at,
      actor: meta.actor,
      origin: meta.origin,
      reason: tx.auditCtx.reason,
      approvedBy: tx.auditCtx.approvedBy,
    }),
    { seq: lastAudit?.seq ?? 0, hash: lastAudit?.hash ?? GENESIS_HASH }
  )

  const byTable = new Map<TableName, Change[]>()
  for (const change of changes) {
    const list = byTable.get(change.table) ?? []
    list.push(change)
    byTable.set(change.table, list)
  }

  const counters = [...tx.counters()].map(([id, value]) => ({ id, value }))
  const tables: Table[] = [...byTable.keys()].map((name) => db.t(name) as Table)
  tables.push(db.events, db.audit, db.counters)
  if (meta.idempotency) tables.push(db.idempotency)
  if (meta.appliedCommit) tables.push(db.appliedCommits)
  const writeOutbox = db.kind === "edge" && changes.length > 0
  if (writeOutbox) tables.push(db.outbox)

  await db.transaction("rw", tables, async () => {
    for (const [name, list] of byTable) {
      const table = db.t(name)
      const puts = list.filter((c) => c.kind !== "delete").map((c) => c.after!)
      const deletes = list.filter((c) => c.kind === "delete").map((c) => c.id)
      if (puts.length) await table.bulkPut(puts as never[])
      if (deletes.length) await table.bulkDelete(deletes)
    }
    if (events.length) await db.events.bulkAdd(events)
    if (audit.length) await db.audit.bulkAdd(audit)
    if (counters.length) await db.counters.bulkPut(counters)
    if (meta.idempotency) {
      await db.idempotency.put({
        key: meta.idempotency.key,
        commitId: tx.commitId,
        command: meta.command,
        result: meta.idempotency.result,
        at,
      })
    }
    if (meta.appliedCommit) {
      await db.appliedCommits.put({
        commitId: meta.appliedCommit.commitId,
        appliedAt: at,
        origin: meta.appliedCommit.origin,
      })
    }
    if (writeOutbox) {
      const lastOut = await db.outbox.orderBy("seq").last()
      await db.outbox.add({
        seq: (lastOut?.seq ?? 0) + 1,
        commitId: tx.commitId,
        command: meta.command,
        actor: meta.actor,
        at,
        ops: opsFor(changes),
        events,
        audit,
      })
    }
  })
  return events
}

/** Insert-time guard: explicit ids must not collide with committed rows. */
async function checkNewIds(tx: TxImpl): Promise<void> {
  const byTable = new Map<TableName, Id[]>()
  for (const change of tx.changes()) {
    if (change.kind !== "insert") continue
    const ids = byTable.get(change.table) ?? []
    ids.push(change.id)
    byTable.set(change.table, ids)
  }
  for (const [table, ids] of byTable) {
    const existing = await tx.db.t(table).bulkGet(ids)
    const clash = existing.findIndex((row) => row !== undefined)
    if (clash >= 0) throw new RuleViolation("DUPLICATE_ID", { table, id: ids[clash] })
  }
}

function translateStorageError(error: unknown): unknown {
  if (error instanceof Dexie.ConstraintError || (error as Error)?.name === "ConstraintError") {
    return new RuleViolation("UNIQUE_CONSTRAINT", {
      detail: (error as Error).message?.slice(0, 120) ?? "",
    })
  }
  const inner = (error as { inner?: unknown } | null)?.inner
  if (error instanceof Dexie.AbortError && inner) {
    return translateStorageError(inner)
  }
  return error
}

export function publishCommit(
  db: MedcoreDb,
  command: string,
  actor: ActorRef,
  commitId: Id,
  events: EventRow[]
): void {
  publish({
    kind: "commit",
    db: db.name,
    commitId,
    command,
    branchId: actor.branchId,
    events: events.map((e) => ({
      seq: e.seq,
      type: e.type,
      summaryKey: e.summaryKey,
      params: e.params,
      refs: e.refs,
      patientId: e.patientId,
    })),
  })
}

/* ================================================================== *
 * Blocked attempts (audited rejections)
 * ================================================================== */

/**
 * Records a refused attempt as its own tiny commit: one "blocked" audit row
 * and a RuleViolationBlocked event. The refused command itself wrote nothing.
 */
export async function recordBlocked(
  db: MedcoreDb,
  actor: ActorRef,
  command: string,
  code: string,
  params: Record<string, string | number>
): Promise<void> {
  const actorRef = toActorRef(actor)
  const origin = originFor(db)
  const commitId = newId("cm")
  const events = await withLock(commitLockName(db.name), async () => {
    const at = now()
    const lastAudit = await db.audit.orderBy("seq").last()
    const lastEvent = await db.events.orderBy("seq").last()
    const [row] = chainAudit(
      [
        {
          commitId,
          command,
          at,
          actor: actorRef,
          action: "blocked",
          entity: "command",
          entityId: command,
          after: params,
          code,
          origin,
        },
      ],
      { seq: lastAudit?.seq ?? 0, hash: lastAudit?.hash ?? GENESIS_HASH }
    )
    const def = EVENT_CATALOG.RuleViolationBlocked
    const event: EventRow = {
      seq: (lastEvent?.seq ?? 0) + 1,
      id: newId("ev"),
      type: "RuleViolationBlocked",
      v: 1,
      at,
      realAt: Date.now(),
      actor: actorRef,
      branchId: actorRef.branchId,
      refs: {},
      summaryKey: def?.labelKey ?? "events.RuleViolationBlocked",
      params: { code, command, ...params },
      consumers: def?.consumers ?? [],
      commitId,
      command,
      origin,
    }
    await db.transaction("rw", [db.audit, db.events], async () => {
      await db.audit.add(row)
      await db.events.add(event)
    })
    return [event]
  })
  publishCommit(db, command, actorRef, commitId, events)
}

/* ================================================================== *
 * commit()
 * ================================================================== */

function mayRun(roles: CommandDef<z.ZodType, unknown>["roles"], actor: Actor) {
  return actor.role === "system" || roles === "any" || roles.includes(actor.role as never)
}

function idempotencyKeyOf(input: unknown): string | undefined {
  if (input && typeof input === "object" && "idempotencyKey" in input) {
    const key = (input as { idempotencyKey?: unknown }).idempotencyKey
    return typeof key === "string" && key ? key : undefined
  }
  return undefined
}

/**
 * Run a command as one ACID transaction (plan §3.3):
 * validate, check role, dedupe by idempotency key, take the cross-window
 * commit lock, run against a buffered transaction, enforce invariants, then
 * write everything in one IndexedDB transaction and notify other windows.
 */
export async function commit<S extends z.ZodType, O>(
  def: CommandDef<S, O>,
  input: z.input<S>,
  ctx: { db: MedcoreDb; actor: Actor }
): Promise<CommitResult<O>> {
  const { db, actor } = ctx

  const parsed = def.input.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(
      def.name,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    )
  }
  const data = parsed.data as z.output<S>

  if (!mayRun(def.roles as CommandDef<z.ZodType, unknown>["roles"], actor)) {
    await recordBlocked(db, actor, def.name, "PERMISSION_DENIED", { role: actor.role })
    throw new PermissionDenied(def.name, actor.role, def.roles)
  }

  const key = idempotencyKeyOf(data)
  let outcome: CommitResult<O>
  try {
    outcome = await withLock(commitLockName(db.name), async () => {
      if (key) {
        const prior = await db.idempotency.get(key)
        if (prior) {
          return {
            result: prior.result as O,
            commitId: prior.commitId,
            events: [],
            deduplicated: true,
          }
        }
      }
      const tx = new TxImpl(db, actor, newId("cm"), now(), originFor(db), false)
      const result = await def.run(tx as Tx, data)
      await checkNewIds(tx)
      await runInvariants(tx)
      const events = await writeCommit(db, tx, {
        command: def.name,
        actor: toActorRef(actor),
        origin: tx.origin,
        emitted: tx.pendingEvents,
        idempotency: key ? { key, result } : undefined,
      })
      return { result, commitId: tx.commitId, events, deduplicated: false }
    })
  } catch (error) {
    const translated = translateStorageError(error)
    if (translated instanceof RuleViolation && translated.audit) {
      await recordBlocked(db, actor, def.name, translated.code, translated.params)
    }
    throw translated
  }

  if (!outcome.deduplicated) {
    publishCommit(db, def.name, toActorRef(actor), outcome.commitId, outcome.events)
  }
  return outcome
}

export { ConflictError, NotFoundError, PermissionDenied, RuleViolation, ValidationError }
