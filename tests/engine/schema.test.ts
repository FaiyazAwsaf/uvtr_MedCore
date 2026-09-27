import { afterEach, describe, expect, it } from "vitest"

import { baseFields } from "@/core/db/base"
import { ControlDb } from "@/core/db/control"
import { MedcoreDb } from "@/core/db/database"
import type { PatientRow, StockLevelRow } from "@/core/db/schema"
import { TABLE_NAMES } from "@/core/db/tables"

const opened: { delete: () => Promise<void> }[] = []
afterEach(async () => {
  while (opened.length) await opened.pop()!.delete()
})

function patient(id: string, uhid: string): PatientRow {
  return {
    ...baseFields(id, 1_000),
    uhid,
    aliases: [],
    identityStatus: "active",
    nameEn: "Abdul Karim",
    nameBn: "আব্দুল করিম",
    nameSearchKeys: ["abdul", "karim"],
    dob: "1964-03-02",
    sex: "M",
    phone: "01711-523418",
    phoneVerified: true,
    allergies: [],
    currentMeds: [],
    problems: [],
    photoSeed: "x",
    consents: [],
    registeredAtBranch: "B1",
  }
}

describe("database schema", () => {
  it("opens a central database with every domain and platform table", async () => {
    const db = new MedcoreDb("test-central-open")
    opened.push(db)
    await db.open()
    const names = db.tables.map((t) => t.name)
    for (const name of TABLE_NAMES) expect(names).toContain(name)
    for (const name of ["events", "audit", "counters", "idempotency", "appliedCommits"])
      expect(names).toContain(name)
    expect(names).not.toContain("outbox")
  })

  it("adds the outbox only to edge databases", async () => {
    const edge = new MedcoreDb("test-edge-open", "edge", "B1")
    opened.push(edge)
    await edge.open()
    expect(edge.tables.map((t) => t.name)).toContain("outbox")
    expect(edge.edgeBranch).toBe("B1")
  })

  it("supports indexed, multi-entry and compound queries", async () => {
    const db = new MedcoreDb("test-indexes")
    opened.push(db)
    await db.patients.bulkAdd([patient("p1", "10000000018"), patient("p2", "10000000026")])
    expect(await db.patients.where("nameSearchKeys").equals("karim").count()).toBe(2)
    expect((await db.patients.where("uhid").equals("10000000026").first())?.id).toBe("p2")
    // The UHID index is unique.
    await expect(db.patients.add(patient("p3", "10000000018"))).rejects.toThrow()

    const level: StockLevelRow = {
      ...baseFields("sl1", 1_000),
      branchId: "B1",
      brandId: "brand_napa500",
      batchId: "bat1",
      qty: 40,
      quarantinedQty: 0,
      inTransitIn: 0,
      inTransitOut: 0,
      asAt: 1_000,
    }
    await db.stockLevels.add(level)
    const hits = await db.stockLevels
      .where("[branchId+brandId]")
      .equals(["B1", "brand_napa500"])
      .toArray()
    expect(hits.map((h) => h.id)).toEqual(["sl1"])
  })

  it("opens the control database", async () => {
    const control = new ControlDb("test-control")
    opened.push(control)
    await control.clock.put({ id: "clock", offsetMs: 900_000, updatedAt: 1 })
    expect((await control.clock.get("clock"))?.offsetMs).toBe(900_000)
  })
})
