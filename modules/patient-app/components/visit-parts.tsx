"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  Clock,
  Hourglass,
  MapPin,
  MapPinCheck,
  TriangleAlert,
  WifiOff,
} from "lucide-react"

import { StatusPill, type Tone } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { atDhaka } from "@/core/clock/dates"
import { useDb, useDbInfo } from "@/core/db/DbProvider"
import type { AppointmentRow, SessionRow } from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { checkIn } from "@/modules/queue/commands"

import { checkInState } from "../lib/appointments"
import { myQueue, nowServing, waitingCount } from "../lib/queue"
import { branchName, useRoomName, useToday } from "./data"
import { useAppCommand, useProblemText } from "./use-app-command"

/** Status pill tones for appointment states. */
export const APPOINTMENT_TONE: Record<AppointmentRow["status"], Tone> = {
  booked: "primary",
  "checked-in": "success",
  "in-consult": "info",
  done: "muted",
  "no-show": "warning",
  cancelled: "destructive",
  rebooked: "muted",
}

export function AppointmentStatus({
  status,
}: {
  status: AppointmentRow["status"]
}) {
  const { t } = useLocale()
  return (
    <StatusPill tone={APPOINTMENT_TONE[status]} dot>
      {t(`patientApp.appointments.status.${status}`)}
    </StatusPill>
  )
}

/** The appointment's session (live), for room, delay and queue state. */
export function useSession(sessionId: string): SessionRow | undefined {
  const db = useDb()
  return useLiveQuery(() => db.sessions.get(sessionId), [db, sessionId])
}

/** True while the branch works on its own server (plan §3.7). */
export function useBranchOffline(branchId: string): boolean {
  const { network } = useDbInfo()
  return network.some((n) => n.branchId === branchId && n.status !== "online")
}

/** Day tile: weekday, day and month of an ISO date. */
export function DateTile({
  date,
  className,
}: {
  date: string
  className?: string
}) {
  const { date: fmt } = useLocale()
  const ms = atDhaka(date, "12:00")
  return (
    <span
      className={cn(
        "flex w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-primary-soft py-2 text-link",
        className
      )}
    >
      <span className="text-[0.6875rem] font-medium">
        {fmt(ms, { weekday: "short" })}
      </span>
      <span className="text-xl leading-tight font-semibold">
        {fmt(ms, { day: "numeric" })}
      </span>
      <span className="text-[0.6875rem] font-medium">
        {fmt(ms, { month: "short" })}
      </span>
    </span>
  )
}

/** "11:50 am" and "Dhanmondi, Room 3" lines for an appointment. */
export function WhenWhere({
  appointment,
  session,
}: {
  appointment: AppointmentRow
  session: SessionRow | undefined
}) {
  const { t, time, dmy, locale } = useLocale()
  const roomName = useRoomName()
  const today = useToday()
  const at = atDhaka(appointment.date, appointment.slotStart)
  const day = appointment.date === today ? t("common.today") : dmy(at)
  const room = roomName(session?.roomId)
  return (
    <div className="flex flex-col gap-1 text-[0.8125rem]">
      <span className="flex items-center gap-2">
        <Clock className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">
          {day}, {time(at)}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <MapPin className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {branchName(appointment.branchId, locale)}
          {room ? `, ${room}` : ""}
        </span>
      </span>
      {session?.status === "delayed" && session.delayMin > 0 ? (
        <span className="flex items-center gap-2 font-medium text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning">
          <Hourglass className="size-4 shrink-0" />
          {t("patientApp.appointments.delayed", { minutes: session.delayMin })}
        </span>
      ) : null}
      {session?.status === "blocked" ? (
        <span className="flex items-center gap-2 font-medium text-destructive">
          <TriangleAlert className="size-4 shrink-0" />
          {t("patientApp.appointments.blocked")}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The live queue for the appointment's session: the token on the display
 * board ("Now serving"), the patient's own token and how many are ahead
 * (positions from the 2:1 interleave). Unavailable while the branch is
 * offline, because its queue then lives on the branch server (plan §3.7).
 */
export function QueuePanel({
  appointment,
  session,
}: {
  appointment: AppointmentRow
  session: SessionRow | undefined
}) {
  const { t, num } = useLocale()
  const db = useDb()
  const roomName = useRoomName()
  const offline = useBranchOffline(appointment.branchId)
  const tokens = useLiveQuery(
    () =>
      db.queueTokens.where("sessionId").equals(appointment.sessionId).toArray(),
    [db, appointment.sessionId]
  )
  const serving = tokens ? nowServing(tokens) : null
  const mine = tokens ? myQueue(tokens, appointment.tokenId) : null
  const servingFlash = useFlashOnChange(serving?.token.id)
  const aheadFlash = useFlashOnChange(
    mine ? `${mine.state}:${"ahead" in mine ? mine.ahead : ""}` : ""
  )

  if (offline) {
    return (
      <p
        data-testid="app-queue-offline"
        className="mt-3 flex items-center gap-2 rounded-2xl bg-surface-raised p-3 text-[0.8125rem] font-medium text-muted-foreground"
      >
        <WifiOff className="size-4 shrink-0" />
        {t("patientApp.queue.offline")}
      </p>
    )
  }
  if (!tokens) return null

  let message: string | null = null
  if (mine?.state === "waiting") {
    message =
      mine.ahead === 0
        ? t("patientApp.queue.next")
        : t("patientApp.queue.ahead", { count: num(mine.ahead) })
  } else if (mine?.state === "called") {
    message = t("patientApp.queue.yourTurn", {
      room: roomName(session?.roomId),
    })
  } else if (mine?.state === "skipped") {
    message = t("patientApp.queue.skipped")
  } else if (mine?.state === "done") {
    message = t("patientApp.queue.finished")
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className={cn("rounded-2xl bg-surface-raised p-3", servingFlash)}>
          <p className="text-xs font-medium text-muted-foreground">
            {serving?.state === "last-called"
              ? t("patientApp.queue.lastCalled")
              : t("patientApp.queue.nowServing")}
          </p>
          <p
            data-testid="app-now-serving"
            data-state={serving?.state ?? "none"}
            lang={serving ? "en" : undefined}
            className={cn(
              "mt-1 truncate font-semibold",
              serving
                ? "font-mono text-[1.625rem] leading-none"
                : "text-base leading-[1.625rem]"
            )}
          >
            {serving ? serving.token.label : t("patientApp.queue.notStarted")}
          </p>
        </div>
        {mine ? (
          <div className="rounded-2xl bg-primary p-3 text-primary-foreground">
            <p className="text-xs font-medium opacity-90">
              {t("patientApp.queue.yourToken")}
            </p>
            <p
              data-testid="app-token-label"
              lang="en"
              className="mt-1 truncate font-mono text-[1.625rem] leading-none font-semibold"
            >
              {mine.token.label}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-surface-raised p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("patientApp.queue.waiting", {
                count: num(waitingCount(tokens)),
              })}
            </p>
            <p className="mt-1 text-xs leading-snug">
              {t("patientApp.queue.waitingNoToken")}
            </p>
          </div>
        )}
      </div>
      {mine && message ? (
        <p
          data-testid="app-ahead"
          data-state={mine.state}
          data-ahead={mine.state === "waiting" ? mine.ahead : undefined}
          className={cn(
            "rounded-2xl px-3 py-2.5 text-center text-[0.9375rem] font-semibold",
            mine.state === "called"
              ? "bg-success text-white dark:text-background"
              : "bg-primary-soft text-link",
            aheadFlash
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}

/**
 * "I'm here": self check-in through `queue.checkIn` (patient role) on the
 * day of a booked appointment. The idempotency key is per appointment, so a
 * double tap or a second window never issues two tokens.
 */
export function CheckInButton({
  appointment,
  session,
}: {
  appointment: AppointmentRow
  session: SessionRow | undefined
}) {
  const { t } = useLocale()
  const today = useToday()
  const offline = useBranchOffline(appointment.branchId)
  const command = useAppCommand(checkIn)
  const problemText = useProblemText()
  const state = checkInState(appointment, session, today, offline)

  if (state === "checked-in") return null
  if (state !== "ready") {
    const text =
      state === "not-today"
        ? t("patientApp.appointments.checkInLater")
        : state === "offline"
          ? t("patientApp.appointments.checkInOffline")
          : t("patientApp.appointments.checkInClosed")
    return (
      <p
        data-testid="app-checkin-unavailable"
        data-state={state}
        className="mt-3 rounded-2xl bg-surface-raised px-3 py-2.5 text-[0.8125rem] leading-snug text-muted-foreground"
      >
        {text}
      </p>
    )
  }
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <Button
        data-testid="app-checkin"
        size="lg"
        className="h-12 w-full text-base"
        disabled={command.pending}
        onClick={() =>
          command.run({
            appointmentId: appointment.id,
            idempotencyKey: `app-checkin:${appointment.id}`,
          })
        }
      >
        <MapPinCheck />
        {command.pending
          ? t("patientApp.appointments.checkingIn")
          : t("patientApp.appointments.checkIn")}
      </Button>
      {command.problem ? (
        <p
          role="alert"
          className="text-center text-[0.8125rem] font-medium text-destructive"
        >
          {problemText(command.problem)}
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          {t("patientApp.appointments.checkInHint")}
        </p>
      )}
    </div>
  )
}
