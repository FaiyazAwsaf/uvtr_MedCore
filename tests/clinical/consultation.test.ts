import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { HERO, SEED_REFS } from "@/core/seed/content"
import {
  acknowledgeInboxItem,
  amendNote,
  discardScribe,
  finishConsultation,
  readInboxItem,
  saveNote,
  saveVitals,
  signNote,
  startConsultation,
  startScribe,
} from "@/modules/consultation/commands"
import {
  appendLine,
  applyTemplate,
  emptySections,
  hasLine,
  templateById,
} from "@/modules/consultation/note"
import { safeDraft, scriptFor } from "@/modules/consultation/scribe"
import { placeImaging, placeTests } from "@/modules/orders/commands"
import { searchTests } from "@/modules/orders/catalog"
import {
  allergyAlertsFor,
  criticalAlertsFor,
  isLineActive,
  missingOverrides,
} from "@/modules/prescribing/alerts"
import { addRxLine } from "@/modules/prescribing/commands"
import { parseDoseShortcut, quantityFor } from "@/modules/prescribing/dose"
import { DAY } from "@/core/clock/dates"

import {
  arif,
  dropDb,
  kamal,
  reception,
  seededDb,
  startVisit,
  testInboxItem,
} from "./helpers"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("clinical-consult-test")
})
afterAll(async () => {
  await dropDb(db)
})

const note = (chiefComplaint: string) => ({
  ...emptySections(),
  chiefComplaint,
})

describe("starting and finishing a consultation", () => {
  it("refuses a patient who has not checked in, and another doctor's patient", async () => {
    const booked = (
      await db.appointments
        .where("sessionId")
        .equals("ses_kamal_today")
        .toArray()
    ).find((a) => a.status === "booked")!
    await expect(
      commit(
        startConsultation,
        { appointmentId: booked.id },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "NOT_CHECKED_IN" })
    const checkedIn = (
      await db.appointments
        .where("sessionId")
        .equals("ses_kamal_today")
        .toArray()
    ).find((a) => a.status === "checked-in")!
    await expect(
      commit(
        startConsultation,
        { appointmentId: checkedIn.id },
        { db, actor: arif }
      )
    ).rejects.toMatchObject({ code: "NOT_YOUR_PATIENT" })
    await expect(
      commit(
        startConsultation,
        { appointmentId: checkedIn.id },
        { db, actor: reception }
      )
    ).rejects.toMatchObject({ kind: "denied" })
  })

  it("returns the same encounter when started twice, and reopens a finished one", async () => {
    const visit = await startVisit(db, "pat_0181")
    const again = await commit(
      startConsultation,
      { appointmentId: visit.appointmentId },
      { db, actor: kamal }
    )
    expect(again.result).toMatchObject({
      encounterId: visit.encounterId,
      created: false,
      reopened: false,
    })
    expect(
      await db.encounters
        .where("appointmentId")
        .equals(visit.appointmentId)
        .count()
    ).toBe(1)

    await expect(
      commit(
        finishConsultation,
        { encounterId: visit.encounterId },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "NOTE_NOT_SIGNED" })

    await commit(
      addRxLine,
      {
        encounterId: visit.encounterId,
        line: {
          brandId: SEED_REFS.brand.ace500,
          dosePattern: "1+0+1",
          mealTiming: "after",
          durationDays: 3,
        },
      },
      { db, actor: kamal }
    )
    await commit(
      signNote,
      {
        encounterId: visit.encounterId,
        sections: note("Headache"),
        diagnoses: [],
        templateId: "tpl_medicine",
        lang: "en",
      },
      { db, actor: kamal }
    )
    await expect(
      commit(
        finishConsultation,
        { encounterId: visit.encounterId },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "RX_DRAFT_OPEN" })
  })

  it("reopens a closed encounter on start", async () => {
    const visit = await startVisit(db, "pat_0091")
    await commit(
      signNote,
      {
        encounterId: visit.encounterId,
        sections: note("Follow-up, well"),
        diagnoses: [],
        templateId: "tpl_medicine",
        lang: "en",
      },
      { db, actor: kamal }
    )
    await commit(
      finishConsultation,
      { encounterId: visit.encounterId },
      { db, actor: kamal }
    )
    const { result } = await commit(
      startConsultation,
      { appointmentId: visit.appointmentId },
      { db, actor: kamal }
    )
    expect(result).toMatchObject({
      encounterId: visit.encounterId,
      reopened: true,
    })
    expect((await db.encounters.get(visit.encounterId))?.status).toBe("open")
    expect((await db.appointments.get(visit.appointmentId))?.status).toBe(
      "in-consult"
    )
    expect((await db.events.toArray()).map((e) => e.type)).toContain(
      "EncounterReopened"
    )
  })

  it("validates vitals", async () => {
    const visit = await startVisit(db, "pat_0406")
    await expect(
      commit(
        saveVitals,
        { encounterId: visit.encounterId, vitals: {} },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "VITALS_EMPTY" })
    await expect(
      commit(
        saveVitals,
        { encounterId: visit.encounterId, vitals: { bpSys: 80, bpDia: 90 } },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "VITALS_BP" })
    await expect(
      commit(
        saveVitals,
        { encounterId: visit.encounterId, vitals: { spo2: 140 } },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ kind: "validation" })
  })
})

describe("notes: sign and amend (INV-04)", () => {
  it("autosaves a draft, signs it, then amends it as a new version", async () => {
    const visit = await startVisit(db, "pat_0312")
    const saved = await commit(
      saveNote,
      {
        encounterId: visit.encounterId,
        sections: note("Cough"),
        diagnoses: [],
        templateId: "tpl_medicine",
        lang: "bn",
      },
      { db, actor: kamal }
    )
    const draft = (await db.notes.get(saved.result.noteId))!
    expect(draft).toMatchObject({ status: "draft", lang: "bn", noteVersion: 1 })
    await expect(
      commit(
        signNote,
        {
          encounterId: visit.encounterId,
          sections: emptySections(),
          diagnoses: [],
          templateId: "tpl_medicine",
          lang: "bn",
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "NOTE_EMPTY" })
    const signed = await commit(
      signNote,
      {
        encounterId: visit.encounterId,
        sections: note("Cough for 3 days"),
        diagnoses: [
          { icd10: "R05", label: "Cough", primary: false },
          { icd10: "R05", label: "Cough", primary: false },
          {
            icd10: "J06.9",
            label: "Acute upper respiratory infection, unspecified",
            primary: false,
          },
        ],
        templateId: "tpl_medicine",
        lang: "bn",
        expectedVersion: draft.version,
      },
      { db, actor: kamal }
    )
    const v1 = (await db.notes.get(signed.result.noteId))!
    // One entry per code and exactly one primary.
    expect(v1.diagnoses.map((d) => d.icd10)).toEqual(["R05", "J06.9"])
    expect(v1.diagnoses.filter((d) => d.primary)).toHaveLength(1)

    await expect(
      commit(
        amendNote,
        {
          noteId: v1.id,
          expectedVersion: v1.version,
          sections: note("Cough for 4 days"),
          diagnoses: v1.diagnoses,
          reason: "",
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ kind: "validation" })
    const amended = await commit(
      amendNote,
      {
        noteId: v1.id,
        expectedVersion: v1.version,
        sections: note("Cough for 4 days"),
        diagnoses: v1.diagnoses,
        reason: "Patient corrected the duration",
      },
      { db, actor: kamal }
    )
    const old = (await db.notes.get(v1.id))!
    const v2 = (await db.notes.get(amended.result.noteId))!
    expect(old.status).toBe("amended")
    expect(old.sections.chiefComplaint).toBe("Cough for 3 days")
    expect(v2).toMatchObject({
      noteVersion: 2,
      status: "signed",
      amendmentOfId: v1.id,
      amendReason: "Patient corrected the duration",
    })
    // The old version can no longer be amended.
    await expect(
      commit(
        amendNote,
        {
          noteId: v1.id,
          expectedVersion: old.version,
          sections: note("x"),
          diagnoses: [],
          reason: "Another change",
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "NOTE_NOT_SIGNED" })
    const audit = (await db.audit.where("entityId").equals(v2.id).toArray())[0]
    expect(audit.reason).toBe("Patient corrected the duration")
    expect((await db.events.toArray()).map((e) => e.type)).toContain(
      "NoteAmended"
    )
  })

  it("refuses to change a signed note through the engine", async () => {
    const signed = (await db.notes.where("status").equals("signed").first())!
    await expect(
      commit(
        saveNote,
        {
          encounterId: signed.encounterId,
          sections: note("Edited"),
          diagnoses: [],
          templateId: "tpl_medicine",
          lang: "en",
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({
      code: expect.stringMatching(/NOTE_SIGNED|ENCOUNTER_CLOSED/),
    })
  })
})

describe("scribe", () => {
  it("picks the hero script for Abdul and a specialty script otherwise; never drafts an assessment", () => {
    expect(scriptFor({ patientId: HERO.patient.abdulKarim }).id).toBe(
      "scr_hero_fever_cough"
    )
    expect(scriptFor({ patientId: "pat_x", specialtyCode: "PAED" }).id).toBe(
      "scr_paeds_loose_motions"
    )
    expect(scriptFor({ patientId: "pat_x", specialtyCode: "CARD" }).id).toBe(
      "scr_cardio_chest_heaviness"
    )
    const withAssessment = safeDraft([
      {
        section: "assessment",
        lines: [{ text: "Pneumonia", transcriptLineIds: ["h01"] }],
      },
      {
        section: "history",
        lines: [
          { text: "Unlinked", transcriptLineIds: [] },
          { text: "Linked", transcriptLineIds: ["h02"] },
        ],
      },
    ])
    expect(withAssessment).toEqual([
      {
        section: "history",
        lines: [{ text: "Linked", transcriptLineIds: ["h02"] }],
      },
    ])
  })

  it("discards an earlier recording when a new one starts", async () => {
    const visit = await startVisit(db, "pat_0092")
    const first = await commit(
      startScribe,
      { encounterId: visit.encounterId },
      { db, actor: kamal }
    )
    const second = await commit(
      startScribe,
      { encounterId: visit.encounterId },
      { db, actor: kamal }
    )
    expect((await db.scribeDrafts.get(first.result.draftId))?.status).toBe(
      "discarded"
    )
    expect((await db.scribeDrafts.get(second.result.draftId))?.status).toBe(
      "recording"
    )
    await commit(
      discardScribe,
      { draftId: second.result.draftId },
      { db, actor: kamal }
    )
    expect((await db.scribeDrafts.get(second.result.draftId))?.status).toBe(
      "discarded"
    )
  })

  it("appends accepted lines once, and templates only fill empty sections", () => {
    expect(appendLine("", "Fever.")).toBe("Fever.")
    expect(appendLine("Fever.", "Cough.")).toBe("Fever.\nCough.")
    expect(appendLine("Fever.\nCough.", "Cough.")).toBe("Fever.\nCough.")
    expect(hasLine("Fever.\nCough.", "Cough.")).toBe(true)
    const filled = applyTemplate(
      { ...emptySections(), chiefComplaint: "Fever" },
      templateById("tpl_medicine"),
      "bn"
    )
    expect(filled.chiefComplaint).toBe("Fever")
    expect(filled.history.startsWith("বর্তমান অসুস্থতার ইতিহাস")).toBe(true)
  })
})

describe("orders", () => {
  it("clears payment at order time for a corporate employee and creates the specimen", async () => {
    const { result } = await commit(
      placeTests,
      {
        patientId: "pat_0223",
        testIds: [SEED_REFS.test.cbc, SEED_REFS.test.lipid],
      },
      { db, actor: kamal }
    )
    const items = await db.labOrderItems
      .where("labOrderId")
      .equals(result.labOrderId)
      .toArray()
    for (const item of items) {
      expect(item.paymentCleared).toBe(true)
      expect(item.specimenId).toBeDefined()
      const basket = (await db.basketLines.get(item.basketLineId!))!
      expect(basket).toMatchObject({
        payerType: "corporate",
        corporateClientId: "corp_brightloom",
      })
    }
    const specimens = await db.specimens
      .where("labOrderId")
      .equals(result.labOrderId)
      .toArray()
    expect(specimens.every((s) => s.status === "awaiting-collection")).toBe(
      true
    )
  })

  it("refuses an imaging test on the lab order and a lab test on the imaging order", async () => {
    await expect(
      commit(
        placeTests,
        {
          patientId: HERO.patient.rokeyaBegum,
          testIds: [SEED_REFS.test.xrayChest],
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "TEST_KIND" })
    await expect(
      commit(
        placeImaging,
        {
          patientId: HERO.patient.rokeyaBegum,
          testIds: [SEED_REFS.test.cbc],
          indication: "Check",
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "TEST_KIND" })
  })

  it("searches the catalogue by code, name and Bangla gloss", async () => {
    const tests = await db.labTests.toArray()
    expect(searchTests("cbc", tests)[0].id).toBe(SEED_REFS.test.cbc)
    expect(searchTests("chest", tests).map((t) => t.id)).toContain(
      SEED_REFS.test.xrayChest
    )
    expect(searchTests("সিআরপি", tests)[0].id).toBe(SEED_REFS.test.crp)
  })
})

describe("doctor inbox", () => {
  it("marks read, acknowledges with the time, and only for the item's own doctor", async () => {
    const { result: id } = await commit(
      testInboxItem,
      {
        doctorId: HERO.doctor.kamal,
        patientId: HERO.patient.abdulKarim,
        kind: "abnormal",
      },
      { db, actor: kamal }
    )
    await expect(
      commit(acknowledgeInboxItem, { inboxItemId: id }, { db, actor: arif })
    ).rejects.toMatchObject({ code: "NOT_YOUR_ITEM" })
    await commit(readInboxItem, { inboxItemId: id }, { db, actor: kamal })
    expect((await db.inboxItems.get(id))?.status).toBe("read")
    await commit(
      acknowledgeInboxItem,
      { inboxItemId: id },
      { db, actor: kamal }
    )
    const item = (await db.inboxItems.get(id))!
    expect(item.status).toBe("acknowledged")
    expect(item.ackAt).toBeDefined()
    expect((await db.events.toArray()).map((e) => e.type)).toContain(
      "InboxAcknowledged"
    )
  })
})

describe("dose shortcuts and alert rules", () => {
  it("expands typed shortcuts", () => {
    expect(parseDoseShortcut("1+0+1 pc 5")).toMatchObject({
      code: "1+0+1",
      valid: true,
      meal: "after",
      durationDays: 5,
    })
    expect(parseDoseShortcut("½+0+½ ac 2w")).toMatchObject({
      code: "1/2+0+1/2",
      meal: "before",
      durationDays: 14,
    })
    expect(parseDoseShortcut("1-1-1 x7")).toMatchObject({
      code: "1+1+1",
      durationDays: 7,
    })
    expect(parseDoseShortcut("sos")).toMatchObject({ code: "SOS", valid: true })
    expect(parseDoseShortcut("0+0+1 cont")).toMatchObject({
      code: "0+0+1",
      durationDays: 0,
    })
    expect(parseDoseShortcut("abc").valid).toBe(false)
    expect(quantityFor("1+0+1", 5)).toBe(10)
    expect(quantityFor("2+2+2", 3)).toBe(18)
    expect(quantityFor("1/2+0+1/2", 7)).toBe(7)
    expect(quantityFor("SOS", 5)).toBe(0)
  })

  it("matches allergies by class or name, and needs a reason to override one", () => {
    const allergies = [
      {
        substance: "Penicillin",
        allergyClass: "penicillins",
        reaction: "Rash",
        severity: "moderate" as const,
      },
    ]
    expect(
      allergyAlertsFor(allergies, {
        allergyClass: "penicillins",
        genericName: "Amoxicillin",
      })
    ).toHaveLength(1)
    expect(
      allergyAlertsFor(allergies, {
        allergyClass: "macrolides",
        genericName: "Azithromycin",
      })
    ).toHaveLength(0)
    expect(
      allergyAlertsFor(allergies, { freeText: "Penicillin V syrup" })
    ).toHaveLength(1)
    const alerts = allergyAlertsFor(allergies, { allergyClass: "penicillins" })
    expect(missingOverrides(alerts, [{ kind: "allergy" }])).toEqual(["allergy"])
    expect(
      missingOverrides(alerts, [{ kind: "allergy", reason: "Tolerated" }])
    ).toEqual([])
  })

  it("treats a course as active until it ends, and only recent critical results as on file", () => {
    const t = 1_800_000_000_000
    const rx = { status: "signed" as const, signedAt: t - 10 * DAY }
    expect(isLineActive({ status: "open", durationDays: 30 }, rx, t)).toBe(true)
    expect(isLineActive({ status: "open", durationDays: 5 }, rx, t)).toBe(false)
    expect(isLineActive({ status: "dispensed", durationDays: 0 }, rx, t)).toBe(
      true
    )
    expect(isLineActive({ status: "cancelled", durationDays: 30 }, rx, t)).toBe(
      false
    )
    const base = {
      id: "r1",
      version: 1,
      createdAt: t,
      updatedAt: t,
      createdBy: "x",
      updatedBy: "x",
      origin: "central" as const,
      labOrderItemId: "i",
      patientId: "p",
      testId: "lt_k",
      analyteCode: "K",
      value: 6.8,
      unit: "mmol/L",
      flag: "HH" as const,
      critical: true,
      source: "analyser" as const,
      status: "validated" as const,
    }
    expect(
      criticalAlertsFor([{ ...base, validatedAt: t - DAY }], t)
    ).toHaveLength(1)
    expect(
      criticalAlertsFor([{ ...base, validatedAt: t - 40 * DAY }], t)
    ).toHaveLength(0)
    expect(criticalAlertsFor([{ ...base, status: "pending" }], t)).toHaveLength(
      0
    )
  })
})
