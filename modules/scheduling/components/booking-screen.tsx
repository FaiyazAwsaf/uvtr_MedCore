"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"
import {
  ArrowLeft,
  CalendarCheck2,
  CalendarPlus,
  CircleCheckBig,
  ListOrdered,
  LogIn,
  MessageSquareText,
  Stethoscope,
  UserRoundSearch,
} from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { MoneyText } from "@/components/shared/money-text"
import { PatientPicker } from "@/components/shared/patient-picker"
import { QrCode } from "@/components/shared/qr-code"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import type { BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { addDaysISO, atDhaka, dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { HHMM, ISODate, VisitType } from "@/core/db/schema"
import type { RuleViolation } from "@/core/engine/errors"
import { usePersona } from "@/core/session/persona"
import { LOCALE_META, type Locale } from "@/lib/i18n/config"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { useDeskCommand, useRuleText } from "@/modules/identity/components/desk-command"
import { ChoicePills, DeskHeader, RuleAlert } from "@/modules/identity/components/desk-ui"
import { checkIn } from "@/modules/queue/commands"

import { bookAppointment } from "../commands"
import { isSessionBookable, isSessionOver } from "../slots"
import { DateStrip } from "./date-strip"
import { DoctorDirectory } from "./doctor-directory"
import { DoctorProfile } from "./doctor-profile"
import { SessionList, useDoctorSessions } from "./session-list"
import { SlotGrid } from "./slot-grid"

const DAYS_AHEAD = 14

function replaceParam(name: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value) url.searchParams.set(name, value)
  else url.searchParams.delete(name)
  window.history.replaceState(window.history.state, "", url.toString())
}

/**
 * Booking at the counter or for a phone call (plan §9 `/reception/book`):
 * the doctor directory with verified profiles, a date, the doctor's sessions,
 * the slot grid, and `scheduling.book`. The same scheduler serves the patient
 * app and the call centre.
 */
export function BookingScreen() {
  const params = useSearchParams()
  const persona = usePersona()
  const { t } = useLocale()
  const [patientId, setPatientId] = React.useState<string | null>(() => params.get("patient"))
  const [branch, setBranch] = React.useState<BranchCode | "all">(persona?.branchId ?? "all")
  const [doctorId, setDoctorId] = React.useState<string | null>(() => params.get("doctor"))
  const [booked, setBooked] = React.useState<string | null>(null)

  React.useEffect(() => replaceParam("patient", patientId), [patientId])
  React.useEffect(() => replaceParam("doctor", doctorId), [doctorId])

  return (
    <div className="@container/book flex flex-col gap-4 py-2">
      <DeskHeader
        title={t("scheduling.book.title")}
        subtitle={t("scheduling.book.subtitle")}
        actions={
          <Button
            variant="neutral"
            size="sm"
            nativeButton={false}
            render={<Link href={patientId ? `/reception?patient=${patientId}` : "/reception"} />}
          >
            <UserRoundSearch />
            {t("scheduling.book.frontDesk")}
          </Button>
        }
      />

      {patientId ? (
        <IdentityBanner
          patientId={patientId}
          compact
          actions={
            <Button variant="link" size="sm" onClick={() => setPatientId(null)}>
              {t("scheduling.book.changePatient")}
            </Button>
          }
        />
      ) : (
        <div className="surface-card flex flex-col gap-2 p-4">
          <p className="text-[0.8125rem] font-medium">{t("scheduling.book.whoFor")}</p>
          <PatientPicker onSelect={(patient) => setPatientId(patient.id)} />
        </div>
      )}

      <div className="grid min-w-0 items-start gap-4 @[62rem]/book:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <DoctorDirectory
          branch={branch}
          onBranchChange={setBranch}
          selectedId={doctorId}
          onSelect={(id) => {
            setDoctorId(id)
            setBooked(null)
          }}
          className={doctorId ? "hidden @[62rem]/book:flex" : undefined}
        />
        {booked ? (
          <BookingSuccess
            appointmentId={booked}
            onAnother={() => setBooked(null)}
          />
        ) : doctorId ? (
          <BookingPanel
            key={doctorId}
            doctorId={doctorId}
            patientId={patientId}
            branch={branch}
            onBack={() => setDoctorId(null)}
            onBooked={setBooked}
          />
        ) : (
          <div className="surface-card hidden @[62rem]/book:flex">
            <EmptyState
              icon={Stethoscope}
              title={t("scheduling.book.pickDoctor")}
              description={t("scheduling.book.pickDoctorHint")}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function BookingPanel({
  doctorId,
  patientId,
  branch,
  onBack,
  onBooked,
}: {
  doctorId: string
  patientId: string | null
  branch: BranchCode | "all"
  onBack: () => void
  onBooked: (appointmentId: string) => void
}) {
  const db = useDb()
  const { t, dmy, time } = useLocale()
  const today = dhakaDate(now())
  const [date, setDate] = React.useState<ISODate>(today)
  const [chosenSession, setSessionId] = React.useState<string | null>(null)
  const [slotChoice, setSlotChoice] = React.useState<{ sessionId: string; time: HHMM } | null>(null)
  const [visitType, setVisitType] = React.useState<VisitType>("first")
  const [source, setSource] = React.useState<"counter" | "call">("counter")
  const [smsLang, setSmsLang] = React.useState<Locale>("bn")
  const [rule, setRule] = React.useState<RuleViolation | null>(null)
  const book = useDeskCommand(bookAppointment)
  const sessions = useDoctorSessions(doctorId, date)

  const marked = useLiveQuery(async () => {
    const last = addDaysISO(today, DAYS_AHEAD - 1)
    const rows = await db.sessions.where("doctorId").equals(doctorId).toArray()
    return new Set(
      rows
        .filter((s) => s.date >= today && s.date <= last && isSessionBookable(s))
        .map((s) => s.date)
    )
  }, [db, doctorId, today])

  // The chosen session, else the first bookable one of the day (this branch first).
  const sessionId = React.useMemo(() => {
    if (!sessions) return null
    if (chosenSession && sessions.some((s) => s.session.id === chosenSession)) return chosenSession
    const ms = now()
    const open = sessions.filter(
      (s) => isSessionBookable(s.session) && !isSessionOver(s.session, ms)
    )
    const preferred = open.find((s) => s.session.branchId === branch) ?? open[0]
    return preferred?.session.id ?? null
  }, [sessions, chosenSession, branch])
  const slot = slotChoice && slotChoice.sessionId === sessionId ? slotChoice.time : null
  const setSlot = (time: HHMM | null) =>
    setSlotChoice(time && sessionId ? { sessionId, time } : null)

  const selected = sessions?.find((s) => s.session.id === sessionId)
  const feeP = selected
    ? visitType === "follow-up"
      ? selected.session.followUpFeeP
      : visitType === "report"
        ? 0
        : selected.session.feeP
    : 0
  const ready = !!patientId && !!selected && !!slot

  const onConfirm = async () => {
    if (!patientId || !selected || !slot) return
    setRule(null)
    const outcome = await book.run({
      sessionId: selected.session.id,
      patientId,
      source,
      visitType,
      slotStart: slot,
      smsLang,
    })
    if (outcome.ok) {
      toast.success(t("scheduling.book.toast", { time: time(atDhaka(selected.session.date, slot)) }))
      onBooked(outcome.result.appointmentId)
    } else if (outcome.rule) {
      setRule(outcome.rule)
      if (outcome.rule.code === "SLOT_TAKEN") setSlot(null)
    }
  }

  return (
    <section
      data-testid="booking-panel"
      className="surface-card @container flex min-w-0 flex-col gap-4 p-4"
    >
      <Button variant="link" size="sm" className="self-start @[62rem]/book:hidden" onClick={onBack}>
        <ArrowLeft />
        {t("scheduling.book.allDoctors")}
      </Button>
      <DoctorProfile doctorId={doctorId} compact />

      <div className="flex flex-col gap-2">
        <h3 className="text-[0.8125rem] font-medium">{t("scheduling.book.date")}</h3>
        <DateStrip
          from={today}
          days={DAYS_AHEAD}
          value={date}
          marked={marked}
          onChange={(value) => {
            setDate(value)
            setSessionId(null)
            setSlot(null)
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[0.8125rem] font-medium">
          {t("scheduling.book.sessions", { date: dmy(atDhaka(date, "12:00")) })}
        </h3>
        <SessionList
          sessions={sessions}
          selectedId={sessionId}
          onSelect={(id) => {
            setSessionId(id)
            setSlot(null)
          }}
        />
      </div>

      {selected ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-[0.8125rem] font-medium">{t("scheduling.book.slot")}</h3>
          <SlotGrid
            session={selected.session}
            appointments={selected.appointments}
            value={slot}
            onChange={(value) => {
              setSlot(value)
              setRule(null)
            }}
          />
        </div>
      ) : null}

      {selected ? (
        <div className="grid gap-3 @[36rem]:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t("scheduling.book.visitType")}</span>
            <ChoicePills
              data-testid="book-visit-type"
              name="visit-type"
              value={visitType}
              onChange={setVisitType}
              options={selected.session.visitTypes.map((v) => ({
                value: v,
                label: t(`scheduling.visitTypes.${v}`),
              }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t("scheduling.book.source")}</span>
            <ChoicePills
              data-testid="book-source"
              name="book-source"
              value={source}
              onChange={setSource}
              options={[
                { value: "counter" as const, label: t("scheduling.sources.counter") },
                { value: "call" as const, label: t("scheduling.sources.call") },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("scheduling.book.smsLang")}
              <SimulatedBadge className="h-5" />
            </span>
            <ChoicePills
              data-testid="book-sms-lang"
              name="sms-lang"
              value={smsLang}
              onChange={setSmsLang}
              options={[
                { value: "bn" as const, label: LOCALE_META.bn.nativeLabel },
                { value: "en" as const, label: LOCALE_META.en.nativeLabel },
              ]}
            />
          </div>
        </div>
      ) : null}

      {rule ? <RuleAlert rule={rule} /> : null}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
        <div className="min-w-0 text-[0.8125rem]">
          {!patientId ? (
            <span className="text-warning">{t("scheduling.book.needPatient")}</span>
          ) : selected && slot ? (
            <span className="nums">
              {t("scheduling.book.summary", {
                date: dmy(atDhaka(selected.session.date, slot)),
                time: time(atDhaka(selected.session.date, slot)),
              })}
              {" · "}
              <MoneyText poisha={feeP} className="font-semibold" />
            </span>
          ) : (
            <span className="text-muted-foreground">
              {selected
                ? t("scheduling.book.pickSlot")
                : sessions?.length
                  ? t("scheduling.book.pickSession")
                  : t("scheduling.book.pickDate")}
            </span>
          )}
        </div>
        <Button data-testid="book-confirm" disabled={!ready || book.pending} onClick={onConfirm}>
          <CalendarPlus />
          {book.pending
            ? t("common.saving")
            : slot && selected
              ? t("scheduling.book.confirmAt", { time: time(atDhaka(selected.session.date, slot)) })
              : t("scheduling.book.confirm")}
        </Button>
      </footer>
    </section>
  )
}

/** After booking: the appointment, its QR code, the SMS, and check-in if it is today. */
function BookingSuccess({
  appointmentId,
  onAnother,
}: {
  appointmentId: string
  onAnother: () => void
}) {
  const db = useDb()
  const { t, locale, dmy, time, digits } = useLocale()
  const ruleText = useRuleText()
  const checkInCommand = useDeskCommand(checkIn)
  const data = useLiveQuery(async () => {
    const appointment = await db.appointments.get(appointmentId)
    if (!appointment) return null
    const [session, patient, token, sms] = await Promise.all([
      db.sessions.get(appointment.sessionId),
      db.patients.get(appointment.patientId),
      appointment.tokenId ? db.queueTokens.get(appointment.tokenId) : undefined,
      db.sms.where("patientId").equals(appointment.patientId).toArray(),
    ])
    const doctor = session ? await db.doctors.get(session.doctorId) : undefined
    const [staff, room] = await Promise.all([
      doctor ? db.staff.get(doctor.staffId) : undefined,
      session ? db.rooms.get(session.roomId) : undefined,
    ])
    const confirmation = sms
      .filter((m) => m.templateId === "appointment-booked" && m.queuedAt >= appointment.createdAt)
      .at(-1)
    return { appointment, session, patient, token, staff, room, confirmation }
  }, [db, appointmentId])

  if (!data) return null
  const { appointment, session, patient, token, staff, room, confirmation } = data
  const today = dhakaDate(now())
  const at = atDhaka(appointment.date, appointment.slotStart)
  const canCheckIn =
    appointment.status === "booked" &&
    appointment.date === today &&
    !!session &&
    !isSessionOver(session, now())

  const onCheckIn = async () => {
    const outcome = await checkInCommand.run({ appointmentId, method: "desk" })
    if (outcome.ok) toast.success(t("queue.toast.checkedIn", { token: outcome.result.label }))
    else if (outcome.rule) toast.error(ruleText(outcome.rule))
  }

  return (
    <section
      data-testid="book-success"
      data-appointment-id={appointment.id}
      className="surface-card @container flex min-w-0 flex-col gap-4 p-5"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--success)_16%,transparent)] text-success">
          <CircleCheckBig className="size-6" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[1.0625rem] font-semibold">{t("scheduling.success.title")}</h2>
          <p className="truncate text-[0.8125rem] text-muted-foreground">
            {patient ? (locale === "bn" ? patient.nameBn : patient.nameEn) : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 @[30rem]:flex-row @[30rem]:items-start">
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 text-[0.8125rem]">
          <Detail label={t("scheduling.success.doctor")}>
            {staff ? (locale === "bn" ? staff.nameBn : staff.nameEn) : ""}
          </Detail>
          <Detail label={t("scheduling.success.when")}>
            <span className="nums">
              {dmy(at)}, {time(at)}
            </span>
          </Detail>
          <Detail label={t("scheduling.success.room")}>{room ? room.name[locale] : ""}</Detail>
          <Detail label={t("scheduling.success.source")}>
            {t(`scheduling.sources.${appointment.source}`)} ·{" "}
            {t(`scheduling.visitTypes.${appointment.visitType}`)}
          </Detail>
          {token ? (
            <Detail label={t("scheduling.success.token")}>
              <span
                data-testid="book-token"
                lang="en"
                className="font-mono text-lg font-semibold text-link"
              >
                {token.label}
              </span>
            </Detail>
          ) : null}
          <Detail label={t("scheduling.success.sms")}>
            {confirmation ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <MessageSquareText className="size-3.5 text-muted-foreground" />
                <span className="nums">{digits(confirmation.to)}</span>
                <SimulatedBadge className="h-5" />
              </span>
            ) : (
              <span className="text-muted-foreground">{t("scheduling.success.noSms")}</span>
            )}
          </Detail>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <QrCode value={appointment.qrCode} size={104} title={t("scheduling.success.qr")} />
          <span className="text-[0.6875rem] text-muted-foreground">{t("scheduling.success.qr")}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
        {canCheckIn ? (
          <Button data-testid="book-checkin" disabled={checkInCommand.pending} onClick={onCheckIn}>
            <LogIn />
            {t("scheduling.success.checkInNow")}
          </Button>
        ) : null}
        <Button
          variant={canCheckIn ? "outline" : "default"}
          nativeButton={false}
          render={<Link href={`/reception/queue?session=${appointment.sessionId}`} />}
        >
          <ListOrdered />
          {t("scheduling.success.openQueue")}
        </Button>
        <Button variant="neutral" onClick={onAnother}>
          <CalendarCheck2 />
          {t("scheduling.success.another")}
        </Button>
      </div>
    </section>
  )
}

function Detail({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 font-medium">{children}</span>
    </div>
  )
}
