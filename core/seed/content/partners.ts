/**
 * Vendors (plan §7.1: 12, including manufacturer depots) and the three
 * corporate clients. Manufacturer depots carry real company names because
 * they supply those companies' brands; distributors, general suppliers and
 * corporate clients are invented names that do not refer to real businesses.
 */

import type { Bilingual } from "@/config/brand.config"
import type { VendorRow } from "@/core/db/schema"

export type VendorSeed = {
  id: string
  code: string
  name: string
  phone: string
  kind: VendorRow["kind"]
  paymentTermsDays: number
  /** Manufacturer whose brands this depot supplies */
  companyKey?: string
}

export const VENDORS: VendorSeed[] = [
  {
    id: "ven_square",
    code: "V-SQ",
    name: "Square Pharmaceuticals depot, Tejgaon",
    phone: "01713-020101",
    kind: "manufacturer-depot",
    paymentTermsDays: 30,
    companyKey: "square",
  },
  {
    id: "ven_beximco",
    code: "V-BX",
    name: "Beximco Pharmaceuticals depot, Tongi",
    phone: "01713-020102",
    kind: "manufacturer-depot",
    paymentTermsDays: 30,
    companyKey: "beximco",
  },
  {
    id: "ven_incepta",
    code: "V-IN",
    name: "Incepta Pharmaceuticals depot, Savar",
    phone: "01713-020103",
    kind: "manufacturer-depot",
    paymentTermsDays: 30,
    companyKey: "incepta",
  },
  {
    id: "ven_acme",
    code: "V-AC",
    name: "ACME Laboratories depot, Dhamrai",
    phone: "01713-020104",
    kind: "manufacturer-depot",
    paymentTermsDays: 30,
    companyKey: "acme",
  },
  {
    id: "ven_renata",
    code: "V-RN",
    name: "Renata depot, Mirpur",
    phone: "01713-020105",
    kind: "manufacturer-depot",
    paymentTermsDays: 30,
    companyKey: "renata",
  },
  {
    id: "ven_healthcare",
    code: "V-HC",
    name: "Healthcare Pharmaceuticals depot, Gazipur",
    phone: "01713-020106",
    kind: "manufacturer-depot",
    paymentTermsDays: 30,
    companyKey: "healthcare",
  },
  {
    id: "ven_eskayef",
    code: "V-SK",
    name: "Eskayef Pharmaceuticals depot, Tongi",
    phone: "01713-020107",
    kind: "manufacturer-depot",
    paymentTermsDays: 30,
    companyKey: "eskayef",
  },
  {
    id: "ven_opsonin",
    code: "V-OP",
    name: "Opsonin Pharma depot, Barishal Road",
    phone: "01713-020108",
    kind: "manufacturer-depot",
    paymentTermsDays: 30,
    companyKey: "opsonin",
  },
  {
    id: "ven_nirvik",
    code: "V-NV",
    name: "Nirvik Medical Distributors",
    phone: "01819-330211",
    kind: "distributor",
    paymentTermsDays: 45,
  },
  {
    id: "ven_doel",
    code: "V-DL",
    name: "Doel Pharma Traders",
    phone: "01819-330212",
    kind: "distributor",
    paymentTermsDays: 45,
  },
  {
    id: "ven_mahin",
    code: "V-MH",
    name: "Mahin Surgical and Consumables",
    phone: "01911-440321",
    kind: "general",
    paymentTermsDays: 15,
  },
  {
    id: "ven_brightpath",
    code: "V-BP",
    name: "Brightpath Office and Hospital Supplies",
    phone: "01911-440322",
    kind: "general",
    paymentTermsDays: 15,
  },
]

/** Vendor that supplies a manufacturer's brands (distributor otherwise). */
export function vendorForCompany(companyKey: string): string {
  return VENDORS.find((v) => v.companyKey === companyKey)?.id ?? "ven_nirvik"
}

export type CorporateSeed = {
  id: string
  code: string
  name: Bilingual
  contactName: string
  phone: string
  creditLimitTaka: number
  discountPct: number
  employees: number
}

/** Invented employers; none is a real Bangladeshi company. */
export const CORPORATE_CLIENTS: CorporateSeed[] = [
  {
    id: "corp_brightloom",
    code: "CORP-BLA",
    name: { en: "Brightloom Apparels Ltd", bn: "ব্রাইটলুম অ্যাপারেলস লিমিটেড" },
    contactName: "HR and welfare desk",
    phone: "01730-551201",
    creditLimitTaka: 1_500_000,
    discountPct: 10,
    employees: 16,
  },
  {
    id: "corp_kestrel",
    code: "CORP-KSS",
    name: {
      en: "Kestrel Software Services Ltd",
      bn: "কেস্ট্রেল সফটওয়্যার সার্ভিসেস লিমিটেড",
    },
    contactName: "People operations",
    phone: "01730-551202",
    creditLimitTaka: 800_000,
    discountPct: 15,
    employees: 12,
  },
  {
    id: "corp_bluewave",
    code: "CORP-BWS",
    name: {
      en: "Bluewave Shipping Agencies Ltd",
      bn: "ব্লুওয়েভ শিপিং এজেন্সিজ লিমিটেড",
    },
    contactName: "Administration office",
    phone: "01730-551203",
    creditLimitTaka: 1_000_000,
    discountPct: 12,
    employees: 12,
  },
]
