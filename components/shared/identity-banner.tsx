"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { TriangleAlert } from "lucide-react"

import { PatientAvatar } from "@/components/shared/avatars"
import { ageOf, nameIn, otherName } from "@/components/shared/person"
import { StatusPill } from "@/components/shared/status"
import { UhidText } from "@/components/shared/uhid-text"
import { Skeleton } from "@/components/ui/skeleton"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { PatientRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** The patient fields the banner shows. */
export type IdentityPatient = Pick<
  PatientRow,
  "id" | "uhid" | "nameEn" | "nameBn" | "dob" | "sex" | "allergies" | "photoSeed"
> &
  Partial<
    Pick<
      PatientRow,
      "bloodGroup" | "identityStatus" | "dobEstimated" | "phone" | "relationToHead"
    >
  >

export type IdentityBannerProps = {
  /** The patient row; or pass `patientId` to load it live */
  patient?: IdentityPatient
  patientId?: string
  /** Relation or context line, e.g. "Guardian: Tanvir Karim" */
  relation?: React.ReactNode
  /** Controls on the right (e.g. a "Patient 360" link) */
  actions?: React.ReactNode
  compact?: boolean
  className?: string
}

/**
 * The patient identity strip for every patient-context screen (plan §9,
 * HAZ-01): generated photo, name in the window's language, age and sex, UHID
 * in mono (Latin digits), and allergies as destructive chips.
 */
export function IdentityBanner({
  patient,
  patientId,
  relation,
  actions,
  compact = false,
  className,
}: IdentityBannerProps) {
  const db = useDb()
  const loaded = useLiveQuery(
    () => (patient || !patientId ? undefined : db.patients.get(patientId)),
    [db, patientId, patient]
  )
  const row = patient ?? loaded

  if (!row) {
    return (
      <div
        className={cn(
          "flex items-center gap-4 rounded-lg bg-surface-raised px-4 py-3",
          className
        )}
      >
        <Skeleton className="size-12 rounded-full bg-card" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-48 bg-card" />
          <Skeleton className="h-3 w-72 bg-card" />
        </div>
      </div>
    )
  }

  return (
    <IdentityBannerView
      patient={row}
      relation={relation}
      actions={actions}
      compact={compact}
      className={className}
    />
  )
}

function IdentityBannerView({
  patient,
  relation,
  actions,
  compact,
  className,
}: {
  patient: IdentityPatient
  relation?: React.ReactNode
  actions?: React.ReactNode
  compact: boolean
  className?: string
}) {
  const { t, num, locale, digits } = useLocale()
  const nowMs = useNow(60_000)
  const age = ageOf(patient.dob, nowMs)
  const ageText = `${patient.dobEstimated ? "~" : ""}${t(
    age.unit === "years" ? "common.years" : "common.months",
    { count: num(age.value) }
  )}`
  const secondary = otherName(patient, locale)
  const provisional = patient.uhid.startsWith("P-")

  return (
    <section
      data-slot="identity-banner"
      aria-label={nameIn(patient, locale)}
      className={cn(
        "@container/id flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg bg-surface-raised",
        compact ? "px-3 py-2.5" : "px-4 py-3",
        className
      )}
    >
      <PatientAvatar patient={patient} size={compact ? 36 : 48} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2
            className={cn(
              "truncate leading-tight font-semibold",
              compact ? "text-[0.9375rem]" : "text-base"
            )}
          >
            {nameIn(patient, locale)}
          </h2>
          {secondary && !compact ? (
            <span className="truncate text-xs text-muted-foreground">
              {secondary}
            </span>
          ) : null}
          {patient.identityStatus === "under-review" ? (
            <StatusPill tone="warning" className="h-5 px-2 text-[0.6875rem]">
              {t("common.underReview")}
            </StatusPill>
          ) : null}
          {provisional ? (
            <StatusPill tone="muted" className="h-5 px-2 text-[0.6875rem]">
              {t("common.provisional")}
            </StatusPill>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem] text-muted-foreground">
          <span className="nums whitespace-nowrap text-foreground/90">
            {ageText} · {t(`common.sexShort.${patient.sex}`)}
          </span>
          <span aria-hidden className="text-border">
            |
          </span>
          <UhidText
            uhid={patient.uhid}
            withLabel
            className="text-foreground/90"
          />
          {patient.bloodGroup ? (
            <>
              <span aria-hidden className="text-border">
                |
              </span>
              <span className="whitespace-nowrap">
                {t("common.bloodGroup")}{" "}
                <span className="font-medium text-foreground/90">
                  {patient.bloodGroup}
                </span>
              </span>
            </>
          ) : null}
          {patient.phone && !compact ? (
            <>
              <span aria-hidden className="text-border">
                |
              </span>
              <span className="nums whitespace-nowrap">{digits(patient.phone)}</span>
            </>
          ) : null}
          {relation ? (
            <>
              <span aria-hidden className="text-border">
                |
              </span>
              <span className="truncate">{relation}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {patient.allergies.length ? (
          patient.allergies.map((allergy) => (
            <span
              key={allergy.substance}
              title={allergy.reaction}
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--destructive)_16%,transparent)] px-2.5 text-xs font-semibold text-destructive"
            >
              <TriangleAlert className="size-3.5" />
              {allergy.substance}
            </span>
          ))
        ) : (
          <span className="inline-flex h-7 items-center rounded-full bg-card px-2.5 text-xs text-muted-foreground">
            {t("common.noKnownAllergies")}
          </span>
        )}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </section>
  )
}
