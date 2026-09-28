import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import { isValidUhid } from "@/core/db/numbering"
import { commit } from "@/core/engine/commit"
import { RuleViolation } from "@/core/engine/errors"
import type { Actor } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { findLikelyDuplicates, nameKeys } from "@/core/search/fuzzy"
import {
  confirmExistingPatient,
  registerPatient,
  type RegisterInput,
} from "@/modules/identity/commands"
import { dobFromAge, normalizePhone } from "@/modules/identity/registration"

const reception: Actor = {
  staffId: "stf_farhana_akter",
  personaId: "per_reception_farhana",
  role: "receptionist",
  branchId: "B1",
  name: "Farhana Akter",
  authorities: [],
}

let db: MedcoreDb
let today: string

const CONSENTS = { treatment: true, sms: true, app: false }

function input(over: Partial<RegisterInput>): RegisterInput {
  return {
    nameEn: "Salma Karim",
    nameBn: "সালমা করিম",
    dob: "1996-02-14",
    sex: "F",
    phone: HERO.karimPhone,
    idMissingReason: "not-brought",
    consents: CONSENTS,
    ...over,
  }
}

const register = (value: RegisterInput) => commit(registerPatient, value, { db, actor: reception })

beforeAll(async () => {
  // 11:30 in Dhaka today, the demo's clinic time.
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "11:30") - Date.now())
  today = dhakaDate(now())
  db = new MedcoreDb("identity-register-test")
  await seedDatabase(db, { now: now(), today })
})
afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("identity.register", () => {
  it("registers an adult into an existing household with consents and search keys", async () => {
    const { result, events } = await register(
      input({ household: { mode: "join", householdId: HERO.household.karim, relation: "daughter" } })
    )
    expect(result.provisional).toBe(false)
    expect(isValidUhid(result.uhid)).toBe(true)
    const patient = await db.patients.get(result.patientId)
    expect(patient).toMatchObject({
      uhid: result.uhid,
      identityStatus: "active",
      householdId: HERO.household.karim,
      relationToHead: "daughter",
      phone: HERO.karimPhone,
      registeredAtBranch: "B1",
      registrationNote: "NID not brought at registration",
    })
    expect(patient?.nameSearchKeys).toEqual(nameKeys("Salma Karim", "সালমা করিম"))
    expect(patient?.consents.map((c) => [c.purpose, c.granted])).toEqual([
      ["treatment", true],
      ["sms", true],
      ["app", false],
    ])
    const household = await db.households.get(HERO.household.karim)
    expect(household?.memberIds).toContain(result.patientId)
    expect(events.map((e) => e.type)).toEqual(["PatientRegistered"])
    expect(events[0].params).toMatchObject({ name: "Salma Karim" })
  })

  it("needs an adult guardian and records the guardian's consent for a minor", async () => {
    const child = input({
      nameEn: "Rafi Karim",
      nameBn: "রাফি করিম",
      dob: dobFromAge(6, today),
      sex: "M",
      idMissingReason: "child-no-brn",
      household: { mode: "join", householdId: HERO.household.karim, relation: "grandchild" },
    })
    await expect(register(child)).rejects.toMatchObject({ code: "GUARDIAN_REQUIRED" })
    await expect(
      register({ ...child, guardian: { patientId: HERO.patient.nusratKarim, relation: "sister" } })
    ).rejects.toMatchObject({ code: "GUARDIAN_NOT_ADULT" })

    const { result } = await register({
      ...child,
      guardian: { patientId: HERO.patient.tanvirKarim, relation: "father" },
    })
    const patient = await db.patients.get(result.patientId)
    expect(patient).toMatchObject({
      guardianPatientId: HERO.patient.tanvirKarim,
      guardianRelation: "father",
    })
    expect(patient?.consents.every((c) => c.byPatientId === HERO.patient.tanvirKarim)).toBe(true)
    expect(patient?.consents.find((c) => c.purpose === "treatment")?.granted).toBe(true)
  })

  it("refuses to save without contact, an ID reason or treatment consent", async () => {
    const base = input({ nameEn: "Jahid Munshi", nameBn: "জাহিদ মুন্সী", phone: "01911-000111" })
    await expect(register({ ...base, phone: undefined })).rejects.toMatchObject({
      code: "CONTACT_REQUIRED",
    })
    await expect(register({ ...base, idMissingReason: undefined })).rejects.toMatchObject({
      code: "ID_REASON_REQUIRED",
    })
    await expect(
      register({ ...base, consents: { ...CONSENTS, treatment: false } })
    ).rejects.toMatchObject({ code: "TREATMENT_CONSENT_REQUIRED" })
  })

  it("hard-blocks a known NID through INV-02 and audits the attempt", async () => {
    const [{ patientId, nid }] = SEED_REFS.nidCollisions
    const before = await db.patients.count()
    const attempt = register(
      input({
        nameEn: "Kawsar Ahmed",
        nameBn: "কাওসার আহমেদ",
        dob: "1990-01-01",
        sex: "M",
        phone: "01933-777001",
        nid,
        idMissingReason: undefined,
      })
    )
    await expect(attempt).rejects.toBeInstanceOf(RuleViolation)
    await expect(attempt).rejects.toMatchObject({ code: "NID_EXISTS", audit: true })
    expect(await db.patients.count()).toBe(before)
    const existing = await db.patients.get(patientId)
    const blocked = await db.audit.where("action").equals("blocked").toArray()
    expect(blocked.at(-1)).toMatchObject({ code: "NID_EXISTS", command: "identity.register" })
    expect(blocked.at(-1)?.after).toMatchObject({ uhid: existing?.uhid })
    const lastEvent = await db.events.orderBy("seq").last()
    expect(lastEvent?.type).toBe("RuleViolationBlocked")
  })

  it("requires the duplicate warning to be answered, then records a different person with the reason", async () => {
    const s1 = SEED_REFS.s1
    const form = input({
      nameEn: s1.variantNameEn,
      nameBn: s1.variantNameBn,
      dob: s1.dob,
      sex: "M",
      phone: s1.variantPhone,
    })
    const active = await db.patients.where("identityStatus").equals("active").toArray()
    const candidates = findLikelyDuplicates(
      { nameEn: form.nameEn, dob: form.dob, phone: form.phone },
      active
    )
    expect(candidates[0]?.patientId).toBe(s1.existingPatientId)

    await expect(register(form)).rejects.toMatchObject({ code: "DUPLICATE_UNRESOLVED" })

    const reason = "Different father's name and village on the NID slip"
    const { result, events } = await register({
      ...form,
      duplicateDecision: {
        candidateIds: candidates.map((c) => c.patientId),
        score: candidates[0].score,
        reason,
      },
    })
    expect(events.map((e) => e.type)).toEqual(["DuplicateWarningResolved", "PatientRegistered"])
    const decisions = await db.duplicateDecisions.where("newPatientId").equals(result.patientId).toArray()
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ decision: "different", reason, decidedBy: reception.staffId })
    expect(decisions[0].candidateIds).toContain(s1.existingPatientId)
    const audit = await db.audit.where("entityId").equals(result.patientId).toArray()
    expect(audit[0]?.reason).toBe(reason)
  })

  it("records a 'same person' answer without creating a patient", async () => {
    const before = await db.patients.count()
    const { result, events } = await commit(
      confirmExistingPatient,
      {
        patientId: SEED_REFS.s1.existingPatientId,
        candidateIds: [SEED_REFS.s1.existingPatientId],
        score: 0.8,
      },
      { db, actor: reception }
    )
    expect(result.patientId).toBe(SEED_REFS.s1.existingPatientId)
    expect(await db.patients.count()).toBe(before)
    expect(events.map((e) => e.type)).toEqual(["DuplicateWarningResolved"])
    const decision = (await db.duplicateDecisions.toArray()).find(
      (d) => d.decision === "same" && d.decidedBy === reception.staffId
    )
    expect(decision?.candidateIds[0]).toBe(SEED_REFS.s1.existingPatientId)
  })

  it("starts a household on a new number, and only once per number", async () => {
    const phone = "01999-123456"
    const first = input({
      nameEn: "Mizanur Sarker",
      nameBn: "মিজানুর সরকার",
      dob: "1980-05-05",
      sex: "M",
      phone,
      household: { mode: "new" },
    })
    const { result } = await register(first)
    const patient = await db.patients.get(result.patientId)
    expect(patient?.relationToHead).toBe("self")
    const household = await db.households.get(patient!.householdId!)
    expect(household).toMatchObject({ phone, headPatientId: result.patientId, memberIds: [result.patientId] })
    await expect(
      register({ ...first, nameEn: "Shirin Sarker", nameBn: "শিরিন সরকার", sex: "F", dob: "1984-01-01" })
    ).rejects.toMatchObject({ code: "HOUSEHOLD_EXISTS" })
  })

  it("issues a provisional UHID while the branch works offline", async () => {
    const edge = new MedcoreDb("identity-register-edge", "edge", "B1")
    try {
      const { result } = await commit(
        registerPatient,
        input({ nameEn: "Babul Mia", nameBn: "বাবুল মিয়া", sex: "M", phone: "01822-000999" }),
        { db: edge, actor: reception }
      )
      expect(result).toMatchObject({ uhid: "P-B1-000001", provisional: true })
      expect((await edge.patients.get(result.patientId))?.provisionalUhid).toBe("P-B1-000001")
      expect(await edge.outbox.count()).toBe(1)
    } finally {
      await edge.delete()
    }
  })
})

describe("registration helpers", () => {
  it("normalises Bangladeshi mobile numbers to the stored form", () => {
    expect(normalizePhone("01711523418")).toBe("01711-523418")
    expect(normalizePhone("+880 1711-523418")).toBe("01711-523418")
    expect(normalizePhone("01211523418")).toBeUndefined()
    expect(normalizePhone("0171152341")).toBeUndefined()
  })

  it("turns an estimated age into a date of birth that reads back the same age", () => {
    expect(dobFromAge(62, "2026-09-28")).toBe("1964-09-28")
    expect(dobFromAge(4, "2028-02-29")).toBe("2024-02-28")
  })
})
