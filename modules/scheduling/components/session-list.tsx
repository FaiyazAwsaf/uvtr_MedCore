"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { CalendarX2, Clock3, DoorOpen } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { StatusText } from "@/components/shared/status"
import { branches } from "@/config/brand.config"
import { atDhaka } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { AppointmentRow, ISODate, RoomRow, SessionRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { isSessionBookable, isSessionOver, sessionLoad } from "../slots"

export type SessionWithLoad = {
  session: SessionRow
  room?: RoomRow
  appointments: AppointmentRow[]
}

/** A doctor's sessions on a day, with their rooms and appointments (live). */
export function useDoctorSessions(doctorId: string | null, date: ISODate) {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!doctorId) return []
    const sessions = (await db.sessions.where("[doctorId+date]").equals([doctorId, date]).toArray()).sort(
      (a, b) => a.start.localeCompare(b.start)
    )
    const [rooms, appointments] = await Promise.all([
      db.rooms.bulkGet(sessions.map((s) => s.roomId)),
      Promise.all(sessions.map((s) => db.appointments.where("sessionId").equals(s.id).toArray())),
    ])
    return sessions.map(
      (session, i): SessionWithLoad => ({ session, room: rooms[i], appointments: appointments[i] })
    )
  }, [db, doctorId, date])
}

/** Session cards for a doctor and day: time, branch, room and places left. */
export function SessionList({
  sessions,
  selectedId,
  onSelect,
  showCapacity = true,
  className,
}: {
  sessions: SessionWithLoad[] | undefined
  selectedId: string | null
  onSelect: (sessionId: string) => void
  /** Staff see booked and walk-in places; the patient app does not */
  showCapacity?: boolean
  className?: string
}) {
  const { t, locale, num, time } = useLocale()
  const nowMs = useNow(30_000)

  if (!sessions) return null
  if (!sessions.length) {
    return (
      <EmptyState
        size="sm"
        icon={CalendarX2}
        title={t("scheduling.sessions.none")}
        description={t("scheduling.sessions.noneHint")}
        className={className}
      />
    )
  }

  return (
    <div className={cn("grid gap-2 @[34rem]:grid-cols-2", className)}>
      {sessions.map(({ session, room, appointments }) => {
        const load = sessionLoad(session, appointments)
        const over = nowMs > 0 && isSessionOver(session, nowMs)
        const bookable = isSessionBookable(session) && !over
        const branch = branches.find((b) => b.code === session.branchId)
        const active = selectedId === session.id
        return (
          <button
            key={session.id}
            type="button"
            data-testid="book-session"
            data-session-id={session.id}
            aria-pressed={active}
            disabled={!bookable}
            onClick={() => onSelect(session.id)}
            className={cn(
              "flex flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-55",
              active ? "border-primary bg-primary-soft" : "border-border/70 hover:bg-surface-raised"
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="nums inline-flex items-center gap-1.5 text-sm font-semibold">
                <Clock3 className="size-3.5 text-link" />
                {time(atDhaka(session.date, session.start))} - {time(atDhaka(session.date, session.end))}
              </span>
              <StatusText
                tone={
                  session.status === "blocked"
                    ? "destructive"
                    : session.status === "delayed"
                      ? "warning"
                      : over
                        ? "muted"
                        : "success"
                }
                className="text-xs"
              >
                {over && session.status === "open"
                  ? t("scheduling.sessions.over")
                  : t(`scheduling.sessions.status.${session.status}`)}
              </StatusText>
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DoorOpen className="size-3.5" />
              {branch ? `${branch.name[locale]} (${branch.code})` : session.branchId}
              {room ? ` · ${room.name[locale]}` : ""}
            </span>
            {showCapacity ? (
              <span className="nums text-xs">
                {t("scheduling.sessions.places", {
                  left: num(load.bookedLeft),
                  total: num(load.bookedCapacity),
                })}
                <span className="text-muted-foreground">
                  {" · "}
                  {t("scheduling.sessions.walkIns", { left: num(load.walkInLeft) })}
                </span>
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
