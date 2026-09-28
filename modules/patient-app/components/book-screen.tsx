"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ChevronLeft,
  CircleCheck,
  Languages,
  MapPin,
  QrCode,
  Stethoscope,
  UserRound,
} from "lucide-react"

import { PatientAvatar } from "@/components/shared/avatars"
import { MoneyText } from "@/components/shared/money-text"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { addDaysISO, atDhaka } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import { newId } from "@/core/db/ids"
import type { HHMM, Id, SessionRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { bookAppointment } from "@/modules/scheduling/commands"

import {
  bookableSessions,
  hasActiveBooking,
  sessionAvailability,
} from "../lib/slots"
import { AppCard, AppLoading, DoctorAvatar, Segmented } from "./bits"
import {
  branchName,
  patientName,
  useDoctorInfo,
  useFamily,
  useRoomName,
  useToday,
} from "./data"
import { BmdcBadge, BOOKING_WINDOW_DAYS } from "./doctors-screen"
import { useOpenFamilySheet } from "./family-switcher"
import { useAppCommand, useProblemText } from "./use-app-command"

type Choice = { sessionId: Id; slot: HHMM }
type Booked = {
  appointmentId: Id
  sessionId: Id
  slot: HHMM
  date: string
  feeP: number
  memberId: Id
}
type VisitType = "first" | "follow-up"

/** `/app/book?doctor=<id>` */
export function BookRoute() {
  return <BookScreen doctorId={useSearchParams().get("doctor")} />
}

/** Book with one doctor: the one scheduler (`scheduling.book`, source "app"). */
export function BookScreen({ doctorId }: { doctorId: string | null }) {
  const { t, locale, money } = useLocale()
  const db = useDb()
  const doctorInfo = useDoctorInfo()
  const info = doctorId ? doctorInfo(doctorId) : undefined
  const today = useToday()
  const nowMs = useNow(30_000)
  const sessions = useLiveQuery(
    async () =>
      doctorId ? db.sessions.where("doctorId").equals(doctorId).toArray() : [],
    [db, doctorId]
  )
  const [booked, setBooked] = React.useState<Booked | null>(null)

  if (!info) {
    return (
      <>
        <BackLink />
        <AppCard className="mt-3 py-8 text-center text-[0.9375rem] font-semibold">
          {t("patientApp.book.notFound")}
        </AppCard>
      </>
    )
  }
  const { doctor, staff } = info
  const lastDay = addDaysISO(today, BOOKING_WINDOW_DAYS)
  const upcoming = bookableSessions(sessions ?? [], today, nowMs).filter(
    (s) => s.date <= lastDay
  )

  return (
    <>
      <BackLink />
      <AppCard className="mt-2">
        <div className="flex items-start gap-3">
          <DoctorAvatar staff={staff} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg leading-tight font-semibold">{info.name}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground" lang="en">
              {doctor.qualifications}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] font-medium text-link">
              <Stethoscope className="size-4" />
              {info.specialtyName}
            </p>
            <div className="mt-2">
              <BmdcBadge doctor={doctor} />
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-surface-raised p-2.5">
            <p className="text-muted-foreground">{t("patientApp.book.fees")}</p>
            <p className="mt-0.5 font-semibold">
              {t("patientApp.book.firstFee", {
                fee: money(doctor.consultFeeP),
              })}
            </p>
            <p className="font-semibold">
              {t("patientApp.book.followUpFee", {
                fee: money(doctor.followUpFeeP),
              })}
            </p>
          </div>
          <div className="flex flex-col gap-1 rounded-xl bg-surface-raised p-2.5">
            <p className="font-medium">
              {t("patientApp.book.experience", {
                years: doctor.experienceYears,
              })}
            </p>
            <p className="flex items-start gap-1 text-muted-foreground">
              <Languages className="mt-px size-3.5 shrink-0" />
              {t("patientApp.book.speaks", {
                languages: doctor.languages
                  .map((l) => t(`patientApp.book.languages.${l}`))
                  .join(", "),
              })}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">
          {doctor.bio[locale]}
        </p>
      </AppCard>

      {booked ? (
        <BookedCard
          booked={booked}
          doctorName={info.name}
          onAnother={() => setBooked(null)}
        />
      ) : !sessions ? (
        <AppLoading />
      ) : (
        <Picker
          sessions={upcoming}
          feeFirst={doctor.consultFeeP}
          onBooked={setBooked}
        />
      )}
    </>
  )
}

function BackLink() {
  const { t } = useLocale()
  return (
    <Link
      href="/app/doctors"
      className="-ml-1 inline-flex min-h-10 items-center gap-1 self-start rounded-full pr-3 text-[0.8125rem] font-medium text-link"
    >
      <ChevronLeft className="size-5" />
      {t("patientApp.book.back")}
    </Link>
  )
}

function Picker({
  sessions,
  feeFirst,
  onBooked,
}: {
  sessions: SessionRow[]
  feeFirst: number
  onBooked: (booked: Booked) => void
}) {
  const { t, locale, date: fmt, time, dmy } = useLocale()
  const db = useDb()
  const today = useToday()
  const nowMs = useNow(30_000)
  const roomName = useRoomName()
  const { member } = useFamily()
  const openFamily = useOpenFamilySheet()
  const book = useAppCommand(bookAppointment)
  const problemText = useProblemText()
  const confirmRef = React.useRef<HTMLDivElement>(null)
  const idempotency = React.useRef(newId("appbook"))

  const dates = [...new Set(sessions.map((s) => s.date))]
  const [picked, setPicked] = React.useState<string | null>(null)
  const [choice, setChoice] = React.useState<Choice | null>(null)
  const [visitType, setVisitType] = React.useState<VisitType>("first")

  const ids = sessions.map((s) => s.id)
  const key = ids.join(",")
  const appointments = useLiveQuery(
    async () =>
      key
        ? db.appointments.where("sessionId").anyOf(key.split(",")).toArray()
        : [],
    [db, key]
  )
  const firstOpen = sessions.find((s) =>
    appointments
      ? sessionAvailability(s, appointments, nowMs).free.length > 0
      : s.status !== "blocked"
  )
  const selectedDate = picked ?? firstOpen?.date ?? dates[0]
  const daySessions = sessions.filter((s) => s.date === selectedDate)
  const chosenSession = choice
    ? sessions.find((s) => s.id === choice.sessionId)
    : undefined
  const fee = chosenSession
    ? visitType === "follow-up"
      ? chosenSession.followUpFeeP
      : chosenSession.feeP
    : feeFirst

  if (!dates.length) {
    return (
      <AppCard className="mt-3 py-8 text-center text-[0.8125rem] text-muted-foreground">
        {t("patientApp.book.noDates")}
      </AppCard>
    )
  }

  const confirm = async () => {
    if (!choice || !chosenSession) return
    const result = await book.run({
      sessionId: choice.sessionId,
      patientId: member.patient.id,
      source: "app",
      visitType,
      slotStart: choice.slot,
      smsLang: locale,
      idempotencyKey: idempotency.current,
    })
    if (!result) return
    idempotency.current = newId("appbook")
    setChoice(null)
    onBooked({
      appointmentId: result.appointmentId,
      sessionId: choice.sessionId,
      slot: result.slotStart,
      date: chosenSession.date,
      feeP: result.feeP,
      memberId: member.patient.id,
    })
  }

  return (
    <>
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-raised p-2.5 pl-3">
        <UserRound className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">
            {t("patientApp.book.bookingFor")}
          </span>
          <span className="flex items-center gap-2">
            <PatientAvatar patient={member.patient} size={24} />
            <span
              data-testid="app-book-member"
              data-patient-id={member.patient.id}
              className="truncate text-[0.875rem] font-semibold"
            >
              {patientName(member.patient, locale)}
            </span>
          </span>
        </span>
        <Button
          variant="neutral"
          size="sm"
          className="h-10 rounded-full px-4"
          onClick={openFamily}
        >
          {t("patientApp.book.change")}
        </Button>
      </div>

      <h2 className="mt-5 mb-2 px-1 text-[0.9375rem] font-semibold">
        {t("patientApp.book.chooseDate")}
      </h2>
      <div className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1">
        {dates.map((d) => {
          const active = d === selectedDate
          const ms = atDhaka(d, "12:00")
          const blocked = sessions
            .filter((s) => s.date === d)
            .every((s) => s.status === "blocked")
          return (
            <button
              key={d}
              type="button"
              data-testid="app-book-date"
              data-date={d}
              aria-pressed={active}
              onClick={() => {
                setPicked(d)
                setChoice(null)
                book.clearProblem()
              }}
              className={cn(
                "flex min-h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border text-center transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/60",
                blocked && !active && "opacity-50"
              )}
            >
              <span className="text-[0.6875rem] font-medium">
                {d === today
                  ? t("common.today")
                  : fmt(ms, { weekday: "short" })}
              </span>
              <span className="text-lg leading-tight font-semibold">
                {fmt(ms, { day: "numeric" })}
              </span>
              <span className="text-[0.625rem] opacity-80">
                {fmt(ms, { month: "short" })}
              </span>
            </button>
          )
        })}
      </div>

      <h2 className="mt-5 mb-2 px-1 text-[0.9375rem] font-semibold">
        {t("patientApp.book.chooseTime")}
      </h2>
      <div className="flex flex-col gap-3">
        {!appointments ? (
          <AppLoading />
        ) : (
          daySessions.map((session) => {
            const availability = sessionAvailability(
              session,
              appointments,
              nowMs
            )
            const already = hasActiveBooking(
              appointments,
              session.id,
              member.patient.id
            )
            const reason = availability.closedReason
            const notice = already
              ? t("patientApp.book.alreadyBooked", {
                  name: patientName(member.patient, locale),
                })
              : reason === "blocked"
                ? t("patientApp.book.unavailable")
                : reason === "closed"
                  ? t("patientApp.book.closed")
                  : reason === "ended"
                    ? t("patientApp.book.ended")
                    : reason === "full"
                      ? t("patientApp.book.full")
                      : null
            return (
              <AppCard
                key={session.id}
                data-testid="app-book-session"
                data-session-id={session.id}
                className="p-3.5"
              >
                <p className="flex items-center gap-2 text-[0.8125rem] font-semibold">
                  <MapPin className="size-4 shrink-0 text-link" />
                  <span className="truncate">
                    {branchName(session.branchId, locale)},{" "}
                    {roomName(session.roomId)}
                  </span>
                </p>
                <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
                  {t("patientApp.book.sessionTime", {
                    start: time(atDhaka(session.date, session.start)),
                    end: time(atDhaka(session.date, session.end)),
                  })}
                  {session.status === "delayed" && session.delayMin > 0
                    ? ` · ${t("patientApp.appointments.delayed", { minutes: session.delayMin })}`
                    : ""}
                </p>
                {notice ? (
                  <p className="mt-3 rounded-xl bg-surface-raised px-3 py-2.5 text-[0.8125rem] text-muted-foreground">
                    {notice}
                  </p>
                ) : (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {availability.slots
                      .filter((slot) => slot.state !== "past")
                      .map((slot) => {
                        const selected =
                          choice?.sessionId === session.id &&
                          choice.slot === slot.time
                        const free = slot.state === "free"
                        return (
                          <button
                            key={slot.time}
                            type="button"
                            data-testid="app-book-slot"
                            data-slot={slot.time}
                            data-session-id={session.id}
                            data-state={slot.state}
                            aria-pressed={selected}
                            disabled={!free}
                            title={
                              free ? undefined : t("patientApp.book.taken")
                            }
                            onClick={() => {
                              setChoice({
                                sessionId: session.id,
                                slot: slot.time,
                              })
                              book.clearProblem()
                              window.setTimeout(
                                () =>
                                  confirmRef.current?.scrollIntoView({
                                    block: "nearest",
                                    behavior: "smooth",
                                  }),
                                50
                              )
                            }}
                            className={cn(
                              "flex h-11 items-center justify-center rounded-xl border text-[0.8125rem] font-semibold tabular-nums transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : free
                                  ? "border-border bg-card hover:border-primary"
                                  : "cursor-not-allowed border-transparent bg-surface-raised text-muted-foreground line-through opacity-60"
                            )}
                          >
                            {time(atDhaka(session.date, slot.time))}
                          </button>
                        )
                      })}
                  </div>
                )}
              </AppCard>
            )
          })
        )}
      </div>

      <div ref={confirmRef} className="mt-4 scroll-mb-24">
        <Segmented<VisitType>
          label={t("patientApp.book.visitType")}
          value={visitType}
          onChange={setVisitType}
          options={[
            {
              value: "first",
              label: t("patientApp.appointments.visitType.first"),
            },
            {
              value: "follow-up",
              label: t("patientApp.appointments.visitType.follow-up"),
            },
          ]}
        />
        {choice && chosenSession ? (
          <p className="mt-3 flex items-center justify-between gap-3 px-1 text-[0.8125rem]">
            <span className="min-w-0 truncate font-medium">
              {t("patientApp.book.summary", {
                name: patientName(member.patient, locale),
                date:
                  chosenSession.date === today
                    ? t("common.today")
                    : dmy(atDhaka(chosenSession.date, "12:00")),
                time: time(atDhaka(chosenSession.date, choice.slot)),
              })}
            </span>
            <MoneyText poisha={fee} className="shrink-0 font-semibold" />
          </p>
        ) : null}
        {book.problem ? (
          <p
            role="alert"
            className="mt-2 px-1 text-[0.8125rem] font-medium text-destructive"
          >
            {problemText(book.problem)}
          </p>
        ) : null}
        <Button
          data-testid="app-book-confirm"
          size="lg"
          className="mt-3 h-12 w-full text-base"
          disabled={!choice || book.pending}
          onClick={confirm}
        >
          <CircleCheck />
          {book.pending
            ? t("patientApp.book.booking")
            : choice
              ? t("patientApp.book.confirm")
              : t("patientApp.book.pickSlot")}
        </Button>
      </div>
    </>
  )
}

function BookedCard({
  booked,
  doctorName,
  onAnother,
}: {
  booked: Booked
  doctorName: string
  onAnother: () => void
}) {
  const { t, locale, time, dmy, money } = useLocale()
  const { members } = useFamily()
  const today = useToday()
  const who = members.find((m) => m.patient.id === booked.memberId)?.patient
  return (
    <AppCard
      data-testid="app-book-success"
      data-appointment-id={booked.appointmentId}
      className="mt-4 flex flex-col items-center gap-3 py-6 text-center"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--success)_16%,transparent)] text-success">
        <CircleCheck className="size-7" />
      </span>
      <h2 className="text-lg font-semibold">
        {t("patientApp.book.successTitle")}
      </h2>
      <p className="text-[0.875rem] leading-relaxed">
        {t("patientApp.book.successBody", {
          name: who ? patientName(who, locale) : "",
          doctor: doctorName,
          date:
            booked.date === today
              ? t("common.today")
              : dmy(atDhaka(booked.date, "12:00")),
          time: time(atDhaka(booked.date, booked.slot)),
        })}
      </p>
      <p className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
        <SimulatedBadge />
        {t("patientApp.book.smsSent")}
      </p>
      {booked.feeP > 0 ? (
        <p className="rounded-xl bg-surface-raised px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {t("patientApp.book.feeNote", { fee: money(booked.feeP) })}
        </p>
      ) : null}
      <Button
        nativeButton={false}
        render={
          <Link href={`/app/appointments?focus=${booked.appointmentId}`} />
        }
        size="lg"
        className="mt-1 h-12 w-full text-base"
        data-testid="app-book-view-pass"
      >
        <QrCode />
        {t("patientApp.book.viewPass")}
      </Button>
      <Button
        variant="neutral"
        size="lg"
        className="h-12 w-full"
        onClick={onAnother}
      >
        {t("patientApp.book.bookAnother")}
      </Button>
    </AppCard>
  )
}
