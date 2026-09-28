import { describe, expect, it } from "vitest"

import { ruleMessage } from "@/components/shared/rule-message"
import { dictionaries, interpolate, lookup } from "@/lib/i18n"
import type { Locale } from "@/lib/i18n/config"
import {
  formatDmy,
  formatMoney,
  formatNumber,
  formatUhid,
} from "@/lib/i18n/format"

function formatters(locale: Locale) {
  return {
    locale,
    tk: (key: string, params?: Record<string, string | number>) =>
      interpolate(lookup(dictionaries[locale], key), params),
    num: (value: number) => formatNumber(value, locale),
    money: (poisha: number) => formatMoney(poisha, locale),
    dmy: (value: string | number | Date) => formatDmy(value, locale),
    uhid: formatUhid,
  }
}

describe("ruleMessage", () => {
  const en = formatters("en")

  it("reads the engine's shared rules", () => {
    const message = ruleMessage("NID_EXISTS", {}, en)
    expect(message).toBe(lookup(dictionaries.en, "rules.NID_EXISTS"))
  })

  it("finds a module's own code on any screen", () => {
    expect(ruleMessage("SESSION_FULL", {}, en)).toBe(
      lookup(dictionaries.en, "scheduling.rules.SESSION_FULL")
    )
    expect(ruleMessage("TOKEN_STATE", { token: "M-7" }, en)).toContain("M-7")
  })

  it("prefers the refusing command's module when two modules share a code", () => {
    const billing = ruleMessage(
      "PATIENT_MERGED",
      { uhid: "1234567890" },
      en,
      "billing.checkout"
    )
    const identity = ruleMessage(
      "PATIENT_MERGED",
      { uhid: "1234567890" },
      en,
      "identity.register"
    )
    expect(billing).toContain("Bill the surviving record")
    expect(identity).toContain("Search again")
  })

  it("formats params in the window's language", () => {
    const bn = formatters("bn")
    const message = ruleMessage(
      "TENDER_MISMATCH",
      { tenderedP: 50000, dueP: 80000 },
      bn,
      "billing.checkout"
    )
    expect(message).toContain(formatMoney(80000, "bn"))
  })

  it("falls back to the code for an unknown rule", () => {
    expect(ruleMessage("NO_SUCH_RULE", {}, en)).toContain("NO_SUCH_RULE")
  })
})
