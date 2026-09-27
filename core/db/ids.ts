import { customAlphabet } from "nanoid"

/** Lowercase letters and digits only: readable in the audit log and URLs. */
const makeId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12)

/** A new internal id with a short type prefix, e.g. `rx_4f9k2m0q8z1a`. */
export function newId(prefix: string): string {
  return `${prefix}_${makeId()}`
}
