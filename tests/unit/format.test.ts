import { afterEach, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { addDaysISO, ageOn, atDhaka, dhakaDate, dhakaTime } from "@/core/clock/dates"
import { canAccess } from "@/core/rbac/routes"
import { formatDmy, formatMoney, formatRelative, formatUhid } from "@/lib/i18n/format"

afterEach(() => applyClockOffset(0))

describe("money", () => {
  it("uses lakh/crore grouping from poisha, in both languages", () => {
    expect(formatMoney(12_345_600, "en")).toBe("৳1,23,456")
    expect(formatMoney(12_345_650, "en")).toBe("৳1,23,456.50")
    expect(formatMoney(12_345_600, "bn")).toBe("৳১,২৩,৪৫৬")
    expect(formatMoney(-50_000, "en")).toBe("-৳500")
  })
})

describe("dates", () => {
  it("formats DD-MM-YYYY in Dhaka time", () => {
    // 2026-09-27 20:30 UTC is 2026-09-28 02:30 in Dhaka.
    const moment = Date.UTC(2026, 8, 27, 20, 30)
    expect(formatDmy(moment, "en")).toBe("28-09-2026")
    expect(formatDmy(moment, "bn")).toBe("২৮-০৯-২০২৬")
    expect(dhakaDate(moment)).toBe("2026-09-28")
    expect(dhakaTime(moment)).toBe("02:30")
    expect(dhakaDate(atDhaka("2026-09-28", "10:00"))).toBe("2026-09-28")
    expect(addDaysISO("2026-09-28", 7)).toBe("2026-10-05")
    expect(ageOn("1964-09-29", "2026-09-28")).toBe(61)
  })

  it("measures relative time from the shared demo clock", () => {
    const tenMinutesAgo = now() - 10 * 60_000
    expect(formatRelative(tenMinutesAgo, "en")).toBe("10 minutes ago")
    applyClockOffset(20 * 60_000)
    expect(formatRelative(tenMinutesAgo, "en")).toBe("30 minutes ago")
    expect(formatRelative(tenMinutesAgo, "bn")).toBe("৩০ মিনিট আগে")
  })

  it("keeps identifiers in Latin digits", () => {
    expect(formatUhid("10000000424")).toBe("1000-0000-42-4")
  })
})

describe("route access", () => {
  it("lets each role into its own area only", () => {
    expect(canAccess("pharmacist", "/pharmacy/dispense/x")).toBe(true)
    expect(canAccess("cashier", "/pharmacy")).toBe(false)
    expect(canAccess("doctor", "/library/brand/b1")).toBe(true)
    expect(canAccess("patient", "/library")).toBe(false)
    expect(canAccess("patient", "/app/reports")).toBe(true)
    expect(canAccess(null, "/display/B1")).toBe(true)
    expect(canAccess(null, "/doctor")).toBe(false)
    expect(canAccess("ceo", "/patient-360/p1")).toBe(true)
  })
})

describe("Bangla clock time", () => {
  it("says the day period in words, before the time, with Bangla digits", async () => {
    const { formatDateTime, formatTime } = await import("@/lib/i18n/format")
    const at = (h: number, m: number) => Date.UTC(2026, 8, 29, h - 6, m)
    expect(formatTime(at(11, 30), "bn")).toBe("সকাল ১১:৩০")
    expect(formatTime(at(17, 5), "bn")).toBe("বিকাল ৫:০৫")
    expect(formatTime(at(11, 30), "en")).toMatch(/^11:30\s?am$/i)
    expect(formatDateTime(at(19, 45), "bn")).toMatch(/^২৯ .+, সন্ধ্যা ৭:৪৫$/)
    expect(formatTime(at(11, 30), "bn")).not.toMatch(/[AP]M/)
  })
})
