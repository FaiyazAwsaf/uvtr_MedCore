import {
  Banknote,
  BedDouble,
  Building2,
  CreditCard,
  FlaskConical,
  Package,
  Pill,
  ScanLine,
  Smartphone,
  Stethoscope,
  Syringe,
  Wallet,
  type LucideIcon,
} from "lucide-react"

import type { BasketLineRow, InvoiceLineRow, Tender } from "@/core/db/schema"
import type { Locale } from "@/lib/i18n/config"

export type SourceType = BasketLineRow["sourceType"]

/** Basket groups in the order the cashier reads them. */
export const SOURCE_ORDER: SourceType[] = [
  "consult",
  "test",
  "imaging",
  "rx-line",
  "procedure",
  "bed",
  "other",
]

/** i18n suffix under `billing.source.*` (keys cannot hold a hyphen nicely). */
export const SOURCE_KEY: Record<SourceType, string> = {
  consult: "consult",
  test: "test",
  imaging: "imaging",
  "rx-line": "rxLine",
  procedure: "procedure",
  bed: "bed",
  other: "other",
}

export const SOURCE_ICON: Record<SourceType, LucideIcon> = {
  consult: Stethoscope,
  test: FlaskConical,
  imaging: ScanLine,
  "rx-line": Pill,
  procedure: Syringe,
  bed: BedDouble,
  other: Package,
}

export const TENDER_ICON: Record<Tender, LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  bkash: Smartphone,
  nagad: Smartphone,
  deposit: Wallet,
  corporate: Building2,
}

/** Hue-coded tag per tender (globals.css `.tag-*`). */
export const TENDER_TAG: Record<Tender, string> = {
  cash: "tag-green",
  card: "tag-blue",
  bkash: "tag-magenta",
  nagad: "tag-amber",
  deposit: "tag-slate",
  corporate: "tag-purple",
}

/**
 * A bill line's name in the window's language (plan §3.11): consultations
 * read in Bangla in a Bangla window; tests, imaging and medicines keep their
 * English clinical names with the Bangla gloss as a second line.
 */
export function lineNames(
  line: Pick<BasketLineRow, "description" | "descriptionBn" | "sourceType">,
  locale: Locale
): { primary: string; secondary?: string } {
  if (locale !== "bn" || !line.descriptionBn) return { primary: line.description }
  if (line.sourceType === "consult") return { primary: line.descriptionBn }
  return { primary: line.description, secondary: line.descriptionBn }
}

/** Invoice lines carry no Bangla text; their basket line does. */
export type NamedLine = Pick<InvoiceLineRow, "description" | "sourceType"> & {
  descriptionBn?: string
}
