"use client"

import * as React from "react"
import { CalendarSync, Hourglass, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { atDhaka } from "@/core/clock/dates"
import type { AppointmentRow, SessionRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { applyDelayChoice } from "@/modules/scheduling/commands"
import {
  allowedChoices,
  isAwaiting,
  type DelayChoice,
} from "@/modules/scheduling/delay"

import { useAppCommand, useProblemText } from "./use-app-command"

const ICON: Record<DelayChoice, React.ReactNode> = {
  wait: <Hourglass />,
  rebook: <CalendarSync />,
  refund: <Undo2 />,
}

/**
 * The doctor is running late (plan §10 S11): the delay on the affected
 * appointment and the patient's three choices, the same ones the front desk
 * offers (`scheduling.applyDelayChoice`, patient role: own or a linked
 * family member's appointment only). Rebooking moves the visit to the
 * doctor's next session; a refund cancels it.
 */
export function DelayNotice({
  appointment,
  session,
  doctorName,
}: {
  appointment: AppointmentRow
  session: SessionRow | undefined
  doctorName: string
}) {
  const { t, num, time } = useLocale()
  const command = useAppCommand(applyDelayChoice)
  const problemText = useProblemText()
  if (!session || session.status !== "delayed" || !isAwaiting(appointment))
    return null
  const choices = allowedChoices(appointment, true)
  const waiting = appointment.delayChoice === "wait"
  const expected =
    atDhaka(appointment.date, appointment.slotStart) + session.delayMin * 60_000

  return (
    <div
      data-testid="app-delay"
      data-appointment-id={appointment.id}
      data-choice={appointment.delayChoice ?? ""}
      className="mt-3 flex flex-col gap-2.5 rounded-2xl bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] p-3"
    >
      <p className="flex items-start gap-2 text-[0.875rem] leading-snug font-semibold">
        <Hourglass className="mt-0.5 size-4 shrink-0 text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning" />
        {t("patientApp.delay.title", {
          doctor: doctorName,
          minutes: num(session.delayMin),
        })}
      </p>
      <p className="text-[0.8125rem] leading-snug text-foreground/85">
        {waiting
          ? t("patientApp.delay.waiting", { time: time(expected) })
          : t("patientApp.delay.ask", { time: time(expected) })}
      </p>
      <div
        className={cn(
          "grid gap-1.5",
          choices.length === 3 ? "grid-cols-3" : "grid-cols-1"
        )}
      >
        {choices.map((choice) => {
          const chosen = appointment.delayChoice === choice
          return (
            <Button
              key={choice}
              data-testid="app-delay-choice"
              data-choice={choice}
              aria-pressed={chosen}
              variant={chosen ? "default" : "secondary"}
              className="h-auto min-h-11 flex-col gap-0.5 rounded-xl px-1.5 py-1.5 text-xs whitespace-normal"
              disabled={command.pending || chosen}
              onClick={() =>
                command.run({
                  appointmentId: appointment.id,
                  choice,
                  idempotencyKey: `app-delay:${appointment.id}:${choice}:${session.version}`,
                })
              }
            >
              {ICON[choice]}
              {t(`patientApp.delay.choice.${choice}`)}
            </Button>
          )
        })}
      </div>
      {command.problem ? (
        <p
          role="alert"
          className="text-center text-[0.8125rem] font-medium text-destructive"
        >
          {problemText(command.problem)}
        </p>
      ) : (
        <p className="text-[0.6875rem] leading-snug text-muted-foreground">
          {t("patientApp.delay.hint")}
        </p>
      )}
    </div>
  )
}
