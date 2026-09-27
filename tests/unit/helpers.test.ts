import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { applyClockOffset } from "@/core/clock/clock"
import { sweepOnce } from "@/core/clock/sweeper"
import { smsParts, queueSms } from "@/core/comms/sms"
import { baseFields, seedRow } from "@/core/db/base"
import { MedcoreDb } from "@/core/db/database"
import type {
  BatchRow,
  BrandRow,
  GenericRow,
  LabOrderItemRow,
  LabTestRow,
  PharmaCompanyRow,
  ReorderLevelRow,
  StockLevelRow,
} from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Actor } from "@/core/engine/types"
import { createSpecimensForItems } from "@/core/lab/specimens"
import { rankMedicines } from "@/core/search/medicines"
import { fefoAllocate, stockByBranch, stockStatus } from "@/core/stock/availability"
import { commsJobs } from "@/modules/comms/jobs"
import { renderSms } from "@/modules/comms/templates"

const at = 1_000
const brand = (id: string, name: string, genericId: string, companyId: string, strength = "500 mg"): BrandRow =>
  seedRow<BrandRow>(id, at, {
    name,
    genericId,
    companyId,
    strength,
    form: "tablet",
    darNo: "DAR-1",
    packSizes: [{ label: "10 x 10", units: 100, stripSize: 10 }],
    unitPriceP: 120,
    mrpP: 120,
    category: "otc",
    isAntibiotic: false,
    searchKeys: [name.toLowerCase()],
    unitLabel: { en: "tablet", bn: "ট্যাবলেট" },
  })
const generic = (id: string, name: string): GenericRow =>
  seedRow<GenericRow>(id, at, {
    name,
    classId: "cls",
    indications: "",
    dosage: "",
    contraindications: "",
    sideEffects: "",
    pregnancyCategory: "B",
    interactionsNote: "licensed content, Release 2",
    isAntibiotic: false,
  })
const company = (id: string, name: string, shortName: string): PharmaCompanyRow =>
  seedRow<PharmaCompanyRow>(id, at, { name, shortName })

describe("medicine search (HAZ-04)", () => {
  const catalog = {
    brands: [
      brand("b_napa", "Napa", "g_para", "c_bex"),
      brand("b_ace", "Ace", "g_para", "c_sq"),
      brand("b_seclo", "Seclo", "g_omep", "c_sq", "20 mg"),
    ],
    generics: [generic("g_para", "Paracetamol"), generic("g_omep", "Omeprazole")],
    companies: [company("c_bex", "Beximco Pharmaceuticals", "Beximco"), company("c_sq", "Square Pharmaceuticals", "Square")],
    classes: [],
  }

  it("finds brands by name and by generic, alphabetically within equal relevance", () => {
    expect(rankMedicines("napa", catalog)[0]).toMatchObject({ kind: "brand", brandId: "b_napa" })
    const byGeneric = rankMedicines("paracetamol", catalog)
    expect(byGeneric[0]).toMatchObject({ kind: "generic", id: "g_para" })
    expect(byGeneric.slice(1).map((h) => h.label)).toEqual(["Ace 500 mg", "Napa 500 mg"])
  })

  it("finds companies", () => {
    expect(rankMedicines("beximco", catalog).some((h) => h.kind === "company" && h.id === "c_bex")).toBe(true)
  })
})

describe("stock status and FEFO", () => {
  const level = (id: string, branch: "B1" | "B3", batchId: string, qty: number): StockLevelRow => ({
    ...baseFields(id, at),
    branchId: branch,
    brandId: "b_zimax",
    batchId,
    qty,
    quarantinedQty: 0,
    inTransitIn: 0,
    inTransitOut: 0,
    asAt: at,
  })
  const reorder: ReorderLevelRow[] = [
    { ...baseFields("r1", at), branchId: "B1", brandId: "b_zimax", reorderLevel: 20, reorderQty: 100 },
  ]
  const batch = (id: string, expiry: string, status: BatchRow["status"] = "ok"): BatchRow =>
    seedRow<BatchRow>(id, at, { brandId: "b_zimax", batchNo: id, expiry, costP: 100, mrpP: 150, status })

  it("reads in stock, low, other branch and out, and hides other branches offline", () => {
    const levels = [level("l1", "B1", "bt1", 0), level("l2", "B3", "bt2", 40)]
    const by = stockByBranch("b_zimax", levels, reorder)
    expect(stockStatus("B1", by)).toMatchObject({ status: "other-branch", otherBranches: ["B3"] })
    expect(stockStatus("B1", by, { offline: true }).status).toBe("out")
    expect(stockStatus("B1", stockByBranch("b_zimax", [level("l1", "B1", "bt1", 10)], reorder)).status).toBe("low")
    expect(stockStatus("B1", stockByBranch("b_zimax", [level("l1", "B1", "bt1", 50)], reorder)).status).toBe("in-stock")
  })

  it("allocates first-expiry-first-out, skipping expired and quarantined batches", () => {
    const batches = [batch("late", "2027-06-30"), batch("soon", "2026-11-30"), batch("old", "2026-01-31"), batch("held", "2026-10-31", "quarantine")]
    const levels = [level("a", "B1", "late", 30), level("b", "B1", "soon", 10), level("c", "B1", "old", 50), level("d", "B1", "held", 50)]
    const { picks, shortfall } = fefoAllocate(25, "B1", "b_zimax", levels, batches, "2026-09-28")
    expect(picks.map((p) => [p.batch.id, p.take])).toEqual([["soon", 10], ["late", 15]])
    expect(shortfall).toBe(0)
    expect(fefoAllocate(60, "B1", "b_zimax", levels, batches, "2026-09-28").shortfall).toBe(20)
  })
})

describe("SMS", () => {
  it("counts parts: English GSM 160/153, Bangla UCS-2 70/67", () => {
    expect(smsParts("a".repeat(160))).toEqual({ parts: 1, encoding: "GSM" })
    expect(smsParts("a".repeat(161))).toEqual({ parts: 2, encoding: "GSM" })
    expect(smsParts("ক".repeat(70))).toEqual({ parts: 1, encoding: "UCS-2" })
    expect(smsParts("ক".repeat(71))).toEqual({ parts: 2, encoding: "UCS-2" })
  })

  it("renders templates without clinical content", () => {
    const text = renderSms("report-ready", "en", {})
    expect(text).toContain("City Care")
    expect(text).not.toMatch(/\{\w+\}/)
  })
})

describe("engine helpers", () => {
  let db: MedcoreDb
  let n = 0
  const actor: Actor = { staffId: "stf_rafiq_ahmed", role: "cashier", branchId: "B1", name: "Rafiq", authorities: [] }
  beforeEach(async () => {
    db = new MedcoreDb(`helpers-${++n}`)
    await db.open()
  })
  afterEach(async () => {
    applyClockOffset(0)
    await db.delete()
  })

  const test = (id: string, container: LabTestRow["container"], volumeMl: number): LabTestRow =>
    seedRow<LabTestRow>(id, at, {
      code: id,
      name: id.toUpperCase(),
      section: "haematology",
      kind: "lab",
      specimen: "blood",
      container,
      volumeMl,
      tatHours: 4,
      analytes: [],
      stabilityHours: 24,
      sendOut: false,
      signatoryGroup: "pathology",
      priceP: 50_000,
    })
  const item = (id: string, testId: string): LabOrderItemRow =>
    seedRow<LabOrderItemRow>(id, at, {
      labOrderId: "lo1",
      patientId: "p1",
      branchId: "B1",
      testId,
      status: "paid",
      paymentCleared: true,
    })

  it("creates one specimen per container with accession numbers", async () => {
    await db.labTests.bulkAdd([test("cbc", "EDTA", 3), test("hba1c", "EDTA", 2), test("crp", "plain", 4)])
    await db.labOrderItems.bulkAdd([item("i1", "cbc"), item("i2", "hba1c"), item("i3", "crp")])
    const make = defineCommand({
      name: "test.specimens",
      roles: "any",
      input: z.object({}),
      async run(tx) {
        const items = await tx.list("labOrderItems", "labOrderId", "lo1")
        return (await createSpecimensForItems(tx, items)).map((s) => [s.container, s.itemIds.length, s.volumeRemainingMl, s.accessionNo])
      },
    })
    const { result } = await commit(make, {}, { db, actor })
    expect(result).toEqual([
      ["EDTA", 2, 5, "B1-000001"],
      ["plain", 1, 4, "B1-000002"],
    ])
    expect((await db.labOrderItems.get("i1"))?.specimenId).toBeDefined()
  })

  it("queues SMS and the sweeper reports it delivered after the simulated delay", async () => {
    const send = defineCommand({
      name: "test.sms",
      roles: "any",
      input: z.object({}),
      async run(tx) {
        return queueSms(tx, { to: "01711-523418", lang: "bn", templateId: "report-ready" }).id
      },
    })
    const { result: id } = await commit(send, {}, { db, actor })
    expect((await db.sms.get(id))).toMatchObject({ status: "queued", encoding: "UCS-2" })
    await sweepOnce([db], commsJobs)
    expect((await db.sms.get(id))?.status).toBe("queued")
    applyClockOffset(5_000)
    await sweepOnce([db], commsJobs)
    expect((await db.sms.get(id))?.status).toBe("delivered")
  })
})
