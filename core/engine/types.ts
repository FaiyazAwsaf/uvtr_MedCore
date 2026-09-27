import type { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import type { MedcoreDb } from "@/core/db/database"
import type {
  ActorRef,
  BaseField,
  BaseRow,
  EventRow,
  ISODate,
  Id,
  Ms,
  Origin,
  Refs,
} from "@/core/db/schema"
import type { Row, TableName } from "@/core/db/tables"
import type { Role } from "@/core/rbac/types"

/** Who is committing: the window's persona (or the system). */
export type Actor = ActorRef & {
  /** Staff authorities, e.g. "discount:15", "approve:variance" */
  authorities: string[]
}

export const SYSTEM_ACTOR: Actor = {
  staffId: "system",
  role: "system",
  branchId: null,
  name: "System",
  authorities: ["*"],
}

/** Insert input: domain fields; `id` optional (generated when absent). */
export type NewRow<T extends TableName> = Omit<Row<T>, BaseField> & {
  id?: Id
}

/** Update input: any subset of domain fields. */
export type Patch<T extends TableName> = Partial<Omit<Row<T>, BaseField>>

/** A value an index can be matched against (compound indexes take arrays). */
export type IndexValue = string | number | boolean | (string | number)[]

export type EmitOptions = {
  refs?: Refs
  /** Values for the event's i18n summary */
  params?: Record<string, string | number>
  /** Defaults to the actor's branch */
  branchId?: BranchCode | null
  /** Event schema version (default 1) */
  v?: number
}

/** One buffered change in a transaction. */
export type Change = {
  table: TableName
  id: Id
  kind: "insert" | "update" | "delete"
  /** Committed row before this transaction (update and delete) */
  before?: BaseRow
  /** Row after this transaction (insert and update) */
  after?: BaseRow
}

/**
 * The transaction a command runs in (plan §3.3). Reads see committed data plus
 * this transaction's own buffered writes; writes are buffered and applied
 * atomically only if the command, and every invariant, succeeds.
 *
 * Inside `run()`, await only `tx.*` calls: no fetch, timers or crypto.subtle.
 */
export interface Tx {
  readonly commitId: Id
  readonly actor: Actor
  /** Read-only use: for indexed queries beyond `list()` (committed data only) */
  readonly db: MedcoreDb
  readonly origin: Origin
  /** True when writing to a branch edge store (offline) */
  readonly isEdge: boolean
  /** True during offline replay onto central */
  readonly isReplay: boolean

  /** Demo-clock time, fixed for the whole transaction. */
  now(): Ms
  /** Dhaka calendar day of `now()`. */
  today(): ISODate

  /** Row by id, or throws NotFoundError. `expectedVersion` throws ConflictError when stale. */
  get<T extends TableName>(
    table: T,
    id: Id,
    opts?: { expectedVersion?: number }
  ): Promise<Row<T>>
  /** Row by id, or undefined. */
  find<T extends TableName>(table: T, id: Id): Promise<Row<T> | undefined>
  /** Rows whose `index` equals `value` (e.g. "patientId", "[branchId+status]"). */
  list<T extends TableName>(
    table: T,
    index: string,
    value: IndexValue
  ): Promise<Row<T>[]>
  /** Every row of a table (small tables only). */
  all<T extends TableName>(table: T): Promise<Row<T>[]>

  /** Buffer an insert; returns the complete row (base fields filled). */
  insert<T extends TableName>(table: T, row: NewRow<T>): Row<T>
  /** Buffer an update; returns the updated row. */
  update<T extends TableName>(
    table: T,
    id: Id,
    patch: Patch<T>,
    opts?: { expectedVersion?: number }
  ): Promise<Row<T>>
  /** Buffer a delete (only tables marked deletable). */
  remove<T extends TableName>(table: T, id: Id): Promise<void>

  /** Record a domain event (label and consumers come from the catalog). */
  emit(type: string, opts?: EmitOptions): void
  /** Refuse the whole commit with a rule code. */
  reject(
    code: string,
    params?: Record<string, string | number>,
    opts?: { audit?: boolean }
  ): never
  /** Next integer for a counter key (see core/db/numbering.ts). */
  nextNumber(key: string): Promise<number>
  /** Reason and approver recorded on this commit's audit rows. */
  auditContext(ctx: { reason?: string; approvedBy?: Id }): void
  /** The buffered changes so far (used by invariants). */
  changes(): readonly Change[]
}

export type CommandRoles = readonly Role[] | "any"

export type CommandDef<S extends z.ZodType, O> = {
  /** Namespaced name, e.g. "rx.sign" */
  name: string
  roles: CommandRoles
  input: S
  run: (tx: Tx, input: z.output<S>) => Promise<O>
}

export type CommitResult<O> = {
  result: O
  commitId: Id
  events: EventRow[]
  /** True when the idempotency key matched an earlier commit */
  deduplicated: boolean
}
