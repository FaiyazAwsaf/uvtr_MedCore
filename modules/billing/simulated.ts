import type { Tender } from "@/core/db/schema"

/**
 * The simulated payment connector (plan §3.13): card terminal approvals and
 * bKash/Nagad push references. Every screen that uses it shows the
 * "Simulated" badge. References are derived from an id rather than drawn at
 * random, so a command stays deterministic (plan §3.3, rules for `run()`).
 * A real integration would replace these functions behind the same shape.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** A stable 32-bit hash of a string (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function code(seed: string, length: number): string {
  let h = hash(seed)
  let out = ""
  for (let i = 0; i < length; i++) {
    if (i > 0 && i % 6 === 0) h = hash(`${seed}:${i}`)
    out += ALPHABET[h % ALPHABET.length]
    h = Math.floor(h / ALPHABET.length)
  }
  return out
}

/** Card terminal approval code, e.g. "POS-482913". */
export function terminalRef(seed: string): string {
  return `POS-${String(100000 + (hash(seed) % 900000))}`
}

/** bKash or Nagad transaction id, e.g. "BK7Q2M9XKD" / "NG4TR8PLWA". */
export function mfsTrxId(tender: Tender, seed: string): string {
  return `${tender === "nagad" ? "NG" : "BK"}${code(seed, 8)}`
}

/** Reference of a posting to a corporate account, e.g. "CORP-BLA/7Q2M9X". */
export function corporateRef(clientCode: string, seed: string): string {
  return `${clientCode}/${code(seed, 6)}`
}

/**
 * Reference of a simulated refund back to where the money came from: a
 * bKash or Nagad merchant refund ("BKR" / "NGR" and 8 characters) or a card
 * reversal on the terminal ("POS-RV-" and 6 digits). Cash and corporate
 * refunds have none. Derived from the refund id, so it never changes.
 */
export function merchantRefundRef(tender: Tender, refundId: string): string | undefined {
  if (tender === "bkash" || tender === "nagad") {
    return `${tender === "nagad" ? "NGR" : "BKR"}${code(`refund:${refundId}`, 8)}`
  }
  if (tender === "card") {
    return `POS-RV-${String(100000 + (hash(`refund:${refundId}`) % 900000))}`
  }
  return undefined
}
