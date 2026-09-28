"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ClipboardList,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  Pill,
  ScanLine,
  Stethoscope,
  TriangleAlert,
} from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, type Tone } from "@/components/shared/status"
import { Timeline, type TimelineItem } from "@/components/shared/timeline"
import { useDb } from "@/core/db/DbProvider"
import type { LabTestRow, PatientRow, ResultFlag, ResultRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

export const FLAG_TONE: Record<ResultFlag, Tone> = {
  N: "muted",
  L: "warning",
  H: "warning",
  LL: "destructive",
  HH: "destructive",
  A: "warning",
}

/** Analyte display name for a result, from the test's analytes. */
export function analyteName(test: LabTestRow | undefined, code: string): string {
  const analyte = test?.analytes.find((a) => a.code === code)
  if (analyte && test && test.analytes.length > 1) return analyte.name
  return test?.name ?? analyte?.name ?? code
}

type SummaryData = {
  results: ResultRow[]
  visits: {
    id: string
    at: number
    doctor: string
    complaint?: string
    diagnoses: { icd10: string; label: string }[]
  }[]
  timeline: { id: string; kind: "visit" | "rx" | "report" | "imaging"; at: number; params: Record<string, string> }[]
  dxFromNotes: { icd10: string; label: string }[]
}

/**
 * The patient summary on the encounter (plan §9, objective §2): allergies
 * first, current medicines, active problems, recent results with flags, the
 * last visits and a history timeline. Everything is read live.
 */
export function PatientSummary({
  patient,
  encounterId,
  tests,
  part,
}: {
  patient: PatientRow
  encounterId: string
  tests: Map<string, LabTestRow> | undefined
  /** "profile": allergies, medicines, problems; "history": results, visits, timeline */
  part: "profile" | "history"
}) {
  const { t, tk, locale, dmy } = useLocale()
  const db = useDb()

  const data = useLiveQuery(async (): Promise<SummaryData> => {
    const [results, encounters, prescriptions, reports, imaging] = await Promise.all([
      db.results.where("patientId").equals(patient.id).toArray(),
      db.encounters.where("patientId").equals(patient.id).toArray(),
      db.prescriptions.where("patientId").equals(patient.id).toArray(),
      db.labReports.where("patientId").equals(patient.id).toArray(),
      db.imagingReports.where("patientId").equals(patient.id).toArray(),
    ])
    const previous = encounters
      .filter((e) => e.id !== encounterId)
      .sort((a, b) => b.startedAt - a.startedAt)
    const doctorIds = [...new Set(previous.map((e) => e.doctorId))]
    const doctors = await db.doctors.bulkGet(doctorIds)
    const staff = await db.staff.bulkGet(doctors.map((d) => d?.staffId ?? ""))
    const doctorName = new Map<string, string>()
    doctors.forEach((d, i) => {
      const s = staff[i]
      if (d && s) doctorName.set(d.id, locale === "bn" ? s.nameBn : s.nameEn)
    })
    const notes = previous.length
      ? await db.notes.where("encounterId").anyOf(previous.map((e) => e.id)).toArray()
      : []
    const latestNote = new Map<string, (typeof notes)[number]>()
    for (const note of notes) {
      if (note.status === "draft") continue
      const current = latestNote.get(note.encounterId)
      if (!current || current.noteVersion < note.noteVersion) latestNote.set(note.encounterId, note)
    }
    const dxFromNotes = new Map<string, string>()
    for (const note of latestNote.values()) {
      for (const d of note.diagnoses) dxFromNotes.set(d.icd10, d.label)
    }
    const timeline: SummaryData["timeline"] = [
      ...previous.map((e) => ({
        id: e.id,
        kind: "visit" as const,
        at: e.startedAt,
        params: { doctor: doctorName.get(e.doctorId) ?? "" },
      })),
      ...prescriptions
        .filter((rx) => rx.signedAt && rx.status !== "draft" && rx.encounterId !== encounterId)
        .map((rx) => ({ id: rx.id, kind: "rx" as const, at: rx.signedAt!, params: { rxNo: rx.rxNo } })),
      ...reports
        .filter((r) => r.releasedAt)
        .map((r) => ({
          id: r.id,
          kind: "report" as const,
          at: r.releasedAt!,
          params: { reportNo: r.reportNo },
        })),
      ...imaging
        .filter((r) => r.releasedAt)
        .map((r) => ({ id: r.id, kind: "imaging" as const, at: r.releasedAt!, params: {} })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 8)
    return {
      results: results
        .filter((r) => r.status === "validated")
        .sort((a, b) => (b.validatedAt ?? b.updatedAt) - (a.validatedAt ?? a.updatedAt))
        .slice(0, 10),
      visits: previous.slice(0, 3).map((e) => {
        const note = latestNote.get(e.id)
        return {
          id: e.id,
          at: e.startedAt,
          doctor: doctorName.get(e.doctorId) ?? "",
          complaint: note?.sections.chiefComplaint,
          diagnoses: note?.diagnoses ?? [],
        }
      }),
      timeline,
      dxFromNotes: [...dxFromNotes].map(([icd10, label]) => ({ icd10, label })),
    }
  }, [db, patient.id, encounterId, locale])

  const problems = React.useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of patient.problems) if (p.status === "active") seen.set(p.icd10, p.label)
    for (const d of data?.dxFromNotes ?? []) if (!seen.has(d.icd10)) seen.set(d.icd10, d.label)
    return [...seen].map(([icd10, label]) => ({ icd10, label }))
  }, [patient.problems, data?.dxFromNotes])

  const timelineItems: TimelineItem[] = (data?.timeline ?? []).map((item) => ({
    id: item.id,
    at: item.at,
    icon:
      item.kind === "visit"
        ? Stethoscope
        : item.kind === "rx"
          ? Pill
          : item.kind === "report"
            ? FlaskConical
            : ScanLine,
    tone: item.kind === "visit" ? "primary" : item.kind === "rx" ? "success" : "info",
    title: tk(`consultation.summary.timelineItems.${item.kind}`, item.params),
  }))

  if (part === "profile") {
    return (
      <SectionCard size="sm" icon={ClipboardList} title={t("consultation.summary.title")}>
        <div className="flex flex-col gap-4">
          <div data-testid="patient-allergies" data-count={patient.allergies.length}>
            <h3 className="micro mb-2">{t("consultation.summary.allergies")}</h3>
            {patient.allergies.length ? (
              <ul className="flex flex-col gap-1.5">
                {patient.allergies.map((a) => (
                  <li
                    key={a.substance}
                    className="flex items-start gap-2 rounded-md bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] px-3 py-2 text-destructive"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[0.8125rem] font-semibold">{a.substance}</div>
                      <div className="text-xs opacity-90">
                        {t("consultation.summary.reaction", {
                          reaction: a.reaction,
                          severity: tk(`consultation.summary.severity.${a.severity}`),
                        })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{t("consultation.summary.noAllergies")}</p>
            )}
          </div>

          <div>
            <h3 className="micro mb-2">{t("consultation.summary.currentMeds")}</h3>
            {patient.currentMeds.length ? (
              <ul className="flex flex-col gap-1.5">
                {patient.currentMeds.map((m) => (
                  <li key={m.name} className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
                    <span className="min-w-0">
                      <span className="font-medium" lang="en">
                        {m.name}
                      </span>{" "}
                      <span className="text-muted-foreground">{m.dose}</span>
                    </span>
                    {m.since ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t("consultation.summary.since", { date: dmy(m.since) })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{t("consultation.summary.noMeds")}</p>
            )}
          </div>

          <div>
            <h3 className="micro mb-2">{t("consultation.summary.problems")}</h3>
            {problems.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {problems.map((p) => (
                  <li key={p.icd10}>
                    <StatusPill tone="info" className="h-auto min-h-6 py-0.5 whitespace-normal">
                      <span className="font-mono" lang="en">
                        {p.icd10}
                      </span>
                      <span lang="en">{p.label}</span>
                    </StatusPill>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{t("consultation.summary.noProblems")}</p>
            )}
          </div>
        </div>
      </SectionCard>
    )
  }

  return (
    <div className="@container/sum flex flex-col gap-4">
      <SectionCard size="sm" icon={FlaskConical} title={t("consultation.summary.results")}>
        {data?.results.length ? (
          <ul className="flex flex-col" data-testid="summary-results">
            {data.results.map((r) => {
              const test = tests?.get(r.testId)
              return (
                <li
                  key={r.id}
                  className={cn(
                    "flex items-center gap-2 border-b border-hairline py-1.5 text-[0.8125rem] last:border-0",
                    r.critical && "text-destructive"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate" lang="en">
                    {analyteName(test, r.analyteCode)}
                  </span>
                  <span className="nums font-medium whitespace-nowrap" lang="en">
                    {r.value ?? r.text} {r.unit}
                  </span>
                  {r.flag !== "N" ? (
                    <StatusPill tone={FLAG_TONE[r.flag]} className="h-5 px-2 text-[0.6875rem]">
                      {r.critical ? t("consultation.summary.critical") : tk(`consultation.summary.flags.${r.flag}`)}
                    </StatusPill>
                  ) : null}
                  <DateText
                    value={r.validatedAt ?? r.updatedAt}
                    className="hidden shrink-0 text-xs text-muted-foreground @min-[20rem]/sum:inline"
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t("consultation.summary.noResults")}</p>
        )}
      </SectionCard>

      <SectionCard size="sm" icon={History} title={t("consultation.summary.visits")}>
        {data?.visits.length ? (
          <ul className="flex flex-col gap-3">
            {data.visits.map((v) => (
              <li key={v.id} className="flex gap-3">
                <span className="icon-well flex size-8 shrink-0 items-center justify-center text-link">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="text-[0.8125rem] font-medium">
                      {t("consultation.summary.visitWith", { doctor: v.doctor })}
                    </span>
                    <DateText value={v.at} className="text-xs text-muted-foreground" />
                  </div>
                  {v.complaint ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{v.complaint}</p>
                  ) : null}
                  {v.diagnoses.length ? (
                    <p className="mt-0.5 text-xs text-foreground/80" lang="en">
                      {v.diagnoses.map((d) => `${d.icd10} ${d.label}`).join("; ")}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t("consultation.summary.noVisits")}</p>
        )}
      </SectionCard>

      <SectionCard size="sm" icon={HeartPulse} title={t("consultation.summary.timeline")}>
        {timelineItems.length ? (
          <Timeline items={timelineItems} timeVariant="dmy" />
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t("consultation.summary.timelineEmpty")}</p>
        )}
      </SectionCard>
    </div>
  )
}
