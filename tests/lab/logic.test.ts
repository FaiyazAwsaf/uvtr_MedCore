import { describe, expect, it } from "vitest"

import type { Analyte } from "@/core/db/schema"
import {
  deltaCheck,
  digitsOnly,
  flagValue,
  formatRange,
  inboxKindFor,
  initialsOf,
  previousFor,
  reportHash,
  resultText,
  secondIdentifierMatch,
} from "@/modules/lab/logic"

const patient = { dob: "1964-05-07", phone: "01711-523418" }

describe("second identifier (HAZ-01)", () => {
  it("accepts the date of birth in the usual forms, Bangla digits too", () => {
    for (const typed of [
      "07-05-1964",
      "7/5/1964",
      "07051964",
      "1964-05-07",
      "০৭-০৫-১৯৬৪",
    ]) {
      expect(secondIdentifierMatch(patient, typed), typed).toBe("dob")
    }
  })

  it("accepts the last four phone digits, or the attendant's", () => {
    expect(secondIdentifierMatch(patient, "3418")).toBe("phone")
    expect(secondIdentifierMatch(patient, "৩৪১৮")).toBe("phone")
    expect(
      secondIdentifierMatch(
        { dob: "2018-01-01", attendantPhone: "01819-000777" },
        "0777"
      )
    ).toBe("phone")
  })

  it("rejects anything else", () => {
    for (const typed of [
      "",
      "1234",
      "05-07-1964",
      "341",
      "01711523418",
      "1964",
    ]) {
      expect(secondIdentifierMatch(patient, typed), typed).toBeNull()
    }
    expect(digitsOnly("০১৭-১১")).toBe("01711")
  })
})

const WBC: Analyte = {
  code: "WBC",
  name: "Total WBC count",
  units: "x10^9/L",
  decimals: 1,
  ranges: [{ low: 4, high: 11 }],
  criticalLow: 2,
  criticalHigh: 30,
}
const PROTEIN: Analyte = {
  code: "UPRO",
  name: "Protein",
  decimals: 0,
  ranges: [{ text: "Nil" }],
  qualitative: true,
}

describe("flags and ranges", () => {
  it("flags numbers against the range and the critical limits", () => {
    expect(flagValue(WBC, 12.8, "M", 62)).toBe("H")
    expect(flagValue(WBC, 7, "M", 62)).toBe("N")
    expect(flagValue(WBC, 3.1, "M", 62)).toBe("L")
    expect(flagValue(WBC, 31, "M", 62)).toBe("HH")
    expect(flagValue(WBC, 1.5, "M", 62)).toBe("LL")
  })

  it("flags qualitative text that is not the normal text", () => {
    expect(flagValue(PROTEIN, "nil", "F", 30)).toBe("N")
    expect(flagValue(PROTEIN, "Trace", "F", 30)).toBe("A")
  })

  it("formats ranges and values with Latin digits", () => {
    expect(formatRange({ low: 4, high: 11 }, 1)).toBe("4.0 - 11.0")
    expect(formatRange({ high: 200 }, 0)).toBe("< 200")
    expect(formatRange({ low: 40 }, 0)).toBe("> 40")
    expect(formatRange({ text: "Negative" }, 0)).toBe("Negative")
    expect(formatRange(undefined, 0)).toBe("-")
    expect(resultText({ value: 12.8, text: undefined }, 1)).toBe("12.8")
    expect(resultText({ value: null, text: "Nil" }, 0)).toBe("Nil")
  })
})

describe("delta check", () => {
  it("flags changes beyond the analyte's limit", () => {
    expect(deltaCheck("HB", 9, 13).flagged).toBe(true)
    expect(deltaCheck("HB", 12.5, 13).flagged).toBe(false)
    expect(deltaCheck("ZZZ", 100, 80).flagged).toBe(false)
    expect(deltaCheck("ZZZ", 100, 50).flagged).toBe(true)
  })

  it("picks the latest earlier validated value from another item", () => {
    const rows = [
      {
        analyteCode: "HB",
        labOrderItemId: "a",
        status: "validated" as const,
        value: 11,
        createdAt: 10,
      },
      {
        analyteCode: "HB",
        labOrderItemId: "b",
        status: "validated" as const,
        value: 12,
        createdAt: 20,
      },
      {
        analyteCode: "HB",
        labOrderItemId: "c",
        status: "pending" as const,
        value: 13,
        createdAt: 30,
      },
      {
        analyteCode: "HB",
        labOrderItemId: "now",
        status: "validated" as const,
        value: 9,
        createdAt: 25,
      },
    ]
    expect(previousFor(rows, "HB", "now", 40)?.value).toBe(12)
    expect(previousFor(rows, "HB", "now", 15)?.value).toBe(11)
    expect(previousFor(rows, "K", "now", 40)).toBeUndefined()
  })
})

describe("reports", () => {
  it("picks the doctor inbox kind", () => {
    expect(inboxKindFor([{ flag: "N", critical: false }])).toBe("result")
    expect(
      inboxKindFor([
        { flag: "N", critical: false },
        { flag: "H", critical: false },
      ])
    ).toBe("abnormal")
    expect(
      inboxKindFor([
        { flag: "HH", critical: true },
        { flag: "H", critical: false },
      ])
    ).toBe("critical")
  })

  it("hashes the signed content deterministically, whatever the result order", () => {
    const report = {
      reportNo: "RPT-B1-000100",
      reportVersion: 1,
      patientId: "pat_1",
      labOrderId: "lo_1",
      itemIds: ["i1", "i2"],
      signedBy: "stf_mizanur_rahman",
      signedAt: 1_000,
    }
    const a = {
      labOrderItemId: "i1",
      testId: "lt_cbc",
      analyteCode: "WBC",
      value: 12.8,
      unit: "x10^9/L",
      flag: "H" as const,
    }
    const b = {
      labOrderItemId: "i2",
      testId: "lt_crp",
      analyteCode: "CRP",
      value: 48,
      unit: "mg/L",
      flag: "H" as const,
    }
    const other = { ...a, labOrderItemId: "elsewhere" }
    const hash = reportHash(report, [a, b])
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(reportHash(report, [b, other, a])).toBe(hash)
    expect(reportHash(report, [a, { ...b, value: 4.8 }])).not.toBe(hash)
    expect(reportHash({ ...report, reportVersion: 2 }, [a, b])).not.toBe(hash)
  })

  it("shows initials only", () => {
    expect(initialsOf("Abdul Karim")).toBe("A. K.")
    expect(initialsOf("Md. Rafiqul Islam")).toBe("R. I.")
    expect(initialsOf("Jahanara Begum")).toBe("J. B.")
  })
})
