import { describe, expect, it } from "vitest"

import { DAY } from "@/core/clock/dates"
import { buildLabel, type LabelInput } from "@/modules/pharmacy/label"
import {
  balanceDaysLeft,
  balanceExpired,
  courseEndDate,
  dispenseBlock,
  expiresBeforeCourseEnd,
  matchIdentity,
  packBreakdown,
  queueStatusFor,
  roundToStrips,
  stripSizeOf,
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
