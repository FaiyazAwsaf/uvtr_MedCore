import { describe, expect, it } from "vitest"

import {
  counterKey,
  docNo,
  groupUhid,
  isValidUhid,
  luhnCheckDigit,
  uhidFromSerial,
} from "@/core/db/numbering"

describe("UHID", () => {
  it("uses the standard Luhn check digit", () => {
    // Classic Luhn example: 7992739871 has check digit 3.
    expect(luhnCheckDigit("7992739871")).toBe(3)
  })

  it("is 10 digits plus a valid check digit, with no branch or date", () => {
    const uhid = uhidFromSerial(42)
    expect(uhid).toMatch(/^\d{11}$/)
    expect(uhid.slice(0, 10)).toBe("1000000042")
    expect(isValidUhid(uhid)).toBe(true)
    expect(isValidUhid(uhid.slice(0, 10) + ((Number(uhid[10]) + 1) % 10))).toBe(false)
  })

  it("groups for display", () => {
    expect(groupUhid("10000000424")).toBe("1000-0000-42-4")
  })
})

describe("document numbers", () => {
  it("formats the agreed patterns", () => {
    expect(docNo.purchaseOrder(1042)).toBe("PO-1042")
    expect(docNo.invoice("C1", "B1", "2627", 123)).toBe("C1-B1-2627-000123")
    expect(docNo.offlineInvoice("C1", "B1", "2627", 1)).toBe("C1-B1-2627-OFF-0001")
    expect(docNo.provisionalUhid("B1", 17)).toBe("P-B1-000017")
    expect(docNo.rx("B1", 5)).toBe("RX-B1-000005")
  })

  it("gives network-wide series a branch range while offline", () => {
    expect(docNo.offlineDoc("po", "B1", 1)).toBe("PO-B1-OFF-0001")
    expect(docNo.offlineDoc("pr", "B2", 12)).toBe("PR-B2-OFF-0012")
    expect(docNo.offlineDoc("grn", "B1", 3)).toBe("GRN-B1-OFF-0003")
    expect(docNo.offlineDoc("trf", "B3", 7)).toBe("TR-B3-OFF-0007")
    expect(docNo.offlineDoc("vinv", "B1", 2)).toBe("VI-B1-OFF-0002")
    expect(counterKey.offlineDoc("po", "B1")).toBe("po-off:B1")
  })
})
