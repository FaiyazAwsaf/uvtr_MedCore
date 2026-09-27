import { describe, expect, it } from "vitest"

describe("engine test environment", () => {
  it("provides an in-memory IndexedDB for Dexie", () => {
    expect(typeof indexedDB.open).toBe("function")
  })
})
