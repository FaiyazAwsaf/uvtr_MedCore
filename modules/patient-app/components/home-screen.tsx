"use client"

import * as React from "react"
import Link from "next/link"
import {
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  ChevronRight,
  FileText,
  FlaskConical,
  LogOut,
  Moon,
  PhoneCall,
  Pill,
  QrCode,
  ReceiptText,
  ShieldCheck,
  Sun,
  UsersRound,
  type LucideIcon,
} from "lucide-react"

import { StatusPill } from "@/components/shared/status"
import { useWindowTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { hospital } from "@/config/brand.config"
import { dhakaTime } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useLocale } from "@/lib/i18n/provider"
import { useReportDoc } from "@/modules/lab/components/report-document"

import { nextAppointment } from "../lib/appointments"
import { rxSummary } from "../lib/rx"
import { updateAppState } from "../state/app-state"
import { useMemberAppointments } from "./appointments-screen"
import { AppCard, DoctorAvatar, SectionLabel, Segmented } from "./bits"
import {
  firstName,
  patientName,
  useDoctorInfo,
  useFamily,
  useToday,
} from "./data"
import { useOpenFamilySheet } from "./family-switcher"
import {
  NotificationItem,
  useMemberNotifications,
} from "./notifications-screen"
import {
  RX_SUMMARY_TONE,
  useMemberPrescriptions,
  useRxLines,
} from "./prescriptions-screen"
import { reportTitle, useMemberReports } from "./reports-screen"
import {
  AppointmentStatus,
  CheckInButton,
  QueuePanel,
  useSession,
  WhenWhere,
} from "./visit-parts"

function Greeting() {
  const { t, locale } = useLocale()
  const { account, member } = useFamily()
  const openFamily = useOpenFamilySheet()
  const nowMs = useNow(60_000)
  const hour = Number(dhakaTime(nowMs).slice(0, 2))
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"
  const other = member.patient.id !== account.id
  return (
    <div className="pt-1 pb-1">
      <h1 className="text-[1.375rem] leading-tight font-semibold">
        {t(`patientApp.home.greeting.${part}`, {
          name: firstName(account, locale),
        })}
      </h1>
      {other ? (
        <button
          type="button"
          onClick={openFamily}
          data-testid="app-viewing-for"
          className="mt-2 flex min-h-9 items-center gap-2 rounded-full bg-primary-soft px-3 text-[0.8125rem] font-medium text-link"
        >
          <UsersRound className="size-4" />
          {t("patientApp.home.viewingFor", {
            name: patientName(member.patient, locale),
          })}
        </button>
      ) : null}
    </div>
  )
}

/** The soonest upcoming appointment with its live queue and check-in. */
function NextAppointmentCard() {
  const { t } = useLocale()
  const appointments = useMemberAppointments()
  const today = useToday()
  const doctorInfo = useDoctorInfo()
  const next = appointments ? nextAppointment(appointments, today) : undefined
  const session = useSession(next?.sessionId ?? "")
  const info = next ? doctorInfo(next.doctorId) : undefined

  if (!appointments) return <AppCard className="h-40 animate-pulse" />
  if (!next) {
    return (
      <AppCard
        data-testid="app-next-appointment"
        data-state="none"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-link">
            <CalendarPlus className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-semibold">
              {t("patientApp.home.noAppointment")}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("patientApp.home.noAppointmentHint")}
            </span>
          </span>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/app/doctors" />}
          size="lg"
          className="h-12 w-full rounded-full"
        >
          <CalendarPlus />
          {t("patientApp.home.bookDoctor")}
        </Button>
      </AppCard>
    )
  }
  return (
    <AppCard
      data-testid="app-next-appointment"
      data-appointment-id={next.id}
      data-status={next.status}
      className="border-2 border-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-link uppercase">
          <CalendarClock className="size-4" />
          {t("patientApp.home.nextAppointment")}
        </p>
        <AppointmentStatus status={next.status} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <DoctorAvatar staff={info?.staff} size={48} />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{info?.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {info?.specialtyName}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <WhenWhere appointment={next} session={session} />
      </div>
      {next.date === today ? (
        <>
          <QueuePanel appointment={next} session={session} />
          <CheckInButton appointment={next} session={session} />
        </>
      ) : null}
      <Link
        href={`/app/appointments?focus=${next.id}`}
        className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-full bg-surface-raised text-[0.8125rem] font-semibold"
      >
        <QrCode className="size-4" />
        {t("patientApp.home.openPass")}
      </Link>
    </AppCard>
  )
}

function Services() {
  const { t } = useLocale()
  const tiles: { href: string; label: string; icon: LucideIcon }[] = [
    {
      href: "/app/doctors",
      label: t("patientApp.home.quick.book"),
      icon: CalendarPlus,
    },
    {
      href: "/app/appointments",
      label: t("patientApp.home.quick.appointments"),
      icon: CalendarCheck,
    },
    {
      href: "/app/reports",
      label: t("patientApp.home.quick.reports"),
      icon: FileText,
    },
    {
      href: "/app/prescriptions",
      label: t("patientApp.home.quick.prescriptions"),
      icon: Pill,
    },
    {
      href: "/app/bills",
      label: t("patientApp.home.quick.bills"),
      icon: ReceiptText,
    },
    {
      href: "/app/notifications",
      label: t("patientApp.home.quick.notifications"),
      icon: Bell,
    },
  ]
  return (
    <>
      <SectionLabel>{t("patientApp.home.services")}</SectionLabel>
      <div className="grid grid-cols-3 gap-2.5">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className="surface-card flex min-h-24 flex-col items-center justify-center gap-2 rounded-[1.25rem] p-2 text-center text-xs leading-tight font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-link">
                <Icon className="size-5" />
              </span>
              {tile.label}
            </Link>
          )
        })}
      </div>
    </>
  )
}

function LatestReport() {
  const { t, dmy, num } = useLocale()
  const entries = useMemberReports()
  const latest = entries?.find((e) => e.kind === "lab")
  const doc = useReportDoc(
    latest?.kind === "lab" ? latest.group.current.id : null
  )
  if (!latest || latest.kind !== "lab") {
    return (
      <AppCard className="flex items-center gap-3 p-3.5 text-[0.8125rem] text-muted-foreground">
        <FileText className="size-5" />
        {entries ? t("patientApp.home.noReport") : null}
      </AppCard>
    )
  }
  const report = latest.group.current
  const outCount = doc ? doc.results.filter((r) => r.flag !== "N").length : 0
  return (
    <Link
      href={`/app/reports?focus=${report.id}`}
      data-testid="app-home-report"
      data-report-id={report.id}
      className="surface-card flex items-center gap-3 rounded-[1.25rem] p-3.5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-link">
        <FlaskConical className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">
          {t("patientApp.home.latestReport")}
        </span>
        <span
          className="block truncate text-[0.875rem] font-semibold"
          lang="en"
        >
          {reportTitle(doc) || report.reportNo}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t("patientApp.reports.released", { date: dmy(report.releasedAt!) })}
          {outCount
            ? ` · ${t("patientApp.reports.outOfRange", { count: num(outCount) })}`
            : ""}
        </span>
      </span>
      {report.reportVersion > 1 ? (
        <StatusPill tone="warning">
          {t("patientApp.reports.corrected")}
        </StatusPill>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

function LatestRx() {
  const { t, dmy } = useLocale()
  const rxs = useMemberPrescriptions()
  const rx = rxs?.find((r) => r.status === "signed") ?? rxs?.[0]
  const data = useRxLines(rx?.id ?? "")
  const doctorInfo = useDoctorInfo()
  const nowMs = useNow(60_000)
  if (!rx) {
    return (
      <AppCard className="flex items-center gap-3 p-3.5 text-[0.8125rem] text-muted-foreground">
        <Pill className="size-5" />
        {rxs ? t("patientApp.home.noRx") : null}
      </AppCard>
    )
  }
  const summary = data ? rxSummary(data.lines, nowMs) : null
  return (
    <Link
      href={`/app/prescriptions?focus=${rx.id}`}
      data-testid="app-home-rx"
      data-rx-id={rx.id}
      className="surface-card flex items-center gap-3 rounded-[1.25rem] p-3.5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-link">
        <Pill className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">
          {t("patientApp.home.latestRx")}
        </span>
        <span className="block truncate text-[0.875rem] font-semibold">
          {doctorInfo(rx.doctorId)?.name}
        </span>
        <span className="block text-xs text-muted-foreground">
          <span lang="en" className="font-mono">
            {rx.rxNo}
          </span>{" "}
          · {dmy(rx.signedAt!)}
        </span>
        {summary ? (
          <StatusPill tone={RX_SUMMARY_TONE[summary]} dot className="mt-1.5">
            {t(`patientApp.prescriptions.summary.${summary}`)}
          </StatusPill>
        ) : null}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

function NotificationsPreview() {
  const { t } = useLocale()
  const rows = useMemberNotifications()
  return (
    <>
      <SectionLabel
        action={
          <Link
            href="/app/notifications"
            className="text-[0.8125rem] font-medium text-link"
          >
            {t("common.seeAll")}
          </Link>
        }
      >
        {t("patientApp.home.notifications")}
      </SectionLabel>
      <AppCard className="flex flex-col p-1.5">
        {rows?.length ? (
          rows
            .slice(0, 3)
            .map((n) => (
              <NotificationItem key={n.id} notification={n} isNew={!n.read} />
            ))
        ) : (
          <p className="p-3 text-[0.8125rem] text-muted-foreground">
            {t("patientApp.home.noNotifications")}
          </p>
        )}
      </AppCard>
    </>
  )
}

function Account() {
  const { t, locale } = useLocale()
  const { account } = useFamily()
  const { theme, setTheme } = useWindowTheme()
  return (
    <>
      <SectionLabel>{t("patientApp.home.account")}</SectionLabel>
      <AppCard className="flex flex-col gap-3">
        <p className="text-[0.8125rem] text-muted-foreground">
          {t("patientApp.home.signedInAs", {
            name: patientName(account, locale),
          })}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.8125rem] font-medium">
            {t("patientApp.home.appearance")}
          </span>
          <Segmented
            label={t("patientApp.home.appearance")}
            value={theme}
            onChange={setTheme}
            className="w-44"
            options={[
              {
                value: "light",
                label: (
                  <span className="flex items-center gap-1.5">
                    <Sun className="size-4" />
                    {t("shell.theme.light")}
                  </span>
                ),
              },
              {
                value: "dark",
                label: (
                  <span className="flex items-center gap-1.5">
                    <Moon className="size-4" />
                    {t("shell.theme.dark")}
                  </span>
                ),
              },
            ]}
          />
        </div>
        <a
          href={`tel:${hospital.helpline.replace(/\D/g, "")}`}
          className="flex min-h-11 items-center gap-3 rounded-xl bg-surface-raised px-3 text-[0.8125rem] font-medium"
        >
          <PhoneCall className="size-4 text-link" />
          <span className="flex-1">{t("patientApp.home.callHelpline")}</span>
          <span lang="en" className="font-mono text-xs text-muted-foreground">
            {hospital.helpline}
          </span>
        </a>
        <details className="rounded-xl bg-surface-raised px-3 py-2.5 text-[0.8125rem]">
          <summary className="flex min-h-7 cursor-pointer list-none items-center gap-3 font-medium">
            <ShieldCheck className="size-4 text-link" />
            {t("patientApp.home.privacy")}
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {hospital.privacyNotice[locale]}
          </p>
        </details>
        <Button
          variant="destructive-outline"
          className="h-11 w-full rounded-full"
          data-testid="app-sign-out"
          onClick={() => updateAppState({ signedInAs: null, memberId: null })}
        >
          <LogOut />
          {t("patientApp.home.signOut")}
        </Button>
      </AppCard>
    </>
  )
}

export function HomeScreen() {
  const { t } = useLocale()
  return (
    <>
      <Greeting />
      <div className="mt-3">
        <NextAppointmentCard />
      </div>
      <Services />
      <SectionLabel>{t("patientApp.home.latest")}</SectionLabel>
      <div className="flex flex-col gap-2.5">
        <LatestReport />
        <LatestRx />
      </div>
      <NotificationsPreview />
      <Account />
    </>
  )
}
