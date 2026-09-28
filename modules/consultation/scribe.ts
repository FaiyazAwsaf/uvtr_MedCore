/**
 * The scripted AI scribe (a CONCEPT, plan §11 and D12): no model is called and
 * nothing leaves the browser. A consultation "recording" plays back one of the
 * seeded scripts, then shows its SOAP draft. Every draft line links to the
 * transcript lines it came from, and the draft never holds medicines or
 * diagnoses: those stay with the doctor (the Rx pad and the ICD-10 picker).
 */

import type { NoteSections, ScribeDraftRow } from "@/core/db/schema"
import { HERO_SCRIBE_SCRIPT_ID, SCRIBE_SCRIPTS, type ScribeScript } from "@/core/seed/content"

/** Seconds of the recording animation before the transcript starts streaming. */
export const SCRIBE_RECORDING_MS = 3200
/** Pause between transcript lines while it streams. */
export const SCRIBE_LINE_MS = 420

/**
 * The script for a consultation: the one written for this patient (the hero),
 * else one for the doctor's specialty, else the hero script.
 */
export function scriptFor(opts: {
  patientId?: string
  specialtyCode?: string
  scriptId?: string
}): ScribeScript {
  const byId = opts.scriptId && SCRIBE_SCRIPTS.find((s) => s.id === opts.scriptId)
  if (byId) return byId
  const byPatient = SCRIBE_SCRIPTS.find((s) => s.patientId && s.patientId === opts.patientId)
  if (byPatient) return byPatient
  const bySpecialty = SCRIBE_SCRIPTS.find(
    (s) => !s.patientId && s.specialtyCode === opts.specialtyCode
  )
  if (bySpecialty) return bySpecialty
  return SCRIBE_SCRIPTS.find((s) => s.id === HERO_SCRIBE_SCRIPT_ID) ?? SCRIBE_SCRIPTS[0]
}

/**
 * The scribe never drafts the assessment (a diagnosis is the doctor's call), so
 * any assessment section in a script is dropped before it reaches the screen.
 */
export function safeDraft(draft: ScribeDraftRow["draft"]): ScribeDraftRow["draft"] {
  return draft
    .filter((section) => section.section !== "assessment")
    .map((section) => ({
      section: section.section,
      lines: section.lines.filter((l) => l.text.trim() && l.transcriptLineIds.length > 0),
    }))
    .filter((section) => section.lines.length > 0)
}

export type DraftLineRef = { section: keyof NoteSections; index: number }

/** Every line of a draft, flattened with its position (for "accept all"). */
export function allDraftLines(draft: ScribeDraftRow["draft"]): DraftLineRef[] {
  return draft.flatMap((section) =>
    section.lines.map((_, index) => ({ section: section.section, index }))
  )
}
