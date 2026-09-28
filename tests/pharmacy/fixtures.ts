/**
 * Test fixtures for the pharmacy suite: a seeded database pinned to 09:30
 * Dhaka, the pharmacist actors, and a signed (optionally paid) prescription
 * written through a real engine commit, the way `rx.sign` and checkout leave it.
 */

import { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import type { MealTiming } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { defineCommand } from "@/core/engine/defineCommand"
import { nextRxNo } from "@/core/engine/docNumbers"
import { SYSTEM_ACTOR, type Actor } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { courseQuantity, doseInstruction, HERO } from "@/core/seed/content"
import { findPersona } from "@/core/seed/content/personas"
import { actorFor } from "@/core/session/persona"

export const shirin: Actor = actorFor(findPersona("per_pharmacist_shirin")!)
export const jahid: Actor = actorFor(findPersona("per_pharmacist_jahid")!)

/** A fresh seeded database with the demo clock at 09:30 Dhaka today. */
export async function seededDb(name: string): Promise<MedcoreDb> {
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "09:30") - Date.now())
  const db = new MedcoreDb(name)
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
  return db
}

export async function dropDb(db: MedcoreDb): Promise<void> {
  applyClockOffset(0)
  await db.delete()
}

const signedRxFixture = defineCommand({
  name: "test.signedRx",
  roles: [],
  input: z.object({
    patientId: z.string(),
    doctorId: z.string(),
    branch: z.enum(["B1", "B2", "B3", "B4", "B5"]),
    lines: z.array(
      z.object({
        brandId: z.string(),
        dosePattern: z.string(),
        meal: z.enum(["before", "after", "with", "any"]),
        days: z.number().int(),
        qty: z.number().int().optional(),
        paid: z.boolean(),
        billed: z.boolean(),
      })
    ),
  }),
  async run(tx, input) {
    const branch = input.branch as BranchCode
    const rxNo = await nextRxNo(tx, branch)
    const rx = tx.insert("prescriptions", {
      rxNo,
      rxVersion: 1,
      patientId: input.patientId,
      doctorId: input.doctorId,
      branchId: branch,
      status: "signed",
      mode: "in-person",
      advice: "",
      tests: [],
      signedAt: tx.now(),
    })
    const lineIds: string[] = []
    for (const [index, spec] of input.lines.entries()) {
      const brand = await tx.get("brands", spec.brandId)
      const words = doseInstruction(spec.dosePattern, spec.meal as MealTiming, spec.days)
      const qty = spec.qty ?? courseQuantity(spec.dosePattern, spec.days)
      const line = tx.insert("rxLines", {
        rxId: rx.id,
        patientId: input.patientId,
        branchId: branch,
        lineNo: index + 1,
        brandId: brand.id,
        genericId: brand.genericId,
        strength: brand.strength,
        form: brand.form,
        dosePattern: spec.dosePattern,
        mealTiming: spec.meal as MealTiming,
        durationDays: spec.days,
        qtyPrescribed: qty,
        instructionsEn: words.en,
        instructionsBn: words.bn,
        isAntibiotic: brand.isAntibiotic,
        isControlled: brand.category === "controlled",
        paymentCleared: spec.paid,
        dispensedQty: 0,
        status: "open",
      })
      lineIds.push(line.id)
      // rx.sign bills only what is on the shelf: an out-of-stock line has no basket line.
      if (spec.billed) tx.insert("basketLines", {
        patientId: input.patientId,
        branchId: branch,
        sourceType: "rx-line",
        sourceId: line.id,
        serviceType: "medicine",
        description: `${brand.name} ${brand.strength}`,
        qty,
        unitPriceP: brand.unitPriceP,
        mrpP: brand.mrpP,
        status: spec.paid ? "invoiced" : "open",
        payerType: "self",
      })
    }
    tx.insert("pharmacyQueue", {
      rxId: rx.id,
      rxNo,
      patientId: input.patientId,
      branchId: branch,
      status: "waiting",
      receivedAt: tx.now(),
    })
    return { rxId: rx.id, rxNo, lineIds }
  },
})

export type FixtureLine = {
  brandId: string
  dosePattern: string
  meal?: MealTiming
  days: number
  qty?: number
  paid?: boolean
  /** false: nothing on the bill (out of stock when signed) */
  billed?: boolean
}

/** A signed prescription at B1 by Dr. Kamal for Abdul Karim; lines paid unless `paid: false`. */
export async function signedRx(
  db: MedcoreDb,
  lines: FixtureLine[],
  opts: { patientId?: string; branch?: BranchCode } = {}
): Promise<{ rxId: string; rxNo: string; lineIds: string[] }> {
  const { result } = await commit(
    signedRxFixture,
    {
      patientId: opts.patientId ?? HERO.patient.abdulKarim,
      doctorId: HERO.doctor.kamal,
      branch: opts.branch ?? "B1",
      lines: lines.map((l) => ({
        brandId: l.brandId,
        dosePattern: l.dosePattern,
        meal: l.meal ?? "after",
        days: l.days,
        qty: l.qty,
        paid: l.paid ?? true,
        billed: l.billed ?? true,
      })),
    },
    { db, actor: SYSTEM_ACTOR }
  )
  return result
}

/** Dispensable units of a brand at a branch (batch ok and not expired). */
export async function usableAt(db: MedcoreDb, branch: BranchCode, brandId: string) {
  const today = dhakaDate(now())
  const levels = await db.stockLevels.where("[branchId+brandId]").equals([branch, brandId]).toArray()
  const batches = await db.batches.bulkGet(levels.map((l) => l.batchId))
  return levels
    .map((level, i) => ({ level, batch: batches[i]! }))
    .filter(({ level, batch }) => level.qty > 0 && batch.status === "ok" && batch.expiry >= today)
    .sort((a, b) => a.batch.expiry.localeCompare(b.batch.expiry))
}
