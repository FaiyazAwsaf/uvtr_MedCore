import type { MedcoreDb } from "@/core/db/database"
import { newId } from "@/core/db/ids"
import type { BaseRow, Id, Ms, Origin } from "@/core/db/schema"
import { TABLE_SPECS, type Row, type TableName } from "@/core/db/tables"
import { dhakaDate } from "@/core/clock/dates"

import { ConflictError, NotFoundError, RuleViolation } from "./errors"
import type {
  Actor,
  Change,
  EmitOptions,
  IndexValue,
  NewRow,
  Patch,
  Tx,
} from "./types"

/** Fields the engine owns; stripped from any patch a command passes. */
const BASE_FIELDS = new Set([
  "id",
  "version",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "origin",
  "originAt",
])

/** Short id prefixes, so ids read well in the audit log and event stream. */
const ID_PREFIX: Partial<Record<TableName, string>> = {
  patients: "pat",
  households: "hh",
  appointments: "apt",
  queueTokens: "tok",
  encounters: "enc",
  notes: "note",
  prescriptions: "rx",
  rxLines: "rxl",
  labOrders: "lo",
  labOrderItems: "loi",
  specimens: "spc",
  results: "res",
  labReports: "rpt",
  invoices: "inv",
  invoiceLines: "invl",
  payments: "pay",
  basketLines: "bsk",
  dispenses: "dsp",
  stockMovements: "mov",
  transfers: "trf",
  approvals: "apv",
  inboxItems: "inb",
  sms: "sms",
  notifications: "ntf",
}

export type PendingEvent = { type: string; opts: EmitOptions }

const changeKey = (table: string, id: Id) => `${table}\u0000${id}`

function multiEntryFields(table: TableName): Set<string> {
  const fields = new Set<string>()
  for (const part of TABLE_SPECS[table].indexes.split(",")) {
    const token = part.trim()
    if (token.startsWith("*")) fields.add(token.slice(1))
  }
  return fields
}

/** Whether a buffered row would be returned by `where(index).equals(value)`. */
export function matchesIndex(
  table: TableName,
  index: string,
  value: IndexValue,
  row: Record<string, unknown>
): boolean {
  if (index.startsWith("[")) {
    const fields = index.slice(1, -1).split("+")
    const values = Array.isArray(value) ? value : [value]
    return fields.every((field, i) => row[field] === values[i])
  }
  const field = row[index]
  if (multiEntryFields(table).has(index)) {
    return Array.isArray(field) && field.includes(value as never)
  }
  return field === value
}

/**
 * The buffered transaction behind `commit()`. Nothing touches IndexedDB until
 * the engine applies `changes()` in one atomic write.
 */
export class TxImpl implements Tx {
  private readonly buffer = new Map<string, Change>()
  private readonly counterBuffer = new Map<string, number>()
  readonly pendingEvents: PendingEvent[] = []
  auditCtx: { reason?: string; approvedBy?: Id } = {}

  constructor(
    readonly db: MedcoreDb,
    readonly actor: Actor,
    readonly commitId: Id,
    private readonly at: Ms,
    readonly origin: Origin,
    readonly isReplay: boolean
  ) {}

  get isEdge(): boolean {
    return this.db.kind === "edge"
  }

  now(): Ms {
    return this.at
  }

  today(): string {
    return dhakaDate(this.at)
  }

  /* ---------------- reads ---------------- */

  async find<T extends TableName>(table: T, id: Id): Promise<Row<T> | undefined> {
    const change = this.buffer.get(changeKey(table, id))
    if (change) {
      return change.kind === "delete" ? undefined : (change.after as Row<T>)
    }
    return this.db.t(table).get(id) as Promise<Row<T> | undefined>
  }

  async get<T extends TableName>(
    table: T,
    id: Id,
    opts?: { expectedVersion?: number }
  ): Promise<Row<T>> {
    const row = await this.find(table, id)
    if (!row) throw new NotFoundError(table, id)
    if (opts?.expectedVersion !== undefined) {
      this.checkVersion(table, id, row, opts.expectedVersion)
    }
    return row
  }

  /** Compares against the committed version; rows inserted here have none. */
  private checkVersion(table: string, id: Id, row: BaseRow, expected: number) {
    const change = this.buffer.get(changeKey(table, id))
    if (change?.kind === "insert") return
    const committed = change?.before ?? row
    if (committed.version !== expected) {
      throw new ConflictError(
        table,
        id,
        expected,
        committed.version,
        committed.updatedBy,
        committed.updatedAt
      )
    }
  }

  async list<T extends TableName>(
    table: T,
    index: string,
    value: IndexValue
  ): Promise<Row<T>[]> {
    const committed = (await this.db
      .t(table)
      .where(index)
      .equals(value as never)
      .toArray()) as Row<T>[]
    return this.overlay(table, committed, (row) =>
      matchesIndex(table, index, value, row as Record<string, unknown>)
    )
  }

  async all<T extends TableName>(table: T): Promise<Row<T>[]> {
    const committed = (await this.db.t(table).toArray()) as Row<T>[]
    return this.overlay(table, committed, () => true)
  }

  private overlay<T extends TableName>(
    table: T,
    rows: Row<T>[],
    matches: (row: Row<T>) => boolean
  ): Row<T>[] {
    const out = new Map<Id, Row<T>>()
    for (const row of rows) out.set(row.id, row)
    for (const change of this.buffer.values()) {
      if (change.table !== table) continue
      if (change.kind === "delete") {
        out.delete(change.id)
        continue
      }
      const after = change.after as Row<T>
      if (matches(after)) out.set(change.id, after)
      else out.delete(change.id)
    }
    return [...out.values()]
  }

  /* ---------------- writes ---------------- */

  insert<T extends TableName>(table: T, data: NewRow<T>): Row<T> {
    const id = data.id ?? newId(ID_PREFIX[table] ?? table.slice(0, 4))
    const key = changeKey(table, id)
    const existing = this.buffer.get(key)
    if (existing && existing.kind !== "delete") {
      throw new RuleViolation("DUPLICATE_ID", { table, id })
    }
    const row = {
      ...(data as object),
      id,
      version: 1,
      createdAt: this.at,
      updatedAt: this.at,
      createdBy: this.actor.staffId,
      updatedBy: this.actor.staffId,
      origin: this.origin,
    } as unknown as Row<T>
    this.buffer.set(key, { table, id, kind: "insert", after: row })
    return row
  }

  /**
   * Replay only: insert a row exactly as the edge wrote it (keeps its base
   * fields and marks its origin time).
   */
  insertRaw<T extends TableName>(table: T, row: Row<T>, originAt: Ms): Row<T> {
    const copy = { ...row, originAt } as Row<T>
    this.buffer.set(changeKey(table, row.id), {
      table,
      id: row.id,
      kind: "insert",
      after: copy,
    })
    return copy
  }

  async update<T extends TableName>(
    table: T,
    id: Id,
    patch: Patch<T>,
    opts?: { expectedVersion?: number }
  ): Promise<Row<T>> {
    const key = changeKey(table, id)
    const change = this.buffer.get(key)
    let current: BaseRow
    if (change) {
      if (change.kind === "delete" || !change.after) {
        throw new NotFoundError(table, id)
      }
      current = change.after
    } else {
      const committed = await this.db.t(table).get(id)
      if (!committed) throw new NotFoundError(table, id)
      current = committed
    }
    if (opts?.expectedVersion !== undefined) {
      this.checkVersion(table, id, current, opts.expectedVersion)
    }

    const clean: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(patch as object)) {
      if (!BASE_FIELDS.has(field)) clean[field] = value
    }
    const version =
      change?.kind === "insert"
        ? 1
        : (change?.before?.version ?? current.version) + 1
    const next = {
      ...current,
      ...clean,
      version,
      updatedAt: this.at,
      updatedBy: this.actor.staffId,
    } as Row<T>

    if (change) {
      this.buffer.set(key, { ...change, after: next })
    } else {
      this.buffer.set(key, {
        table,
        id,
        kind: "update",
        before: current,
        after: next,
      })
    }
    return next
  }

  async remove<T extends TableName>(table: T, id: Id): Promise<void> {
    if (!TABLE_SPECS[table].deletable) {
      throw new RuleViolation("NOT_DELETABLE", { table })
    }
    const key = changeKey(table, id)
    const change = this.buffer.get(key)
    if (change?.kind === "insert") {
      this.buffer.delete(key)
      return
    }
    const before = change?.before ?? (await this.db.t(table).get(id))
    if (!before) throw new NotFoundError(table, id)
    this.buffer.set(key, { table, id, kind: "delete", before })
  }

  /* ---------------- commit metadata ---------------- */

  emit(type: string, opts: EmitOptions = {}): void {
    this.pendingEvents.push({ type, opts })
  }

  reject(
    code: string,
    params: Record<string, string | number> = {},
    opts?: { audit?: boolean }
  ): never {
    throw new RuleViolation(code, params, opts?.audit ?? false)
  }

  async nextNumber(key: string): Promise<number> {
    let value = this.counterBuffer.get(key)
    if (value === undefined) {
      value = (await this.db.counters.get(key))?.value ?? 0
    }
    value += 1
    this.counterBuffer.set(key, value)
    return value
  }

  auditContext(ctx: { reason?: string; approvedBy?: Id }): void {
    this.auditCtx = { ...this.auditCtx, ...ctx }
  }

  changes(): readonly Change[] {
    return [...this.buffer.values()]
  }

  counters(): ReadonlyMap<string, number> {
    return this.counterBuffer
  }
}
