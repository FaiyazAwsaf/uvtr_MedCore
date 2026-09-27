/**
 * Shared state for one seed run: the row bag every generator writes into, the
 * deferred document-number allocator, sub-seeded randomness and the time
 * anchors. Nothing touches IndexedDB until `seedDatabase` flushes the bag.
 */

import { seedRow } from "@/core/db/base"
import type {
  BaseRow,
  CounterRow,
  HHMM,
  ISODate,
  Id,
  Ms,
} from "@/core/db/schema"
import type { Row, TableName } from "@/core/db/tables"
import { createRng, type Rng } from "@/lib/mock/rng"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"

import { dhakaAt, isoAddDays } from "./time"
import type { SeedOptions } from "./types"

/** Root seed string: every random stream derives from it. */
export const SEED_KEY = "medcore-seed-v1"

export type RowData<T extends TableName> = Omit<Row<T>, keyof BaseRow>

/** Every row the seed produces, grouped by table, with duplicate-id checks. */
export class SeedBag {
  private readonly tables = new Map<TableName, Map<Id, Row<TableName>>>()

  put<T extends TableName>(table: T, id: Id, at: Ms, data: RowData<T>): Row<T> {
    const row = seedRow<Row<T>>(id, at, data)
    let rows = this.tables.get(table)
    if (!rows) {
      rows = new Map()
      this.tables.set(table, rows)
    }
    if (rows.has(id)) throw new Error(`seed: duplicate id ${table}/${id}`)
    rows.set(id, row)
    return row
  }

  get<T extends TableName>(table: T, id: Id): Row<T> {
    const row = this.tables.get(table)?.get(id)
    if (!row) throw new Error(`seed: missing ${table}/${id}`)
    return row as Row<T>
  }

  find<T extends TableName>(table: T, id: Id): Row<T> | undefined {
    return this.tables.get(table)?.get(id) as Row<T> | undefined
  }

  all<T extends TableName>(table: T): Row<T>[] {
    return [...(this.tables.get(table)?.values() ?? [])] as Row<T>[]
  }

  tableNames(): TableName[] {
    return [...this.tables.keys()]
  }

  count(table: TableName): number {
    return this.tables.get(table)?.size ?? 0
  }
}

type NumberRequest = {
  key: string
  at: Ms
  order: number
  apply: (n: number) => void
}

/**
 * Document numbers are assigned after every generator has run, in time order
 * per counter key, so numbering reads chronologically even though history is
 * generated story by story. The counters table then continues from the last
 * number used (plan §7: the next purchase order is PO-1042).
 */
export class NumberPlan {
  private readonly bases = new Map<string, number>()
  private readonly requests: NumberRequest[] = []
  private readonly after: (() => void)[] = []
  private finalized = false

  /** Numbers under `key` start after `base` (first issued = base + 1). */
  base(key: string, base: number): void {
    this.bases.set(key, base)
  }

  request(key: string, at: Ms, apply: (n: number) => void): void {
    if (this.finalized) throw new Error("seed: numbers already assigned")
    this.requests.push({ key, at, order: this.requests.length, apply })
  }

  /** Runs once every number is assigned (copies of numbers, hashes). */
  afterAssigned(fn: () => void): void {
    this.after.push(fn)
  }

  finalize(defaultBase: (key: string) => number): CounterRow[] {
    this.finalized = true
    const byKey = new Map<string, NumberRequest[]>()
    for (const r of this.requests) {
      const list = byKey.get(r.key) ?? []
      list.push(r)
      byKey.set(r.key, list)
    }
    const counters: CounterRow[] = []
    for (const [key, list] of byKey) {
      list.sort((a, b) => a.at - b.at || a.order - b.order)
      let n = this.bases.get(key) ?? defaultBase(key)
      for (const r of list) r.apply(++n)
      counters.push({ id: key, value: n })
    }
    for (const fn of this.after) fn()
    return counters.sort((a, b) => a.id.localeCompare(b.id))
  }
}

export type SeedCtx = {
  now: Ms
  today: ISODate
  bag: SeedBag
  numbers: NumberPlan
  /** Independent deterministic stream per generator. */
  rng: (stream: string) => Rng
  /** Calendar day `offset` days from today. */
  day: (offset: number) => ISODate
  /** Dhaka wall time on the day `offset` days from today. */
  at: (offset: number, hhmm: HHMM) => Ms
  /** Readable sequential id per prefix, e.g. seq("inv") gives "inv_00001". */
  seq: (prefix: string) => Id
}

export function createSeedCtx(opts: SeedOptions): SeedCtx {
  const counters = new Map<string, number>()
  return {
    now: opts.now,
    today: opts.today,
    bag: new SeedBag(),
    numbers: new NumberPlan(),
    rng: (stream) => createRng(`${SEED_KEY}:${stream}`),
    day: (offset) => isoAddDays(opts.today, offset),
    at: (offset, hhmm) => dhakaAt(isoAddDays(opts.today, offset), hhmm),
    seq: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, n)
      return `${prefix}_${String(n).padStart(5, "0")}`
    },
  }
}

/** SHA-256 hex of a string (synchronous; used for report and PDF hashes). */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)))
}
