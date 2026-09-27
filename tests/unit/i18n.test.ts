import { describe, expect, it } from "vitest"

import { bnFlat, enFlat } from "@/scripts/i18n-lib"

const EM_DASH = String.fromCharCode(0x2014)

describe("dictionaries", () => {
  it("have the same keys in English and Bangla", () => {
    expect([...bnFlat.keys()].sort()).toEqual([...enFlat.keys()].sort())
  })

  it("contain no empty strings and no em dashes", () => {
    for (const flat of [enFlat, bnFlat]) {
      for (const [key, value] of flat) {
        expect(value.trim(), key).not.toBe("")
        expect(value.includes(EM_DASH), key).toBe(false)
      }
    }
  })
})
