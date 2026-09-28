import { describe, expect, it } from "vitest"

import { formatTyping, isoToDmy, parseDmy } from "@/modules/identity/dmy"

describe("DD-MM-YYYY entry", () => {
  it("formats digits as they are typed", () => {
    expect(formatTyping("1")).toBe("1")
    expect(formatTyping("120")).toBe("12-0")
    expect(formatTyping("12031978")).toBe("12-03-1978")
    expect(formatTyping("12-03-19789")).toBe("12-03-1978")
    expect(formatTyping("১২০৩১৯৭৮")).toBe("12-03-1978")
    expect(formatTyping("1978-03-12")).toBe("12-03-1978")
  })

  it("parses only complete, real dates", () => {
    expect(parseDmy("12-03-1978")).toBe("1978-03-12")
    expect(parseDmy("১২-০৩-১৯৭৮")).toBe("1978-03-12")
    expect(parseDmy("1978-03-12")).toBe("1978-03-12")
    expect(parseDmy("12-03-197")).toBe("")
    expect(parseDmy("31-02-2020")).toBe("")
    expect(parseDmy("29-02-2024")).toBe("2024-02-29")
    expect(parseDmy("12-13-1978")).toBe("")
    expect(isoToDmy("1978-03-12")).toBe("12-03-1978")
  })
})
