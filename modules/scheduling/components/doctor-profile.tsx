"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { BadgeCheck, Languages, MapPin } from "lucide-react"

import { GeneratedAvatar } from "@/components/shared/avatars"
import { MoneyText } from "@/components/shared/money-text"
import { Skeleton } from "@/components/ui/skeleton"
import { branches } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import { LOCALE_META } from "@/lib/i18n/config"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { SpecialtyIcon } from "./specialty-icon"

/**
 * A verified doctor profile (PRD §10.2): BMDC registration with a verified
 * badge, qualifications, experience, languages, branches, fees and a short
 * bio. Shared by the front desk and the patient app.
 */
export function DoctorProfile({
  doctorId,
  compact = false,
  className,
}: {
  doctorId: string
  compact?: boolean
  className?: string
}) {
  const db = useDb()
  const { t, locale, num } = useLocale()
  const data = useLiveQuery(async () => {
    const doctor = await db.doctors.get(doctorId)
    if (!doctor) return null
    const [staff, specialty] = await Promise.all([
      db.staff.get(doctor.staffId),
      db.specialties.get(doctor.specialtyId),
    ])
    return staff ? { doctor, staff, specialty } : null
  }, [db, doctorId])

  if (data === undefined) return <Skeleton className={cn("h-28 w-full rounded-lg", className)} />
  if (data === null) return null
  const { doctor, staff, specialty } = data
  const name = locale === "bn" ? staff.nameBn : staff.nameEn

  return (
    <section
      data-testid="doctor-profile"
      data-doctor-id={doctor.id}
      className={cn("flex flex-col gap-3 rounded-lg bg-surface-raised p-4", className)}
    >
      <div className="flex items-start gap-3">
        <GeneratedAvatar
          seed={staff.avatarSeed}
          sex="M"
          role="doctor"
          age={40 + doctor.experienceYears}
          size={compact ? 44 : 56}
          title={name}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-base leading-tight font-semibold">{name}</h2>
          <p className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
            <SpecialtyIcon name={specialty?.icon} className="size-4 text-link" />
            {specialty?.name[locale]}
            <span aria-hidden>·</span>
            {t("scheduling.profile.experience", { years: num(doctor.experienceYears) })}
          </p>
          <p className="text-[0.8125rem]" lang="en">
            {doctor.qualifications}
          </p>
        </div>
        {doctor.bmdcVerified ? (
          <span
            data-testid="bmdc-verified"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--success)_15%,transparent)] px-2.5 py-1 text-xs font-medium text-success"
          >
            <BadgeCheck className="size-3.5" />
            <span>
              {t("scheduling.profile.verified")}{" "}
              <span className="font-mono" lang="en">
                {doctor.bmdcNo}
              </span>
            </span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem]">
        <span>
          <span className="text-muted-foreground">{t("scheduling.profile.fee")} </span>
          <MoneyText poisha={doctor.consultFeeP} className="font-semibold" />
        </span>
        <span>
          <span className="text-muted-foreground">{t("scheduling.profile.followUpFee")} </span>
          <MoneyText poisha={doctor.followUpFeeP} className="font-semibold" />
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Languages className="size-3.5" />
          {doctor.languages.map((l) => LOCALE_META[l].nativeLabel).join(", ")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <MapPin className="size-3.5 text-muted-foreground" />
        {doctor.branchIds.map((code) => {
          const branch = branches.find((b) => b.code === code)
          return (
            <span key={code} className="rounded-full bg-card px-2.5 py-0.5 text-xs">
              {branch ? `${branch.name[locale]} (${code})` : code}
            </span>
          )
        })}
      </div>
      {!compact ? (
        <p className="text-[0.8125rem] leading-relaxed text-foreground/85">{doctor.bio[locale]}</p>
      ) : null}
    </section>
  )
}
