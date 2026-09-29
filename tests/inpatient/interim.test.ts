import { readFileSync } from "node:fs"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { now } from "@/core/clock/clock"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { PermissionDenied } from "@/core/engine/errors"
import { EVENT_CATALOG } from "@/core/events/registry"
import { bedDays, interimBill, NURSING_PER_DAY_P } from "@/core/inpatient/interim"
import { issueInterimBill } from "@/modules/inpatient/commands"
import { inpatientEvents } from "@/modules/inpatient/events"
import { inpatientBn } from "@/modules/inpatient/i18n/bn"
import { inpatientEn } from "@/modules/inpatient/i18n/en"
import { depositsTotal, mayChangeBed, reasonKey, REASON_PRESETS, restoreAmountP, wardRefusal } from "@/modules/inpatient/stay"
import { en } from "@/lib/i18n/en"

import { B2_DESK, billsAt, dropDb, eventsSince, FARHANA, lastSeq, RAFIQ, seededDb } from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("inpatient-interim")
})
afterAll(async () => {
  await dropDb(db)
})

describe("the interim bill on seeded stays", () => {
  it("charges bed, nursing and one consultant round per started day, less the deposits", async () => {
    const rows = await billsAt(db, "B1")
    expect(rows.length).toBeGreaterThan(10)
    for (const { stay, bill } of rows) {
      const ward = stay.ward!
      expect(bill.days).toBe(bedDays(stay.admission.admittedAt, now()))
      const bed = bill.lines.find((l) => l.kind === "bed")!
      expect(bed).toMatchObject({ qty: bill.days, unitP: ward.bedDayRateP, amountP: ward.bedDayRateP * bill.days })
      const nursing = bill.lines.find((l) => l.kind === "nursing")!
      expect(nursing.unitP).toBe(NURSING_PER_DAY_P[ward.kind])
      const rounds = bill.lines.find((l) => l.kind === "consultant")
      expect(rounds?.unitP ?? 0).toBe(stay.consultant!.doctor.followUpFeeP)
      expect(bill.depositsP).toBe(depositsTotal(stay.deposits))
      expect(bill.balanceP).toBe(bill.depositsP - bill.chargesP)
      expect(bill).toEqual(
        interimBill({
          admittedAt: stay.admission.admittedAt,
          at: now(),
          ward,
          consultantRoundP: stay.consultant!.doctor.followUpFeeP,
          depositsP: depositsTotal(stay.deposits),
        })
      )
    }
  })

  it("issuing records the figures in the event log and writes no invoice", async () => {
    const [{ stay, bill }] = await billsAt(db, "B1")
    const invoices = await db.invoices.count()
    const seq = await lastSeq(db)
    const { result } = await commit(issueInterimBill, { admissionId: stay.admission.id }, { db, actor: RAFIQ })
    expect(result).toMatchObject({
      admissionNo: stay.admission.admissionNo,
      days: bill.days,
      chargesP: bill.chargesP,
      depositsP: bill.depositsP,
      balanceP: bill.balanceP,
    })
    const [event] = await eventsSince(db, seq, "InterimBillIssued")
    expect(event.params).toMatchObject({ admissionNo: stay.admission.admissionNo, days: bill.days })
    expect(event.params.charges).toBeTruthy()
    expect(event.params.chargesBn).toBeTruthy()
    expect(await db.invoices.count()).toBe(invoices)
    // Reception may issue it too; other branches and stays may not.
    await commit(issueInterimBill, { admissionId: stay.admission.id }, { db, actor: FARHANA })
    await expect(
      commit(issueInterimBill, { admissionId: stay.admission.id }, { db, actor: B2_DESK })
    ).rejects.toMatchObject({ code: "STAY_OTHER_BRANCH" })
    await expect(
      commit(issueInterimBill, { admissionId: stay.admission.id }, { db, actor: { ...RAFIQ, role: "pharmacist" } })
    ).rejects.toBeInstanceOf(PermissionDenied)
  })
})

describe("pure rules", () => {
  it("bed status changes by hand", () => {
    expect(mayChangeBed("cleaning", "vacant")).toBe(true)
    expect(mayChangeBed("vacant", "reserved")).toBe(true)
    expect(mayChangeBed("reserved", "vacant")).toBe(true)
    expect(mayChangeBed("cleaning", "reserved")).toBe(false)
    expect(mayChangeBed("occupied", "vacant")).toBe(false)
  })

  it("wards by sex and age", () => {
    const today = "2026-09-29"
    const men = { name: { en: "General ward (male)", bn: "" }, kind: "general" as const }
    const women = { name: { en: "General ward (female)", bn: "" }, kind: "general" as const }
    const children = { name: { en: "Paediatric ward", bn: "" }, kind: "paediatric" as const }
    const cabin = { name: { en: "Cabin block", bn: "" }, kind: "cabin" as const }
    const man = { sex: "M" as const, dob: "1980-01-01" }
    const girl = { sex: "F" as const, dob: "2015-01-01" }
    expect(wardRefusal(men, man, today)).toBeNull()
    expect(wardRefusal(women, man, today)).toBe("WARD_FOR_FEMALE")
    expect(wardRefusal(men, girl, today)).toBe("WARD_FOR_MALE")
    expect(wardRefusal(children, girl, today)).toBeNull()
    expect(wardRefusal(children, man, today)).toBe("WARD_PAEDIATRIC_ONLY")
    expect(wardRefusal(cabin, girl, today)).toBeNull()
  })

  it("restore amounts round up to whole thousands", () => {
    expect(restoreAmountP(12_000_00, 10_000_00)).toBe(0)
    expect(restoreAmountP(9_999_00, 10_000_00)).toBe(1_000_00)
    expect(restoreAmountP(-4_250_00, 10_000_00)).toBe(15_000_00)
  })

  it("every preset reason has a label in both languages", () => {
    expect(REASON_PRESETS.length).toBeGreaterThan(5)
    for (const preset of REASON_PRESETS) {
      expect(reasonKey(preset.text)).toBe(preset.key)
      expect(inpatientEn.inpatient.reasons[preset.key]).toBe(preset.text)
      expect(inpatientBn.inpatient.reasons[preset.key]).toBeTruthy()
    }
  })
})

describe("messages", () => {
  const source = ["commands.ts", "stay.ts"]
    .map((file) => readFileSync(`modules/inpatient/${file}`, "utf8"))
    .join("\n")
  const codes = new Set<string>()
  for (const match of source.matchAll(/reject\("([A-Z_]+)"/g)) codes.add(match[1])
  for (const match of source.matchAll(/"(WARD_[A-Z_]+)"/g)) codes.add(match[1])
  // actorBranch and requireShift (modules/billing/settle.ts) refuse with these.
  codes.add("NO_BRANCH")
  codes.add("NO_OPEN_SHIFT")

  it("every rule code the commands refuse with has an English and a Bangla message", () => {
    expect(codes.size).toBeGreaterThan(15)
    const enRules = inpatientEn.inpatient.rules as Record<string, string>
    const bnRules = inpatientBn.inpatient.rules as Record<string, string>
    for (const code of codes) {
      expect(enRules[code], code).toBeTruthy()
      expect(bnRules[code], code).toBeTruthy()
    }
  })

  it("every event has labels and consumers in both languages, and is in the shared catalog", () => {
    const flat = (dict: unknown, key: string) =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict)
    for (const [type, def] of Object.entries(inpatientEvents)) {
      expect(EVENT_CATALOG[type]).toBe(def)
      expect(flat(en, def.labelKey), def.labelKey).toBeTypeOf("string")
      const bnLabel = flat({ inpatient: inpatientBn.inpatient }, def.labelKey)
      expect(bnLabel, def.labelKey).toBeTypeOf("string")
      for (const consumer of def.consumers) {
        expect(flat(en, consumer), consumer).toBeTypeOf("string")
      }
    }
  })
})
