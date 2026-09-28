import type {
  FeeShareContractRow,
  FeeShareRule,
  Poisha,
  ServiceType,
  Tender,
} from "@/core/db/schema"

/**
 * Billing arithmetic, kept pure so it is unit tested on its own and shared by
 * the commands and the cashier screen (the screen previews exactly what the
 * command will commit). Money is integer poisha throughout; nothing here
 * rounds to taka.
 */

/** The counter tenders a cashier can take (corporate and deposit are not typed in). */
export const COUNTER_TENDERS = ["cash", "card", "bkash", "nagad"] as const
export type CounterTender = (typeof COUNTER_TENDERS)[number]

export const MFS_TENDERS: readonly Tender[] = ["bkash", "nagad"]

export function isMfs(tender: Tender): tender is "bkash" | "nagad" {
  return tender === "bkash" || tender === "nagad"
}

/**
 * Highest discount % a set of staff authorities may give (INV-16):
 * `discount:<n>` grants up to n, `*` grants everything, nothing grants 0.
 */
export function discountLimit(authorities: readonly string[]): number {
  if (authorities.includes("*")) return 100
  let max = 0
  for (const authority of authorities) {
    const match = /^discount:(\d+)$/.exec(authority)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max
}

/** Discount on a subtotal, rounded to the nearest poisha. */
export function discountFor(subtotalP: Poisha, pct: number): Poisha {
  if (subtotalP <= 0 || pct <= 0) return 0
  return Math.round((subtotalP * Math.min(pct, 100)) / 100)
}

/**
 * Spread an invoice discount over its lines pro rata (largest remainder), so
 * the line discounts add up to the invoice discount exactly and every line
 * stays balanced: 0 <= line discount <= line amount (INV-03).
 */
export function spreadDiscount(amounts: readonly Poisha[], discountP: Poisha): Poisha[] {
  const subtotal = amounts.reduce((sum, amount) => sum + amount, 0)
  if (discountP <= 0 || subtotal <= 0) return amounts.map(() => 0)
  const total = Math.min(discountP, subtotal)
  const exact = amounts.map((amount) => (total * amount) / subtotal)
  const shares = exact.map((value) => Math.floor(value))
  let left = total - shares.reduce((sum, share) => sum + share, 0)
  // Hand the leftover poisha to the lines with the largest fractions.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const { index } of order) {
    if (left <= 0) break
    if (shares[index] < amounts[index]) {
      shares[index] += 1
      left -= 1
    }
  }
  return shares
}

export type PricedLine = {
  qty: number
  unitPriceP: Poisha
  amountP: Poisha
  discountP: Poisha
  netP: Poisha
}

/** Invoice totals and balanced lines for a set of basket lines and a discount %. */
export function priceLines<L extends { qty: number; unitPriceP: Poisha }>(
  lines: readonly L[],
  discountPct: number
): {
  lines: (L & PricedLine)[]
  subtotalP: Poisha
  discountP: Poisha
  taxP: Poisha
  totalP: Poisha
} {
  const amounts = lines.map((line) => line.qty * line.unitPriceP)
  const subtotalP = amounts.reduce((sum, amount) => sum + amount, 0)
  const discountP = discountFor(subtotalP, discountPct)
  const shares = spreadDiscount(amounts, discountP)
  return {
    lines: lines.map((line, index) => ({
      ...line,
      amountP: amounts[index],
      discountP: shares[index],
      netP: amounts[index] - shares[index],
    })),
    subtotalP,
    discountP,
    // Outpatient medical services are VAT exempt in the demo.
    taxP: 0,
    totalP: subtotalP - discountP,
  }
}

/** What the bill needs to know about a patient's live corporate cover. */
export type CoverInfo = {
  clientId: string
  coPayPct: number
  coveredServices: readonly ServiceType[]
  /** Annual limit left for the employee */
  remainingLimitP: number
}

export type BillLine = {
  qty: number
  unitPriceP: Poisha
  serviceType: ServiceType
  payerType: "self" | "corporate"
  corporateClientId?: string
}

/**
 * The whole bill for a set of basket lines: balanced lines, totals, and who
 * pays what. Lines billed to a company count toward its share only when the
 * patient's cover is live, the service is covered and the client matches;
 * otherwise the patient pays them. The cashier screen previews with this
 * same function, so the screen and the committed invoice always agree.
 */
export function computeBill<L extends BillLine>(
  lines: readonly L[],
  discountPct: number,
  cover: CoverInfo | null
) {
  const priced = priceLines(lines, discountPct)
  const covered = (line: BillLine) =>
    !!cover &&
    line.payerType === "corporate" &&
    cover.coveredServices.includes(line.serviceType) &&
    (!line.corporateClientId || line.corporateClientId === cover.clientId)
  const corporateNetP = priced.lines
    .filter((line) => covered(line))
    .reduce((sum, line) => sum + line.netP, 0)
  const split = corporateSplit({
    corporateNetP,
    totalP: priced.totalP,
    coPayPct: cover?.coPayPct ?? 0,
    remainingLimitP: cover?.remainingLimitP ?? 0,
  })
  return {
    ...priced,
    corporateNetP,
    corporateShareP: split.corporateShareP,
    patientDueP: split.patientDueP,
    payerType: (corporateNetP > 0 ? "corporate" : "self") as "self" | "corporate",
    /** Lines marked corporate that the live cover does not pay for */
    uncoveredCorporate: lines.filter((line) => line.payerType === "corporate" && !covered(line))
      .length,
  }
}

/**
 * Corporate cover (PRD §10.10): the company pays all but the co-pay of its
 * lines, up to what is left of the employee's annual limit; the patient pays
 * the co-pay, anything above the limit, and every self-pay line.
 */
export function corporateSplit(opts: {
  /** Net of the lines billed to the company */
  corporateNetP: Poisha
  totalP: Poisha
  coPayPct: number
  /** Annual limit left for this employee (Infinity when unlimited) */
  remainingLimitP: number
}): { corporateShareP: Poisha; patientDueP: Poisha } {
  const coPay = Math.round((opts.corporateNetP * opts.coPayPct) / 100)
  const covered = Math.max(0, opts.corporateNetP - coPay)
  const corporateShareP = Math.max(0, Math.min(covered, opts.remainingLimitP))
  return { corporateShareP, patientDueP: opts.totalP - corporateShareP }
}

/** Reporting-doctor rules apply to diagnostic lines when no direct rule exists. */
const REPORTING_SERVICE: Partial<Record<ServiceType, ServiceType>> = {
  lab: "lab-reporting",
  imaging: "imaging-reporting",
}

/** The contract in force on a day: the latest version already effective. */
export function contractInForce(
  contracts: readonly FeeShareContractRow[],
  day: string
): FeeShareContractRow | undefined {
  return contracts
    .filter((contract) => contract.effectiveFrom <= day)
    .sort((a, b) => b.contractVersion - a.contractVersion)[0]
}

/** The collection-triggered rule of a contract for a service, if any. */
export function feeShareRuleFor(
  contract: FeeShareContractRow,
  serviceType: ServiceType
): FeeShareRule | undefined {
  const direct = contract.rules.find(
    (rule) => rule.serviceType === serviceType && rule.trigger === "collection"
  )
  if (direct) return direct
  const reporting = REPORTING_SERVICE[serviceType]
  return reporting
    ? contract.rules.find(
        (rule) => rule.serviceType === reporting && rule.trigger === "collection"
      )
    : undefined
}

/**
 * A consultant's share of one invoice line (PRD §10.9): a percentage of the
 * net (discount borne pro rata), of the gross (the hospital bears the
 * discount), or a fixed amount; withholding tax is taken from the share.
 */
export function feeShareAmounts(
  rule: FeeShareRule,
  contract: Pick<FeeShareContractRow, "whtPct" | "discountBearer">,
  line: { amountP: Poisha; discountP: Poisha; netP: Poisha }
): { shareP: Poisha; whtP: Poisha } {
  const pct = (base: Poisha) => Math.round((base * rule.value) / 100)
  let shareP: Poisha
  if (rule.basis === "fixed") {
    shareP = rule.value
  } else if (rule.basis === "pct-gross" || contract.discountBearer === "hospital") {
    shareP = pct(line.amountP)
  } else if (contract.discountBearer === "consultant") {
    // The consultant carries the whole line discount.
    shareP = Math.max(0, pct(line.amountP) - line.discountP)
  } else {
    // Pro rata: the share is taken from the net, so the discount is shared.
    shareP = pct(line.netP)
  }
  const whtP = Math.round((shareP * contract.whtPct) / 100)
  return { shareP, whtP }
}

/** Parse a taka amount typed by a cashier ("1,500", "1500.5", "১৫০০") into poisha. */
export function parseTaka(text: string): Poisha | null {
  const latin = text
    .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
    .replace(/[,\s৳]/g, "")
  if (!latin) return null
  if (!/^\d+(\.\d{0,2})?$/.test(latin)) return null
  return Math.round(Number(latin) * 100)
}

/** Poisha as a plain editable taka string ("1500", "10.8"). */
export function takaText(poisha: Poisha): string {
  if (poisha % 100 === 0) return String(poisha / 100)
  return (poisha / 100).toFixed(2).replace(/0$/, "")
}
