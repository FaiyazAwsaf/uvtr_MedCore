"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"
import {
  CalendarPlus,
  Check,
  Crown,
  Footprints,
  Home,
  LogIn,
  ShieldCheck,
  X,
} from "lucide-react"

import { PatientAvatar } from "@/components/shared/avatars"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { KeyValueGrid, type KeyValueItem } from "@/components/shared/key-value"
import { nameIn } from "@/components/shared/person"
import { StatusPill, type Tone } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { branches } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { AppointmentRow, ConsentPurpose, PatientRow } from "@/core/db/schema"
import { usePersona } from "@/core/session/persona"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { checkIn } from "@/modules/queue/commands"
import {
  useSessionInfo,
  type SessionInfo,
} from "@/modules/scheduling/components/use-session-info"

import { idReasonFromNote } from "../registration"
import { useDeskCommand, useRuleText } from "./desk-command"

export const APPOINTMENT_TONE: Record<AppointmentRow["status"], Tone> = {
  booked: "info",
  "checked-in": "primary",
  "in-consult": "warning",
  done: "success",
  "no-show": "destructive",
  cancelled: "muted",
  rebooked: "muted",
}

const CONSENTS: ConsentPurpose[] = ["treatment", "sms", "app"]

/**
 * The picked patient at the front desk: the identity banner (photo, name,
 * age, sex, UHID, allergies) with quick actions, today's visits with
 * check-in, contact and ID details, consents, guardian and household.
 */
export function PatientPanel({
  patientId,
  onSelect,
  onClose,
}: {
  patientId: string
  onSelect: (patientId: string) => void
  onClose: () => void
}) {
  const db = useDb()
  const router = useRouter()
  const { t, tk, locale, dmy, digits } = useLocale()
  const persona = usePersona()
  const branch = persona?.branchId ?? null
  const nowMs = useNow(60_000)
  const today = dhakaDate(nowMs || now())

  const data = useLiveQuery(async () => {
    const patient = await db.patients.get(patientId)
    if (!patient) return null
    const [household, guardian, appointments] = await Promise.all([
      patient.householdId ? db.households.get(patient.householdId) : undefined,
      patient.guardianPatientId ? db.patients.get(patient.guardianPatientId) : undefined,
      db.appointments.where("patientId").equals(patientId).toArray(),
    ])
    const members = household
      ? (await db.patients.bulkGet(household.memberIds)).filter(
          (p): p is PatientRow => !!p && p.identityStatus !== "merged"
        )
      : []
    return { patient, household, guardian, appointments, members }
  }, [db, patientId])

  const visits = React.useMemo(() => {
    const all = data?.appointments ?? []
    const todays = all
      .filter((a) => a.date === today && a.status !== "cancelled" && a.status !== "rebooked")
      .sort((a, b) => a.slotStart.localeCompare(b.slotStart))
    const upcoming = all
      .filter((a) => a.date > today && a.status === "booked")
      .sort((a, b) => (a.date + a.slotStart).localeCompare(b.date + b.slotStart))
      .slice(0, 3)
    return { todays, upcoming }
  }, [data, today])

  const sessionInfo = useSessionInfo(
    [...visits.todays, ...visits.upcoming].map((a) => a.sessionId)
  )
  const tokens = useLiveQuery(
    async () => {
      const ids = visits.todays.map((a) => a.tokenId).filter((id): id is string => !!id)
      const rows = await db.queueTokens.bulkGet(ids)
      return new Map(rows.filter((r) => !!r).map((r) => [r!.id, r!]))
    },
    [db, visits.todays]
  )

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    )
  }
  if (data === null) return null

  const { patient, household, guardian, members } = data
  const isHead = household?.headPatientId === patient.id
  const relationText = patient.relationToHead
    ? isHead
      ? t("identity.desk.household.head")
      : t(`common.relation.${patient.relationToHead}`)
    : undefined
  const reason = idReasonFromNote(patient.registrationNote)
  const branchName = (code: string) => {
    const b = branches.find((x) => x.code === code)
    return b ? `${b.name[locale]} (${b.code})` : code
  }

  const ids: KeyValueItem[] = []
  if (patient.nid) ids.push({ label: t("identity.patient.nid"), value: patient.nid, mono: true })
  if (patient.brn) ids.push({ label: t("identity.patient.brn"), value: patient.brn, mono: true })
  if (patient.passport)
    ids.push({ label: t("identity.patient.passport"), value: patient.passport, mono: true })
  if (!ids.length) {
    ids.push({
      label: t("identity.patient.idDocument"),
      value: (
        <span className="text-warning">
          {reason ? t(`identity.idReasons.${reason}`) : t("identity.patient.noId")}
        </span>
      ),
    })
  }

  const details: KeyValueItem[] = [
    {
      label: t("identity.patient.phone"),
      value: patient.phone ? (
        <span className="nums inline-flex items-center gap-1.5">
          {digits(patient.phone)}
          {patient.phoneVerified ? (
            <ShieldCheck
              className="size-3.5 text-success"
              aria-label={t("identity.patient.verified")}
            />
          ) : null}
        </span>
      ) : (
        <span className="text-muted-foreground">{t("identity.patient.noPhone")}</span>
      ),
    },
    ...(patient.attendantPhone
      ? [
          {
            label: t("identity.patient.attendantPhone"),
            value: <span className="nums">{digits(patient.attendantPhone)}</span>,
          },
        ]
      : []),
    ...ids,
    {
      label: t("identity.patient.dob"),
      value: (
        <span className="nums">
          {dmy(patient.dob)}
          {patient.dobEstimated ? ` (${t("identity.patient.estimated")})` : ""}
        </span>
      ),
    },
    {
      label: t("identity.patient.registered"),
      value: `${branchName(patient.registeredAtBranch)}, ${dmy(patient.createdAt)}`,
    },
    ...(patient.address
      ? [{ label: t("identity.patient.address"), value: patient.address, wide: true }]
      : []),
  ]

  return (
    <div data-testid="patient-panel" data-patient-id={patient.id} className="flex min-w-0 flex-col gap-3">
      <IdentityBanner
        patient={patient}
        relation={relationText}
        actions={
          <>
            <Button
              data-testid="patient-book"
              nativeButton={false}
              render={<Link href={`/reception/book?patient=${patient.id}`} />}
              size="sm"
            >
              <CalendarPlus />
              {t("identity.patient.book")}
            </Button>
            <Button
              data-testid="patient-walkin"
              variant="outline"
              size="sm"
              onClick={() => router.push(`/reception/queue?walkin=${patient.id}`)}
            >
              <Footprints />
              {t("identity.patient.walkIn")}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("common.close")}
              onClick={onClose}
            >
              <X />
            </Button>
          </>
        }
      />

      <section className="surface-card @container flex flex-col gap-3 p-4">
        <h3 className="text-[0.9375rem] font-semibold">{t("identity.patient.todayTitle")}</h3>
        {visits.todays.length ? (
          <ul className="flex flex-col divide-y divide-hairline">
            {visits.todays.map((appointment) => (
              <VisitRow
                key={appointment.id}
                appointment={appointment}
                info={sessionInfo?.get(appointment.sessionId)}
                tokenLabel={
                  appointment.tokenId ? tokens?.get(appointment.tokenId)?.label : undefined
                }
                canCheckIn={appointment.status === "booked" && appointment.branchId === branch}
              />
            ))}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("identity.patient.noVisitToday")}
          </p>
        )}
        {visits.upcoming.length ? (
          <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
            <p className="text-xs text-muted-foreground">{t("identity.patient.upcoming")}</p>
            {visits.upcoming.map((appointment) => {
              const info = sessionInfo?.get(appointment.sessionId)
              return (
                <p key={appointment.id} className="nums text-[0.8125rem]">
                  {dmy(appointment.date)} · {digits(appointment.slotStart)} ·{" "}
                  {info?.staff ? (locale === "bn" ? info.staff.nameBn : info.staff.nameEn) : ""}
                </p>
              )
            })}
          </div>
        ) : null}
      </section>

      <section className="surface-card flex flex-col gap-4 p-4">
        <KeyValueGrid items={details} columns={3} />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">
            {t("identity.patient.consents")}
          </span>
          {CONSENTS.map((purpose) => {
            const consent = patient.consents.find((c) => c.purpose === purpose)
            const granted = consent?.granted === true
            return (
              <StatusPill key={purpose} tone={granted ? "success" : "muted"}>
                {granted ? <Check /> : <X />}
                {tk(`identity.consent.${purpose}`)}
              </StatusPill>
            )
          })}
          {patient.consents.some((c) => c.byPatientId) && guardian ? (
            <span className="text-xs text-muted-foreground">
              {t("identity.patient.consentBy", { name: nameIn(guardian, locale) })}
            </span>
          ) : null}
        </div>
        {guardian ? (
          <p className="text-[0.8125rem]">
            <span className="text-muted-foreground">{t("identity.patient.guardian")}: </span>
            <button
              type="button"
              className="font-medium text-link underline-offset-4 hover:underline"
              onClick={() => onSelect(guardian.id)}
            >
              {nameIn(guardian, locale)}
            </button>
            {patient.guardianRelation ? (
              <span className="text-muted-foreground">
                {" "}
                ({t(`common.relation.${patient.guardianRelation}`)})
              </span>
            ) : null}
          </p>
        ) : null}
      </section>

      {household && members.length > 1 ? (
        <section className="surface-card flex flex-col gap-3 p-4">
          <h3 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
            <Home className="size-4 text-link" />
            {t("identity.desk.household.title")}
            <span className="nums text-xs font-normal text-muted-foreground">
              {digits(household.phone)}
            </span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => onSelect(member.id)}
                aria-current={member.id === patient.id}
                className={cn(
                  "flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-left text-[0.8125rem] transition-colors",
                  member.id === patient.id
                    ? "bg-primary-soft text-link"
                    : "bg-surface-raised hover:bg-[color-mix(in_oklch,var(--surface-raised),var(--foreground)_7%)]"
                )}
              >
                <PatientAvatar patient={member} size={26} />
                <span className="font-medium">{nameIn(member, locale)}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {member.id === household.headPatientId ? (
                    <Crown className="size-3 text-warning" />
                  ) : null}
                  {member.relationToHead
                    ? member.id === household.headPatientId
                      ? t("identity.desk.household.head")
                      : t(`common.relation.${member.relationToHead}`)
                    : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function VisitRow({
  appointment,
  info,
  tokenLabel,
  canCheckIn,
}: {
  appointment: AppointmentRow
  info: SessionInfo | undefined
  tokenLabel?: string
  canCheckIn: boolean
}) {
  const { t, tk, locale, digits } = useLocale()
  const ruleText = useRuleText()
  const command = useDeskCommand(checkIn)
  const flash = useFlashOnChange(appointment.version)
  const doctor = info?.staff ? (locale === "bn" ? info.staff.nameBn : info.staff.nameEn) : ""
  const room = info?.room ? info.room.name[locale] : ""

  const onCheckIn = async () => {
    const outcome = await command.run({ appointmentId: appointment.id, method: "desk" })
    if (outcome.ok) {
      toast.success(t("queue.toast.checkedIn", { token: outcome.result.label }))
    } else if (outcome.rule) {
      toast.error(ruleText(outcome.rule))
    }
  }

  return (
    <li
      data-testid="checkin-row"
      data-appointment-id={appointment.id}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5", flash)}
    >
      <span className="nums w-14 shrink-0 font-mono text-sm font-semibold">
        {digits(appointment.slotStart)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.8125rem] font-medium">{doctor}</span>
        <span className="truncate text-xs text-muted-foreground">
          {[info?.specialty?.name[locale], room].filter(Boolean).join(" · ")}
        </span>
      </span>
      {tokenLabel ? (
        <span
          lang="en"
          className="rounded-md bg-primary-soft px-2 py-0.5 font-mono text-sm font-semibold text-link"
        >
          {tokenLabel}
        </span>
      ) : null}
      <StatusPill tone={APPOINTMENT_TONE[appointment.status]}>
        {tk(`scheduling.status.${appointment.status}`)}
      </StatusPill>
      {canCheckIn ? (
        <Button
          data-testid="checkin-button"
          size="sm"
          disabled={command.pending}
          onClick={onCheckIn}
        >
          <LogIn />
          {t("queue.actions.checkIn")}
        </Button>
      ) : null}
    </li>
  )
}
