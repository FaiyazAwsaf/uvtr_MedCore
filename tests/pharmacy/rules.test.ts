import { describe, expect, it } from "vitest"

import { DAY } from "@/core/clock/dates"
import { buildLabel, type LabelInput } from "@/modules/pharmacy/label"
import {
  balanceDaysLeft,
  balanceExpired,
  courseEndDate,
  dispenseBlock,
  expiresBeforeCourseEnd,
  isEquivalentBrand,
  matchIdentity,
  packBreakdown,
  paidAndOwed,
  paidUnitsOf,
  queueStatusFor,
  roundToStrips,
  shownQueueStatus,
  stripSizeOf,
  unpaidBilledLines,
} from "@/modules/pharmacy/rules"

const line = (patch: Partial<Parameters<typeof dispenseBlock>[0]> = {}) => ({
  status: "open" as const,
  paymentCleared: true,
  brandId: "brd_x",
  balanceUntil: undefined,
  qtyPrescribed: 28,
  dispensedQty: 0,
  ...patch,
})

describe("pack rounding", () => {
  it("breaks a quantity into whole strips and loose units", () => {
    expect(stripSizeOf([{ label: "10 x 10 strip", units: 100, stripSize: 10 }])).toBe(10)
    expect(stripSizeOf([{ label: "60 ml bottle", units: 1 }])).toBeUndefined()
    expect(packBreakdown(28, 10)).toEqual({ strips: 2, loose: 8 })
    expect(packBreakdown(14, undefined)).toEqual({ strips: 0, loose: 14 })
  })

  it("rounds to the nearest whole strip that fits what is owed and on the shelf", () => {
    expect(roundToStrips(28, 10, 30)).toBe(30)
    expect(roundToStrips(28, 10, 28)).toBe(20)
    expect(roundToStrips(14, 10, 14)).toBe(10)
    expect(roundToStrips(6, 10, 6)).toBe(6)
    expect(roundToStrips(7, undefined, 5)).toBe(5)
  })
})

describe("dispensing gates", () => {
  const now = Date.UTC(2026, 8, 28, 5)
  it("only paid, open lines with a brand and something owed can be dispensed", () => {
    expect(dispenseBlock(line(), now)).toBeNull()
    expect(dispenseBlock(line({ paymentCleared: false }), now)).toBe("unpaid")
    expect(dispenseBlock(line({ status: "awaiting-prescriber" }), now)).toBe("awaiting-prescriber")
    expect(dispenseBlock(line({ status: "dispensed", dispensedQty: 28 }), now)).toBe("final")
    expect(dispenseBlock(line({ status: "bought-elsewhere" }), now)).toBe("final")
    expect(dispenseBlock(line({ brandId: undefined }), now)).toBe("no-brand")
    expect(
      dispenseBlock(line({ status: "partial", dispensedQty: 14, balanceUntil: now - 1 }), now)
    ).toBe("balance-expired")
  })

  it("keeps a balance open for its days and derives expiry on read", () => {
    const until = now + 7 * DAY
    expect(balanceDaysLeft(until, now)).toBe(7)
    expect(balanceDaysLeft(until, now + 6.5 * DAY)).toBe(1)
    expect(balanceDaysLeft(until, now + 7 * DAY)).toBe(0)
    expect(balanceDaysLeft(until + 50_000, now)).toBe(7)
    expect(balanceExpired({ status: "partial", balanceUntil: until }, now + 7 * DAY + 1)).toBe(true)
    expect(balanceExpired({ status: "partial", balanceUntil: until }, now)).toBe(false)
  })

  it("derives the queue status from the lines", () => {
    expect(queueStatusFor([{ status: "open", dispensedQty: 0 }])).toBe("waiting")
    expect(queueStatusFor([{ status: "awaiting-prescriber", dispensedQty: 0 }])).toBe("in-progress")
    expect(
      queueStatusFor([
        { status: "partial", dispensedQty: 14 },
        { status: "dispensed", dispensedQty: 9 },
      ])
    ).toBe("partial")
    expect(
      queueStatusFor([
        { status: "dispensed", dispensedQty: 28 },
        { status: "bought-elsewhere", dispensedQty: 0 },
      ])
    ).toBe("done")
    // Lines taken off the draft stay as cancelled rows and do not count.
    expect(
      queueStatusFor([
        { status: "cancelled", dispensedQty: 0 },
        { status: "open", dispensedQty: 0 },
      ])
    ).toBe("waiting")
    expect(
      shownQueueStatus("in-progress", [{ status: "open", dispensedQty: 0 }])
    ).toBe("waiting")
    expect(shownQueueStatus("cancelled", [{ status: "open", dispensedQty: 0 }])).toBe(
      "cancelled"
    )
  })

  it("warns when a batch expires before the course ends", () => {
    const end = courseEndDate("2026-09-28", 14)
    expect(end).toBe("2026-10-11")
    expect(expiresBeforeCourseEnd("2026-10-05", end)).toBe(true)
    expect(expiresBeforeCourseEnd("2026-10-11", end)).toBe(false)
    expect(expiresBeforeCourseEnd("2026-10-05", courseEndDate("2026-09-28", 0))).toBe(false)
  })
})

describe("second identifier (HAZ-01)", () => {
  const patient = { dob: "1964-03-05", phone: "01711-523418" }
  it("matches the date of birth in common forms and Bangla digits", () => {
    expect(matchIdentity("05-03-1964", patient)).toBe("dob")
    expect(matchIdentity("5/3/1964", patient)).toBe("dob")
    expect(matchIdentity("1964-03-05", patient)).toBe("dob")
    expect(matchIdentity("০৫-০৩-১৯৬৪", patient)).toBe("dob")
    expect(matchIdentity("06-03-1964", patient)).toBeNull()
  })
  it("matches the phone number or its last digits", () => {
    expect(matchIdentity("01711523418", patient)).toBe("phone")
    expect(matchIdentity("3418", patient)).toBe("phone")
    expect(matchIdentity("341", patient)).toBeNull()
    expect(matchIdentity("9999", patient)).toBeNull()
  })
})

describe("dispensing label", () => {
  const input: LabelInput = {
    rxNo: "RX-B1-006300",
    patient: { nameEn: "Abdul Karim", nameBn: "আব্দুল করিম", uhid: "10000000018" },
    brand: { name: "Seclo", strength: "20 mg", unitLabel: { en: "capsule", bn: "ক্যাপসুল" } },
    genericName: "Omeprazole",
    dosePattern: "1+0+1",
    mealTiming: "before",
    durationDays: 14,
    dispensedQty: 14,
    outstandingQty: 14,
    balanceUntil: Date.UTC(2026, 9, 5, 6),
    batches: [{ batchNo: "SQ271234", expiry: "2027-03-10" }],
    pharmacist: { nameEn: "Shirin Sultana", nameBn: "শিরিন সুলতানা", councilNo: "PCB-B-10234" },
    at: Date.UTC(2026, 8, 28, 6),
  }

  it("prints the Bangla dose words, meal timing, given and outstanding quantities", () => {
    const label = buildLabel(input, "bn")
    expect(label.patient).toBe("আব্দুল করিম")
    expect(label.medicine).toBe("Seclo 20 mg")
    expect(label.dose).toContain("সকালে ও রাতে")
    expect(label.dose).toContain("খাবারের আগে")
    expect(label.dose).toContain("১৪ দিন")
    expect(label.given).toBe("দেওয়া হলো: ১৪টি ক্যাপসুল")
    expect(label.outstanding).toContain("বাকি: ১৪টি ক্যাপসুল")
    expect(label.outstanding).toContain("০৫-১০-২০২৬")
    expect(label.batches[0]).toContain("SQ271234")
    expect(label.pharmacist).toContain("PCB-B-10234")
    expect(label.rx).toContain("RX-B1-006300")
  })

  it("can be printed in English, and says when nothing is left", () => {
    const label = buildLabel({ ...input, outstandingQty: 0 }, "en")
    expect(label.given).toBe("Given: 14 capsules")
    expect(label.outstanding).toBe("Nothing left to collect")
    expect(label.dose).toContain("morning and night")
  })
})

describe("paid quantity (a later balance is paid before it is handed over)", () => {
  const rxLine = { id: "rxl_1", paymentCleared: true, qtyPrescribed: 28, dispensedQty: 0 }
  const billed = (id: string, qty: number, status: "open" | "invoiced" | "removed", payerType: "self" | "corporate" = "self") => ({
    id,
    sourceType: "rx-line" as const,
    sourceId: "rxl_1",
    status,
    qty,
    payerType,
  })

  it("counts only paid billing lines of the line", () => {
    const baskets = [billed("bl_1", 14, "invoiced"), billed("bl_2", 14, "open"), billed("bl_3", 5, "removed")]
    expect(paidUnitsOf(rxLine, baskets)).toBe(14)
    expect(paidUnitsOf({ ...rxLine, paymentCleared: false }, baskets)).toBe(0)
    // After 14 are handed over the balance is not paid: the gate closes again.
    const after = { ...rxLine, dispensedQty: 14, status: "partial" as const, brandId: "brd_x", balanceUntil: undefined }
    expect(paidAndOwed(after, 14)).toBe(0)
    expect(dispenseBlock(after, 0, 14)).toBe("unpaid")
    expect(dispenseBlock(after, 0, 28)).toBeNull()
    expect(paidAndOwed(after, 28)).toBe(14)
  })

  it("treats corporate cover and lines cleared without a bill of their own as paid in full", () => {
    expect(paidUnitsOf(rxLine, [])).toBe(28)
    expect(paidUnitsOf(rxLine, [billed("bl_1", 14, "open", "corporate")])).toBe(28)
  })

  it("never counts a billing line whose invoice is not fully paid, or was refunded", () => {
    const baskets = [billed("bl_1", 14, "invoiced"), billed("bl_2", 14, "invoiced"), billed("bl_3", 7, "invoiced")]
    const unpaid = unpaidBilledLines(
      baskets,
      [
        { basketLineId: "bl_1", invoiceId: "inv_paid", status: "active" },
        { basketLineId: "bl_2", invoiceId: "inv_pending", status: "active" },
        { basketLineId: "bl_3", invoiceId: "inv_paid", status: "refunded" },
      ],
      (id) => (id === "inv_paid" ? "paid" : "partial")
    )
    expect([...unpaid].sort()).toEqual(["bl_2", "bl_3"])
    expect(paidUnitsOf(rxLine, baskets, unpaid)).toBe(14)
  })
})

describe("substitution candidates", () => {
  it("are other brands of the same generic and strength", () => {
    const monas10 = { id: "monas10", genericId: "montelukast", strength: "10 mg" }
    expect(isEquivalentBrand(monas10, { id: "lumona10", genericId: "montelukast", strength: "10mg" })).toBe(true)
    expect(isEquivalentBrand(monas10, { id: "montair5", genericId: "montelukast", strength: "5 mg" })).toBe(false)
    expect(isEquivalentBrand(monas10, { id: "fexo120", genericId: "fexofenadine", strength: "10 mg" })).toBe(false)
    expect(isEquivalentBrand(monas10, monas10)).toBe(false)
  })
})
