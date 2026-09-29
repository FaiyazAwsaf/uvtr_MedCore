import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { z } from "zod"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { ConflictError, RuleViolation } from "@/core/engine/errors"
import { seedDatabase } from "@/core/seed"
import { SEED_REFS } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"
import { updateContact } from "@/modules/identity/commands"

const desk = actorFor(findPersona("per_reception_farhana")!)
const PATIENT = SEED_REFS.patient.shahnaz
let db: MedcoreDb

const save = (input: z.input<typeof updateContact.input>) =>
  commit(updateContact, input, { db, actor: desk })

beforeAll(async () => {
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "11:30") - Date.now())
  db = new MedcoreDb("identity-contact-test")
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
}, 60_000)

afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("identity.updateContact", () => {
  it("saves on the version the form opened with; a new phone starts unverified", async () => {
    const before = (await db.patients.get(PATIENT))!
    const { result, events } = await save({
      patientId: PATIENT,
      expectedVersion: before.version,
      phone: "01819-555123",
      address: "House 12, Road 4, Dhanmondi",
    })
    expect(result).toMatchObject({ version: before.version + 1 })
    expect(result.changed).toEqual(expect.arrayContaining(["phone", "address"]))
    expect(await db.patients.get(PATIENT)).toMatchObject({
      phone: "01819-555123",
      phoneVerified: false,
      address: "House 12, Road 4, Dhanmondi",
      updatedBy: desk.staffId,
    })
    expect(events.map((e) => e.type)).toContain("PatientContactUpdated")
  })

  it("refuses a save made on an older version with the engine's conflict", async () => {
    const current = (await db.patients.get(PATIENT))!
    const error = await save({
      patientId: PATIENT,
      expectedVersion: current.version - 1,
      phone: "01819-555999",
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConflictError)
    expect(error).toMatchObject({
      table: "patients",
      expectedVersion: current.version - 1,
      actualVersion: current.version,
      updatedBy: desk.staffId,
    })
    expect((await db.patients.get(PATIENT))?.phone).toBe("01819-555123")
  })

  it("needs the patient's or an attendant's number, and changes nothing when nothing changed", async () => {
    const current = (await db.patients.get(PATIENT))!
    const error = await save({
      patientId: PATIENT,
      expectedVersion: current.version,
    }).catch((e: unknown) => e)
    expect((error as RuleViolation).code).toBe("CONTACT_REQUIRED")
    const same = await save({
      patientId: PATIENT,
      expectedVersion: current.version,
      phone: current.phone,
      address: current.address,
    })
    expect(same.result).toMatchObject({ version: current.version, changed: [] })
    expect((await db.patients.get(PATIENT))?.version).toBe(current.version)
  })
})
