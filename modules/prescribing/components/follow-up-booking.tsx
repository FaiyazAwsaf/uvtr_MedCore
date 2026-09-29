"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { CalendarCheck, CalendarPlus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StatusPill } from "@/components/shared/status"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { AppointmentRow, ISODate } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { useClinicalCommand } from "@/modules/consultation/components/use-clinical-command"
import { bookAppointment } from "@/modules/scheduling/commands"

const ACTIVE: AppointmentRow["status"][] = [
  "booked",
  "checked-in",
  "in-consult",
  "done",
]

/**
 * "Book follow-up" after signing (objective §2 "Follow-up"): the doctor's
 * sessions from the follow-up date, booked through the one shared scheduler
 * (`scheduling.book`, source counter), the same one the front desk uses.
 */
export function FollowUpBooking({
  patientId,
  doctorId,
  doctorName,
  fromDate,
  today,
}: {
  patientId: string
  doctorId: string
  doctorName: string
  fromDate: ISODate
  today: ISODate
}) {
  const { t, num, dmy } = useLocale()
  const db = useDb()
  const book = useClinicalCommand(bookAppointment)
  const [open, setOpen] = React.useState(false)
  const until = addDaysISO(fromDate, 14)

  const existing = useLiveQuery(async () => {
    const appts = await db.appointments
      .where("patientId")
      .equals(patientId)
      .toArray()
    return (
      appts
        .filter(
          (a) =>
            a.doctorId === doctorId &&
            a.visitType === "follow-up" &&
            a.date > today &&
            (a.status === "booked" || a.status === "checked-in")
        )
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
    )
  }, [db, patientId, doctorId, today])

  const sessions = useLiveQuery(async () => {
    if (!open) return []
    const rows = (
      await db.sessions.where("doctorId").equals(doctorId).toArray()
    )
      .filter(
        (s) =>
          s.date >= fromDate &&
          s.date <= until &&
          (s.status === "open" || s.status === "delayed")
      )
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
      )
    const out = []
    for (const s of rows) {
      const appts = (
        await db.appointments.where("sessionId").equals(s.id).toArray()
      ).filter((a) => ACTIVE.includes(a.status))
      const booked = appts.filter((a) => a.source !== "walk-in").length
      out.push({
        session: s,
        free: Math.max(0, s.capacity - s.walkInQuota - booked),
      })
    }
    return out
  }, [db, doctorId, fromDate, until, open])

  const onBook = async (sessionId: string) => {
    const out = await book.run({
      sessionId,
      patientId,
      source: "counter",
      visitType: "follow-up",
      smsLang: "bn",
    })
    if (out.ok) {
      const session = sessions?.find((s) => s.session.id === sessionId)?.session
      toast.success(
        t("prescribing.followUp.booked", {
          date: session ? dmy(session.date) : "",
          time: out.result.slotStart,
        })
      )
      setOpen(false)
    }
  }

  if (existing) {
    return (
      <StatusPill tone="success" data-testid="rx-follow-up-booked">
        <CalendarCheck />
        {t("prescribing.followUp.existing", {
          date: dmy(existing.date),
          time: existing.slotStart,
        })}
      </StatusPill>
    )
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="rx-book-follow-up"
      >
        <CalendarPlus />
        {t("prescribing.followUp.book")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("prescribing.followUp.title")}</DialogTitle>
            <DialogDescription>
              {t("prescribing.followUp.body", {
                doctor: doctorName,
                date: dmy(fromDate),
              })}
            </DialogDescription>
          </DialogHeader>
          {sessions?.length ? (
            <ul className="flex max-h-80 flex-col overflow-y-auto">
              {sessions.map(({ session, free }) => (
                <li
                  key={session.id}
                  className="flex items-center gap-3 border-b border-hairline py-2 last:border-0"
                  data-testid="follow-up-session"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.8125rem] font-semibold">
                      {dmy(session.date)}
                    </div>
                    <div
                      className="nums text-xs text-muted-foreground"
                      lang="en"
                    >
                      {session.start} - {session.end}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {free
                      ? t("prescribing.followUp.slots", { count: num(free) })
                      : t("prescribing.followUp.full")}
                  </span>
                  <Button
                    size="xs"
                    disabled={!free || book.pending}
                    onClick={() => onBook(session.id)}
                    data-testid="follow-up-book"
                  >
                    {t("prescribing.followUp.bookThis")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t("prescribing.followUp.none")}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
