"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { CalendarPlus, CalendarX2, QrCode as QrIcon } from "lucide-react"

import { MoneyText } from "@/components/shared/money-text"
import { QrCode } from "@/components/shared/qr-code"
import { Button } from "@/components/ui/button"
import { atDhaka } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { AppointmentRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { splitAppointments } from "../lib/appointments"
import {
  AppCard,
  AppLoading,
  DoctorAvatar,
  ScreenTitle,
  Segmented,
  useFocusId,
  useFocusRing,
} from "./bits"
import { useDoctorInfo, useMember, useToday } from "./data"
import { DelayNotice } from "./delay-notice"
import {
  AppointmentStatus,
  CheckInButton,
  DateTile,
  QueuePanel,
  useSession,
  WhenWhere,
} from "./visit-parts"

/** The patient's appointments, live (the member on screen only). */
export function useMemberAppointments(): AppointmentRow[] | undefined {
  const db = useDb()
  const member = useMember()
  return useLiveQuery(
    () => db.appointments.where("patientId").equals(member.id).toArray(),
    [db, member.id]
  )
}

/** The consultation fee line for a booking: due at the counter, or paid. */
function FeeLine({ appointment }: { appointment: AppointmentRow }) {
  const { t } = useLocale()
  const db = useDb()
  const line = useLiveQuery(
    async () =>
      appointment.feeBasketLineId
        ? await db.basketLines.get(appointment.feeBasketLineId)
        : undefined,
    [db, appointment.feeBasketLineId]
  )
  if (!line || line.status === "removed") return null
  const paid = line.status === "invoiced"
  return (
    <Link
      href="/app/bills"
      data-testid="app-appointment-fee"
      data-paid={paid}
      className="flex items-center justify-between gap-3 text-[0.8125rem]"
    >
      <span className="min-w-0">
        <span className="block text-muted-foreground">
          {t("patientApp.appointments.fee")}
        </span>
        <span
          className={cn(
            "block text-xs font-medium",
            paid ? "text-success" : "text-link"
          )}
        >
          {paid
            ? t("patientApp.appointments.feePaid")
            : t("patientApp.appointments.feeDue")}
        </span>
      </span>
      <MoneyText
        poisha={line.qty * line.unitPriceP}
        className="text-[0.9375rem] font-semibold"
      />
    </Link>
  )
}

/** The check-in pass: the appointment's QR for the front desk scanner. */
export function CheckInQr({ appointment }: { appointment: AppointmentRow }) {
  const { t } = useLocale()
  return (
    <div className="mt-3 flex items-center gap-3 rounded-2xl border border-dashed border-border p-3">
      <span
        data-testid="app-qr"
        data-value={appointment.qrCode}
        className="shrink-0"
      >
        <QrCode
          value={appointment.qrCode}
          size={92}
          title={t("patientApp.appointments.passTitle")}
        />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
          <QrIcon className="size-4 text-link" />
          {t("patientApp.appointments.passTitle")}
        </span>
        <span className="mt-1 block text-xs leading-snug text-muted-foreground">
          {t("patientApp.appointments.passHint")}
        </span>
        <span
          lang="en"
          className="mt-1.5 block truncate font-mono text-[0.625rem] text-muted-foreground"
        >
          {appointment.qrCode}
        </span>
      </span>
    </div>
  )
}

/** One upcoming appointment: doctor, time, place, live queue, check-in and QR pass. */
function AppointmentPass({
  appointment,
  focused,
}: {
  appointment: AppointmentRow
  focused: boolean
}) {
  const { t } = useLocale()
  const doctorInfo = useDoctorInfo()
  const session = useSession(appointment.sessionId)
  const today = useToday()
  const info = doctorInfo(appointment.doctorId)
  const { ref, flash } = useFocusRing(focused)

  return (
    <AppCard
      ref={ref}
      flash={flash}
      data-testid="app-appointment"
      data-appointment-id={appointment.id}
      data-status={appointment.status}
      className="scroll-mt-20"
    >
      <div className="flex items-start gap-3">
        <DateTile date={appointment.date} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <DoctorAvatar staff={info?.staff} size={36} />
              <div className="min-w-0">
                <p className="truncate text-[0.9375rem] leading-tight font-semibold">
                  {info?.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {info?.specialtyName}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-2">
            <WhenWhere appointment={appointment} session={session} hideDelay />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <AppointmentStatus status={appointment.status} />
        <span className="text-xs text-muted-foreground">
          {t(`patientApp.appointments.visitType.${appointment.visitType}`)} ·{" "}
          {t(`patientApp.appointments.source.${appointment.source}`)}
        </span>
      </div>

      <DelayNotice
        appointment={appointment}
        session={session}
        doctorName={info?.name ?? ""}
      />
      {appointment.date === today ? (
        <QueuePanel appointment={appointment} session={session} />
      ) : null}
      <CheckInButton appointment={appointment} session={session} />
      {appointment.status === "booked" ? (
        <CheckInQr appointment={appointment} />
      ) : null}
      <div className="mt-3 border-t border-hairline pt-3">
        <FeeLine appointment={appointment} />
      </div>
    </AppCard>
  )
}

/** A finished, missed or cancelled appointment. */
function PastRow({ appointment }: { appointment: AppointmentRow }) {
  const { dmy, time } = useLocale()
  const doctorInfo = useDoctorInfo()
  const info = doctorInfo(appointment.doctorId)
  return (
    <AppCard
      data-testid="app-appointment"
      data-appointment-id={appointment.id}
      data-status={appointment.status}
      className="flex items-center gap-3 p-3"
    >
      <DoctorAvatar staff={info?.staff} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.875rem] font-semibold">{info?.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {info?.specialtyName} · {dmy(atDhaka(appointment.date, "12:00"))},{" "}
          {time(atDhaka(appointment.date, appointment.slotStart))}
        </p>
      </div>
      <AppointmentStatus status={appointment.status} />
    </AppCard>
  )
}

export function AppointmentsScreen() {
  const { t, num } = useLocale()
  const today = useToday()
  const appointments = useMemberAppointments()
  const focusId = useFocusId()
  const [view, setView] = React.useState<"upcoming" | "past">("upcoming")
  const split = appointments ? splitAppointments(appointments, today) : null
  const focusedPast = !!(focusId && split?.past.some((a) => a.id === focusId))
  const shown = focusedPast ? "past" : view

  return (
    <>
      <ScreenTitle
        title={t("patientApp.appointments.title")}
        action={
          <Button
            nativeButton={false}
            render={<Link href="/app/doctors" />}
            size="sm"
            className="h-10 rounded-full px-4"
          >
            <CalendarPlus />
            {t("patientApp.appointments.book")}
          </Button>
        }
      />
      <Segmented
        label={t("patientApp.appointments.title")}
        value={shown}
        onChange={setView}
        options={[
          {
            value: "upcoming",
            label: `${t("patientApp.appointments.upcoming")}${split ? ` (${num(split.upcoming.length)})` : ""}`,
          },
          { value: "past", label: t("patientApp.appointments.past") },
        ]}
      />
      <div className="mt-3 flex flex-col gap-3">
        {!split ? (
          <AppLoading />
        ) : shown === "upcoming" ? (
          split.upcoming.length ? (
            split.upcoming.map((a) => (
              <AppointmentPass
                key={a.id}
                appointment={a}
                focused={a.id === focusId}
              />
            ))
          ) : (
            <EmptyAppointments />
          )
        ) : split.past.length ? (
          split.past.map((a) => <PastRow key={a.id} appointment={a} />)
        ) : (
          <p className="py-10 text-center text-[0.8125rem] text-muted-foreground">
            {t("patientApp.appointments.emptyPast")}
          </p>
        )}
      </div>
    </>
  )
}

function EmptyAppointments() {
  const { t } = useLocale()
  return (
    <AppCard className="flex flex-col items-center gap-3 py-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-surface-raised text-muted-foreground">
        <CalendarX2 className="size-5" />
      </span>
      <p className="text-[0.9375rem] font-semibold">
        {t("patientApp.appointments.emptyUpcoming")}
      </p>
      <p className="max-w-[30ch] text-[0.8125rem] text-muted-foreground">
        {t("patientApp.appointments.emptyUpcomingHint")}
      </p>
      <Button
        nativeButton={false}
        render={<Link href="/app/doctors" />}
        size="lg"
        className="mt-1 h-12 rounded-full px-6"
      >
        <CalendarPlus />
        {t("patientApp.home.bookDoctor")}
      </Button>
    </AppCard>
  )
}
