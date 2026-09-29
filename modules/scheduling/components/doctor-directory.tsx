"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { BadgeCheck, Search, X } from "lucide-react"

import { GeneratedAvatar } from "@/components/shared/avatars"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { branches, type BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { DoctorRow, SessionRow, SpecialtyRow, StaffRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { SpecialtyIcon } from "./specialty-icon"

export type DirectoryDoctor = {
  doctor: DoctorRow
  staff: StaffRow
  specialty?: SpecialtyRow
  /** This doctor's sessions today at the chosen branch (or anywhere for "all") */
  today: SessionRow[]
}

/**
 * Consulting doctors with their specialty and today's sessions. Only
 * consultants appear (not pathologists, radiologists or duty doctors), all
 * with their verified BMDC registration.
 */
export function useDoctorDirectory(branch: BranchCode | "all") {
  const db = useDb()
  const today = dhakaDate(now())
  return useLiveQuery(async () => {
    const [doctors, specialties, sessions] = await Promise.all([
      db.doctors.where("kind").equals("consultant").toArray(),
      db.specialties.toArray(),
      db.sessions.where("date").equals(today).toArray(),
    ])
    const staff = await db.staff.bulkGet(doctors.map((d) => d.staffId))
    const specialtyById = new Map(specialties.map((s) => [s.id, s]))
    const out: DirectoryDoctor[] = []
    doctors.forEach((doctor, i) => {
      const person = staff[i]
      if (!person) return
      if (branch !== "all" && !doctor.branchIds.includes(branch)) return
      out.push({
        doctor,
        staff: person,
        specialty: specialtyById.get(doctor.specialtyId),
        today: sessions
          .filter(
            (s) =>
              s.doctorId === doctor.id &&
              (branch === "all" || s.branchId === branch) &&
              s.status !== "blocked"
          )
          .sort((a, b) => a.start.localeCompare(b.start)),
      })
    })
    return { doctors: out, specialties }
  }, [db, branch, today])
}

/**
 * The doctor directory (plan §9 `/reception/book`, PRD §10.2): specialty
 * chips, a name search and verified doctor cards. Shared by the front desk
 * and the patient app. Order is neutral: doctors in today first (by start
 * time), then by name.
 */
export function DoctorDirectory({
  branch,
  onBranchChange,
  selectedId,
  onSelect,
  className,
}: {
  branch: BranchCode | "all"
  /** Shows the branch filter when given */
  onBranchChange?: (branch: BranchCode | "all") => void
  selectedId?: string | null
  onSelect: (doctorId: string) => void
  className?: string
}) {
  const { t, locale } = useLocale()
  const data = useDoctorDirectory(branch)
  const [specialty, setSpecialty] = React.useState<string>("all")
  const [query, setQuery] = React.useState("")

  const list = React.useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.doctors
      .filter((d) => specialty === "all" || d.doctor.specialtyId === specialty)
      .filter(
        (d) =>
          !q ||
          d.staff.nameEn.toLowerCase().includes(q) ||
          d.staff.nameBn.includes(query.trim()) ||
          d.specialty?.name.en.toLowerCase().includes(q) ||
          d.specialty?.name.bn.includes(query.trim())
      )
      .sort((a, b) => {
        const at = a.today[0]?.start ?? "99:99"
        const bt = b.today[0]?.start ?? "99:99"
        return at.localeCompare(bt) || a.staff.nameEn.localeCompare(b.staff.nameEn)
      })
  }, [data, specialty, query])

  const specialties = React.useMemo(() => {
    if (!data) return []
    const used = new Set(data.doctors.map((d) => d.doctor.specialtyId))
    return data.specialties
      .filter((s) => used.has(s.id))
      .sort((a, b) => a.name[locale].localeCompare(b.name[locale], locale === "bn" ? "bn" : "en"))
  }, [data, locale])

  return (
    <section
      data-testid="doctor-directory"
      className={cn("surface-card @container/dir flex min-w-0 flex-col gap-3 p-4", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid="doctor-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("scheduling.directory.search")}
            aria-label={t("scheduling.directory.search")}
            className="pr-9 pl-9"
          />
          {query ? (
            <button
              type="button"
              aria-label={t("common.clear")}
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {onBranchChange ? (
          <select
            data-testid="doctor-branch"
            aria-label={t("scheduling.directory.branch")}
            value={branch}
            onChange={(e) => onBranchChange(e.target.value as BranchCode | "all")}
            className="h-10 rounded-md border border-border bg-transparent px-3 text-sm [color-scheme:light] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20 dark:[color-scheme:dark] [&>option]:bg-popover"
          >
            <option value="all">{t("scheduling.directory.allBranches")}</option>
            {branches
              .filter((b) => b.services.includes("opd"))
              .map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name[locale]} ({b.code})
                </option>
              ))}
          </select>
        ) : null}
      </div>

      <div role="tablist" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {[{ id: "all", icon: undefined, name: { en: "", bn: "" } }, ...specialties].map((s) => {
          const active = specialty === s.id
          return (
            <button
              key={s.id}
              role="tab"
              type="button"
              aria-selected={active}
              data-testid="specialty-chip"
              data-specialty-id={s.id}
              onClick={() => setSpecialty(s.id)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-raised text-foreground/85 hover:text-foreground"
              )}
            >
              {s.id === "all" ? null : <SpecialtyIcon name={s.icon} className="size-3.5" />}
              {s.id === "all" ? t("scheduling.directory.allSpecialties") : s.name[locale]}
            </button>
          )
        })}
      </div>

      {!data ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : list.length ? (
        <ul className="grid gap-1.5 @[40rem]/dir:grid-cols-2">
          {list.map((entry) => (
            <li key={entry.doctor.id}>
              <DoctorCard
                entry={entry}
                selected={selectedId === entry.doctor.id}
                onSelect={() => onSelect(entry.doctor.id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="sm" icon={Search} title={t("scheduling.directory.empty")} />
      )}
    </section>
  )
}

function DoctorCard({
  entry,
  selected,
  onSelect,
}: {
  entry: DirectoryDoctor
  selected: boolean
  onSelect: () => void
}) {
  const { t, locale, digits } = useLocale()
  const { doctor, staff, specialty, today } = entry
  return (
    <button
      type="button"
      data-testid="book-doctor"
      data-doctor-id={doctor.id}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        selected
          ? "border-primary bg-primary-soft"
          : "border-transparent bg-surface-raised/50 hover:bg-surface-raised"
      )}
    >
      <GeneratedAvatar
        seed={staff.avatarSeed}
        sex="M"
        role="doctor"
        age={40 + doctor.experienceYears}
        size={40}
        title={locale === "bn" ? staff.nameBn : staff.nameEn}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold">
            {locale === "bn" ? staff.nameBn : staff.nameEn}
          </span>
          {doctor.bmdcVerified ? (
            <BadgeCheck
              className="size-4 shrink-0 text-success"
              aria-label={t("scheduling.profile.verified")}
            />
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <SpecialtyIcon name={specialty?.icon} className="size-3.5 shrink-0 text-link" />
          <span className="truncate">{specialty?.name[locale]}</span>
          <span aria-hidden>·</span>
          <span className="truncate" lang="en">
            {doctor.qualifications}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <MoneyText poisha={doctor.consultFeeP} className="font-medium" />
          <span className="font-mono text-[0.6875rem] text-muted-foreground" lang="en">
            {t("scheduling.profile.bmdcNo", { no: doctor.bmdcNo })}
          </span>
          {today.length ? (
            <span className="nums rounded-full bg-primary-soft px-2 py-px text-[0.6875rem] font-medium text-link">
              {t("scheduling.directory.today", { time: digits(today[0].start) })}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
