import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { ConflictError, PermissionDenied } from "@/core/engine/errors"
import { setBedStatus, transferBed } from "@/modules/inpatient/commands"

import {
  admitTo,
  B2_DESK,
  bedAt,
  dropDb,
  eventsSince,
  FARHANA,
  lastSeq,
  RAFIQ,
  seededDb,
  vacantBed,
  wardsAt,
} from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("inpatient-beds")
})
afterAll(async () => {
  await dropDb(db)
})

describe("inpatient.transferBed", () => {
  it("moves the stay to a vacant bed; the old bed goes for cleaning", async () => {
    const from = await vacantBed(db)
    const stay = await admitTo(db, from)
    const to = await vacantBed(db)
    const seq = await lastSeq(db)
    const { result } = await commit(
      transferBed,
      { admissionId: stay.id, toBedId: to.id, toBedVersion: to.version },
      { db, actor: FARHANA }
    )
    expect(result).toMatchObject({ fromBed: from.code, toBed: to.code })
    expect(await db.beds.get(from.id)).toMatchObject({ status: "cleaning", admissionId: undefined })
    expect(await db.beds.get(to.id)).toMatchObject({ status: "occupied", admissionId: stay.id })
    const moved = (await db.admissions.get(stay.id))!
    expect(moved).toMatchObject({ bedId: to.id, admissionNo: stay.admissionNo, admittedAt: stay.admittedAt })
    const [event] = await eventsSince(db, seq, "BedTransferred")
    expect(event.params).toMatchObject({ from: from.code, to: to.code, admissionNo: stay.admissionNo })
  })

  it("refuses the same bed, occupied, cleaning and reserved beds, and a stale target", async () => {
    const bed = await vacantBed(db)
    const stay = await admitTo(db, bed)
    const same = (await db.beds.get(bed.id))!
    await expect(
      commit(transferBed, { admissionId: stay.id, toBedId: same.id, toBedVersion: same.version }, { db, actor: FARHANA })
    ).rejects.toMatchObject({ code: "SAME_BED" })
    for (const [status, code] of [
      ["occupied", "BED_OCCUPIED"],
      ["cleaning", "BED_BEING_CLEANED"],
      ["reserved", "BED_RESERVED"],
    ] as const) {
      const target = await bedAt(db, "B1", status, { except: [bed.id] })
      await expect(
        commit(
          transferBed,
          { admissionId: stay.id, toBedId: target.id, toBedVersion: target.version },
          { db, actor: FARHANA }
        )
      ).rejects.toMatchObject({ code })
    }
    const target = await vacantBed(db)
    await expect(
      commit(
        transferBed,
        { admissionId: stay.id, toBedId: target.id, toBedVersion: target.version - 1 || 99 },
        { db, actor: FARHANA }
      )
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("keeps the ward rules and the branch, and only moves admitted stays", async () => {
    const [male] = (await wardsAt(db, "B1", "general")).filter((w) => w.name.en.includes("(male)"))
    const [female] = (await wardsAt(db, "B1", "general")).filter((w) => w.name.en.includes("(female)"))
    const stay = (await db.admissions.where("bedId").anyOf(
      (await db.beds.where("wardId").equals(male.id).toArray()).map((b) => b.id)
    ).toArray()).find((a) => a.status === "admitted")!
    const femaleBed = await bedAt(db, "B1", "vacant", { wardId: female.id })
    await expect(
      commit(
        transferBed,
        { admissionId: stay.id, toBedId: femaleBed.id, toBedVersion: femaleBed.version },
        { db, actor: FARHANA }
      )
    ).rejects.toMatchObject({ code: "WARD_FOR_FEMALE", params: { ward: female.code } })

    const b2Bed = await bedAt(db, "B2", "vacant", { kind: "general" })
    await expect(
      commit(transferBed, { admissionId: stay.id, toBedId: b2Bed.id, toBedVersion: b2Bed.version }, { db, actor: B2_DESK })
    ).rejects.toMatchObject({ code: "STAY_OTHER_BRANCH", params: { branch: "B1" } })

    const discharged = (await db.admissions.where("branchId").equals("B1").toArray()).find(
      (a) => a.status === "discharged"
    )!
    const vacant = await vacantBed(db)
    await expect(
      commit(
        transferBed,
        { admissionId: discharged.id, toBedId: vacant.id, toBedVersion: vacant.version },
        { db, actor: FARHANA }
      )
    ).rejects.toMatchObject({ code: "NOT_ADMITTED", params: { admissionNo: discharged.admissionNo } })
  })
})

describe("inpatient.setBedStatus", () => {
  it("marks a cleaned bed ready, reserves a vacant bed and releases it", async () => {
    const cleaning = await bedAt(db, "B1", "cleaning")
    const seq = await lastSeq(db)
    await commit(setBedStatus, { bedId: cleaning.id, status: "vacant", expectedVersion: cleaning.version }, { db, actor: FARHANA })
    expect((await db.beds.get(cleaning.id))!.status).toBe("vacant")
    const [ready] = await eventsSince(db, seq, "BedStatusChanged")
    expect(ready.params).toMatchObject({ bed: cleaning.code, status: "Vacant", statusBn: "খালি" })

    let bed = (await db.beds.get(cleaning.id))!
    await commit(setBedStatus, { bedId: bed.id, status: "reserved", expectedVersion: bed.version }, { db, actor: FARHANA })
    bed = (await db.beds.get(cleaning.id))!
    expect(bed.status).toBe("reserved")
    await commit(setBedStatus, { bedId: bed.id, status: "vacant", expectedVersion: bed.version }, { db, actor: FARHANA })
    expect((await db.beds.get(cleaning.id))!.status).toBe("vacant")
  })

  it("refuses other changes, occupied beds, other branches, stale versions and other roles", async () => {
    const cleaning = await bedAt(db, "B1", "cleaning")
    await expect(
      commit(setBedStatus, { bedId: cleaning.id, status: "reserved", expectedVersion: cleaning.version }, { db, actor: FARHANA })
    ).rejects.toMatchObject({ code: "BED_CHANGE_NOT_ALLOWED", params: { bed: cleaning.code } })
    const occupied = await bedAt(db, "B1", "occupied")
    await expect(
      commit(setBedStatus, { bedId: occupied.id, status: "vacant", expectedVersion: occupied.version }, { db, actor: FARHANA })
    ).rejects.toMatchObject({ code: "BED_OCCUPIED" })
    const b2 = await bedAt(db, "B2", "vacant")
    await expect(
      commit(setBedStatus, { bedId: b2.id, status: "reserved", expectedVersion: b2.version }, { db, actor: FARHANA })
    ).rejects.toMatchObject({ code: "BED_OTHER_BRANCH" })
    const vacant = await bedAt(db, "B1", "vacant")
    await expect(
      commit(setBedStatus, { bedId: vacant.id, status: "reserved", expectedVersion: vacant.version + 1 }, { db, actor: FARHANA })
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      commit(setBedStatus, { bedId: vacant.id, status: "reserved", expectedVersion: vacant.version }, { db, actor: RAFIQ })
    ).rejects.toBeInstanceOf(PermissionDenied)
  })
})
