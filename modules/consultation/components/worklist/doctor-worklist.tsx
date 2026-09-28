"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Inbox,
  Megaphone,
  Play,
  RotateCcw,
  SkipForward,
  Stethoscope,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/shared/empty-state"
import { KpiCard } from "@/components/shared/kpi-card"
import { PatientAvatar } from "@/components/shared/avatars"
import { ageOf, nameIn } from "@/components/shared/person"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText, type Tone } from "@/components/shared/status"
import { UhidText } from "@/components/shared/uhid-text"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { now } from "@/core/clock/clock"
import { dhakaDate, MINUTE } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type {
  AppointmentRow,
  PatientRow,
  QueueTokenRow,
  RoomRow,
  SessionRow,
  SpecialtyRow,
} from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { callToken, recallToken, skipToken } from "@/modules/queue/commands"

import { startConsultation } from "../../commands"
import { useDoctor } from "../data"
import { useClinicalCommand } from "../use-clinical-command"

/** KPI cards shrink to a compact 4-across row in a 960x600 window. */
const KPI_COMPACT =
  "min-h-[5.75rem] gap-2 p-4 @min-[66rem]/kpis:min-h-[8.25rem] @min-[66rem]/kpis:gap-4 @min-[66rem]/kpis:p-5"

const STATUS_TONE: Record<QueueTokenRow["status"], Tone> = {
  waiting: "info",
  called: "warning",
  recalled: "warning",
  skipped: "muted",
  "in-consult": "primary",
  done: "success",
}

type Row = {
  token: QueueTokenRow
  appointment?: AppointmentRow
  patient?: PatientRow
  encounterId?: string
  room?: RoomRow
}

type WorklistData = {
  sessions: SessionRow[]
  rows: Row[]
  notArrived: (AppointmentRow & { patient?: PatientRow })[]
  specialty?: SpecialtyRow
  rooms: Map<string, RoomRow>
  unread: number
}

/**
 * The doctor's worklist (plan §9 `/doctor`): today's queue in position order
 * with call, skip, recall and start, the KPI row, the results-inbox count and
 * the patients booked but not yet arrived. Updates live from every window.
 */
export function DoctorWorklist() {
  const { t, num, locale, digits } = useLocale()
  const db = useDb()
  const { doctor } = useDoctor()
  const tick = useNow(30_000)
  const nowMs = tick || now()
  const today = dhakaDate(nowMs)

  const data = useLiveQuery(async (): Promise<WorklistData | null> => {
    if (!doctor) return null
    const sessions = (
      await db.sessions
        .where("[doctorId+date]")
        .equals([doctor.id, today])
        .toArray()
    ).sort((a, b) => a.start.localeCompare(b.start))
    const sessionIds = sessions.map((s) => s.id)
    const [tokens, appointments, rooms, specialty, unread] = await Promise.all([
      sessionIds.length
        ? db.queueTokens.where("sessionId").anyOf(sessionIds).toArray()
        : [],
      sessionIds.length
        ? db.appointments.where("sessionId").anyOf(sessionIds).toArray()
        : [],
      db.rooms.bulkGet(sessions.map((s) => s.roomId)),
      db.specialties.get(doctor.specialtyId),
      db.inboxItems
        .where("[doctorId+status]")
        .equals([doctor.id, "unread"])
        .count(),
    ])
    const patientIds = [...new Set(appointments.map((a) => a.patientId))]
    const patients = new Map(
      (await db.patients.bulkGet(patientIds))
        .filter(Boolean)
        .map((p) => [p!.id, p!])
    )
    const appointmentIds = appointments.map((a) => a.id)
    const encounters = appointmentIds.length
      ? await db.encounters
          .where("appointmentId")
          .anyOf(appointmentIds)
          .toArray()
      : []
    const encounterOf = new Map(encounters.map((e) => [e.appointmentId!, e.id]))
    const byAppointment = new Map(appointments.map((a) => [a.id, a]))
    const roomMap = new Map(rooms.filter(Boolean).map((r) => [r!.id, r!]))
    const rows = tokens
      .map((token) => ({
        token,
        appointment: byAppointment.get(token.appointmentId),
        patient: patients.get(token.patientId),
        encounterId: encounterOf.get(token.appointmentId),
        room: roomMap.get(token.roomId),
      }))
      .sort(
        (a, b) =>
          Number(a.token.status === "done") -
            Number(b.token.status === "done") ||
          a.token.position - b.token.position
      )
    const notArrived = appointments
      .filter((a) => a.status === "booked")
      .sort((a, b) => a.slotStart.localeCompare(b.slotStart))
      .map((a) => ({ ...a, patient: patients.get(a.patientId) }))
    return { sessions, rows, notArrived, specialty, rooms: roomMap, unread }
  }, [db, doctor?.id, doctor?.specialtyId, today])

  if (doctor === null) {
    return (
      <EmptyState
        icon={Stethoscope}
        title={t("consultation.worklist.noDoctor")}
      />
    )
  }
  if (!data || !doctor) return <WorklistSkeleton />

  const tokens = data.rows.map((r) => r.token)
  const seen = tokens.filter((tk) => tk.status === "done").length
  const waiting = tokens.filter((tk) =>
    ["waiting", "called", "recalled"].includes(tk.status)
  ).length
  const waits = tokens
    .filter((tk) => tk.calledAt && tk.calledAt >= tk.issuedAt)
    .map((tk) => (tk.calledAt! - tk.issuedAt) / MINUTE)
  const avgWait = waits.length
    ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
    : null
  const session = data.sessions[0]
  const room = session ? data.rooms.get(session.roomId) : undefined

  return (
    <div className="flex flex-col gap-5" data-testid="doctor-worklist">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] leading-tight font-semibold">
            {t("consultation.worklist.title")}
          </h1>
          {session ? (
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              {t("consultation.worklist.sessionLine", {
                specialty: data.specialty?.name[locale] ?? "",
                start: digits(session.start),
                end: digits(session.end),
                room: digits(room?.code ?? ""),
              })}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/doctor/inbox" />}
          data-testid="worklist-inbox-link"
        >
          <Inbox />
          {t("consultation.worklist.inboxOpen")}
          {data.unread ? (
            <span className="count-badge nums ml-0.5 inline-flex h-5 min-w-5 items-center justify-center px-1.5 text-[0.6875rem] font-semibold">
              {num(data.unread)}
            </span>
          ) : null}
        </Button>
      </header>

      <div className="@container/kpis">
        <div className="grid grid-cols-2 gap-3 @min-[44rem]/kpis:grid-cols-4 @min-[66rem]/kpis:gap-5">
          <KpiCard
            className={KPI_COMPACT}
            variant="cyan"
            icon={CheckCircle2}
            title={t("consultation.worklist.kpi.seen")}
            value={<span data-testid="kpi-seen">{num(seen)}</span>}
            caption={t("consultation.worklist.kpi.seenCaption")}
          />
          <KpiCard
            className={KPI_COMPACT}
            variant="yellow"
            icon={Users}
            title={t("consultation.worklist.kpi.waiting")}
            value={<span data-testid="kpi-waiting">{num(waiting)}</span>}
            caption={t("consultation.worklist.kpi.waitingCaption")}
          />
          <KpiCard
            className={KPI_COMPACT}
            variant="pink"
            icon={Clock3}
            title={t("consultation.worklist.kpi.avgWait")}
            value={avgWait === null ? "-" : num(avgWait)}
            caption={t("consultation.worklist.kpi.avgWaitCaption")}
          />
          <KpiCard
            className={KPI_COMPACT}
            variant="purple"
            icon={Inbox}
            title={t("consultation.worklist.kpi.inbox")}
            value={<span data-testid="kpi-inbox">{num(data.unread)}</span>}
            caption={t("consultation.worklist.kpi.inboxCaption")}
            href="/doctor/inbox"
          />
        </div>
      </div>

      <div className="@container/wl">
        <div className="grid items-start gap-5 @min-[74rem]/wl:grid-cols-[minmax(0,1fr)_19rem]">
          <SectionCard
            title={t("consultation.nav.worklist")}
            icon={Stethoscope}
            size="sm"
            bodyClassName="-mx-1"
          >
            {!data.sessions.length ? (
              <EmptyState
                size="sm"
                icon={CalendarClock}
                title={t("consultation.worklist.noSession")}
                description={t("consultation.worklist.noSessionHint")}
              />
            ) : !data.rows.length ? (
              <EmptyState
                size="sm"
                icon={Users}
                title={t("consultation.worklist.empty")}
                description={t("consultation.worklist.emptyHint")}
              />
            ) : (
              <WorklistTable rows={data.rows} nowMs={nowMs} />
            )}
          </SectionCard>

          <NotArrived rows={data.notArrived} />
        </div>
      </div>
    </div>
  )
}

function WorklistTable({ rows, nowMs }: { rows: Row[]; nowMs: number }) {
  const { t } = useLocale()
  return (
    <div className="@container/table overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
        <thead className="[&_th]:bg-surface-raised [&_th:first-child]:rounded-l-md [&_th:last-child]:rounded-r-md">
          <tr>
            <th className="h-9 px-3 text-left font-medium">
              {t("consultation.worklist.columns.token")}
            </th>
            <th className="h-9 px-3 text-left font-medium">
              {t("consultation.worklist.columns.patient")}
            </th>
            <th className="hidden h-9 px-3 text-left font-medium @min-[40rem]/table:table-cell">
              {t("consultation.worklist.columns.visit")}
            </th>
            <th className="h-9 px-3 text-left font-medium">
              {t("consultation.worklist.columns.status")}
            </th>
            <th className="hidden h-9 px-3 text-left font-medium @min-[34rem]/table:table-cell">
              {t("consultation.worklist.columns.waiting")}
            </th>
            <th className="h-9 px-3 text-right font-medium">
              {t("consultation.worklist.columns.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <WorklistRow key={row.token.id} row={row} nowMs={nowMs} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WorklistRow({ row, nowMs }: { row: Row; nowMs: number }) {
  const { t, tk, num, time, locale } = useLocale()
  const router = useRouter()
  const { token, patient, appointment } = row
  const flash = useFlashOnChange(token.version)
  const call = useClinicalCommand(callToken)
  const skip = useClinicalCommand(skipToken)
  const recall = useClinicalCommand(recallToken)
  const start = useClinicalCommand(startConsultation)
  const busy = call.pending || skip.pending || recall.pending || start.pending
  const name = patient ? nameIn(patient, locale) : ""
  const age = patient ? ageOf(patient.dob, nowMs) : undefined

  const onCall = async () => {
    const out = await call.run({
      tokenId: token.id,
      expectedVersion: token.version,
    })
    if (out.ok)
      toast.success(
        t("consultation.worklist.called", {
          token: token.label,
          room: row.room?.code ?? "",
        })
      )
  }
  const onSkip = async () => {
    const out = await skip.run({
      tokenId: token.id,
      expectedVersion: token.version,
    })
    if (out.ok)
      toast(t("consultation.worklist.skipped", { token: token.label }))
  }
  const onRecall = async () => {
    const out = await recall.run({
      tokenId: token.id,
      expectedVersion: token.version,
    })
    if (out.ok)
      toast(t("consultation.worklist.recalled", { token: token.label }))
  }
  const onStart = async () => {
    const out = await start.run({ appointmentId: token.appointmentId })
    if (out.ok) {
      toast.success(t("consultation.worklist.started", { name }))
      router.push(`/doctor/encounter/${out.result.encounterId}`)
    }
  }
  const open = () =>
    row.encounterId && router.push(`/doctor/encounter/${row.encounterId}`)

  const waitingNow = ["waiting", "called", "recalled", "skipped"].includes(
    token.status
  )
  const waitText =
    token.status === "done"
      ? token.calledAt
        ? t("consultation.worklist.seenAt", { time: time(token.calledAt) })
        : "-"
      : token.status === "in-consult"
        ? t("consultation.worklist.nowServing")
        : waitingNow
          ? t("consultation.worklist.waitMin", {
              count: num(
                Math.max(0, Math.round((nowMs - token.issuedAt) / MINUTE))
              ),
            })
          : "-"

  return (
    <tr
      data-testid="worklist-row"
      data-token-id={token.id}
      data-appointment-id={token.appointmentId}
      data-patient-id={token.patientId}
      data-status={token.status}
      className={cn(
        "transition-colors hover:bg-primary-soft",
        token.status === "done" && "opacity-60",
        token.status === "in-consult" && "bg-primary-soft",
        flash
      )}
    >
      <td className="h-14 border-b border-hairline px-3">
        <span
          className="font-mono text-base font-semibold tracking-tight"
          lang="en"
        >
          {token.label}
        </span>
      </td>
      <td className="border-b border-hairline px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {patient ? <PatientAvatar patient={patient} size={34} /> : null}
          <div className="min-w-0">
            <div className="truncate font-medium">{name}</div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {age ? (
                <span className="nums">
                  {t(age.unit === "years" ? "common.years" : "common.months", {
                    count: num(age.value),
                  })}{" "}
                  · {patient ? t(`common.sexShort.${patient.sex}`) : ""}
                </span>
              ) : null}
              {patient ? (
                <UhidText uhid={patient.uhid} className="text-[0.6875rem]" />
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td className="hidden border-b border-hairline px-3 @min-[40rem]/table:table-cell">
        {appointment
          ? tk(`consultation.visitType.${appointment.visitType}`)
          : "-"}
      </td>
      <td className="border-b border-hairline px-3">
        <StatusText tone={STATUS_TONE[token.status]} dot>
          {tk(`consultation.tokenStatus.${token.status}`)}
        </StatusText>
      </td>
      <td className="nums hidden border-b border-hairline px-3 whitespace-nowrap text-muted-foreground @min-[34rem]/table:table-cell">
        {waitText}
      </td>
      <td className="border-b border-hairline px-3">
        <div className="flex items-center justify-end gap-1.5">
          {token.status === "waiting" || token.status === "recalled" ? (
            <Button
              size="xs"
              variant="neutral"
              onClick={onCall}
              disabled={busy}
              data-testid="worklist-call"
            >
              <Megaphone />
              {t("consultation.worklist.actions.call")}
            </Button>
          ) : null}
          {token.status === "called" ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={onSkip}
              disabled={busy}
              data-testid="worklist-skip"
            >
              <SkipForward />
              {t("consultation.worklist.actions.skip")}
            </Button>
          ) : null}
          {token.status === "skipped" ? (
            <Button
              size="xs"
              variant="neutral"
              onClick={onRecall}
              disabled={busy}
              data-testid="worklist-recall"
            >
              <RotateCcw />
              {t("consultation.worklist.actions.recall")}
            </Button>
          ) : null}
          {["waiting", "called", "recalled"].includes(token.status) ? (
            <Button
              size="xs"
              onClick={onStart}
              disabled={busy}
              data-testid="worklist-start"
            >
              <Play />
              {t("consultation.worklist.actions.start")}
            </Button>
          ) : null}
          {token.status === "in-consult" ? (
            <Button
              size="xs"
              onClick={row.encounterId ? open : onStart}
              disabled={busy}
              data-testid="worklist-open"
            >
              {t("consultation.worklist.actions.open")}
            </Button>
          ) : null}
          {token.status === "done" && row.encounterId ? (
            <Button
              size="xs"
              variant="link"
              onClick={open}
              data-testid="worklist-view"
            >
              {t("consultation.worklist.actions.view")}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function NotArrived({ rows }: { rows: WorklistData["notArrived"] }) {
  const { t, tk, num, locale } = useLocale()
  return (
    <SectionCard
      size="sm"
      icon={CalendarClock}
      title={t("consultation.worklist.notArrived", { count: num(rows.length) })}
    >
      {rows.length ? (
        <ul className="flex flex-col">
          {rows.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 border-b border-hairline py-2 last:border-0"
            >
              <span
                className="nums w-12 shrink-0 font-mono text-[0.8125rem] text-muted-foreground"
                lang="en"
              >
                {a.slotStart}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.8125rem] font-medium">
                  {a.patient ? nameIn(a.patient, locale) : ""}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {tk(`consultation.visitType.${a.visitType}`)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">-</p>
      )}
    </SectionCard>
  )
}

function WorklistSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  )
}
