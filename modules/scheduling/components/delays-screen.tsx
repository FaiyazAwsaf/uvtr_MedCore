"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"
import {
  CalendarClock,
  CalendarSync,
  Clock3,
  Hourglass,
  MessageSquareText,
  Send,
  TimerReset,
  Undo2,
  X,
} from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusPill, StatusText, type Tone } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { branches } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type {
  AppointmentRow,
  BasketLineRow,
  PatientRow,
  SmsRow,
} from "@/core/db/schema"
import type { RuleViolation } from "@/core/engine/errors"
import { usePersona } from "@/core/session/persona"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import {
  useDeskCommand,
  useRuleText,
} from "@/modules/identity/components/desk-command"
import {
  DeskHeader,
  FormField,
  NativeSelect,
  PersonLine,
  RuleAlert,
} from "@/modules/identity/components/desk-ui"

import { applyDelayChoice, recordDelay } from "../commands"
import {
  allowedChoices,
  DELAY_MAX,
  DELAY_MIN,
  DELAY_PRESETS,
  DELAY_REASONS,
  delaySmsPlan,
  isAwaiting,
  isDelayReason,
  smsLangFrom,
  smsNumber,
  type DelayChoice,
} from "../delay"
import { isSessionOver } from "../slots"
import { loadSessionInfo, type SessionInfo } from "./use-session-info"

type DelayData = {
  sessions: SessionInfo[]
  appointments: AppointmentRow[]
  patients: Map<string, PatientRow>
  /** Each patient's last SMS, for the language they read */
  sms: Map<string, SmsRow[]>
  feeLines: Map<string, BasketLineRow>
  /** Where rebooked appointments went */
  rebooked: Map<string, AppointmentRow>
}

/** Today's sessions at a branch with their bookings (live across windows). */
function useDelayData(
  branch: string | null,
  today: string
): DelayData | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!branch) return null
    const rows = await db.sessions
      .where("[branchId+date]")
      .equals([branch, today])
      .toArray()
    const info = await loadSessionInfo(db, rows)
    const sessions = [...info.values()].sort(
      (a, b) =>
        a.session.start.localeCompare(b.session.start) ||
        (a.room?.code ?? "").localeCompare(b.room?.code ?? "", "en", {
          numeric: true,
        })
    )
    const appointments = await db.appointments
      .where("[branchId+date]")
      .equals([branch, today])
      .toArray()
    const patientIds = [...new Set(appointments.map((a) => a.patientId))]
    const patients = new Map<string, PatientRow>()
    for (const row of await db.patients.bulkGet(patientIds))
      if (row) patients.set(row.id, row)
    const sms = new Map<string, SmsRow[]>()
    for (const row of await db.sms
      .where("patientId")
      .anyOf(patientIds)
      .toArray()) {
      if (row.patientId)
        sms.set(row.patientId, [...(sms.get(row.patientId) ?? []), row])
    }
    const feeIds = appointments
      .map((a) => a.feeBasketLineId)
      .filter((id): id is string => !!id)
    const feeLines = new Map<string, BasketLineRow>()
    for (const row of await db.basketLines.bulkGet(feeIds))
      if (row) feeLines.set(row.id, row)
    const movedIds = appointments
      .map((a) => a.rebookedToId)
      .filter((id): id is string => !!id)
    const rebooked = new Map<string, AppointmentRow>()
    for (const row of await db.appointments.bulkGet(movedIds))
      if (row) rebooked.set(row.id, row)
    return { sessions, appointments, patients, sms, feeLines, rebooked }
  }, [db, branch, today])
}

function replaceParam(name: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value) url.searchParams.set(name, value)
  else url.searchParams.delete(name)
  window.history.replaceState(window.history.state, "", url.toString())
}

/**
 * Doctor delays (plan §9 `/reception/delays`, §10 S11): today's sessions at
 * this branch with their bookings. "Record delay" tells every booked patient
 * not yet seen at once (SMS in their own language, parts counted before
 * sending, and an app notice), then each patient's choice is applied here or
 * by the patient in the app: wait, rebook to the doctor's next session, or a
 * refund.
 */
export function DelaysScreen() {
  const params = useSearchParams()
  const persona = usePersona()
  const { t, locale, num, time } = useLocale()
  const branch = persona?.branchId ?? null
  const nowMs = useNow(30_000)
  const today = dhakaDate(nowMs || now())
  const data = useDelayData(branch, today)
  const [sessionId, setSessionId] = React.useState<string | null>(() =>
    params.get("session")
  )
  const [recording, setRecording] = React.useState(false)
  const launch = params.get("r")
  const [seenLaunch, setSeenLaunch] = React.useState<string | null>(null)
  if (launch && launch !== seenLaunch) {
    setSeenLaunch(launch)
    const wanted = params.get("session")
    if (wanted) setSessionId(wanted)
    setRecording(false)
  }

  React.useEffect(() => replaceParam("session", sessionId), [sessionId])
  React.useEffect(() => {
    if (seenLaunch) replaceParam("r", null)
  }, [seenLaunch])

  const bySession = React.useMemo(() => {
    const map = new Map<string, AppointmentRow[]>()
    for (const a of data?.appointments ?? []) {
      map.set(a.sessionId, [...(map.get(a.sessionId) ?? []), a])
    }
    return map
  }, [data])

  // Default: the first session still to come (or running) that has bookings.
  const selectedId = React.useMemo(() => {
    if (!data?.sessions.length) return null
    if (sessionId && data.sessions.some((s) => s.session.id === sessionId))
      return sessionId
    const ms = nowMs || now()
    const upcoming = data.sessions.filter(
      (s) =>
        s.session.status !== "blocked" &&
        !isSessionOver(s.session, ms) &&
        (bySession.get(s.session.id) ?? []).some(isAwaiting)
    )
    return (upcoming[0] ?? data.sessions[0]).session.id
  }, [data, sessionId, nowMs, bySession])

  const selected = data?.sessions.find((s) => s.session.id === selectedId)
  const branchInfo = branches.find((b) => b.code === branch)

  if (!branch) {
    return (
      <div className="surface-card mt-2">
        <EmptyState icon={Hourglass} title={t("scheduling.delays.noBranch")} />
      </div>
    )
  }

  return (
    <div className="@container/delays flex flex-col gap-4 py-2">
      <DeskHeader
        title={t("scheduling.delays.title")}
        subtitle={t("scheduling.delays.subtitle", {
          branch: branchInfo
            ? `${branchInfo.name[locale]} (${branch})`
            : branch,
        })}
      />

      {!data ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : !data.sessions.length ? (
        <div className="surface-card">
          <EmptyState
            icon={CalendarClock}
            title={t("scheduling.delays.noSessions")}
          />
        </div>
      ) : (
        <>
          <div
            role="tablist"
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          >
            {data.sessions.map(({ session, staff }) => {
              const bookings = (bySession.get(session.id) ?? []).filter(
                isAwaiting
              ).length
              const active = session.id === selectedId
              return (
                <button
                  key={session.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid="delay-session"
                  data-session-id={session.id}
                  data-status={session.status}
                  onClick={() => {
                    setSessionId(session.id)
                    setRecording(false)
                  }}
                  className={cn(
                    "flex shrink-0 flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                    active
                      ? "border-primary bg-primary-soft"
                      : "border-transparent bg-card hover:bg-surface-raised",
                    session.status === "blocked" && "opacity-50"
                  )}
                >
                  <span className="max-w-48 truncate text-[0.8125rem] font-medium">
                    {staff
                      ? locale === "bn"
                        ? staff.nameBn
                        : staff.nameEn
                      : ""}
                  </span>
                  <span className="nums flex items-center gap-1.5 text-xs text-muted-foreground">
                    {time(atDhaka(session.date, session.start))}
                    <span>·</span>
                    {t("scheduling.delays.waitingCount", {
                      count: num(bookings),
                    })}
                  </span>
                  {session.status === "delayed" ? (
                    <StatusText tone="warning" className="text-xs">
                      <Hourglass className="size-3" />
                      {t("scheduling.delays.late", {
                        minutes: num(session.delayMin),
                      })}
                    </StatusText>
                  ) : null}
                </button>
              )
            })}
          </div>

          {selected ? (
            <SessionDelayCard
              key={selected.session.id}
              info={selected}
              appointments={bySession.get(selected.session.id) ?? []}
              data={data}
              recording={recording}
              onRecording={setRecording}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * One session: its delay, the notice, and every booking's choice
 * ------------------------------------------------------------------ */

function SessionDelayCard({
  info,
  appointments,
  data,
  recording,
  onRecording,
}: {
  info: SessionInfo
  appointments: AppointmentRow[]
  data: DelayData
  recording: boolean
  onRecording: (open: boolean) => void
}) {
  const { t, tk, locale, num, time } = useLocale()
  const { session, staff, specialty, room } = info
  const flash = useFlashOnChange(`${session.status}:${session.delayMin}`)
  const delayed = session.status === "delayed"
  const waiting = appointments.filter(isAwaiting)
  const others = appointments.filter((a) => !isAwaiting(a) && a.delayChoice)
  const rows = [...waiting, ...others].sort((a, b) =>
    a.slotStart.localeCompare(b.slotStart)
  )
  const canRecord = session.status === "open" || session.status === "delayed"
  const reasonText = session.delayReason
    ? isDelayReason(session.delayReason)
      ? tk(`scheduling.delays.reasons.${session.delayReason}`)
      : session.delayReason
    : ""

  return (
    <section
      data-testid="delay-card"
      data-session-id={session.id}
      data-status={session.status}
      data-delay={session.delayMin}
      className="surface-card @container flex min-w-0 flex-col gap-4 p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[1.0625rem] font-semibold">
            {staff ? (locale === "bn" ? staff.nameBn : staff.nameEn) : ""}
          </h2>
          <p className="nums flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            {time(atDhaka(session.date, session.start))} -{" "}
            {time(atDhaka(session.date, session.end))}
            {specialty ? <span>· {specialty.name[locale]}</span> : null}
            {room ? <span>· {room.name[locale]}</span> : null}
          </p>
        </div>
        {canRecord && !recording ? (
          <Button data-testid="delay-record" onClick={() => onRecording(true)}>
            <TimerReset />
            {delayed
              ? t("scheduling.delays.update")
              : t("scheduling.delays.record")}
          </Button>
        ) : null}
      </header>

      {delayed ? (
        <div
          data-testid="delay-status"
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-3.5 py-2.5 text-[0.8125rem]",
            flash
          )}
        >
          <Hourglass className="size-4 shrink-0 text-warning" />
          <span className="font-semibold">
            {t("scheduling.delays.late", { minutes: num(session.delayMin) })}
          </span>
          {reasonText ? (
            <span className="text-foreground/85">· {reasonText}</span>
          ) : null}
          <span className="text-muted-foreground">
            ·{" "}
            {t("scheduling.delays.newStart", {
              time: time(
                atDhaka(session.date, session.start) + session.delayMin * 60_000
              ),
            })}
          </span>
        </div>
      ) : null}

      {recording ? (
        <DelayForm
          info={info}
          appointments={waiting}
          data={data}
          onDone={() => onRecording(false)}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-[0.9375rem] font-semibold">
          {t("scheduling.delays.bookings", { count: num(waiting.length) })}
        </h3>
        {rows.length ? (
          <ul
            data-testid="delay-bookings"
            className="flex flex-col divide-y divide-hairline"
          >
            {rows.map((appointment) => (
              <BookingRow
                key={appointment.id}
                appointment={appointment}
                patient={data.patients.get(appointment.patientId)}
                feeLine={
                  appointment.feeBasketLineId
                    ? data.feeLines.get(appointment.feeBasketLineId)
                    : undefined
                }
                movedTo={
                  appointment.rebookedToId
                    ? data.rebooked.get(appointment.rebookedToId)
                    : undefined
                }
                delayed={delayed}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            size="sm"
            icon={CalendarClock}
            title={t("scheduling.delays.noBookings")}
          />
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Record the delay: minutes, reason, and the SMS parts counter
 * ------------------------------------------------------------------ */

function DelayForm({
  info,
  appointments,
  data,
  onDone,
}: {
  info: SessionInfo
  appointments: AppointmentRow[]
  data: DelayData
  onDone: () => void
}) {
  const { t, tk, num } = useLocale()
  const { session, staff } = info
  const command = useDeskCommand(recordDelay)
  const [minutes, setMinutes] = React.useState(() =>
    String(
      session.status === "delayed" && session.delayMin ? session.delayMin : 45
    )
  )
  const [reason, setReason] = React.useState<string>(() =>
    session.delayReason
      ? isDelayReason(session.delayReason)
        ? session.delayReason
        : "other"
      : DELAY_REASONS[0]
  )
  const [reasonText, setReasonText] = React.useState(() =>
    session.delayReason && !isDelayReason(session.delayReason)
      ? session.delayReason
      : ""
  )
  const [rule, setRule] = React.useState<RuleViolation | null>(null)
  const id = React.useId()

  const value = Number(minutes)
  const minutesOk =
    Number.isInteger(value) && value >= DELAY_MIN && value <= DELAY_MAX
  const reasonOk = reason !== "other" || reasonText.trim().length >= 3
  const recipients = appointments.flatMap((a) => {
    const patient = data.patients.get(a.patientId)
    return patient && smsNumber(patient)
      ? [{ lang: smsLangFrom(data.sms.get(patient.id) ?? []) }]
      : []
  })
  const noSms = appointments.length - recipients.length
  const plan =
    staff && minutesOk ? delaySmsPlan(recipients, staff, value) : null

  const send = async () => {
    if (!minutesOk || !reasonOk) return
    setRule(null)
    const outcome = await command.run({
      sessionId: session.id,
      minutes: value,
      reason: reason as (typeof DELAY_REASONS)[number] | "other",
      reasonText: reason === "other" ? reasonText.trim() : undefined,
      expectedVersion: session.version,
    })
    if (outcome.ok) {
      toast.success(
        t("scheduling.delays.sent", {
          sms: num(outcome.result.smsCount),
          app: num(outcome.result.notified),
        })
      )
      onDone()
    } else if (outcome.rule) setRule(outcome.rule)
  }

  return (
    <div
      data-testid="delay-form"
      className="flex flex-col gap-4 rounded-md border border-[color-mix(in_oklch,var(--warning)_35%,transparent)] p-3.5"
    >
      {rule ? <RuleAlert rule={rule} /> : null}
      <div className="grid gap-4 @[40rem]:grid-cols-2">
        <FormField
          label={t("scheduling.delays.minutes")}
          htmlFor={`${id}-min`}
          error={
            minutes && !minutesOk
              ? t("scheduling.delays.minutesError", {
                  min: num(DELAY_MIN),
                  max: num(DELAY_MAX),
                })
              : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {DELAY_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                data-testid="delay-preset"
                data-minutes={preset}
                aria-pressed={value === preset}
                onClick={() => setMinutes(String(preset))}
                className={cn(
                  "nums h-9 rounded-full px-3.5 text-[0.8125rem] font-medium transition-colors",
                  value === preset
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-raised text-foreground/85 hover:text-foreground"
                )}
              >
                {num(preset)}
              </button>
            ))}
            <Input
              id={`${id}-min`}
              data-testid="delay-minutes"
              type="number"
              inputMode="numeric"
              min={DELAY_MIN}
              max={DELAY_MAX}
              value={minutes}
              aria-invalid={!!minutes && !minutesOk}
              onChange={(e) => setMinutes(e.target.value)}
              className="nums h-9 w-20"
            />
          </div>
        </FormField>
        <FormField
          label={t("scheduling.delays.reason")}
          htmlFor={`${id}-reason`}
        >
          <NativeSelect
            id={`${id}-reason`}
            data-testid="delay-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {DELAY_REASONS.map((r) => (
              <option key={r} value={r}>
                {tk(`scheduling.delays.reasons.${r}`)}
              </option>
            ))}
            <option value="other">
              {t("scheduling.delays.reasons.other")}
            </option>
          </NativeSelect>
          {reason === "other" ? (
            <Input
              data-testid="delay-reason-text"
              value={reasonText}
              placeholder={t("scheduling.delays.reasonPlaceholder")}
              aria-invalid={!reasonOk}
              onChange={(e) => setReasonText(e.target.value)}
            />
          ) : null}
        </FormField>
      </div>

      <div
        data-testid="delay-sms-parts"
        data-messages={plan?.messages ?? 0}
        data-total-parts={plan?.totalParts ?? 0}
        data-en-parts={plan?.en.parts ?? 0}
        data-bn-parts={plan?.bn.parts ?? 0}
        className="flex flex-col gap-2.5 rounded-md bg-surface-raised px-3.5 py-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold">
            <MessageSquareText className="size-4 text-link" />
            {t("scheduling.delays.smsTitle", {
              count: num(plan?.messages ?? 0),
            })}
          </p>
          <SimulatedBadge label={t("scheduling.delays.smsGateway")} />
        </div>
        {plan ? (
          <div className="grid gap-2 @[40rem]:grid-cols-2">
            {(["en", "bn"] as const).map((lang) => {
              const lane = plan[lang]
              return (
                <div
                  key={lang}
                  data-testid="delay-sms-lane"
                  data-lang={lang}
                  data-parts={lane.parts}
                  data-count={lane.count}
                  className="flex min-w-0 flex-col gap-1.5 rounded-md bg-card px-3 py-2.5"
                >
                  <p className="nums flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                    <span className="font-semibold">
                      {t(`scheduling.delays.lang.${lang}`)}
                    </span>
                    <span className="text-muted-foreground">
                      {t("scheduling.delays.laneCount", {
                        count: num(lane.count),
                        parts: num(lane.parts),
                        chars: num(lane.chars),
                      })}
                    </span>
                  </p>
                  <p
                    lang={lang}
                    className="text-[0.8125rem] leading-snug text-foreground/90"
                  >
                    {lane.text}
                  </p>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {lane.encoding === "GSM"
                      ? t("scheduling.delays.gsm")
                      : t("scheduling.delays.ucs2")}
                  </p>
                </div>
              )
            })}
          </div>
        ) : null}
        <p className="nums text-[0.8125rem]">
          {t("scheduling.delays.totalParts", {
            parts: num(plan?.totalParts ?? 0),
            messages: num(plan?.messages ?? 0),
          })}
          {noSms > 0 ? (
            <span className="text-muted-foreground">
              {" "}
              · {t("scheduling.delays.noSms", { count: num(noSms) })}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("scheduling.delays.smsSafe")}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="neutral" onClick={onDone} disabled={command.pending}>
          <X />
          {t("common.cancel")}
        </Button>
        <Button
          data-testid="delay-send"
          onClick={send}
          disabled={!minutesOk || !reasonOk || command.pending}
        >
          <Send />
          {command.pending ? t("common.saving") : t("scheduling.delays.send")}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * A booking and its choice
 * ------------------------------------------------------------------ */

const CHOICE_ICON: Record<DelayChoice, React.ReactNode> = {
  wait: <Hourglass />,
  rebook: <CalendarSync />,
  refund: <Undo2 />,
}

function BookingRow({
  appointment,
  patient,
  feeLine,
  movedTo,
  delayed,
}: {
  appointment: AppointmentRow
  patient: PatientRow | undefined
  feeLine: BasketLineRow | undefined
  movedTo: AppointmentRow | undefined
  delayed: boolean
}) {
  const { t, tk, digits, dmy, time } = useLocale()
  const command = useDeskCommand(applyDelayChoice)
  const ruleText = useRuleText()
  const flash = useFlashOnChange(appointment.version)
  const choices = allowedChoices(appointment, delayed)

  const apply = async (choice: DelayChoice) => {
    const outcome = await command.run({ appointmentId: appointment.id, choice })
    if (outcome.ok) {
      const result = outcome.result
      toast.success(
        choice === "rebook" && result.date && result.slotStart
          ? t("scheduling.delays.toast.rebook", {
              date: dmy(atDhaka(result.date, "12:00")),
              time: time(atDhaka(result.date, result.slotStart)),
            })
          : choice === "refund"
            ? result.feePaid
              ? t("scheduling.delays.toast.refundPaid")
              : t("scheduling.delays.toast.refund")
            : t("scheduling.delays.toast.wait")
      )
    } else if (outcome.rule) toast.error(ruleText(outcome.rule))
  }

  let state: { tone: Tone; text: string } | null = null
  if (appointment.status === "rebooked") {
    state = {
      tone: "info",
      text: movedTo
        ? t("scheduling.delays.state.rebookedTo", {
            date: dmy(atDhaka(movedTo.date, "12:00")),
            time: time(atDhaka(movedTo.date, movedTo.slotStart)),
          })
        : t("scheduling.delays.state.rebooked"),
    }
  } else if (
    appointment.status === "cancelled" &&
    appointment.delayChoice === "refund"
  ) {
    state = {
      tone: "destructive",
      text:
        feeLine?.status === "invoiced"
          ? t("scheduling.delays.state.refundCashier")
          : t("scheduling.delays.state.refundRemoved"),
    }
  } else if (appointment.delayChoice === "wait") {
    state = { tone: "success", text: t("scheduling.delays.state.waiting") }
  }

  return (
    <li
      data-testid="delay-booking"
      data-appointment-id={appointment.id}
      data-status={appointment.status}
      data-choice={appointment.delayChoice ?? ""}
      className={cn(
        "@container flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5",
        flash
      )}
    >
      <span className="nums w-12 shrink-0 font-mono text-sm font-semibold">
        {digits(appointment.slotStart)}
      </span>
      {patient ? (
        <PersonLine
          patient={patient}
          size={34}
          className="min-w-[12rem]"
          meta={<span>{tk(`scheduling.sources.${appointment.source}`)}</span>}
        />
      ) : (
        <span className="flex-1" />
      )}
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {state ? (
          <StatusText
            tone={state.tone}
            className="text-xs"
            data-testid="delay-choice-state"
          >
            {state.text}
          </StatusText>
        ) : (
          <StatusPill
            tone={appointment.status === "checked-in" ? "primary" : "info"}
          >
            {tk(`scheduling.status.${appointment.status}`)}
          </StatusPill>
        )}
        {choices.map((choice) =>
          choice === "wait" && appointment.delayChoice === "wait" ? null : (
            <Button
              key={choice}
              data-testid="delay-choice"
              data-appointment-id={appointment.id}
              data-choice={choice}
              size="sm"
              variant={
                choice === "refund"
                  ? "destructive-outline"
                  : choice === "rebook"
                    ? "outline"
                    : "neutral"
              }
              disabled={command.pending}
              onClick={() => apply(choice)}
            >
              {CHOICE_ICON[choice]}
              {t(`scheduling.delays.choice.${choice}`)}
            </Button>
          )
        )}
      </span>
    </li>
  )
}
