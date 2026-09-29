import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { rules } from "@/config/rules.config"
import { now } from "@/core/clock/clock"
import { sweepOnce } from "@/core/clock/sweeper"
import { ControlDb, setControlDbForTests } from "@/core/db/control"
import { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { PermissionDenied } from "@/core/engine/errors"
import { SYSTEM_ACTOR } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { dhakaDate } from "@/core/clock/dates"
import { raiseDepositAlert, takeDeposit } from "@/modules/inpatient/commands"
import { depositAlertJob, staysDueForAlert } from "@/modules/inpatient/jobs"

import {
  admitTo,
  advance,
  bedAt,
  billsAt,
  dropDb,
  eventsSince,
  expectDuring,
  FARHANA,
  lastSeq,
  ONE_DAY,
  plantedLowStay,
  RAFIQ,
  seededDb,
  vacantBed,
} from "./fixtures"

let db: MedcoreDb
let control: ControlDb
let plantedId = ""

const sweep = (target: MedcoreDb = db) => sweepOnce([target], [depositAlertJob])

beforeAll(async () => {
  control = new ControlDb("inpatient-alerts-control")
  setControlDbForTests(control)
  db = await seededDb("inpatient-alerts")
})
afterAll(async () => {
  await dropDb(db)
  await control.delete()
})

let keyNo = 0
const key = () => `alert-test-${String(++keyNo).padStart(4, "0")}`

describe("the deposit threshold alert", () => {
  it("on the fresh seed only the planted cabin stay is low, and its alert is already raised", async () => {
    const planted = await plantedLowStay(db)
    plantedId = planted.id
    for (const branch of ["B1", "B2", "B5"] as const) {
      for (const { stay, bill } of await billsAt(db, branch)) {
        expect(bill.days).toBeGreaterThanOrEqual(1)
        expect(bill.low).toBe(stay.admission.id === planted.id)
      }
    }
    const seq = await lastSeq(db)
    await sweep()
    expect(await eventsSince(db, seq, "DepositLow")).toHaveLength(0)
  })

  it("a new stay without a deposit alerts once, however often the sweeper runs", async () => {
    const stay = await admitTo(db, await vacantBed(db))
    const seq = await lastSeq(db)
    const before = now()
    await sweep()
    await sweep()
    const events = await eventsSince(db, seq, "DepositLow")
    expect(events).toHaveLength(1)
    expect(events[0].actor.role).toBe("system")
    expect(events[0].branchId).toBe("B1")
    expect(events[0].refs.admissionId).toBe(stay.id)
    expect(events[0].params).toMatchObject({ admissionNo: stay.admissionNo, days: 1 })
    expect(String(events[0].params.balance)).toMatch(/^-৳/)
    expect(String(events[0].params.balanceBn)).toMatch(/^-৳[০-৯]/)
    expectDuring((await db.admissions.get(stay.id))!.depositAlertAt, before)
  })

  it("a ৳20,000 deposit clears it; +1 day on the clock adds a day to every bill and alerts each stay that crosses, once", async () => {
    const bed = await bedAt(db, "B1", "vacant", { kind: "cabin" })
    const stay = await admitTo(db, bed)
    await sweep()
    await commit(
      takeDeposit,
      { admissionId: stay.id, amountP: 20_000_00, tender: "cash", idempotencyKey: key() },
      { db, actor: RAFIQ }
    )
    expect((await db.admissions.get(stay.id))!.depositAlertAt).toBeUndefined()

    const before = new Map((await billsAt(db, "B1")).map((r) => [r.stay.admission.id, r]))
    expect(before.get(stay.id)!.bill.low).toBe(false)

    advance(ONE_DAY)
    const after = await billsAt(db, "B1")
    const crossing: string[] = []
    for (const { stay: view, bill } of after) {
      const was = before.get(view.admission.id)!
      expect(bill.days).toBe(was.bill.days + 1)
      const daily = was.bill.lines.reduce((sum, line) => sum + line.unitP, 0)
      expect(bill.chargesP - was.bill.chargesP).toBe(daily)
      if (bill.low && view.admission.depositAlertAt === undefined) crossing.push(view.admission.id)
    }
    // The cabin stay with a ৳20,000 deposit crosses on its second day.
    expect(crossing).toContain(stay.id)

    const seq = await lastSeq(db)
    const swept = now()
    await sweep()
    await sweep()
    const events = await eventsSince(db, seq, "DepositLow")
    expect(events.map((e) => e.refs.admissionId).sort()).toEqual([...crossing].sort())
    for (const id of crossing) {
      expectDuring((await db.admissions.get(id))!.depositAlertAt, swept)
    }
    expect(await staysDueForAlert(db, now(), () => true)).toEqual([])
  })

  it("the planted stay never alerts twice, even as its debt grows", async () => {
    const alertAt = (await db.admissions.get(plantedId))!.depositAlertAt
    expect(alertAt).toBeDefined()
    const seq = await lastSeq(db)
    advance(ONE_DAY)
    await sweep()
    const events = await eventsSince(db, seq, "DepositLow")
    expect(events.some((e) => e.refs.admissionId === plantedId)).toBe(false)
    expect((await db.admissions.get(plantedId))!.depositAlertAt).toBe(alertAt)
  })

  it("raiseDepositAlert is the sweeper's alone and a no-op when not due", async () => {
    const stay = await admitTo(db, await vacantBed(db))
    await expect(
      commit(raiseDepositAlert, { admissionId: stay.id }, { db, actor: RAFIQ })
    ).rejects.toBeInstanceOf(PermissionDenied)
    await expect(
      commit(raiseDepositAlert, { admissionId: stay.id }, { db, actor: FARHANA })
    ).rejects.toBeInstanceOf(PermissionDenied)

    await commit(
      takeDeposit,
      { admissionId: stay.id, amountP: 1_00_000_00, tender: "cash", idempotencyKey: key() },
      { db, actor: RAFIQ }
    )
    const notLow = await commit(raiseDepositAlert, { admissionId: stay.id }, { db, actor: SYSTEM_ACTOR })
    expect(notLow.result.raised).toBe(false)
    expect((await db.admissions.get(stay.id))!.depositAlertAt).toBeUndefined()

    const discharged = (await db.admissions.where("status").equals("discharged").first())!
    const closed = await commit(raiseDepositAlert, { admissionId: discharged.id }, { db, actor: SYSTEM_ACTOR })
    expect(closed.result.raised).toBe(false)
  })
})

describe("offline branches", () => {
  it("an offline branch's store raises its own alerts, and central leaves that branch alone", async () => {
    const central = await seededDb("inpatient-alerts-central")
    const edge = new MedcoreDb("inpatient-alerts-edge", "edge", "B1")
    await seedDatabase(edge, { now: now(), today: dhakaDate(now()) })
    try {
      await control.network.put({ branchId: "B1", status: "offline", queuedCount: 0 })
      // Three days on, stays at every hospital branch have crossed.
      advance(3 * ONE_DAY)
      const due = await staysDueForAlert(central, now(), () => true)
      const byBranch = new Map<string, number>()
      for (const id of due) {
        const branch = (await central.admissions.get(id))!.branchId
        byBranch.set(branch, (byBranch.get(branch) ?? 0) + 1)
      }
      expect(byBranch.get("B1") ?? 0).toBeGreaterThan(0)

      const centralSeq = await lastSeq(central)
      await sweepOnce([central, edge], [depositAlertJob])
      const onCentral = await eventsSince(central, centralSeq, "DepositLow")
      expect(onCentral.every((e) => e.branchId !== "B1")).toBe(true)
      expect(onCentral).toHaveLength(due.length - (byBranch.get("B1") ?? 0))

      const onEdge = (await edge.events.toArray()).filter((e) => e.type === "DepositLow")
      expect(onEdge.length).toBe(byBranch.get("B1"))
      expect(onEdge.every((e) => e.branchId === "B1")).toBe(true)
      expect(await edge.outbox.count()).toBe(onEdge.length)
    } finally {
      await control.network.clear()
      await edge.delete()
      await central.delete()
      advance(-3 * ONE_DAY)
    }
  })

  it("the threshold is the configured one", () => {
    expect(rules.depositThresholdP).toBe(10_000_00)
  })
})
