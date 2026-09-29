"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  BadgeCheck,
  Baby,
  Bone,
  Brain,
  CalendarDays,
  ChevronRight,
  Droplets,
  Ear,
  Eye,
  Hand,
  HeartHandshake,
  HeartPulse,
  LayoutGrid,
  MapPin,
  Microscope,
  ScanLine,
  Scissors,
  Search,
  ShieldPlus,
  Smile,
  Stethoscope,
  Syringe,
  Utensils,
  Wind,
  type LucideIcon,
} from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { Input } from "@/components/ui/input"
import { hospital } from "@/config/brand.config"
import { addDaysISO, atDhaka } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { DoctorRow, SessionRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { bookableSessions } from "../lib/slots"
import { AppCard, AppLoading, DoctorAvatar, ScreenTitle } from "./bits"
import { branchName, staffName, useDirectory, useToday } from "./data"

/** Lucide icons for the specialty icon names in the seed (SpecialtyRow.icon). */
const SPECIALTY_ICONS: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  "heart-pulse": HeartPulse,
  baby: Baby,
  "heart-handshake": HeartHandshake,
  bone: Bone,
  ear: Ear,
  hand: Hand,
  brain: Brain,
  utensils: Utensils,
  droplets: Droplets,
  syringe: Syringe,
  smile: Smile,
  eye: Eye,
  "shield-plus": ShieldPlus,
  scissors: Scissors,
  wind: Wind,
  microscope: Microscope,
  "scan-line": ScanLine,
}

export function specialtyIcon(name: string | undefined): LucideIcon {
  return (name && SPECIALTY_ICONS[name]) || Stethoscope
}

/** How far ahead the app offers sessions. */
export const BOOKING_WINDOW_DAYS = 14

/** Sessions in the booking window (live). */
export function useWindowSessions(): SessionRow[] | undefined {
  const db = useDb()
  const today = useToday()
  return useLiveQuery(
    () =>
      db.sessions
        .where("date")
        .between(today, addDaysISO(today, BOOKING_WINDOW_DAYS), true, true)
        .toArray(),
    [db, today]
  )
}

/** The verified BMDC registration badge. */
export function BmdcBadge({ doctor }: { doctor: DoctorRow }) {
  const { t } = useLocale()
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[0.6875rem] font-medium",
        doctor.bmdcVerified
          ? "bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-success"
          : "bg-surface-raised text-muted-foreground"
      )}
    >
      {doctor.bmdcVerified ? <BadgeCheck className="size-3.5" /> : null}
      <span lang="en" className="font-mono">
        {t("patientApp.doctors.bmdc", { number: doctor.bmdcNo })}
      </span>
      {doctor.bmdcVerified ? (
        <span>· {t("patientApp.doctors.verified")}</span>
      ) : null}
    </span>
  )
}

/** Doctor directory: specialties, search and verified consultants. */
export function DoctorsScreen() {
  const { t, locale, num, dmy } = useLocale()
  const { doctors, staff, specialties } = useDirectory()
  const sessions = useWindowSessions()
  const today = useToday()
  const nowMs = useNow(60_000)
  const [query, setQuery] = React.useState("")
  const [specialtyId, setSpecialtyId] = React.useState<string>("all")

  const consultants = React.useMemo(
    () => [...doctors.values()].filter((d) => d.kind === "consultant"),
    [doctors]
  )
  const nextSession = React.useMemo(() => {
    const next = new Map<string, SessionRow>()
    for (const s of bookableSessions(sessions ?? [], today, nowMs)) {
      if (s.status !== "blocked" && !next.has(s.doctorId))
        next.set(s.doctorId, s)
    }
    return next
  }, [sessions, today, nowMs])

  const specialtyList = React.useMemo(() => {
    const used = new Set(consultants.map((d) => d.specialtyId))
    return [...specialties.values()]
      .filter((s) => used.has(s.id))
      .sort((a, b) => a.name[locale].localeCompare(b.name[locale], locale))
  }, [consultants, specialties, locale])

  const needle = query.trim().toLowerCase()
  const list = consultants
    .filter((d) => specialtyId === "all" || d.specialtyId === specialtyId)
    .filter((d) => {
      if (!needle) return true
      const person = staff.get(d.staffId)
      const specialty = specialties.get(d.specialtyId)
      return [
        person?.nameEn,
        person?.nameBn,
        specialty?.name.en,
        specialty?.name.bn,
        d.qualifications,
      ]
        .filter(Boolean)
        .some((text) => text!.toLowerCase().includes(needle))
    })
    .sort((a, b) =>
      (staff.get(a.staffId)?.nameEn ?? "").localeCompare(
        staff.get(b.staffId)?.nameEn ?? ""
      )
    )

  return (
    <>
      <ScreenTitle
        title={t("patientApp.doctors.title")}
        subtitle={t("patientApp.doctors.subtitle", {
          hospital: hospital.shortName[locale],
        })}
      />
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-testid="app-doctor-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("patientApp.doctors.search")}
          aria-label={t("patientApp.doctors.search")}
          className="h-12 rounded-full pl-11 text-[0.9375rem]"
        />
      </label>

      <div className="-mx-4 mt-3 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1">
        {[
          { id: "all", label: t("patientApp.doctors.all"), icon: LayoutGrid },
          ...specialtyList.map((s) => ({
            id: s.id,
            label: s.name[locale],
            icon: specialtyIcon(s.icon),
          })),
        ].map((chip) => {
          const active = chip.id === specialtyId
          const Icon = chip.icon
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={active}
              data-testid="app-specialty"
              data-specialty-id={chip.id}
              onClick={() => setSpecialtyId(chip.id)}
              className={cn(
                "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/60"
              )}
            >
              <Icon className="size-4" />
              {chip.label}
            </button>
          )
        })}
      </div>

      <p className="mt-3 mb-2 px-1 text-xs text-muted-foreground">
        {t("patientApp.doctors.count", { count: num(list.length) })}
      </p>

      {!sessions ? (
        <AppLoading />
      ) : list.length ? (
        <ul className="flex flex-col gap-3">
          {list.map((doctor) => {
            const person = staff.get(doctor.staffId)
            const specialty = specialties.get(doctor.specialtyId)
            const next = nextSession.get(doctor.id)
            return (
              <li key={doctor.id}>
                <Link
                  href={`/app/book?doctor=${doctor.id}`}
                  data-testid="app-book-doctor"
                  data-doctor-id={doctor.id}
                  className="surface-card flex items-start gap-3 rounded-[1.25rem] p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <DoctorAvatar staff={person} size={56} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-semibold">
                      {staffName(person, locale)}
                    </span>
                    <span
                      className="block truncate text-xs text-muted-foreground"
                      lang="en"
                    >
                      {doctor.qualifications}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-medium text-link">
                      {specialty?.name[locale]}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      <BmdcBadge doctor={doctor} />
                      <span className="inline-flex h-6 items-center rounded-full bg-surface-raised px-2 text-[0.6875rem] font-medium">
                        <MoneyText poisha={doctor.consultFeeP} />
                      </span>
                    </span>
                    <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {doctor.branchIds
                          .map((b) => branchName(b, locale))
                          .join(", ")}
                      </span>
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs">
                      <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
                      {next ? (
                        <span className="font-medium">
                          {t("patientApp.doctors.nextAvailable", {
                            date:
                              next.date === today
                                ? t("common.today")
                                : dmy(atDhaka(next.date, "12:00")),
                          })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("patientApp.doctors.noSessions")}
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="mt-4 size-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <AppCard className="py-8 text-center">
          <p className="text-[0.9375rem] font-semibold">
            {t("patientApp.doctors.empty")}
          </p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            {t("patientApp.doctors.emptyHint")}
          </p>
        </AppCard>
      )}
    </>
  )
}
