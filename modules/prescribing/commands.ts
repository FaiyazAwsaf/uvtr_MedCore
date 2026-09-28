import { z } from "zod"

import { defineCommand } from "@/core/engine/defineCommand"
import { activeEmployee, actorDoctor, writableEncounter } from "@/modules/consultation/server"

import {
  basketLineFor,
  buildLine,
  checkAlerts,
  encounterTestNames,
  ensureDraftRx,
  insertQueueEntry,
  lineName,
  liveLinesOf,
  notifyRxReady,
  queueFollowUpSms,
  reviseRx,
  type RevisedLine,
} from "./server"

/**
 * Prescribing commands (plan §6 `rx.sign`, `rx.revise`,
 * `rx.decideSubstitution`, WS-B). The Rx is written as a draft (lines added,
 * edited or removed), then signed in one atomic commit that sends it to the
 * pharmacy queue, the billing basket and the patient app. A signed Rx is
 * immutable (INV-04): changes make a new version or a new Rx.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const meal = z.enum(["before", "after", "with", "any"])
const lang = z.enum(["en", "bn"])

const lineInput = z.object({
  brandId: z.string().optional(),
  nonDictionaryName: z.string().trim().max(120).optional(),
  strength: z.string().trim().max(40).optional(),
  form: z.string().trim().max(40).optional(),
  dosePattern: z.string().trim().min(1).max(24),
  mealTiming: meal,
  durationDays: z.number().int().min(0).max(365),
  qtyPrescribed: z.number().int().min(0).max(10_000).optional(),
})

const overridesInput = z
  .array(
    z.object({
      kind: z.enum(["allergy", "duplicate", "critical"]),
      reason: z.string().trim().max(300).optional(),
    })
  )
  .optional()

export type RxLineInput = z.input<typeof lineInput>

async function patientOf(tx: Parameters<typeof buildLine>[0], patientId: string) {
  const patient = await tx.get("patients", patientId)
  return { patient, employee: await activeEmployee(tx, patient) }
}

/* ================================================================== *
 * Draft
 * ================================================================== */

/**
 * Add a medicine to the encounter's draft Rx (created on first use). The
 * interruptive alerts must have been acknowledged: allergy with a reason
 * (a refused attempt is audited), duplicate order and critical value.
 */
export const addRxLine = defineCommand({
  name: "rx.addLine",
  roles: ["doctor"],
  input: z.object({
    encounterId: z.string(),
    line: lineInput,
    overrides: overridesInput,
  }),
  async run(tx, input) {
    const encounter = await writableEncounter(tx, input.encounterId)
    const rx = await ensureDraftRx(tx, encounter)
    const existing = await tx.list("rxLines", "rxId", rx.id)
    const { patient } = await patientOf(tx, encounter.patientId)
    await checkAlerts(
      tx,
      patient,
      input.line,
      { thisRx: existing, ignoreRxIds: [rx.id] },
      input.overrides
    )
    const content = await buildLine(tx, input.line)
    const line = tx.insert("rxLines", {
      rxId: rx.id,
      patientId: rx.patientId,
      branchId: rx.branchId,
      lineNo: existing.reduce((max, l) => Math.max(max, l.lineNo), 0) + 1,
      ...content,
      paymentCleared: false,
      dispensedQty: 0,
      status: "open",
    })
    return { rxId: rx.id, rxNo: rx.rxNo, lineId: line.id }
  },
})

/** Change the dose, meal timing, duration or quantity of a draft line. */
export const updateRxLine = defineCommand({
  name: "rx.updateLine",
  roles: ["doctor"],
  input: z.object({
    lineId: z.string(),
    expectedVersion: z.number().int().optional(),
    dosePattern: z.string().trim().min(1).max(24),
    mealTiming: meal,
    durationDays: z.number().int().min(0).max(365),
    qtyPrescribed: z.number().int().min(0).max(10_000).optional(),
  }),
  async run(tx, input) {
    const line = await tx.get("rxLines", input.lineId, { expectedVersion: input.expectedVersion })
    const rx = await tx.get("prescriptions", line.rxId)
    if (rx.status !== "draft") tx.reject("RX_NOT_DRAFT", { rxNo: rx.rxNo })
    if (rx.encounterId) await writableEncounter(tx, rx.encounterId)
    const content = await buildLine(tx, {
      brandId: line.brandId,
      nonDictionaryName: line.nonDictionaryName,
      strength: line.strength,
      form: line.form,
      dosePattern: input.dosePattern,
      mealTiming: input.mealTiming,
      durationDays: input.durationDays,
      qtyPrescribed: input.qtyPrescribed,
    })
    await tx.update("rxLines", line.id, {
      dosePattern: content.dosePattern,
      mealTiming: content.mealTiming,
      durationDays: content.durationDays,
      qtyPrescribed: content.qtyPrescribed,
      instructionsEn: content.instructionsEn,
      instructionsBn: content.instructionsBn,
    })
    return { lineId: line.id }
  },
})

/** Take a line off the draft (lines are never deleted; it is marked cancelled). */
export const removeRxLine = defineCommand({
  name: "rx.removeLine",
  roles: ["doctor"],
  input: z.object({ lineId: z.string() }),
  async run(tx, input) {
    const line = await tx.get("rxLines", input.lineId)
    const rx = await tx.get("prescriptions", line.rxId)
    if (rx.status !== "draft") tx.reject("RX_NOT_DRAFT", { rxNo: rx.rxNo })
    if (rx.encounterId) await writableEncounter(tx, rx.encounterId)
    if (line.status !== "cancelled") await tx.update("rxLines", line.id, { status: "cancelled" })
    return { lineId: line.id }
  },
})

/** Save the draft's advice and follow-up date (autosave). */
export const saveRxDraft = defineCommand({
  name: "rx.saveDraft",
  roles: ["doctor"],
  input: z.object({
    encounterId: z.string(),
    advice: z.string().max(2000),
    followUpDate: isoDate.nullable().optional(),
  }),
  async run(tx, input) {
    const encounter = await writableEncounter(tx, input.encounterId)
    const rx = await ensureDraftRx(tx, encounter)
    await tx.update("prescriptions", rx.id, {
      advice: input.advice,
      ...(input.followUpDate !== undefined
        ? { followUpDate: input.followUpDate ?? undefined }
        : {}),
    })
    return { rxId: rx.id }
  },
})

/* ================================================================== *
 * Sign
 * ================================================================== */

/**
 * Sign the Rx (plan §6): it becomes immutable; a pharmacy queue entry for
 * the branch; a billing basket line per Rx line (quantity = what is on hand
 * now, price = brand unit price, never above MRP); a patient-app item; and,
 * with a follow-up date, the reminder SMS to a verified number.
 */
export const signRx = defineCommand({
  name: "rx.sign",
  roles: ["doctor"],
  input: z.object({
    rxId: z.string(),
    expectedVersion: z.number().int().optional(),
    /** Final advice and follow-up from the pad (saved in the same commit) */
    advice: z.string().max(2000).optional(),
    followUpDate: isoDate.nullable().optional(),
    smsLang: lang.default("bn"),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const rx = await tx.get("prescriptions", input.rxId, {
      expectedVersion: input.expectedVersion,
    })
    if (rx.status !== "draft") tx.reject("RX_NOT_DRAFT", { rxNo: rx.rxNo })
    const encounter = rx.encounterId ? await writableEncounter(tx, rx.encounterId) : undefined
    if (!encounter) {
      const doctor = await actorDoctor(tx)
      if (doctor?.id !== rx.doctorId) tx.reject("NOT_YOUR_PATIENT", {})
    }
    const lines = await liveLinesOf(tx, rx.id)
    if (!lines.length) tx.reject("RX_EMPTY", {})
    const followUpDate =
      input.followUpDate === undefined ? rx.followUpDate : (input.followUpDate ?? undefined)
    if (followUpDate && followUpDate <= tx.today()) {
      tx.reject("FOLLOW_UP_PAST", { date: followUpDate })
    }
    const { patient, employee } = await patientOf(tx, rx.patientId)

    const signed = await tx.update("prescriptions", rx.id, {
      status: "signed",
      signedAt: tx.now(),
      advice: input.advice ?? rx.advice,
      followUpDate,
      tests: await encounterTestNames(tx, rx.encounterId, rx.tests),
      vitalsSnapshot: encounter?.vitals ?? rx.vitalsSnapshot,
    })
    const basketLineIds: string[] = []
    for (const [index, line] of lines.entries()) {
      const patch: { lineNo?: number; paymentCleared?: boolean } = {}
      if (line.lineNo !== index + 1) patch.lineNo = index + 1
      if (employee && !line.paymentCleared) patch.paymentCleared = true
      const current = Object.keys(patch).length
        ? await tx.update("rxLines", line.id, patch)
        : line
      const basket = await basketLineFor(tx, signed, current, employee)
      if (basket) basketLineIds.push(basket.id)
    }
    const queue = await insertQueueEntry(tx, signed)
    notifyRxReady(tx, signed)
    const smsQueued = followUpDate
      ? queueFollowUpSms(tx, patient, followUpDate, input.smsLang)
      : false
    tx.emit("PrescriptionSigned", {
      branchId: signed.branchId,
      refs: { patientId: signed.patientId, rxId: signed.id, encounterId: signed.encounterId },
      params: { rxNo: signed.rxNo, version: signed.rxVersion, lines: lines.length },
    })
    return {
      rxId: signed.id,
      rxNo: signed.rxNo,
      queueId: queue.id,
      basketLineIds,
      smsQueued,
    }
  },
})

/* ================================================================== *
 * Revise
 * ================================================================== */

const revisedLineInput = lineInput.extend({
  keepLineId: z.string().optional(),
  overrides: overridesInput,
})

/**
 * Change a signed Rx (plan §6 `rx.revise`): v2 before any dispense (the old
 * version superseded; queue and basket repointed), or a new Rx that replaces
 * the old one after a dispense. New or changed lines go through the alerts.
 */
export const reviseRxCommand = defineCommand({
  name: "rx.revise",
  roles: ["doctor"],
  input: z.object({
    rxId: z.string(),
    expectedVersion: z.number().int().optional(),
    lines: z.array(revisedLineInput).min(1).max(30),
    advice: z.string().max(2000),
    followUpDate: isoDate.nullable().optional(),
    reason: z.string().trim().min(3).max(300),
    smsLang: lang.default("bn"),
  }),
  async run(tx, input) {
    const old = await tx.get("prescriptions", input.rxId, {
      expectedVersion: input.expectedVersion,
    })
    if (old.status !== "signed") tx.reject("RX_NOT_SIGNED", { rxNo: old.rxNo })
    const encounter = old.encounterId
      ? await writableEncounter(tx, old.encounterId, { allowClosed: true })
      : undefined
    if (!encounter) {
      const doctor = await actorDoctor(tx)
      if (doctor?.id !== old.doctorId) tx.reject("NOT_YOUR_PATIENT", {})
    }
    const { patient, employee } = await patientOf(tx, old.patientId)
    const oldLines = await liveLinesOf(tx, old.id)
    const oldById = new Map(oldLines.map((l) => [l.id, l]))

    // Alerts for every line that is new or changed (kept lines were checked when first written).
    for (const [index, line] of input.lines.entries()) {
      const prev = line.keepLineId ? oldById.get(line.keepLineId) : undefined
      if (prev && prev.brandId === line.brandId && prev.nonDictionaryName === line.nonDictionaryName) {
        continue
      }
      const others = input.lines
        .filter((_, i) => i !== index)
        .map((l, i) => ({
          id: `rev-${i}`,
          genericId: undefined as string | undefined,
          brandId: l.brandId,
          nonDictionaryName: l.nonDictionaryName,
          status: "open" as const,
          strength: l.strength ?? "",
        }))
      for (const other of others) {
        if (other.brandId) other.genericId = (await tx.get("brands", other.brandId)).genericId
      }
      await checkAlerts(
        tx,
        patient,
        line,
        { thisRx: others, ignoreRxIds: [old.id] },
        line.overrides
      )
    }

    const followUpDate =
      input.followUpDate === undefined ? old.followUpDate : (input.followUpDate ?? undefined)
    if (followUpDate && followUpDate !== old.followUpDate && followUpDate <= tx.today()) {
      tx.reject("FOLLOW_UP_PAST", { date: followUpDate })
    }
    const result = await reviseRx(tx, old, input.lines, {
      advice: input.advice,
      followUpDate,
      employee,
      encounter,
    })
    if (followUpDate && followUpDate !== old.followUpDate) {
      queueFollowUpSms(tx, patient, followUpDate, input.smsLang)
    }
    tx.auditContext({ reason: input.reason })
    const refs = {
      patientId: result.rx.patientId,
      rxId: result.rx.id,
      encounterId: result.rx.encounterId,
    }
    if (result.mode === "revised") {
      tx.emit("PrescriptionRevised", {
        branchId: result.rx.branchId,
        refs,
        params: { rxNo: result.rx.rxNo, version: result.rx.rxVersion },
      })
    } else {
      tx.emit("PrescriptionReplaced", {
        branchId: result.rx.branchId,
        refs,
        params: { rxNo: result.rx.rxNo, oldRxNo: old.rxNo },
      })
    }
    return {
      rxId: result.rx.id,
      rxNo: result.rx.rxNo,
      rxVersion: result.rx.rxVersion,
      mode: result.mode,
    }
  },
})

/* ================================================================== *
 * Substitution decision (the pharmacy asked; only the doctor changes the Rx)
 * ================================================================== */

/**
 * Decide a pharmacy substitution request (plan §6 `rx.decideSubstitution`).
 * Approve: the Rx is revised with the proposed brand (v2, or a new Rx after a
 * dispense) and the line keeps its payment. Reject: the line goes back to
 * the pharmacy unchanged, with the doctor's note.
 */
export const decideSubstitution = defineCommand({
  name: "rx.decideSubstitution",
  roles: ["doctor"],
  input: z.object({
    substitutionId: z.string(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(500).optional(),
  }),
  async run(tx, input) {
    const sub = await tx.get("substitutionRequests", input.substitutionId)
    if (sub.status !== "pending") tx.reject("SUBSTITUTION_DECIDED", { status: sub.status })
    const doctor = await actorDoctor(tx)
    if (!doctor || doctor.id !== sub.doctorId) tx.reject("NOT_YOUR_ITEM", {})
    const rx = await tx.get("prescriptions", sub.rxId)
    const line = await tx.get("rxLines", sub.rxLineId)
    const proposed = await tx.get("brands", sub.proposedBrandId)
    const from = await lineName(tx, line)
    const to = `${proposed.name} ${proposed.strength}`
    const inboxItems = (await tx.list("inboxItems", "doctorId", doctor!.id)).filter(
      (item) => item.refs.substitutionId === sub.id && item.status !== "actioned"
    )
    const decided = { decidedBy: tx.actor.staffId, decidedAt: tx.now(), decisionNote: input.note }
    const refs = {
      patientId: sub.patientId,
      rxId: rx.id,
      rxLineId: line.id,
      substitutionId: sub.id,
    }

    if (input.decision === "reject") {
      await tx.update("substitutionRequests", sub.id, { status: "rejected", ...decided })
      if (line.status === "awaiting-prescriber") {
        await tx.update("rxLines", line.id, { status: "open" })
      }
      for (const item of inboxItems) {
        await tx.update("inboxItems", item.id, { status: "actioned", ackAt: tx.now() })
      }
      if (input.note) tx.auditContext({ reason: input.note })
      tx.emit("SubstitutionRejected", {
        branchId: sub.branchId,
        refs,
        params: { rxNo: rx.rxNo, from, to },
      })
      return { decision: "rejected" as const, rxId: rx.id, rxNo: rx.rxNo }
    }

    if (rx.status !== "signed") tx.reject("RX_NOT_SIGNED", { rxNo: rx.rxNo })
    const { patient, employee } = await patientOf(tx, rx.patientId)
    // The proposed brand still goes through the allergy check.
    await checkAlerts(
      tx,
      patient,
      { brandId: proposed.id, dosePattern: line.dosePattern, mealTiming: line.mealTiming, durationDays: line.durationDays },
      { thisRx: [], ignoreRxIds: [rx.id], kinds: ["allergy"] },
      undefined
    )
    const oldLines = await liveLinesOf(tx, rx.id)
    const dispensed = oldLines.some((l) => l.dispensedQty > 0)
    const keep = (l: (typeof oldLines)[number]) =>
      l.id === line.id || !dispensed || (l.dispensedQty === 0 && l.status !== "bought-elsewhere")
    const lines: RevisedLine[] = oldLines.filter(keep).map((l) =>
      l.id === line.id
        ? {
            brandId: proposed.id,
            dosePattern: l.dosePattern,
            mealTiming: l.mealTiming,
            durationDays: l.durationDays,
            qtyPrescribed: l.qtyPrescribed,
            keepLineId: l.id,
            carryPayment: true,
            substitutedFromLineId: l.id,
          }
        : {
            brandId: l.brandId,
            nonDictionaryName: l.nonDictionaryName,
            strength: l.strength,
            form: l.form,
            dosePattern: l.dosePattern,
            mealTiming: l.mealTiming,
            durationDays: l.durationDays,
            qtyPrescribed: l.qtyPrescribed,
            keepLineId: l.id,
          }
    )
    const encounter = rx.encounterId ? await tx.find("encounters", rx.encounterId) : undefined
    const result = await reviseRx(tx, rx, lines, {
      advice: rx.advice,
      followUpDate: rx.followUpDate,
      employee,
      encounter,
    })
    const newLine = result.lines.find((l) => l.substitutedFromLineId === line.id)
    await tx.update("substitutionRequests", sub.id, {
      status: "approved",
      ...decided,
      resultRxId: result.rx.id,
    })
    for (const item of inboxItems) {
      await tx.update("inboxItems", item.id, { status: "actioned", ackAt: tx.now() })
    }
    tx.auditContext({ reason: input.note || `Substitution approved: ${from} to ${to}` })
    tx.emit("SubstitutionApproved", {
      branchId: sub.branchId,
      refs: { ...refs, rxId: result.rx.id, rxLineId: newLine?.id },
      params: { rxNo: result.rx.rxNo, from, to },
    })
    tx.emit(result.mode === "revised" ? "PrescriptionRevised" : "PrescriptionReplaced", {
      branchId: result.rx.branchId,
      refs: {
        patientId: result.rx.patientId,
        rxId: result.rx.id,
        encounterId: result.rx.encounterId,
      },
      params:
        result.mode === "revised"
          ? { rxNo: result.rx.rxNo, version: result.rx.rxVersion }
          : { rxNo: result.rx.rxNo, oldRxNo: rx.rxNo },
    })
    return {
      decision: "approved" as const,
      rxId: result.rx.id,
      rxNo: result.rx.rxNo,
      rxVersion: result.rx.rxVersion,
      lineId: newLine?.id,
    }
  },
})
