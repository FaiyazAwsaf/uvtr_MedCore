"use client"

import * as React from "react"
import { toast } from "sonner"
import { CalendarClock, LogIn } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { atDhaka } from "@/core/clock/dates"
import type { AppointmentRow, PatientRow } from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { useDeskCommand, useRuleText } from "@/modules/identity/components/desk-command"
import { PersonLine } from "@/modules/identity/components/desk-ui"
import type { SessionInfo } from "@/modules/scheduling/components/use-session-info"

import { checkIn } from "../commands"

/**
 * Today's booked patients who have not arrived yet, in time order, each with
 * a desk "Check in" (plan §9 `/reception/queue`).
 */
export function ArrivalsList({
  appointments,
  patients,
  sessions,
  nowMs,
  showDoctor,
  onCheckedIn,
}: {
  appointments: AppointmentRow[]
  patients: Map<string, PatientRow>
  sessions: Map<string, SessionInfo>
  nowMs: number
  /** Show the doctor and room on each row (when listing several sessions) */
  showDoctor: boolean
  onCheckedIn: (appointment: AppointmentRow, tokenId: string) => void
}) {
  const { t } = useLocale()
  if (!appointments.length) {
    return <EmptyState size="sm" icon={CalendarClock} title={t("queue.arrivals.empty")} />
  }
  return (
    <ul data-testid="arrivals-list" className="flex flex-col divide-y divide-hairline">
      {appointments.map((appointment) => (
        <ArrivalRow
          key={appointment.id}
          appointment={appointment}
          patient={patients.get(appointment.patientId)}
          info={sessions.get(appointment.sessionId)}
          late={atDhaka(appointment.date, appointment.slotStart) < nowMs}
          showDoctor={showDoctor}
          onCheckedIn={onCheckedIn}
        />
      ))}
    </ul>
  )
}

function ArrivalRow({
  appointment,
  patient,
  info,
  late,
  showDoctor,
  onCheckedIn,
}: {
  appointment: AppointmentRow
  patient?: PatientRow
  info?: SessionInfo
  late: boolean
  showDoctor: boolean
  onCheckedIn: (appointment: AppointmentRow, tokenId: string) => void
}) {
  const { t, locale, time } = useLocale()
  const ruleText = useRuleText()
  const command = useDeskCommand(checkIn)
  const flash = useFlashOnChange(appointment.version)

  const onCheckIn = async () => {
    const outcome = await command.run({ appointmentId: appointment.id, method: "desk" })
    if (outcome.ok) {
      toast.success(t("queue.toast.checkedIn", { token: outcome.result.label }))
      onCheckedIn(appointment, outcome.result.tokenId)
    } else if (outcome.rule) {
      toast.error(ruleText(outcome.rule))
    }
  }

  return (
    <li
      data-testid="checkin-row"
      data-appointment-id={appointment.id}
      className={cn("@container flex items-center gap-3 py-2", flash)}
    >
      <span className="flex w-16 shrink-0 flex-col">
        <span className="nums text-[0.8125rem] font-semibold">
          {time(atDhaka(appointment.date, appointment.slotStart))}
        </span>
        <span className={cn("text-[0.6875rem]", late ? "text-warning" : "text-muted-foreground")}>
          {late ? t("queue.arrivals.late") : t(`scheduling.sources.${appointment.source}`)}
        </span>
      </span>
      {patient ? (
        <PersonLine
          patient={patient}
          size={32}
          meta={
            showDoctor && info?.staff ? (
              <span className="truncate">
                {locale === "bn" ? info.staff.nameBn : info.staff.nameEn}
                {info.room ? ` · ${info.room.name[locale]}` : ""}
              </span>
            ) : null
          }
        />
      ) : (
        <span className="flex-1" />
      )}
      <Button
        data-testid="checkin-button"
        size="sm"
        disabled={command.pending}
        onClick={onCheckIn}
      >
        <LogIn />
        {t("queue.actions.checkIn")}
      </Button>
    </li>
  )
}
