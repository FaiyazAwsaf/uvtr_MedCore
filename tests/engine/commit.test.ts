import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { verifyChain } from "@/core/audit/verify"
import { baseFields } from "@/core/db/base"
import { MedcoreDb } from "@/core/db/database"
import type { PatientRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import {
  ConflictError,
  PermissionDenied,
  RuleViolation,
  ValidationError,
} from "@/core/engine/errors"
import type { Actor } from "@/core/engine/types"

const cashier: Actor = {
  staffId: "stf_rafiq_ahmed",
  personaId: "per_cashier_rafiq",
  role: "cashier",
  branchId: "B1",
  name: "Rafiq Ahmed",
  authorities: ["discount:5"],
}
const receptionist: Actor = {
  ...cashier,
  staffId: "stf_farhana_akter",
  personaId: "per_reception_farhana",
  role: "receptionist",
  name: "Farhana Akter",
  authorities: [],
}

let db: MedcoreDb
let n = 0
beforeEach(async () => {
  db = new MedcoreDb(`engine-test-${++n}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

function patient(id: string, over: Partial<PatientRow> = {}): PatientRow {
  return {
    ...baseFields(id, 1_000),
    uhid: `U-${id}`,
    aliases: [],
    identityStatus: "active",
    nameEn: "Test Patient",
    nameBn: "পরীক্ষা রোগী",
    nameSearchKeys: ["test"],
    dob: "1980-01-01",
    sex: "M",
    phoneVerified: false,
    allergies: [],
    currentMeds: [],
    problems: [],
    photoSeed: id,
    consents: [],
    registeredAtBranch: "B1",
    ...over,
  }
}

/* ---------------- test commands ---------------- */

const updatePhone = defineCommand({
  name: "test.updatePhone",
  roles: ["receptionist"],
  input: z.object({
    patientId: z.string(),
    phone: z.string().min(5),
    expectedVersion: z.number(),
  }),
  async run(tx, input) {
    const p = await tx.update(
      "patients",
      input.patientId,
      { phone: input.phone },
      { expectedVersion: input.expectedVersion }
    )
    tx.emit("PatientContactUpdated", { refs: { patientId: p.id } })
    return { version: p.version }
  },
})

const insertThenFail = defineCommand({
  name: "test.insertThenFail",
  roles: "any",
  input: z.object({}),
  async run(tx) {
    tx.insert("patients", { ...patient("a"), id: "p-a" })
    tx.insert("patients", { ...patient("b"), id: "p-b" })
    tx.insert("patients", { ...patient("c"), id: "p-c" })
    tx.emit("PatientContactUpdated")
    await tx.nextNumber("uhid")
    tx.reject("SOMETHING_WRONG")
  },
})

const registerWithNid = defineCommand({
  name: "test.register",
  roles: "any",
  input: z.object({ id: z.string(), nid: z.string() }),
  async run(tx, input) {
    tx.insert("patients", { ...patient(input.id), id: input.id, nid: input.nid, uhid: `U-${input.id}` })
    return input.id
  },
})

const takeStock = defineCommand({
  name: "test.takeStock",
  roles: "any",
  input: z.object({ qty: z.number() }),
  async run(tx, input) {
    const level = await tx.get("stockLevels", "sl1")
    await tx.update("stockLevels", "sl1", { qty: level.qty - input.qty })
  },
})

const pay = defineCommand({
  name: "test.pay",
  roles: ["cashier"],
  input: z.object({ idempotencyKey: z.string(), amountP: z.number() }),
  async run(tx, input) {
    const n = await tx.nextNumber("rcpt:B1")
    tx.insert("receipts", {
      receiptNo: `RC-${n}`,
      invoiceId: "inv1",
      paymentIds: [],
      patientId: "p1",
      branchId: "B1",
      amountP: input.amountP,
      at: tx.now(),
    })
    return { receiptNo: `RC-${n}` }
  },
})

const bump = defineCommand({
  name: "test.bump",
  roles: "any",
  input: z.object({}),
  async run(tx) {
    return tx.nextNumber("serial")
  },
})

/* ---------------- tests ---------------- */

describe("Atomicity", () => {
  it("writes nothing when a command fails after buffering writes", async () => {
    await expect(commit(insertThenFail, {}, { db, actor: cashier })).rejects.toBeInstanceOf(
      RuleViolation
    )
    expect(await db.patients.count()).toBe(0)
    expect(await db.events.count()).toBe(0)
    expect(await db.audit.count()).toBe(0)
    expect(await db.counters.count()).toBe(0)
  })

  it("commits rows, events and audit together", async () => {
    await db.patients.add(patient("p1", { phone: "01700-000001" }))
    const out = await commit(
      updatePhone,
      { patientId: "p1", phone: "01700-999999", expectedVersion: 1 },
      { db, actor: receptionist }
    )
    expect(out.result.version).toBe(2)
    const row = await db.patients.get("p1")
    expect(row?.phone).toBe("01700-999999")
    expect(row?.updatedBy).toBe("stf_farhana_akter")
    const events = await db.events.toArray()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ seq: 1, type: "PatientContactUpdated", commitId: out.commitId })
    const audit = await db.audit.toArray()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: "update",
      entity: "patients",
      entityId: "p1",
      patientId: "p1",
      before: { phone: "01700-000001" },
      after: { phone: "01700-999999" },
    })
  })
})

describe("Consistency", () => {
  it("refuses stock going negative (INV-01)", async () => {
    await db.stockLevels.add({
      ...baseFields("sl1", 1),
      branchId: "B1",
      brandId: "b1",
      batchId: "bt1",
      qty: 10,
      quarantinedQty: 0,
      inTransitIn: 0,
      inTransitOut: 0,
      asAt: 1,
    })
    await expect(commit(takeStock, { qty: 11 }, { db, actor: cashier })).rejects.toMatchObject({
      code: "STOCK_NEGATIVE",
    })
    expect((await db.stockLevels.get("sl1"))?.qty).toBe(10)
    await commit(takeStock, { qty: 10 }, { db, actor: cashier })
    expect((await db.stockLevels.get("sl1"))?.qty).toBe(0)
  })

  it("blocks a second active record with the same NID and audits the attempt (INV-02)", async () => {
    await commit(registerWithNid, { id: "p1", nid: "1990123456789" }, { db, actor: receptionist })
    await expect(
      commit(registerWithNid, { id: "p2", nid: "1990123456789" }, { db, actor: receptionist })
    ).rejects.toMatchObject({ code: "NID_EXISTS" })
    expect(await db.patients.count()).toBe(1)
    const blocked = await db.audit.where("action").equals("blocked").toArray()
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({ code: "NID_EXISTS", entityId: "test.register" })
    const events = await db.events.where("type").equals("RuleViolationBlocked").count()
    expect(events).toBe(1)
  })

  it("keeps signed prescriptions immutable (INV-04)", async () => {
    await db.prescriptions.add({
      ...baseFields("rx1", 1),
      rxNo: "RX-B1-000001",
      rxVersion: 1,
      patientId: "p1",
      doctorId: "d1",
      branchId: "B1",
      status: "signed",
      mode: "in-person",
      advice: "Rest",
      tests: [],
    })
    const edit = defineCommand({
      name: "test.editRx",
      roles: "any",
      input: z.object({ advice: z.string() }),
      async run(tx, input) {
        await tx.update("prescriptions", "rx1", { advice: input.advice })
      },
    })
    await expect(commit(edit, { advice: "Changed" }, { db, actor: cashier })).rejects.toMatchObject(
      { code: "SIGNED_IMMUTABLE" }
    )
    const supersede = defineCommand({
      name: "test.supersede",
      roles: "any",
      input: z.object({}),
      async run(tx) {
        await tx.update("prescriptions", "rx1", { status: "superseded" })
      },
    })
    await commit(supersede, {}, { db, actor: cashier })
    expect((await db.prescriptions.get("rx1"))?.status).toBe("superseded")
  })

  it("validates input before running", async () => {
    await expect(
      commit(updatePhone, { patientId: "p1", phone: "1", expectedVersion: 1 }, { db, actor: receptionist })
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("Isolation", () => {
  it("gives the second writer of the same version a conflict", async () => {
    await db.patients.add(patient("p1", { phone: "01700-000001" }))
    await commit(
      updatePhone,
      { patientId: "p1", phone: "01700-111111", expectedVersion: 1 },
      { db, actor: receptionist }
    )
    const second = commit(
      updatePhone,
      { patientId: "p1", phone: "01700-222222", expectedVersion: 1 },
      { db, actor: receptionist }
    )
    await expect(second).rejects.toBeInstanceOf(ConflictError)
    await expect(second).rejects.toMatchObject({ expectedVersion: 1, actualVersion: 2 })
    expect((await db.patients.get("p1"))?.phone).toBe("01700-111111")
  })

  it("serialises concurrent commits through the lock", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => commit(bump, {}, { db, actor: cashier }))
    )
    expect(results.map((r) => r.result).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1)
    )
    expect((await db.counters.get("serial"))?.value).toBe(12)
  })
})

describe("Durability and idempotency", () => {
  it("applies a payment once even if submitted twice", async () => {
    const first = await commit(pay, { idempotencyKey: "pay-abc", amountP: 50_000 }, { db, actor: cashier })
    const again = await commit(pay, { idempotencyKey: "pay-abc", amountP: 50_000 }, { db, actor: cashier })
    expect(again.deduplicated).toBe(true)
    expect(again.result).toEqual(first.result)
    expect(await db.receipts.count()).toBe(1)
  })

  it("survives closing and reopening the database", async () => {
    await commit(bump, {}, { db, actor: cashier })
    const name = db.name
    db.close()
    const reopened = new MedcoreDb(name)
    expect((await reopened.counters.get("serial"))?.value).toBe(1)
    reopened.close()
    await db.open()
  })
})

describe("Permissions", () => {
  it("denies a role the command does not allow, and audits it", async () => {
    await db.patients.add(patient("p1"))
    await expect(
      commit(updatePhone, { patientId: "p1", phone: "01700-000009", expectedVersion: 1 }, { db, actor: cashier })
    ).rejects.toBeInstanceOf(PermissionDenied)
    const blocked = await db.audit.where("action").equals("blocked").first()
    expect(blocked).toMatchObject({ code: "PERMISSION_DENIED" })
  })
})

describe("Audit hash chain", () => {
  it("verifies an intact chain and detects tampering", async () => {
    await db.patients.bulkAdd([patient("p1"), patient("p2")])
    for (const [id, phone] of [["p1", "01700-000011"], ["p2", "01700-000022"], ["p1", "01700-000033"]] as const) {
      const current = await db.patients.get(id)
      await commit(updatePhone, { patientId: id, phone, expectedVersion: current!.version }, { db, actor: receptionist })
    }
    expect(await verifyChain(db)).toEqual({ ok: true, count: 3 })

    // Tamper: rewrite a value in the middle of the chain behind the engine's back.
    await db.audit.update(2, { after: { phone: "01999-999999" } })
    const status = await verifyChain(db)
    expect(status.ok).toBe(false)
    expect(status.brokenAt).toBe(2)
  })

  it("orders events by a gap-free sequence", async () => {
    await db.patients.add(patient("p1"))
    for (let i = 1; i <= 3; i++) {
      await commit(updatePhone, { patientId: "p1", phone: `01700-00000${i}`, expectedVersion: i }, { db, actor: receptionist })
    }
    expect((await db.events.orderBy("seq").toArray()).map((e) => e.seq)).toEqual([1, 2, 3])
  })
})
