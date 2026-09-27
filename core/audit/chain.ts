import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"

import type { AuditRow } from "@/core/db/schema"

/** prevHash of the very first audit row. */
export const GENESIS_HASH = "0".repeat(64)

/**
 * Deterministic JSON: object keys sorted, undefined values dropped. The same
 * row always hashes to the same value in every window and in tests.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)))
}

/** Hash of an audit row: sha256(prevHash + canonical JSON of the row without its hash). */
export function hashAuditRow(row: Omit<AuditRow, "hash">): string {
  return sha256Hex(row.prevHash + canonicalJson(row))
}

export type UnchainedAudit = Omit<AuditRow, "seq" | "prevHash" | "hash">

/** Assign seq numbers and link rows onto the chain after `prev`. Synchronous. */
export function chainAudit(
  rows: UnchainedAudit[],
  prev: { seq: number; hash: string }
): AuditRow[] {
  const out: AuditRow[] = []
  let seq = prev.seq
  let prevHash = prev.hash
  for (const row of rows) {
    seq += 1
    const partial: Omit<AuditRow, "hash"> = { ...row, seq, prevHash }
    const hash = hashAuditRow(partial)
    out.push({ ...partial, hash })
    prevHash = hash
  }
  return out
}
