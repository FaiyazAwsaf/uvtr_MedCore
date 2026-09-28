import { z } from "zod"

import type { Diagnosis, NoteRow, NoteSections } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import { SCRIBE_SCRIPTS } from "@/core/seed/content"

import {
  appendLine,
  cleanSections,
  emptySections,
  isNoteEmpty,
  NOTE_SECTION_KEYS,
  templateForSpecialty,
} from "./note"
import { allDraftLines, safeDraft, scriptFor } from "./scribe"
import { actorDoctor, notesOf, writableEncounter } from "./server"

/**
 * Consultation commands (plan §6 `consult.*`, WS-B). Each is one atomic
 * commit. Signed notes are immutable (INV-04): a change is an amendment, a
 * new signed version, and the old one moves to "amended".
 */

const lang = z.enum(["en", "bn"])
const text = z.string().max(6000)
const sectionsSchema = z.object({
  chiefComplaint: text,
  history: text,
  examination: text,
  assessment: text,
  plan: text,
})
const sectionKey = z.enum(NOTE_SECTION_KEYS)
const diagnosisSchema = z.object({
  icd10: z.string().trim().min(1).max(12),
  label: z.string().trim().min(1).max(240),
  primary: z.boolean(),
})

/** One entry per code, and exactly one primary when there are any. */
export function normaliseDiagnoses(list: Diagnosis[]): Diagnosis[] {
  const seen = new Set<string>()
  const out: Diagnosis[] = []
  for (const d of list) {
    if (seen.has(d.icd10)) continue
    seen.add(d.icd10)
    out.push({ icd10: d.icd10, label: d.label, primary: d.primary })
  }
  const primary = out.findIndex((d) => d.primary)
  return out.map((d, i) => ({ ...d, primary: primary === -1 ? i === 0 : i === primary }))
}

/* ================================================================== *
 * Start, reopen and finish
 * ================================================================== */

/**
 * Start (or reopen) the consultation for a checked-in appointment: the
 * encounter opens, and the appointment and queue token move to in-consult.
 * Starting again while it is open returns the same encounter.
 */
export const startConsultation = defineCommand({
  name: "consult.start",
  roles: ["doctor"],
  input: z.object({
    appointmentId: z.string(),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const appointment = await tx.get("appointments", input.appointmentId)
    const doctor = await actorDoctor(tx)
    if (!doctor || doctor.id !== appointment.doctorId) tx.reject("NOT_YOUR_PATIENT", {})
    if (!["checked-in", "in-consult", "done"].includes(appointment.status)) {
      tx.reject("NOT_CHECKED_IN", { status: appointment.status })
    }
    const token = appointment.tokenId
      ? await tx.find("queueTokens", appointment.tokenId)
      : undefined
    if (token?.status === "skipped") tx.reject("TOKEN_SKIPPED", { token: token.label })

    const existing = (await tx.list("encounters", "appointmentId", appointment.id)).sort(
      (a, b) => b.startedAt - a.startedAt
    )[0]
    const refs = {
      patientId: appointment.patientId,
      appointmentId: appointment.id,
      sessionId: appointment.sessionId,
      tokenId: token?.id,
    }
    const params = { token: token?.label ?? "" }

    let encounterId: string
    let created = false
    let reopened = false
    if (existing && existing.status !== "closed") {
      encounterId = existing.id
    } else if (existing) {
      await tx.update("encounters", existing.id, { status: "open", endedAt: undefined })
      encounterId = existing.id
      reopened = true
      tx.emit("EncounterReopened", {
        branchId: appointment.branchId,
        refs: { ...refs, encounterId },
        params,
      })
    } else {
      const specialty = await tx.find("specialties", doctor!.specialtyId)
      const encounter = tx.insert("encounters", {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        branchId: appointment.branchId,
        mode: "in-person",
        type: appointment.visitType,
        status: "open",
        startedAt: tx.now(),
        templateId: templateForSpecialty(specialty?.code ?? "MED").id,
      })
      encounterId = encounter.id
      created = true
      tx.emit("EncounterStarted", {
        branchId: appointment.branchId,
        refs: { ...refs, encounterId },
        params,
      })
    }

    if (appointment.status !== "in-consult") {
      await tx.update("appointments", appointment.id, { status: "in-consult" })
    }
    if (token && token.status !== "in-consult") {
      await tx.update("queueTokens", token.id, {
        status: "in-consult",
        calledAt: token.calledAt ?? tx.now(),
      })
    }
    return { encounterId, created, reopened }
  },
})

/**
 * Finish the consultation: the encounter closes and the appointment and
 * queue token are done. The note must be signed and no unsigned
 * prescription may be left behind.
 */
export const finishConsultation = defineCommand({
  name: "consult.finish",
  roles: ["doctor"],
  input: z.object({ encounterId: z.string() }),
  async run(tx, input) {
    const encounter = await writableEncounter(tx, input.encounterId)
    const [latest] = await notesOf(tx, encounter.id)
    if (!latest || latest.status === "draft") tx.reject("NOTE_NOT_SIGNED", {})
    for (const rx of await tx.list("prescriptions", "encounterId", encounter.id)) {
      if (rx.status !== "draft") continue
      const lines = await tx.list("rxLines", "rxId", rx.id)
      if (lines.some((l) => l.status !== "cancelled")) {
        tx.reject("RX_DRAFT_OPEN", { rxNo: rx.rxNo })
      }
    }
    await tx.update("encounters", encounter.id, { status: "closed", endedAt: tx.now() })

    const appointment = encounter.appointmentId
      ? await tx.find("appointments", encounter.appointmentId)
      : undefined
    if (appointment && appointment.status !== "done") {
      await tx.update("appointments", appointment.id, { status: "done" })
    }
    const token = appointment?.tokenId
      ? await tx.find("queueTokens", appointment.tokenId)
      : undefined
    if (token && token.status !== "done") {
      await tx.update("queueTokens", token.id, { status: "done" })
    }
    tx.emit("ConsultationFinished", {
      branchId: encounter.branchId,
      refs: {
        patientId: encounter.patientId,
        encounterId: encounter.id,
        appointmentId: appointment?.id,
        tokenId: token?.id,
        sessionId: appointment?.sessionId,
      },
      params: {
        token: token?.label ?? "",
        minutes: Math.max(1, Math.round((tx.now() - encounter.startedAt) / 60_000)),
      },
    })
    return { encounterId: encounter.id }
  },
})

/* ================================================================== *
 * Vitals
 * ================================================================== */

const vitalsSchema = z.object({
  bpSys: z.number().int().min(40).max(300).optional(),
  bpDia: z.number().int().min(20).max(200).optional(),
  pulse: z.number().int().min(20).max(250).optional(),
  tempC: z.number().min(30).max(45).optional(),
  spo2: z.number().int().min(40).max(100).optional(),
  weightKg: z.number().min(0.5).max(300).optional(),
  heightCm: z.number().min(30).max(250).optional(),
  rbs: z.number().min(0.5).max(60).optional(),
})

export type VitalsInput = z.input<typeof vitalsSchema>

/** Record the encounter's vitals (they also go on the printed Rx). */
export const saveVitals = defineCommand({
  name: "consult.saveVitals",
  roles: ["doctor"],
  input: z.object({
    encounterId: z.string(),
    expectedVersion: z.number().int().optional(),
    vitals: vitalsSchema,
  }),
  async run(tx, input) {
    const encounter = await writableEncounter(tx, input.encounterId)
    const v = input.vitals
    if (!Object.values(v).some((value) => value !== undefined)) tx.reject("VITALS_EMPTY", {})
    if (v.bpSys !== undefined && v.bpDia !== undefined && v.bpDia >= v.bpSys) {
      tx.reject("VITALS_BP", {})
    }
    await tx.update(
      "encounters",
      encounter.id,
      { vitals: { ...v, recordedAt: tx.now(), recordedBy: tx.actor.staffId } },
      { expectedVersion: input.expectedVersion }
    )
    tx.emit("VitalsRecorded", {
      branchId: encounter.branchId,
      refs: { patientId: encounter.patientId, encounterId: encounter.id },
      params: {
        bp: v.bpSys !== undefined && v.bpDia !== undefined ? `${v.bpSys}/${v.bpDia}` : "-",
      },
    })
    return { encounterId: encounter.id }
  },
})

/* ================================================================== *
 * Notes
 * ================================================================== */

const noteInput = z.object({
  encounterId: z.string(),
  sections: sectionsSchema,
  diagnoses: z.array(diagnosisSchema).max(12),
  templateId: z.string(),
  lang,
  /** Version of the draft note the editor last saw */
  expectedVersion: z.number().int().optional(),
})

async function upsertDraftNote(
  tx: Tx,
  input: z.output<typeof noteInput>,
  sign: boolean
): Promise<{ note: NoteRow; encounterStatus: string }> {
  const encounter = await writableEncounter(tx, input.encounterId)
  const [latest] = await notesOf(tx, encounter.id)
  if (latest && latest.status !== "draft") {
    tx.reject("NOTE_SIGNED", { version: latest.noteVersion })
  }
  const sections = cleanSections(input.sections)
  if (sign && isNoteEmpty(sections)) tx.reject("NOTE_EMPTY", {})
  const content = {
    sections,
    diagnoses: normaliseDiagnoses(input.diagnoses),
    templateId: input.templateId,
    lang: input.lang,
  }
  let note: NoteRow
  if (latest) {
    note = await tx.update(
      "notes",
      latest.id,
      sign ? { ...content, status: "signed", signedAt: tx.now() } : content,
      { expectedVersion: input.expectedVersion }
    )
  } else {
    note = tx.insert("notes", {
      encounterId: encounter.id,
      patientId: encounter.patientId,
      doctorId: encounter.doctorId,
      noteVersion: 1,
      status: sign ? "signed" : "draft",
      ...content,
      signedAt: sign ? tx.now() : undefined,
    })
  }
  return { note, encounterStatus: encounter.status }
}

/** Save the draft note (autosave while the doctor types). */
export const saveNote = defineCommand({
  name: "consult.saveNote",
  roles: ["doctor"],
  input: noteInput,
  async run(tx, input) {
    const { note } = await upsertDraftNote(tx, input, false)
    return { noteId: note.id, version: note.version }
  },
})

/** Sign the note (with its final content): it becomes immutable (INV-04). */
export const signNote = defineCommand({
  name: "consult.signNote",
  roles: ["doctor"],
  input: noteInput,
  async run(tx, input) {
    const { note, encounterStatus } = await upsertDraftNote(tx, input, true)
    if (encounterStatus === "open") {
      await tx.update("encounters", input.encounterId, { status: "signed" })
    }
    tx.emit("NoteSigned", {
      refs: { patientId: note.patientId, encounterId: note.encounterId },
      params: { version: note.noteVersion, diagnoses: note.diagnoses.length },
    })
    return { noteId: note.id, noteVersion: note.noteVersion }
  },
})

/**
 * Amend a signed note: a new signed version with the reason, and the old
 * version marked "amended" (kept as it was).
 */
export const amendNote = defineCommand({
  name: "consult.amendNote",
  roles: ["doctor"],
  input: z.object({
    noteId: z.string(),
    expectedVersion: z.number().int(),
    sections: sectionsSchema,
    diagnoses: z.array(diagnosisSchema).max(12),
    reason: z.string().trim().min(3).max(500),
  }),
  async run(tx, input) {
    const old = await tx.get("notes", input.noteId, { expectedVersion: input.expectedVersion })
    const encounter = await writableEncounter(tx, old.encounterId, { allowClosed: true })
    if (old.status !== "signed") tx.reject("NOTE_NOT_SIGNED", {})
    const [latest] = await notesOf(tx, encounter.id)
    if (latest.id !== old.id) tx.reject("NOTE_SUPERSEDED", { version: latest.noteVersion })
    const sections = cleanSections(input.sections)
    if (isNoteEmpty(sections)) tx.reject("NOTE_EMPTY", {})

    await tx.update("notes", old.id, { status: "amended" })
    const note = tx.insert("notes", {
      encounterId: old.encounterId,
      patientId: old.patientId,
      doctorId: old.doctorId,
      noteVersion: old.noteVersion + 1,
      status: "signed",
      templateId: old.templateId,
      lang: old.lang,
      sections,
      diagnoses: normaliseDiagnoses(input.diagnoses),
      amendmentOfId: old.id,
      amendReason: input.reason,
      scribeDraftId: old.scribeDraftId,
      signedAt: tx.now(),
    })
    tx.auditContext({ reason: input.reason })
    tx.emit("NoteAmended", {
      refs: { patientId: note.patientId, encounterId: note.encounterId },
      params: { version: note.noteVersion },
    })
    return { noteId: note.id, noteVersion: note.noteVersion }
  },
})

/* ================================================================== *
 * Scribe (concept: scripted, no AI call)
 * ================================================================== */

/** "Record consultation": a new scribe draft in the recording state. */
export const startScribe = defineCommand({
  name: "consult.scribeStart",
  roles: ["doctor"],
  input: z.object({ encounterId: z.string(), scriptId: z.string().optional() }),
  async run(tx, input) {
    const encounter = await writableEncounter(tx, input.encounterId)
    const doctor = await tx.get("doctors", encounter.doctorId)
    const specialty = await tx.find("specialties", doctor.specialtyId)
    const script = scriptFor({
      patientId: encounter.patientId,
      specialtyCode: specialty?.code,
      scriptId: input.scriptId,
    })
    for (const earlier of await tx.list("scribeDrafts", "encounterId", encounter.id)) {
      if (earlier.status === "recording" || earlier.status === "drafted") {
        await tx.update("scribeDrafts", earlier.id, { status: "discarded" })
      }
    }
    const draft = tx.insert("scribeDrafts", {
      encounterId: encounter.id,
      scriptId: script.id,
      transcript: [],
      draft: [],
      status: "recording",
    })
    return { draftId: draft.id, scriptId: script.id }
  },
})

/** The recording ends: the transcript and the SOAP draft (never medicines or diagnoses). */
export const completeScribe = defineCommand({
  name: "consult.scribeComplete",
  roles: ["doctor"],
  input: z.object({ draftId: z.string() }),
  async run(tx, input) {
    const draft = await tx.get("scribeDrafts", input.draftId)
    const encounter = await writableEncounter(tx, draft.encounterId)
    const count = (d: typeof draft.draft) => d.reduce((n, s) => n + s.lines.length, 0)
    if (draft.status === "drafted" || draft.status === "accepted") {
      return { draftId: draft.id, lines: count(draft.draft) }
    }
    if (draft.status !== "recording") tx.reject("SCRIBE_STATE", { status: draft.status })
    const script =
      SCRIBE_SCRIPTS.find((s) => s.id === draft.scriptId) ??
      scriptFor({ patientId: encounter.patientId })
    const safe = safeDraft(script.draft)
    await tx.update("scribeDrafts", draft.id, {
      transcript: script.transcript,
      draft: safe,
      status: "drafted",
    })
    tx.emit("ScribeDraftReady", {
      branchId: encounter.branchId,
      refs: { patientId: encounter.patientId, encounterId: encounter.id },
      params: { lines: count(safe) },
    })
    return { draftId: draft.id, lines: count(safe) }
  },
})

/**
 * The doctor accepts draft lines into the note sections (all, or the chosen
 * ones). The note stays a draft for the doctor to edit and sign.
 */
export const acceptScribe = defineCommand({
  name: "consult.acceptScribe",
  roles: ["doctor"],
  input: z.object({
    draftId: z.string(),
    lines: z.array(z.object({ section: sectionKey, index: z.number().int().min(0) })).optional(),
    lang: lang.default("en"),
  }),
  async run(tx, input) {
    const draft = await tx.get("scribeDrafts", input.draftId)
    if (draft.status !== "drafted" && draft.status !== "accepted") {
      tx.reject("SCRIBE_STATE", { status: draft.status })
    }
    const encounter = await writableEncounter(tx, draft.encounterId)
    const [latest] = await notesOf(tx, encounter.id)
    if (latest && latest.status !== "draft") {
      tx.reject("NOTE_SIGNED", { version: latest.noteVersion })
    }
    let sections: NoteSections = latest ? { ...latest.sections } : emptySections()
    let added = 0
    for (const ref of input.lines ?? allDraftLines(draft.draft)) {
      const line = draft.draft.find((s) => s.section === ref.section)?.lines[ref.index]
      if (!line) continue
      const next = appendLine(sections[ref.section], line.text)
      if (next !== sections[ref.section]) {
        sections = { ...sections, [ref.section]: next }
        added += 1
      }
    }
    let noteId: string
    if (latest) {
      noteId = latest.id
      await tx.update("notes", latest.id, { sections, scribeDraftId: draft.id })
    } else {
      noteId = tx.insert("notes", {
        encounterId: encounter.id,
        patientId: encounter.patientId,
        doctorId: encounter.doctorId,
        noteVersion: 1,
        status: "draft",
        templateId: encounter.templateId ?? templateForSpecialty("MED").id,
        lang: input.lang,
        sections,
        diagnoses: [],
        scribeDraftId: draft.id,
      }).id
    }
    if (draft.status !== "accepted") {
      await tx.update("scribeDrafts", draft.id, { status: "accepted" })
    }
    if (added) {
      tx.emit("ScribeDraftAccepted", {
        branchId: encounter.branchId,
        refs: { patientId: encounter.patientId, encounterId: encounter.id },
        params: { lines: added },
      })
    }
    return { noteId, added }
  },
})

/** Discard a scribe draft (nothing from it reaches the note). */
export const discardScribe = defineCommand({
  name: "consult.scribeDiscard",
  roles: ["doctor"],
  input: z.object({ draftId: z.string() }),
  async run(tx, input) {
    const draft = await tx.get("scribeDrafts", input.draftId)
    await writableEncounter(tx, draft.encounterId, { allowClosed: true })
    if (draft.status !== "discarded") {
      await tx.update("scribeDrafts", draft.id, { status: "discarded" })
    }
    return { draftId: draft.id }
  },
})

/* ================================================================== *
 * Doctor inbox
 * ================================================================== */

async function ownInboxItem(tx: Tx, id: string) {
  const item = await tx.get("inboxItems", id)
  const doctor = await actorDoctor(tx)
  if (!doctor || doctor.id !== item.doctorId) tx.reject("NOT_YOUR_ITEM", {})
  return item
}

/** Opening an unread item marks it read. */
export const readInboxItem = defineCommand({
  name: "consult.readInbox",
  roles: ["doctor"],
  input: z.object({ inboxItemId: z.string() }),
  async run(tx, input) {
    const item = await ownInboxItem(tx, input.inboxItemId)
    if (item.status === "unread") await tx.update("inboxItems", item.id, { status: "read" })
    return { inboxItemId: item.id }
  },
})

/** Acknowledge a result (the acknowledgement time is recorded). */
export const acknowledgeInboxItem = defineCommand({
  name: "consult.ackInbox",
  roles: ["doctor"],
  input: z.object({ inboxItemId: z.string() }),
  async run(tx, input) {
    const item = await ownInboxItem(tx, input.inboxItemId)
    if (item.status === "acknowledged" || item.status === "actioned") {
      return { inboxItemId: item.id, ackAt: item.ackAt }
    }
    if (item.kind === "substitution") tx.reject("INBOX_NEEDS_DECISION", {})
    await tx.update("inboxItems", item.id, { status: "acknowledged", ackAt: tx.now() })
    tx.emit("InboxAcknowledged", {
      refs: { ...item.refs, patientId: item.patientId ?? item.refs.patientId },
      params: {},
    })
    return { inboxItemId: item.id, ackAt: tx.now() }
  },
})

/** Section keys, re-exported for the note editor and tests. */
export { NOTE_SECTION_KEYS }
