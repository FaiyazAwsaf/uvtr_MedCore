"use client"

import * as React from "react"
import { FilePenLine, FileSignature, History, LayoutTemplate, PenLine } from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { Diagnosis, EncounterRow, NoteRow, NoteSections } from "@/core/db/schema"
import type { QuickText } from "@/core/seed/content"
import type { Locale } from "@/lib/i18n/config"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { amendNote, saveNote, signNote } from "../../commands"
import {
  applyTemplate,
  emptySections,
  isNoteEmpty,
  NOTE_SECTION_KEYS,
  templateById,
  templateSections,
  type NoteSectionKey,
} from "../../note"
import { appendQuickText, expandQuickText, QuickTextMenu } from "../quick-text"
import { useClinicalCommand } from "../use-clinical-command"
import { IcdPicker } from "./icd-picker"

type Draft = {
  sections: NoteSections
  diagnoses: Diagnosis[]
  templateId: string
  lang: Locale
}

const AUTOSAVE_MS = 1200

/** Which note section a quick text goes into. */
const QUICK_SECTION: Record<QuickText["section"], NoteSectionKey> = {
  advice: "plan",
  plan: "plan",
  history: "history",
  examination: "examination",
}

/**
 * The clinical note (objective §3A): the specialty template in English or
 * Bangla, five sections, ICD-10 diagnoses chosen by the doctor, autosave
 * while it is a draft, then sign. A signed note is immutable (INV-04): a
 * change is an amendment with a reason, which makes a new version.
 */
export function NoteEditor({
  encounter,
  notes,
  specialtyCode,
  readOnly,
  registerFlush,
}: {
  encounter: EncounterRow
  notes: NoteRow[] | undefined
  specialtyCode?: string
  readOnly: boolean
  registerFlush: (flush: () => Promise<void>) => void
}) {
  const { t, tk, time } = useLocale()
  const latest = notes?.[0]
  const signedLatest = latest && latest.status !== "draft" ? latest : undefined
  const [amending, setAmending] = React.useState(false)

  return (
    <SectionCard
      size="sm"
      icon={FilePenLine}
      title={t("consultation.note.title")}
      action={
        signedLatest ? (
          <StatusPill tone="success" dot data-testid="note-status" data-status="signed">
            {t("consultation.note.signedV", { version: signedLatest.noteVersion })}
          </StatusPill>
        ) : (
          <StatusPill tone="warning" dot data-testid="note-status" data-status="draft">
            {t("consultation.note.draft")}
          </StatusPill>
        )
      }
    >
      <div id="enc-note" className="flex flex-col gap-4">
        {notes === undefined ? null : signedLatest && !amending ? (
          <SignedNote
            note={signedLatest}
            canAmend={true}
            onAmend={() => setAmending(true)}
          />
        ) : signedLatest && amending ? (
          <AmendForm note={signedLatest} specialtyCode={specialtyCode} onDone={() => setAmending(false)} />
        ) : (
          <DraftForm
            encounter={encounter}
            latest={latest}
            specialtyCode={specialtyCode}
            readOnly={readOnly}
            registerFlush={registerFlush}
          />
        )}

        {notes && notes.length > 1 ? (
          <div className="border-t border-hairline pt-3">
            <h3 className="micro mb-2 flex items-center gap-1.5">
              <History className="size-3.5" />
              {t("consultation.note.versions")}
            </h3>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="note-versions">
              {notes.map((n) => (
                <li key={n.id}>
                  {t("consultation.note.versionLine", {
                    version: n.noteVersion,
                    status: tk(`consultation.note.versionStatus.${n.status}`),
                    time: time(n.signedAt ?? n.updatedAt),
                  })}
                  {n.amendReason ? ` · ${t("consultation.note.amendedBecause", { reason: n.amendReason })}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ */

function SectionFields({
  sections,
  lang,
  templateId,
  onChange,
  readOnly = false,
}: {
  sections: NoteSections
  lang: Locale
  templateId: string
  onChange: (key: NoteSectionKey, value: string) => void
  readOnly?: boolean
}) {
  const { t } = useLocale()
  const scaffold = templateSections(templateById(templateId), lang)
  return (
    <div className="grid gap-3 @min-[40rem]/note:grid-cols-2">
      {NOTE_SECTION_KEYS.map((key) => (
        <label
          key={key}
          className={cn("flex min-w-0 flex-col gap-1.5", key === "chiefComplaint" && "@min-[40rem]/note:col-span-2")}
        >
          <span className="text-xs font-semibold text-muted-foreground">
            {t(`consultation.note.sections.${key}`)}
          </span>
          <Textarea
            data-testid={`note-section-${key}`}
            value={sections[key]}
            readOnly={readOnly}
            placeholder={scaffold[key]}
            lang={lang}
            className={cn("text-[0.8125rem] leading-relaxed", key === "chiefComplaint" ? "min-h-12" : "min-h-24")}
            onChange={(e) => {
              const value = e.target.value
              onChange(key, expandQuickText(value, lang) ?? value)
            }}
          />
        </label>
      ))}
    </div>
  )
}

function DraftForm({
  encounter,
  latest,
  specialtyCode,
  readOnly,
  registerFlush,
}: {
  encounter: EncounterRow
  latest: NoteRow | undefined
  specialtyCode?: string
  readOnly: boolean
  registerFlush: (flush: () => Promise<void>) => void
}) {
  const { t, locale } = useLocale()
  const save = useClinicalCommand(saveNote)
  const sign = useClinicalCommand(signNote)
  const initial = React.useCallback(
    (row: NoteRow | undefined): Draft =>
      row
        ? { sections: row.sections, diagnoses: row.diagnoses, templateId: row.templateId, lang: row.lang }
        : {
            sections: emptySections(),
            diagnoses: [],
            templateId: encounter.templateId ?? templateById(undefined).id,
            lang: locale,
          },
    [encounter.templateId, locale]
  )
  const [draft, setDraftState] = React.useState<Draft>(() => initial(latest))
  const draftRef = React.useRef(draft)
  const dirtyRef = React.useRef(false)
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const editSeq = React.useRef(0)
  const knownVersion = React.useRef<number | undefined>(latest?.version)
  const syncedKey = React.useRef(latest ? `${latest.id}:${latest.version}` : "none")
  const timer = React.useRef<number | undefined>(undefined)
  const inflight = React.useRef<Promise<void>>(Promise.resolve())

  // Follow the stored note (another window, an accepted scribe line) unless the doctor is typing.
  React.useEffect(() => {
    const key = latest ? `${latest.id}:${latest.version}` : "none"
    if (dirtyRef.current || key === syncedKey.current) return
    syncedKey.current = key
    knownVersion.current = latest?.version
    const next = initial(latest)
    draftRef.current = next
    setDraftState(next)
  }, [latest, initial])

  const saveNow = React.useCallback(async () => {
    window.clearTimeout(timer.current)
    const run = async () => {
      if (!dirtyRef.current) return
      const seq = editSeq.current
      setSaving(true)
      const out = await save.run({
        encounterId: encounter.id,
        ...draftRef.current,
        expectedVersion: knownVersion.current,
      })
      setSaving(false)
      if (out.ok) {
        knownVersion.current = out.result.version
        if (seq === editSeq.current) {
          dirtyRef.current = false
          setDirty(false)
        }
      } else if (out.conflict) {
        dirtyRef.current = false
        setDirty(false)
        syncedKey.current = ""
      }
    }
    inflight.current = inflight.current.then(run, run)
    await inflight.current
  }, [encounter.id, save])

  React.useEffect(() => {
    registerFlush(saveNow)
  }, [registerFlush, saveNow])
  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  const update = (patch: Partial<Draft>) => {
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    setDraftState(next)
    dirtyRef.current = true
    editSeq.current += 1
    setDirty(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void saveNow(), AUTOSAVE_MS)
  }

  const onSign = async () => {
    window.clearTimeout(timer.current)
    await inflight.current
    const out = await sign.run({
      encounterId: encounter.id,
      ...draftRef.current,
      expectedVersion: knownVersion.current,
    })
    if (out.ok) {
      dirtyRef.current = false
      setDirty(false)
      toast.success(t("consultation.note.signed", { version: out.result.noteVersion }))
    }
  }

  const template = templateById(draft.templateId)
  return (
    <div className="@container/note flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <LayoutTemplate className="size-3.5" />
          {t("consultation.note.template")}:{" "}
          <span className="font-medium text-foreground">{template.name[locale]}</span>
        </span>
        <SegmentedPills
          size="sm"
          value={draft.lang}
          onChange={(lang) => update({ lang })}
          options={[
            { value: "en", label: "EN" },
            { value: "bn", label: "বাং" },
          ]}
          className="ml-auto"
        />
        {!readOnly ? (
          <>
            <Button
              size="xs"
              variant="neutral"
              type="button"
              data-testid="note-insert-template"
              onClick={() => {
                update({ sections: applyTemplate(draftRef.current.sections, template, draftRef.current.lang) })
                toast(t("consultation.note.templateInserted"))
              }}
            >
              {t("consultation.note.insertTemplate")}
            </Button>
            <QuickTextMenu
              lang={draft.lang}
              onPick={(quick) => {
                const key = QUICK_SECTION[quick.section]
                update({
                  sections: {
                    ...draftRef.current.sections,
                    [key]: appendQuickText(draftRef.current.sections[key], quick, draftRef.current.lang),
                  },
                })
              }}
            />
          </>
        ) : null}
      </div>

      <SectionFields
        sections={draft.sections}
        lang={draft.lang}
        templateId={draft.templateId}
        readOnly={readOnly}
        onChange={(key, value) => update({ sections: { ...draftRef.current.sections, [key]: value } })}
      />

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{t("consultation.icd.title")}</h3>
        <IcdPicker
          value={draft.diagnoses}
          specialty={specialtyCode}
          readOnly={readOnly}
          onChange={(diagnoses) => update({ diagnoses })}
        />
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-hairline pt-3">
          <span className="mr-auto text-xs text-muted-foreground" data-testid="note-save-state">
            {saving ? t("consultation.note.saving") : dirty ? t("consultation.note.unsaved") : latest ? t("consultation.note.saved") : t("consultation.note.signHint")}
          </span>
          <Button
            size="sm"
            onClick={onSign}
            disabled={sign.pending || isNoteEmpty(draft.sections)}
            data-testid="note-sign"
          >
            <FileSignature />
            {t("consultation.note.sign")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function SignedNote({
  note,
  canAmend,
  onAmend,
}: {
  note: NoteRow
  canAmend: boolean
  onAmend: () => void
}) {
  const { t, time } = useLocale()
  return (
    <div className="@container/note flex flex-col gap-3" data-testid="note-signed">
      <dl className="grid gap-3 @min-[40rem]/note:grid-cols-2">
        {NOTE_SECTION_KEYS.map((key) => (
          <div key={key} className={cn("min-w-0", key === "chiefComplaint" && "@min-[40rem]/note:col-span-2")}>
            <dt className="text-xs font-semibold text-muted-foreground">{t(`consultation.note.sections.${key}`)}</dt>
            <dd
              className="mt-1 text-[0.8125rem] leading-relaxed whitespace-pre-wrap"
              lang={note.lang}
              data-testid={`note-section-${key}`}
            >
              {note.sections[key].trim() || <span className="text-muted-foreground">{t("consultation.note.empty")}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{t("consultation.icd.title")}</h3>
        <IcdPicker value={note.diagnoses} onChange={() => undefined} readOnly />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-hairline pt-3">
        <span className="mr-auto text-xs text-muted-foreground">
          {t("consultation.note.signed", { version: note.noteVersion })} · {note.signedAt ? time(note.signedAt) : ""}
          {note.scribeDraftId ? ` · ${t("consultation.note.fromScribe")}` : ""}
        </span>
        {canAmend ? (
          <Button size="sm" variant="outline" onClick={onAmend} data-testid="note-amend">
            <PenLine />
            {t("consultation.note.amend")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function AmendForm({
  note,
  specialtyCode,
  onDone,
}: {
  note: NoteRow
  specialtyCode?: string
  onDone: () => void
}) {
  const { t } = useLocale()
  const amend = useClinicalCommand(amendNote)
  const [sections, setSections] = React.useState<NoteSections>(note.sections)
  const [diagnoses, setDiagnoses] = React.useState<Diagnosis[]>(note.diagnoses)
  const [reason, setReason] = React.useState("")

  const submit = async () => {
    const out = await amend.run({
      noteId: note.id,
      expectedVersion: note.version,
      sections,
      diagnoses,
      reason,
    })
    if (out.ok) {
      toast.success(t("consultation.note.amended", { version: out.result.noteVersion }))
      onDone()
    }
  }

  return (
    <div className="@container/note flex flex-col gap-4" data-testid="note-amend-form">
      <p className="text-[0.8125rem] font-semibold">{t("consultation.note.amendTitle")}</p>
      <SectionFields
        sections={sections}
        lang={note.lang}
        templateId={note.templateId}
        onChange={(key, value) => setSections((s) => ({ ...s, [key]: value }))}
      />
      <IcdPicker value={diagnoses} specialty={specialtyCode} onChange={setDiagnoses} />
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted-foreground">{t("consultation.note.amendReason")}</span>
        <Input
          value={reason}
          data-testid="note-amend-reason"
          placeholder={t("consultation.note.amendReasonPlaceholder")}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flex justify-end gap-2 border-t border-hairline pt-3">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("consultation.note.cancelAmend")}
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={amend.pending || reason.trim().length < 3 || isNoteEmpty(sections)}
          data-testid="note-amend-sign"
        >
          <FileSignature />
          {t("consultation.note.signAmendment")}
        </Button>
      </div>
    </div>
  )
}
