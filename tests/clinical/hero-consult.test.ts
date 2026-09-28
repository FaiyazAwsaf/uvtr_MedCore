import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { EVENT_CATALOG } from "@/core/events/registry"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { stockByBranch, stockStatus } from "@/core/stock/availability"
import {
  acceptScribe,
  completeScribe,
  finishConsultation,
  saveVitals,
  signNote,
  startScribe,
} from "@/modules/consultation/commands"
import { NOTE_SECTION_KEYS } from "@/modules/consultation/note"
import { requestTransfer } from "@/modules/inventory/commands"
import { placeImaging, placeTests } from "@/modules/orders/commands"
import { alternativesFor } from "@/modules/prescribing/alternatives"
import {
  addRxLine,
  saveRxDraft,
  signRx,
  updateRxLine,
} from "@/modules/prescribing/commands"

import { dropDb, kamal, seededDb, startVisit } from "./helpers"

/**
 * The hero consultation (plan §7.2, §15 minutes 4 to 7) at the data level:
 * Abdul Karim is called and seen, the scribe drafts the note, the allergy
 * alert stops Moxacil, Zimax 500 is out at B1 so the doctor picks an
 * alternative and asks B3 for a transfer, Ace 500 goes on as 1+0+1 with the
 * Bangla dose line, CBC, CRP and a chest X-ray are ordered, and signing puts
 * the Rx in the pharmacy queue and its lines in the billing basket.
 */

let db: MedcoreDb
let encounterId: string
let appointmentId: string
let tokenId: string

beforeAll(async () => {
  db = await seededDb("clinical-hero-test")
})
afterAll(async () => {
  await dropDb(db)
})

describe("the hero consultation", () => {
  it("calls and starts Abdul Karim: encounter open, token and appointment in consult", async () => {
    const visit = await startVisit(db)
    ;({ encounterId, appointmentId, tokenId } = visit)
    const encounter = await db.encounters.get(encounterId)
    expect(encounter).toMatchObject({
      patientId: HERO.patient.abdulKarim,
      doctorId: HERO.doctor.kamal,
      branchId: "B1",
      status: "open",
      templateId: "tpl_medicine",
    })
    expect((await db.appointments.get(appointmentId))?.status).toBe(
      "in-consult"
    )
    expect((await db.queueTokens.get(tokenId))?.status).toBe("in-consult")
    const started = (await db.events.toArray()).filter(
      (e) => e.type === "EncounterStarted"
    )
    expect(started).toHaveLength(1)
    expect(started[0].consumers).toEqual(
      EVENT_CATALOG.EncounterStarted.consumers
    )
  })

  it("records the scribe draft with every line linked to the transcript, no medicines or diagnoses", async () => {
    const { result: rec } = await commit(
      startScribe,
      { encounterId },
      { db, actor: kamal }
    )
    expect(rec.scriptId).toBe("scr_hero_fever_cough")
    expect((await db.scribeDrafts.get(rec.draftId))?.status).toBe("recording")
    await commit(completeScribe, { draftId: rec.draftId }, { db, actor: kamal })
    const draft = (await db.scribeDrafts.get(rec.draftId))!
    expect(draft.status).toBe("drafted")
    expect(draft.transcript).toHaveLength(18)
    const lineIds = new Set(draft.transcript.map((l) => l.id))
    const sections = draft.draft.map((s) => s.section)
    expect(sections).not.toContain("assessment")
    const brands = (await db.brands.toArray()).map((b) => b.name.toLowerCase())
    for (const section of draft.draft) {
      for (const line of section.lines) {
        expect(line.transcriptLineIds.length).toBeGreaterThan(0)
        for (const id of line.transcriptLineIds)
          expect(lineIds.has(id)).toBe(true)
        const words = line.text.toLowerCase().split(/[^a-z]+/)
        expect(brands.some((b) => words.includes(b))).toBe(false)
      }
    }

    const { result } = await commit(
      acceptScribe,
      { draftId: rec.draftId },
      { db, actor: kamal }
    )
    expect(result.added).toBe(11)
    const note = (await db.notes.get(result.noteId))!
    expect(note.status).toBe("draft")
    expect(note.scribeDraftId).toBe(rec.draftId)
    expect(note.sections.chiefComplaint).toBe("Fever for 5 days with cough.")
    expect(note.sections.examination).toContain(
      "Crackles heard at the right lung base."
    )
    expect(note.diagnoses).toEqual([])
    expect((await db.scribeDrafts.get(rec.draftId))?.status).toBe("accepted")

    // Accepting again adds nothing twice.
    const again = await commit(
      acceptScribe,
      { draftId: rec.draftId },
      { db, actor: kamal }
    )
    expect(again.result.added).toBe(0)
  })

  it("saves vitals and signs the note with a diagnosis the doctor picked", async () => {
    const encounter = (await db.encounters.get(encounterId))!
    await commit(
      saveVitals,
      {
        encounterId,
        expectedVersion: encounter.version,
        vitals: {
          bpSys: 138,
          bpDia: 86,
          pulse: 96,
          tempC: 38.2,
          spo2: 96,
          weightKg: 70,
        },
      },
      { db, actor: kamal }
    )
    expect((await db.encounters.get(encounterId))?.vitals).toMatchObject({
      bpSys: 138,
      tempC: 38.2,
      recordedBy: kamal.staffId,
    })

    const draft = (await db.notes
      .where("encounterId")
      .equals(encounterId)
      .first())!
    const sections = {
      ...draft.sections,
      assessment: "Lower respiratory tract infection.",
    }
    const { result } = await commit(
      signNote,
      {
        encounterId,
        sections,
        diagnoses: [
          {
            icd10: "J22",
            label: "Unspecified acute lower respiratory infection",
            primary: true,
          },
        ],
        templateId: "tpl_medicine",
        lang: "en",
        expectedVersion: draft.version,
      },
      { db, actor: kamal }
    )
    const note = (await db.notes.get(result.noteId))!
    expect(note).toMatchObject({ status: "signed", noteVersion: 1 })
    expect(note.signedAt).toBeDefined()
    for (const key of NOTE_SECTION_KEYS)
      expect(typeof note.sections[key]).toBe("string")
    expect((await db.encounters.get(encounterId))?.status).toBe("signed")
  })

  it("stops Moxacil 500 with the allergy alert and audits the attempt", async () => {
    await expect(
      commit(
        addRxLine,
        {
          encounterId,
          line: {
            brandId: SEED_REFS.brand.moxacil500,
            dosePattern: "1+1+1",
            mealTiming: "after",
            durationDays: 7,
          },
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "ALLERGY_OVERRIDE_REQUIRED" })
    const blocked = (await db.audit.toArray()).filter(
      (a) => a.action === "blocked"
    )
    expect(blocked.at(-1)).toMatchObject({
      code: "ALLERGY_OVERRIDE_REQUIRED",
      command: "rx.addLine",
    })
    const abdulLines = await db.rxLines
      .where("patientId")
      .equals(HERO.patient.abdulKarim)
      .toArray()
    expect(
      abdulLines.some((l) => l.brandId === SEED_REFS.brand.moxacil500)
    ).toBe(false)
  })

  it("shows Zimax 500 out at B1 with alphabetical alternatives, and asks B3 for a transfer", async () => {
    const levels = await db.stockLevels.toArray()
    const reorder = await db.reorderLevels.toArray()
    const byBranch = stockByBranch(SEED_REFS.brand.zimax500, levels, reorder)
    const status = stockStatus("B1", byBranch)
    expect(status.status).toBe("other-branch")
    expect(status.onHand).toBe(0)
    expect(status.otherBranches).toContain("B3")

    const brands = await db.brands.toArray()
    const zimax = brands.find((b) => b.id === SEED_REFS.brand.zimax500)!
    const alts = alternativesFor(zimax, brands, byBranch, "B1")
    expect(alts.sameStrength.map((b) => b.id)).toEqual([
      SEED_REFS.brand.azithrocin500,
      "brd_tridosil_500mg",
    ])
    const names = alts.otherStrengths.map((b) => `${b.name} ${b.strength}`)
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
    expect(alts.otherBranches.map((b) => b.branch)).toEqual(["B2", "B3", "B5"])
    // Offline, other branches are unknown (HAZ-15).
    expect(
      alternativesFor(zimax, brands, byBranch, "B1", { offline: true })
        .otherBranches
    ).toEqual([])

    const { result } = await commit(
      requestTransfer,
      {
        fromBranchId: "B3",
        toBranchId: "B1",
        lines: [{ brandId: SEED_REFS.brand.zimax500, qty: 5 }],
        requestedFrom: "doctor-prompt",
      },
      { db, actor: kamal }
    )
    expect(await db.transfers.get(result.transferId)).toMatchObject({
      fromBranchId: "B3",
      toBranchId: "B1",
      status: "requested",
      requestedFrom: "doctor-prompt",
      requestedBy: kamal.staffId,
    })
  })

  it("writes Azithrocin 500 and Ace 500 as 1+0+1 with the Bangla dose line", async () => {
    const azi = await commit(
      addRxLine,
      {
        encounterId,
        line: {
          brandId: SEED_REFS.brand.azithrocin500,
          dosePattern: "1+0+0",
          mealTiming: "before",
          durationDays: 5,
        },
      },
      { db, actor: kamal }
    )
    const ace = await commit(
      addRxLine,
      {
        encounterId,
        line: {
          brandId: SEED_REFS.brand.ace500,
          dosePattern: "1+0+1",
          mealTiming: "after",
          durationDays: 5,
        },
      },
      { db, actor: kamal }
    )
    expect(ace.result.rxId).toBe(azi.result.rxId)
    const line = (await db.rxLines.get(ace.result.lineId))!
    expect(line).toMatchObject({
      dosePattern: "1+0+1",
      mealTiming: "after",
      durationDays: 5,
      qtyPrescribed: 10,
      instructionsBn: "১+০+১ (সকালে ও রাতে) খাবারের পরে, ৫ দিন",
      instructionsEn: "1+0+1, morning and night, after meals, for 5 days",
      genericId: SEED_REFS.generic.paracetamol,
      strength: "500 mg",
      form: "tablet",
      status: "open",
      paymentCleared: false,
    })
    const rx = (await db.prescriptions.get(ace.result.rxId))!
    expect(rx).toMatchObject({ status: "draft", rxVersion: 1, encounterId })
    expect(rx.rxNo).toMatch(/^RX-B1-\d{6}$/)

    // Adding Ace again on the same Rx is a duplicate order.
    await expect(
      commit(
        addRxLine,
        {
          encounterId,
          line: {
            brandId: "brd_napa_500mg",
            dosePattern: "1+1+1",
            mealTiming: "after",
            durationDays: 3,
          },
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "DUPLICATE_ACK_REQUIRED" })

    // Dose edits recompute the instructions and quantity.
    await commit(
      updateRxLine,
      {
        lineId: azi.result.lineId,
        dosePattern: "1+0+0",
        mealTiming: "before",
        durationDays: 3,
      },
      { db, actor: kamal }
    )
    expect((await db.rxLines.get(azi.result.lineId))?.qtyPrescribed).toBe(3)
  })

  it("orders CBC, CRP and a chest X-ray to the lab worklist and the billing basket", async () => {
    const { result: lab } = await commit(
      placeTests,
      {
        patientId: HERO.patient.abdulKarim,
        encounterId,
        testIds: [SEED_REFS.test.cbc, SEED_REFS.test.crp],
      },
      { db, actor: kamal }
    )
    const order = (await db.labOrders.get(lab.labOrderId))!
    expect(order).toMatchObject({
      status: "ordered",
      source: "doctor",
      doctorId: HERO.doctor.kamal,
    })
    expect(order.orderNo).toMatch(/^LO-B1-\d{6}$/)
    const items = await db.labOrderItems
      .where("labOrderId")
      .equals(order.id)
      .toArray()
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item).toMatchObject({ status: "ordered", paymentCleared: false })
      const basket = (await db.basketLines.get(item.basketLineId!))!
      expect(basket).toMatchObject({
        sourceType: "test",
        sourceId: item.id,
        serviceType: "lab",
        status: "open",
        payerType: "self",
        qty: 1,
        doctorId: HERO.doctor.kamal,
      })
      const test = (await db.labTests.get(item.testId))!
      expect(basket.unitPriceP).toBe(test.priceP)
    }

    const { result: img } = await commit(
      placeImaging,
      {
        patientId: HERO.patient.abdulKarim,
        encounterId,
        testIds: [SEED_REFS.test.xrayChest],
        indication: "Fever and cough; crackles at the right base",
      },
      { db, actor: kamal }
    )
    const imaging = (await db.imagingOrders.get(img.orders[0].imagingOrderId))!
    expect(imaging).toMatchObject({
      modality: "xray",
      bodyPart: "Chest",
      status: "ordered",
      paymentCleared: false,
    })
    expect(await db.basketLines.get(imaging.basketLineId!)).toMatchObject({
      sourceType: "imaging",
      sourceId: imaging.id,
      serviceType: "imaging",
    })

    await expect(
      commit(
        placeTests,
        {
          patientId: HERO.patient.abdulKarim,
          encounterId,
          testIds: [SEED_REFS.test.cbc],
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "DUPLICATE_TEST" })

    const types = (await db.events.toArray()).map((e) => e.type)
    expect(types).toContain("TestOrdered")
    expect(types).toContain("ImagingOrdered")
  })

  it("signs the Rx: immutable, in the pharmacy queue, lines in the basket, patient app and SMS", async () => {
    const rx = (await db.prescriptions
      .where("encounterId")
      .equals(encounterId)
      .first())!
    const followUp = addDaysISO(dhakaDate(now()), 7)
    await commit(
      saveRxDraft,
      {
        encounterId,
        advice: "Drink plenty of fluids.",
        followUpDate: followUp,
      },
      { db, actor: kamal }
    )
    const before = (await db.prescriptions.get(rx.id))!
    const { result } = await commit(
      signRx,
      {
        rxId: rx.id,
        expectedVersion: before.version,
        advice: "Drink plenty of fluids and rest.",
        smsLang: "bn",
      },
      { db, actor: kamal }
    )
    const signed = (await db.prescriptions.get(rx.id))!
    expect(signed).toMatchObject({
      status: "signed",
      advice: "Drink plenty of fluids and rest.",
      followUpDate: followUp,
    })
    expect(signed.vitalsSnapshot).toMatchObject({ bpSys: 138, bpDia: 86 })
    expect(signed.tests).toEqual(
      expect.arrayContaining([
        "Complete blood count (CBC)",
        "C-reactive protein (CRP)",
        "X-ray chest (PA view)",
      ])
    )

    const queue = await db.pharmacyQueue.where("rxId").equals(rx.id).toArray()
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      status: "waiting",
      branchId: "B1",
      rxNo: signed.rxNo,
    })

    const lines = await db.rxLines.where("rxId").equals(rx.id).toArray()
    expect(result.basketLineIds).toHaveLength(2)
    for (const line of lines) {
      const basket = (
        await db.basketLines.where("sourceId").equals(line.id).toArray()
      )[0]
      const brand = (await db.brands.get(line.brandId!))!
      expect(basket).toMatchObject({
        sourceType: "rx-line",
        serviceType: "medicine",
        status: "open",
        qty: line.qtyPrescribed,
        unitPriceP: brand.unitPriceP,
        mrpP: brand.mrpP,
        doctorId: HERO.doctor.kamal,
        payerType: "self",
      })
      expect(basket.unitPriceP).toBeLessThanOrEqual(basket.mrpP!)
    }

    const notification = (
      await db.notifications
        .where("patientId")
        .equals(HERO.patient.abdulKarim)
        .toArray()
    ).find((n) => n.refs.rxId === rx.id)
    expect(notification).toMatchObject({
      kind: "rxReady",
      titleKey: "patientApp.notifications.rxReady",
      read: false,
    })

    const sms = (
      await db.sms.where("patientId").equals(HERO.patient.abdulKarim).toArray()
    ).find((s) => s.templateId === "follow-up-reminder")
    expect(sms).toMatchObject({
      to: HERO.karimPhone,
      lang: "bn",
      status: "queued",
    })
    // No medicine names or clinical content in the SMS.
    for (const word of ["Ace", "Azithrocin", "Paracetamol", "fever", "CBC"]) {
      expect(sms!.text).not.toContain(word)
    }

    const event = (await db.events.toArray()).find(
      (e) => e.type === "PrescriptionSigned"
    )
    expect(event).toMatchObject({
      refs: { rxId: rx.id, patientId: HERO.patient.abdulKarim, encounterId },
      params: { rxNo: signed.rxNo, lines: 2 },
      consumers: [
        "prescribing.consumers.pharmacyQueue",
        "prescribing.consumers.billing",
        "prescribing.consumers.patientApp",
        "prescribing.consumers.audit",
      ],
    })

    // Signed means immutable: no edits and no new lines on this Rx.
    await expect(
      commit(
        updateRxLine,
        {
          lineId: lines[0].id,
          dosePattern: "1+1+1",
          mealTiming: "after",
          durationDays: 5,
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "RX_NOT_DRAFT" })
    await expect(
      commit(
        addRxLine,
        {
          encounterId,
          line: {
            brandId: SEED_REFS.brand.fexo120,
            dosePattern: "0+0+1",
            mealTiming: "after",
            durationDays: 7,
          },
        },
        { db, actor: kamal }
      )
    ).rejects.toMatchObject({ code: "RX_ALREADY_SIGNED" })
    await expect(
      commit(signRx, { rxId: rx.id }, { db, actor: kamal })
    ).rejects.toMatchObject({ code: "RX_NOT_DRAFT" })
  })

  it("finishes the consultation: encounter closed, appointment and token done", async () => {
    await commit(finishConsultation, { encounterId }, { db, actor: kamal })
    expect(await db.encounters.get(encounterId)).toMatchObject({
      status: "closed",
    })
    expect((await db.encounters.get(encounterId))?.endedAt).toBeDefined()
    expect((await db.appointments.get(appointmentId))?.status).toBe("done")
    expect((await db.queueTokens.get(tokenId))?.status).toBe("done")
    const finished = (await db.events.toArray()).find(
      (e) => e.type === "ConsultationFinished"
    )
    expect(finished?.refs).toMatchObject({
      encounterId,
      tokenId,
      appointmentId,
    })
    await expect(
      commit(finishConsultation, { encounterId }, { db, actor: kamal })
    ).rejects.toMatchObject({ code: "ENCOUNTER_CLOSED" })
  })
})
