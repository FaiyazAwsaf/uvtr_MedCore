/**
 * Readable document numbers and the counter keys behind them. The engine's
 * `tx.nextNumber(key)` returns the next integer for a key; these helpers name
 * the keys and format the result. The seed sets counters so numbering carries
 * on from the seeded history (for example, the next purchase order is PO-1042).
 */

import type { BranchCode, CompanyCode } from "@/config/brand.config"

/* ---------------- Counter keys ---------------- */

export const counterKey = {
  uhid: () => "uhid",
  provisionalUhid: (branch: BranchCode) => `uhid-off:${branch}`,
  rx: (branch: BranchCode) => `rx:${branch}`,
  invoice: (company: CompanyCode, branch: BranchCode, fy: string) =>
    `inv:${company}-${branch}-${fy}`,
  offlineInvoice: (company: CompanyCode, branch: BranchCode, fy: string) =>
    `inv-off:${company}-${branch}-${fy}`,
  receipt: (branch: BranchCode) => `rcpt:${branch}`,
  labOrder: (branch: BranchCode) => `lab:${branch}`,
  imagingOrder: (branch: BranchCode) => `img:${branch}`,
  accession: (branch: BranchCode) => `acc:${branch}`,
  offlineAccession: (branch: BranchCode) => `acc-off:${branch}`,
  report: (branch: BranchCode) => `rpt:${branch}`,
  refund: (branch: BranchCode) => `rf:${branch}`,
  creditNote: (branch: BranchCode) => `cn:${branch}`,
  admission: (branch: BranchCode) => `adm:${branch}`,
  purchaseRequest: () => "pr",
  purchaseOrder: () => "po",
  grn: () => "grn",
  transfer: () => "trf",
  vendorInvoice: () => "vinv",
  /** Network-wide documents raised at a branch while it is offline (PRD §16) */
  offlineDoc: (kind: OfflineDocKind, branch: BranchCode) => `${kind}-off:${branch}`,
} as const

/** Network-wide document series that take a branch offline range. */
export type OfflineDocKind = "pr" | "po" | "grn" | "trf" | "vinv"

const OFFLINE_PREFIX: Record<OfflineDocKind, string> = {
  pr: "PR",
  po: "PO",
  grn: "GRN",
  trf: "TR",
  vinv: "VI",
}

const pad = (n: number, width: number) => String(n).padStart(width, "0")

/* ---------------- Formats ---------------- */

export const docNo = {
  rx: (branch: BranchCode, n: number) => `RX-${branch}-${pad(n, 6)}`,
  invoice: (company: CompanyCode, branch: BranchCode, fy: string, n: number) =>
    `${company}-${branch}-${fy}-${pad(n, 6)}`,
  offlineInvoice: (
    company: CompanyCode,
    branch: BranchCode,
    fy: string,
    n: number
  ) => `${company}-${branch}-${fy}-OFF-${pad(n, 4)}`,
  receipt: (branch: BranchCode, n: number) => `RC-${branch}-${pad(n, 6)}`,
  labOrder: (branch: BranchCode, n: number) => `LO-${branch}-${pad(n, 6)}`,
  imagingOrder: (branch: BranchCode, n: number) => `IO-${branch}-${pad(n, 6)}`,
  accession: (branch: BranchCode, n: number) => `${branch}-${pad(n, 6)}`,
  offlineAccession: (branch: BranchCode, n: number) =>
    `${branch}E-${pad(n, 4)}`,
  report: (branch: BranchCode, n: number) => `RPT-${branch}-${pad(n, 6)}`,
  refund: (branch: BranchCode, n: number) => `RF-${branch}-${pad(n, 6)}`,
  creditNote: (branch: BranchCode, n: number) => `CN-${branch}-${pad(n, 6)}`,
  admission: (branch: BranchCode, n: number) => `ADM-${branch}-${pad(n, 6)}`,
  purchaseRequest: (n: number) => `PR-${pad(n, 4)}`,
  purchaseOrder: (n: number) => `PO-${pad(n, 4)}`,
  grn: (n: number) => `GRN-${pad(n, 4)}`,
  transfer: (n: number) => `TR-${pad(n, 4)}`,
  vendorInvoice: (n: number) => `VI-${pad(n, 5)}`,
  provisionalUhid: (branch: BranchCode, n: number) =>
    `P-${branch}-${pad(n, 6)}`,
  /** PO-B1-OFF-0001: raised while the branch was offline, never collides with central */
  offlineDoc: (kind: OfflineDocKind, branch: BranchCode, n: number) =>
    `${OFFLINE_PREFIX[kind]}-${branch}-OFF-${pad(n, 4)}`,
}

/* ---------------- UHID ---------------- */

/** Luhn check digit for a string of digits. */
export function luhnCheckDigit(digits: string): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    // Double every second digit counting from the right of the payload.
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 0) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return (10 - (sum % 10)) % 10
}

/**
 * UHID for a serial: 10 digits plus a Luhn check digit (PRD §10.1). No branch
 * or date is encoded. Serial 1 gives "1000000001" + check digit.
 */
export function uhidFromSerial(serial: number): string {
  const payload = String(1_000_000_000 + serial)
  return `${payload}${luhnCheckDigit(payload)}`
}

export function isValidUhid(uhid: string): boolean {
  if (!/^\d{11}$/.test(uhid)) return false
  return luhnCheckDigit(uhid.slice(0, 10)) === Number(uhid[10])
}

/** Display grouping: 1000-0000-01-8. Always Latin digits. */
export function groupUhid(uhid: string): string {
  if (!/^\d{11}$/.test(uhid)) return uhid
  return `${uhid.slice(0, 4)}-${uhid.slice(4, 8)}-${uhid.slice(8, 10)}-${uhid.slice(10)}`
}
