/**
 * Clinical note helpers (objective §3A, plan §5.4): the five sections, the
 * specialty template scaffold, and the scribe's line-by-line acceptance. Pure
 * functions shared by the note editor, the commands and the tests.
 */

import type { Locale } from "@/lib/i18n/config"
import type { NoteSections } from "@/core/db/schema"
import { NOTE_TEMPLATES, templateForSpecialty, type NoteTemplate } from "@/core/seed/content"

export const NOTE_SECTION_KEYS = [
  "chiefComplaint",
  "history",
  "examination",
  "assessment",
  "plan",
] as const satisfies readonly (keyof NoteSections)[]

export type NoteSectionKey = (typeof NOTE_SECTION_KEYS)[number]

export function emptySections(): NoteSections {
  return { chiefComplaint: "", history: "", examination: "", assessment: "", plan: "" }
}

export function isNoteEmpty(sections: NoteSections): boolean {
  return NOTE_SECTION_KEYS.every((key) => !sections[key].trim())
}

/** Adds a line at the end of a section (on its own line); a line already there is not repeated. */
export function appendLine(text: string, line: string): string {
  const clean = line.trim()
  if (!clean) return text
  const existing = text.split("\n").map((l) => l.trim())
  if (existing.includes(clean)) return text
  const body = text.replace(/\s+$/, "")
  return body ? `${body}\n${clean}` : clean
}

/** Whether a section already holds a line (used to mark accepted scribe lines). */
export function hasLine(text: string, line: string): boolean {
  const clean = line.trim()
  return !!clean && text.split("\n").some((l) => l.trim() === clean)
}

export function templateById(id: string | undefined): NoteTemplate {
  return NOTE_TEMPLATES.find((t) => t.id === id) ?? NOTE_TEMPLATES[0]
}

export { templateForSpecialty }

/** The scaffold text of a template in one language. */
export function templateSections(template: NoteTemplate, lang: Locale): NoteSections {
  return {
    chiefComplaint: template.sections.chiefComplaint[lang],
    history: template.sections.history[lang],
    examination: template.sections.examination[lang],
    assessment: template.sections.assessment[lang],
    plan: template.sections.plan[lang],
  }
}

/**
 * Inserts the template scaffold into empty sections only, so nothing the
 * doctor or the scribe already wrote is overwritten.
 */
export function applyTemplate(
  sections: NoteSections,
  template: NoteTemplate,
  lang: Locale
): NoteSections {
  const scaffold = templateSections(template, lang)
  const next = { ...sections }
  for (const key of NOTE_SECTION_KEYS) {
    if (!next[key].trim()) next[key] = scaffold[key]
  }
  return next
}

/** Trims every section (what gets saved and signed). */
export function cleanSections(sections: NoteSections): NoteSections {
  const out = emptySections()
  for (const key of NOTE_SECTION_KEYS) out[key] = sections[key].replace(/\s+$/, "")
  return out
}

export function sameSections(a: NoteSections, b: NoteSections): boolean {
  return NOTE_SECTION_KEYS.every((key) => a[key] === b[key])
}
