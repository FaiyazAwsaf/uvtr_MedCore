"use client"

import * as React from "react"
import { Check, Mic, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { StreamingText } from "@/components/motion/streaming-text"
import { Waveform } from "@/components/motion/waveform"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusPill } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import type { EncounterRow, NoteRow, NoteSections, ScribeDraftRow, TranscriptLine } from "@/core/db/schema"
import { SCRIBE_SCRIPTS } from "@/core/seed/content"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { acceptScribe, completeScribe, discardScribe, startScribe } from "../../commands"
import { hasLine } from "../../note"
import { SCRIBE_LINE_MS, SCRIBE_RECORDING_MS } from "../../scribe"
import { useClinicalCommand } from "../use-clinical-command"

type Playback = {
  draftId: string
  scriptId: string
  phase: "recording" | "streaming"
  shown: number
}

const SPEAKER_TONE: Record<TranscriptLine["speaker"], string> = {
  doctor: "text-link",
  patient: "text-info",
  attendant: "text-[color-mix(in_oklch,var(--chart-2),var(--foreground)_20%)] dark:text-chart-2",
}

/**
 * The AI scribe (a CONCEPT, plan §11): "Record consultation" plays a scripted
 * recording, streams the transcript line by line, then shows a SOAP draft
 * whose every line links to the transcript lines it came from. The doctor
 * accepts lines into the note; the draft never holds medicines or diagnoses.
 */
export function ScribePanel({
  encounter,
  draft,
  note,
  readOnly,
  flushNote,
}: {
  encounter: EncounterRow
  draft: ScribeDraftRow | null | undefined
  note: NoteRow | undefined
  readOnly: boolean
  flushNote: () => Promise<void>
}) {
  const { t, locale } = useLocale()
  const start = useClinicalCommand(startScribe)
  const complete = useClinicalCommand(completeScribe)
  const accept = useClinicalCommand(acceptScribe)
  const discard = useClinicalCommand(discardScribe)
  const [play, setPlay] = React.useState<Playback | null>(null)
  const [elapsed, setElapsed] = React.useState(0)
  const [hover, setHover] = React.useState<Set<string> | null>(null)
  const completing = React.useRef(false)

  const script = SCRIBE_SCRIPTS.find((s) => s.id === (play?.scriptId ?? draft?.scriptId))
  const total = script?.transcript.length ?? 0
  const completeRun = complete.run
  const completeRef = React.useRef(completeRun)
  React.useEffect(() => {
    completeRef.current = completeRun
  }, [completeRun])

  const phase = play?.phase
  const shown = play?.shown ?? 0
  const playingDraftId = play?.draftId

  // The recording: a clock and the waveform, then the transcript starts.
  React.useEffect(() => {
    if (phase !== "recording") return
    const tick = window.setInterval(() => setElapsed((e) => e + 1), 1000)
    const next = window.setTimeout(
      () => setPlay((p) => (p ? { ...p, phase: "streaming", shown: 1 } : p)),
      SCRIBE_RECORDING_MS
    )
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(next)
    }
  }, [phase, playingDraftId])

  // The transcript streams line by line, then the draft is saved.
  React.useEffect(() => {
    if (phase !== "streaming" || !playingDraftId) return
    if (shown < total) {
      const next = window.setTimeout(
        () => setPlay((p) => (p ? { ...p, shown: p.shown + 1 } : p)),
        SCRIBE_LINE_MS
      )
      return () => window.clearTimeout(next)
    }
    if (completing.current) return
    completing.current = true
    const done = window.setTimeout(() => {
      void completeRef.current({ draftId: playingDraftId }).finally(() => {
        completing.current = false
        setPlay(null)
      })
    }, SCRIBE_LINE_MS)
    return () => {
      window.clearTimeout(done)
      completing.current = false
    }
  }, [phase, shown, total, playingDraftId])

  const record = async () => {
    const out = await start.run({ encounterId: encounter.id })
    if (out.ok) {
      setElapsed(0)
      setPlay({ draftId: out.result.draftId, scriptId: out.result.scriptId, phase: "recording", shown: 0 })
    }
  }
  const skip = () => {
    if (!play || !script) return
    setPlay({ ...play, phase: "streaming", shown: script.transcript.length })
  }
  const acceptLines = async (lines?: { section: keyof NoteSections; index: number }[]) => {
    if (!draft) return
    await flushNote()
    const out = await accept.run({ draftId: draft.id, lines, lang: note?.lang ?? locale })
    if (out.ok) {
      toast.success(
        out.result.added
          ? t("consultation.scribe.accepted", { count: out.result.added })
          : t("consultation.scribe.nothingNew")
      )
    }
  }
  const onDiscard = async () => {
    if (!draft) return
    const out = await discard.run({ draftId: draft.id })
    if (out.ok) toast(t("consultation.scribe.discarded"))
  }

  const noteSigned = !!note && note.status !== "draft"
  const reviewing = !play && draft && (draft.status === "drafted" || draft.status === "accepted")
  const interrupted = !play && draft?.status === "recording"
  const transcript = reviewing ? draft!.transcript : (script?.transcript ?? [])
  const lineNumber = new Map(transcript.map((l, i) => [l.id, i + 1]))

  return (
    <SectionCard
      size="sm"
      icon={Sparkles}
      title={t("consultation.scribe.title")}
      action={
        <div className="flex items-center gap-1.5">
          <StatusPill
            tone="muted"
            className="bg-[color-mix(in_oklch,var(--chart-2)_22%,transparent)] text-[color-mix(in_oklch,var(--chart-2),var(--foreground)_25%)] dark:text-chart-2"
          >
            {t("consultation.scribe.concept")}
          </StatusPill>
          <SimulatedBadge />
        </div>
      }
    >
      <div className="@container/scribe flex flex-col gap-3" data-testid="scribe-panel" data-state={play?.phase ?? draft?.status ?? "idle"}>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill tone="warning" dot>
            {t("consultation.scribe.aiDraft")}
          </StatusPill>
          <StatusPill tone="muted">{t("consultation.scribe.ambient")}</StatusPill>
        </div>

        {play ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-md bg-surface-raised px-3 py-2.5">
              <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <Mic className="size-4" />
                <span className="animate-pulse-ring absolute inset-0 rounded-full" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[0.8125rem] font-semibold">
                  {play.phase === "recording" ? t("consultation.scribe.recording") : t("consultation.scribe.transcribing")}
                </div>
                <Waveform active bars={40} height={28} className="mt-1 justify-start" />
              </div>
              <span className="nums font-mono text-xs text-muted-foreground" lang="en">
                {`00:${String(Math.min(59, elapsed)).padStart(2, "0")}`}
              </span>
              <Button size="xs" variant="ghost" onClick={skip} data-testid="scribe-skip">
                {t("consultation.scribe.skip")}
              </Button>
            </div>
            {play.phase === "streaming" && script ? (
              <ol className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1" data-testid="scribe-transcript">
                {script.transcript.slice(0, play.shown).map((line, i) => (
                  <TranscriptItem
                    key={line.id}
                    line={line}
                    number={i + 1}
                    streaming={i === play.shown - 1}
                  />
                ))}
              </ol>
            ) : null}
          </div>
        ) : reviewing ? (
          <div className="grid gap-3 @min-[38rem]/scribe:grid-cols-2">
            <div className="min-w-0">
              <h3 className="micro mb-2">{t("consultation.scribe.transcript")}</h3>
              <ol className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1" data-testid="scribe-transcript">
                {draft!.transcript.map((line, i) => (
                  <TranscriptItem
                    key={line.id}
                    line={line}
                    number={i + 1}
                    highlighted={!!hover?.has(line.id)}
                  />
                ))}
              </ol>
            </div>
            <div className="min-w-0">
              <h3 className="micro mb-2">{t("consultation.scribe.draft")}</h3>
              <div className="flex flex-col gap-2.5" data-testid="scribe-draft">
                {draft!.draft.map((section) => (
                  <div key={section.section}>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      {t(`consultation.scribe.sections.${section.section}`)}
                    </div>
                    <ul className="flex flex-col gap-1">
                      {section.lines.map((line, index) => {
                        const inNote = !!note && hasLine(note.sections[section.section], line.text)
                        return (
                          <li
                            key={index}
                            data-testid="scribe-draft-line"
                            data-section={section.section}
                            data-transcript-ids={line.transcriptLineIds.join(",")}
                            onMouseEnter={() => setHover(new Set(line.transcriptLineIds))}
                            onMouseLeave={() => setHover(null)}
                            onFocus={() => setHover(new Set(line.transcriptLineIds))}
                            onBlur={() => setHover(null)}
                            tabIndex={0}
                            className="group/line flex items-start gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] outline-none hover:bg-primary-soft focus-visible:bg-primary-soft"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="leading-snug">{line.text}</p>
                              <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                                {t("consultation.scribe.linked", {
                                  lines: line.transcriptLineIds
                                    .map((id) => lineNumber.get(id) ?? id)
                                    .join(", "),
                                })}
                              </p>
                            </div>
                            {inNote ? (
                              <span className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-medium text-success">
                                <Check className="size-3.5" />
                                {t("consultation.scribe.inNote")}
                              </span>
                            ) : !readOnly && !noteSigned ? (
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                title={t("consultation.scribe.acceptLine")}
                                aria-label={t("consultation.scribe.acceptLine")}
                                data-testid="scribe-accept-line"
                                disabled={accept.pending}
                                onClick={() => acceptLines([{ section: section.section, index }])}
                              >
                                <Plus />
                              </Button>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : interrupted ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-raised px-3 py-2.5 text-[0.8125rem]">
            <TriangleAlert className="size-4 text-warning" />
            <span className="flex-1">{t("consultation.scribe.interrupted")}</span>
            <Button size="xs" variant="outline" onClick={() => complete.run({ draftId: draft!.id })}>
              {t("consultation.scribe.showDraft")}
            </Button>
          </div>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t("consultation.scribe.idleHint")}</p>
        )}

        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {t("consultation.scribe.guardrail")} {t("consultation.scribe.scripted")}
        </p>
        {reviewing && noteSigned ? (
          <p className="text-xs text-muted-foreground">{t("consultation.scribe.noteSignedHint")}</p>
        ) : null}

        {!readOnly ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {reviewing && draft?.status !== "discarded" ? (
              <Button size="sm" variant="ghost" onClick={onDiscard} disabled={discard.pending}>
                <Trash2 />
                {t("consultation.scribe.discard")}
              </Button>
            ) : null}
            {!play ? (
              <Button
                size="sm"
                variant={reviewing ? "neutral" : "default"}
                onClick={record}
                disabled={start.pending}
                data-testid="scribe-record"
              >
                <Mic />
                {reviewing || interrupted ? t("consultation.scribe.recordAgain") : t("consultation.scribe.record")}
              </Button>
            ) : null}
            {reviewing && !noteSigned ? (
              <Button
                size="sm"
                onClick={() => acceptLines()}
                disabled={accept.pending}
                data-testid="scribe-accept"
              >
                <Check />
                {t("consultation.scribe.acceptAll")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  )
}

function TranscriptItem({
  line,
  number,
  streaming = false,
  highlighted = false,
}: {
  line: TranscriptLine
  number: number
  streaming?: boolean
  highlighted?: boolean
}) {
  const { t, num } = useLocale()
  return (
    <li
      data-testid="scribe-transcript-line"
      data-line-id={line.id}
      className={cn(
        "flex gap-2 rounded-md px-2 py-1 text-[0.8125rem] leading-snug transition-colors",
        highlighted && "bg-primary-soft ring-1 ring-primary/40"
      )}
    >
      <span className="nums w-5 shrink-0 text-right text-[0.6875rem] text-muted-foreground">{num(number)}</span>
      <div className="min-w-0 flex-1">
        <span className={cn("mr-1.5 text-xs font-semibold", SPEAKER_TONE[line.speaker])}>
          {t(`consultation.scribe.speakers.${line.speaker}`)}
        </span>
        <span lang={line.lang}>
          {streaming ? <StreamingText text={line.text} charsPerTick={4} maxDelay={24} /> : line.text}
        </span>
      </div>
    </li>
  )
}
