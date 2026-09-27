import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { verifyChain } from "@/core/audit/verify"
import { applyClockOffset } from "@/core/clock/clock"
import { baseFields } from "@/core/db/base"
import { getControlDb } from "@/core/db/control"
import { getCentralDb, getEdgeDb, type MedcoreDb } from "@/core/db/database"
import { isValidUhid } from "@/core/db/numbering"
import type { PatientRow, StockLevelRow } from "@/core/db/schema"
import { ensureSeeded, resetDemo } from "@/core/demo/reset"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { nextUhid } from "@/core/engine/docNumbers"
import type { Actor } from "@/core/engine/types"
import { PERSONAS } from "@/core/seed/content/personas"
import { nameKeys } from "@/core/search/fuzzy"
import { cutBranch } from "@/core/sync/offline"
import { reconnectBranch, replayEntry } from "@/core/sync/replay"

const b1: Actor = {
  staffId: "stf_farhana_akter",
  personaId: "per_reception_farhana",
  role: "receptionist",
  branchId: "B1",
  name: "Farhana Akter",
  authorities: [],
}
const b3: Actor = { ...b1, staffId: "stf_sumon_das", personaId: "per_reception_sumon", branchId: "B3", name: "Sumon Das" }

function patient(id: string, over: Partial<PatientRow> = {}): PatientRow {
  return {
    ...baseFields(id, 1_000),
    uhid: `U-${id}`,
    aliases: [],
    identityStatus: "active",
    nameEn: "Salma Khatun",
    nameBn: "সালমা খাতুন",
    nameSearchKeys: ["salma", "khatun"],
    dob: "1985-06-01",
    sex: "F",
    phone: "01700-000001",
    phoneVerified: true,
    allergies: [],
    currentMeds: [],
    problems: [],
    photoSeed: id,
    consents: [],
    registeredAtBranch: "B1",
    ...over,
  }
}

function stock(id: string, qty: number): StockLevelRow {
  return {
    ...baseFields(id, 1_000),
    branchId: "B1",
    brandId: "brand_napa500",
    batchId: "bat_1",
    qty,
    quarantinedQty: 0,
    inTransitIn: 0,
    inTransitOut: 0,
    asAt: 1_000,
  }
}

const updatePatient = defineCommand({
  name: "test.updatePatient",
  roles: "any",
  input: z.object({
    patientId: z.string(),
    patch: z.object({ phone: z.string().optional(), nameEn: z.string().optional() }),
  }),
  async run(tx, input) {
    await tx.update("patients", input.patientId, input.patch)
  },
})

const register = defineCommand({
  name: "test.register",
  roles: "any",
  input: z.object({ nameEn: z.string(), dob: z.string(), nid: z.string() }),
  async run(tx, input) {
    const { uhid, provisional } = await nextUhid(tx)
    const row = tx.insert("patients", {
      uhid,
      provisionalUhid: provisional ? uhid : undefined,
      aliases: [],
      identityStatus: "active",
      nameEn: input.nameEn,
      nameBn: input.nameEn,
      nameSearchKeys: nameKeys(input.nameEn),
      dob: input.dob,
      sex: "M",
      nid: input.nid,
      phoneVerified: false,
      allergies: [],
      currentMeds: [],
      problems: [],
      photoSeed: "x",
      consents: [],
      registeredAtBranch: tx.actor.branchId ?? "B1",
    })
    tx.emit("PatientContactUpdated", { refs: { patientId: row.id } })
    return { id: row.id, uhid, provisional }
  },
})

const takeStock = defineCommand({
  name: "test.takeStock",
  roles: "any",
  input: z.object({ id: z.string(), qty: z.number() }),
  async run(tx, input) {
    const level = await tx.get("stockLevels", input.id)
    await tx.update("stockLevels", input.id, { qty: level.qty - input.qty })
  },
})

let central: MedcoreDb
beforeEach(async () => {
  applyClockOffset(0)
  await resetDemo()
  central = getCentralDb()
})

describe("demo reset", () => {
  it("re-seeds personas, writes the genesis audit row and brings every branch online", async () => {
    expect(await central.personas.count()).toBe(PERSONAS.length)
    expect(await verifyChain(central)).toEqual({ ok: true, count: 1 })
    expect((await central.events.toArray()).map((e) => e.type)).toEqual(["DemoReset"])
    const network = await getControlDb().network.toArray()
    expect(network.every((n) => n.status === "online")).toBe(true)
    expect(await ensureSeeded()).toBe(false)
  })
})

describe("branch offline and resync", () => {
  it("keeps edge work invisible to central, then replays it in order", async () => {
    await central.patients.add(patient("p1"))
    await central.stockLevels.add(stock("sl1", 20))

    await cutBranch("B1")
    expect((await getControlDb().network.get("B1"))?.status).toBe("offline")
    const edge = getEdgeDb("B1")
    expect(await edge.patients.get("p1")).toBeDefined()

    // Work at the offline branch.
    await commit(updatePatient, { patientId: "p1", patch: { phone: "01700-777777" } }, { db: edge, actor: b1 })
    const offlineReg = await commit(
      register,
      { nameEn: "Mohammad Rafiqul Islam", dob: "1978-03-12", nid: "2000000000001" },
      { db: edge, actor: b1 }
    )
    expect(offlineReg.result.provisional).toBe(true)
    expect(offlineReg.result.uhid).toBe("P-B1-000001")
    await commit(takeStock, { id: "sl1", qty: 5 }, { db: edge, actor: b1 })
    expect(await edge.outbox.count()).toBe(3)

    // Central carries on and cannot see any of it.
    expect((await central.patients.get("p1"))?.phone).toBe("01700-000001")
    expect(await central.patients.get(offlineReg.result.id)).toBeUndefined()
    await commit(
      register,
      { nameEn: "Md. Rafiqul Islam", dob: "1978-03-12", nid: "2000000000002" },
      { db: central, actor: b3 }
    )
    await commit(takeStock, { id: "sl1", qty: 3 }, { db: central, actor: b3 })

    const progress: number[] = []
    const outcome = await reconnectBranch("B1", (p) => progress.push(p.done))
    expect(outcome).toMatchObject({ count: 3, conflicts: 1, skipped: 0, edgeChainOk: true })
    expect(progress).toEqual([1, 2, 3])

    // Contact change applied; stock merged as deltas (20 - 3 central - 5 edge).
    expect((await central.patients.get("p1"))?.phone).toBe("01700-777777")
    expect((await central.stockLevels.get("sl1"))?.qty).toBe(12)

    // The offline registration got a permanent UHID and went to review, not merged.
    const replayed = await central.patients.get(offlineReg.result.id)
    expect(replayed?.identityStatus).toBe("under-review")
    expect(isValidUhid(replayed!.uhid)).toBe(true)
    expect(replayed?.aliases).toContain("P-B1-000001")
    expect(replayed?.origin).toBe("edge:B1")
    // The seed carries history from an earlier B2 outage; look at this run only.
    const reviews = await central.reviewQueue.where("branchId").equals("B1").toArray()
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ kind: "sync-duplicate", status: "open", branchId: "B1" })

    // Events keep their origin; commits are recorded as applied; chain intact.
    // Only events that happened at the branch carry its origin and a replay time;
    // the duplicate flag raised while syncing is a central event.
    const carried = await central.events.filter((e) => e.replayedAt !== undefined).toArray()
    expect(carried.map((e) => e.type)).toEqual(["PatientContactUpdated"])
    expect(carried[0]).toMatchObject({ origin: "edge:B1", actor: { staffId: "stf_farhana_akter" } })
    const flagged = await central.events.where("type").equals("IdentityConflictQueued").first()
    expect(flagged).toMatchObject({ origin: "central", branchId: "B1" })
    expect(await central.appliedCommits.count()).toBe(3)
    expect((await verifyChain(central)).ok).toBe(true)
    expect((await getControlDb().network.get("B1"))?.status).toBe("online")
    const types = (await central.events.toArray()).map((e) => e.type)
    expect(types).toContain("BranchWentOffline")
    expect(types).toContain("EdgeEventsReplayed")
  })

  it("replays each outbox entry at most once", async () => {
    await central.patients.add(patient("p1"))
    await cutBranch("B1")
    const edge = getEdgeDb("B1")
    await commit(updatePatient, { patientId: "p1", patch: { phone: "01700-555555" } }, { db: edge, actor: b1 })
    const [entry] = await edge.outbox.toArray()
    expect((await replayEntry(central, entry, "B1")).applied).toBe(true)
    expect((await replayEntry(central, entry, "B1")).applied).toBe(false)
    expect((await central.patients.get("p1"))?.version).toBe(2)
  })

  it("sends identity conflicts to the data steward and keeps the central value", async () => {
    await central.patients.add(patient("p1"))
    await cutBranch("B1")
    await commit(updatePatient, { patientId: "p1", patch: { nameEn: "Salma Akter" } }, { db: getEdgeDb("B1"), actor: b1 })
    await commit(updatePatient, { patientId: "p1", patch: { nameEn: "Salma Begum" } }, { db: central, actor: b3 })
    const outcome = await reconnectBranch("B1")
    expect(outcome.conflicts).toBe(1)
    expect((await central.patients.get("p1"))?.nameEn).toBe("Salma Begum")
    const review = await central.reviewQueue
      .where("kind")
      .equals("identity-conflict")
      .filter((r) => r.branchId === "B1")
      .first()
    expect(review?.fields?.[0]).toMatchObject({ field: "nameEn", edgeValue: "Salma Akter", centralValue: "Salma Begum" })
  })

  it("reports stock that ends negative instead of reversing it", async () => {
    await central.stockLevels.add(stock("sl1", 5))
    await cutBranch("B1")
    await commit(takeStock, { id: "sl1", qty: 4 }, { db: getEdgeDb("B1"), actor: b1 })
    await commit(takeStock, { id: "sl1", qty: 3 }, { db: central, actor: b3 })
    await reconnectBranch("B1")
    expect((await central.stockLevels.get("sl1"))?.qty).toBe(-2)
    const exception = await central.syncExceptions
      .where("kind")
      .equals("stock-negative")
      .filter((x) => x.rowId === "sl1")
      .first()
    expect(exception).toMatchObject({ branchId: "B1", rowId: "sl1", status: "open" })
  })
})
