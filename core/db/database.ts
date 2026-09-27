import Dexie, { type Table } from "dexie"

import type { BranchCode } from "@/config/brand.config"

import type {
  AppliedCommitRow,
  AuditRow,
  CounterRow,
  EventRow,
  IdempotencyRow,
  OutboxRow,
} from "./schema"
import {
  EDGE_ONLY_STORES,
  PLATFORM_STORES,
  TABLE_NAMES,
  TABLE_SPECS,
  type TableName,
  type TableRows,
} from "./tables"

/**
 * Bump when TABLE_SPECS or the platform stores change. The demo re-seeds on
 * reset, so no data migration is needed: an upgrade clears and re-seeds.
 */
export const SCHEMA_VERSION = 1

export const CENTRAL_DB_NAME = "medcore-central"

export function edgeDbName(branch: BranchCode): string {
  return `medcore-edge-${branch}`
}

export type DomainTables = {
  [T in TableName]: Table<TableRows[T], string>
}

function storesFor(kind: "central" | "edge"): Record<string, string> {
  const stores: Record<string, string> = {}
  for (const name of TABLE_NAMES) stores[name] = TABLE_SPECS[name].indexes
  Object.assign(stores, PLATFORM_STORES)
  if (kind === "edge") Object.assign(stores, EDGE_ONLY_STORES)
  return stores
}

// Declaration merging: Dexie creates one property per declared table, so the
// domain tables are typed as instance properties (db.patients, db.rxLines, ...).
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type
export interface MedcoreDb extends DomainTables {}

/**
 * One data database: the central store, or a branch edge store while that
 * branch is offline (plan §3.2). Both share the same schema; edge adds `outbox`.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class MedcoreDb extends Dexie {
  events!: Table<EventRow, number>
  audit!: Table<AuditRow, number>
  counters!: Table<CounterRow, string>
  idempotency!: Table<IdempotencyRow, string>
  appliedCommits!: Table<AppliedCommitRow, string>
  /** Only present on edge databases */
  outbox!: Table<OutboxRow, number>

  readonly kind: "central" | "edge"
  readonly edgeBranch: BranchCode | null

  constructor(
    name: string,
    kind: "central" | "edge" = "central",
    edgeBranch: BranchCode | null = null
  ) {
    // Strict durability: a commit is on disk before IndexedDB reports success.
    super(name, { chromeTransactionDurability: "strict" })
    this.kind = kind
    this.edgeBranch = edgeBranch
    this.version(SCHEMA_VERSION).stores(storesFor(kind))
  }

  /** Typed access to a domain table by name. */
  t<T extends TableName>(name: T): Table<TableRows[T], string> {
    return this.table(name) as unknown as Table<TableRows[T], string>
  }
}

const instances = new Map<string, MedcoreDb>()

/** The shared central database (one connection per window). */
export function getCentralDb(): MedcoreDb {
  let db = instances.get(CENTRAL_DB_NAME)
  if (!db) {
    db = new MedcoreDb(CENTRAL_DB_NAME, "central")
    instances.set(CENTRAL_DB_NAME, db)
  }
  return db
}

/** The edge database for an offline branch. */
export function getEdgeDb(branch: BranchCode): MedcoreDb {
  const name = edgeDbName(branch)
  let db = instances.get(name)
  if (!db) {
    db = new MedcoreDb(name, "edge", branch)
    instances.set(name, db)
  }
  return db
}

/** Close and forget a cached connection (before deleting its database). */
export function forgetDb(name: string): void {
  const db = instances.get(name)
  if (db) {
    db.close()
    instances.delete(name)
  }
}
