"use client"

import * as React from "react"
import { ArrowLeft, TriangleAlert, UserCheck, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { PatientRow } from "@/core/db/schema"
import type { DuplicateCandidate } from "@/core/search/fuzzy"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { PersonLine } from "./desk-ui"

/** The new registration being checked, as typed. */
export type DuplicateEntry = {
  nameEn: string
  nameBn: string
  dob: string
  phone?: string
}

function masked(value: string | undefined): string | undefined {
  return value ? `•••• ${value.slice(-4)}` : undefined
}

/**
 * The ranked duplicate warning shown BEFORE a registration is saved (PRD §9
 * Identity, HAZ-02): likely matches with their score and why they match. The
 * front desk answers "Same person" (open that record, decision recorded) or
 * "Different person" with a reason (registered, decision recorded). Nothing
 * is merged here.
 */
export function DuplicateWarning({
  entry,
  candidates,
  patients,
  pending,
  onSame,
  onDifferent,
  onBack,
}: {
  entry: DuplicateEntry
  candidates: DuplicateCandidate[]
  patients: Map<string, PatientRow>
  pending: boolean
  onSame: (candidate: DuplicateCandidate) => void
  onDifferent: (reason: string) => void
  onBack: () => void
}) {
  const { t, num, dmy, digits } = useLocale()
  const [reason, setReason] = React.useState("")
  const reasonId = React.useId()
  const ready = reason.trim().length >= 3

  return (
    <section data-testid="duplicate-warning" className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-md border border-[color-mix(in_oklch,var(--warning)_35%,transparent)] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-3.5 py-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-[0.9375rem] font-semibold">
            {t("identity.duplicate.title", { count: num(candidates.length) })}
          </h3>
          <p className="text-[0.8125rem] leading-relaxed text-foreground/85">
            {t("identity.duplicate.body")}
          </p>
        </div>
      </div>

      <div className="rounded-md bg-surface-raised px-3.5 py-2.5 text-[0.8125rem]">
        <p className="text-xs text-muted-foreground">{t("identity.duplicate.entering")}</p>
        <p className="font-medium">
          {entry.nameEn} <span className="text-muted-foreground">· {entry.nameBn}</span>
        </p>
        <p className="nums text-xs text-muted-foreground">
          {t("identity.patient.dob")} {dmy(entry.dob)}
          {entry.phone ? ` · ${digits(entry.phone)}` : ""}
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        {candidates.map((candidate, index) => {
          const patient = patients.get(candidate.patientId)
          if (!patient) return null
          const percent = Math.round(candidate.score * 100)
          return (
            <li
              key={candidate.patientId}
              data-testid="duplicate-candidate"
              data-patient-id={candidate.patientId}
              data-score={candidate.score}
              className="@container flex flex-col gap-2.5 rounded-md border border-border/70 p-3"
            >
              <div className="flex items-center gap-3">
                <span className="nums flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs font-semibold">
                  {num(index + 1)}
                </span>
                <PersonLine patient={patient} size={36} />
                <span
                  className={cn(
                    "nums shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                    percent >= 80
                      ? "bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] text-destructive"
                      : "bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] text-warning"
                  )}
                >
                  {t("identity.duplicate.match", { percent: num(percent) })}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-10 text-xs text-muted-foreground">
                <span className="nums">
                  {t("identity.patient.dob")} {dmy(patient.dob)}
                </span>
                {patient.phone ? <span className="nums">{digits(patient.phone)}</span> : null}
                {patient.nid ? (
                  <span className="font-mono" lang="en">
                    {t("identity.patient.nid")} {masked(patient.nid)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pl-10">
                <div className="flex flex-wrap gap-1">
                  {candidate.reasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded-full bg-surface-raised px-2 py-0.5 text-[0.6875rem] text-foreground/85"
                    >
                      {t(`identity.duplicate.reasons.${reason}`)}
                    </span>
                  ))}
                </div>
                <Button
                  data-testid="duplicate-same"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => onSame(candidate)}
                >
                  <UserCheck />
                  {t("identity.duplicate.same")}
                </Button>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="flex flex-col gap-2 border-t border-hairline pt-4">
        <label htmlFor={reasonId} className="text-[0.8125rem] font-medium">
          {t("identity.duplicate.reasonLabel")}
        </label>
        <Textarea
          id={reasonId}
          data-testid="duplicate-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("identity.duplicate.reasonPlaceholder")}
          className="min-h-16"
        />
        <p className="text-xs text-muted-foreground">{t("identity.duplicate.reasonHint")}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={pending}>
            <ArrowLeft />
            {t("identity.duplicate.back")}
          </Button>
          <Button
            data-testid="duplicate-different"
            disabled={!ready || pending}
            onClick={() => onDifferent(reason.trim())}
          >
            <UserPlus />
            {t("identity.duplicate.different")}
          </Button>
        </div>
      </div>
    </section>
  )
}
