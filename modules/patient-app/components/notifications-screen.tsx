"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  Bell,
  BellRing,
  CalendarCheck,
  ChevronRight,
  FileText,
  FlaskConical,
  Hourglass,
  Lock,
  Pill,
  ReceiptText,
} from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { atDhaka } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { NotificationRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { markNotificationsRead } from "../commands"
import { notificationHref, notificationTitleKey } from "../lib/notifications"
import { AppCard, AppLoading, ScreenTitle } from "./bits"
import { patientName, useMember } from "./data"
import { useAppCommand } from "./use-app-command"

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^\d{2}:\d{2}$/

/** Icon per notification kind (elements, so nothing is created during render). */
const KIND_ICON: Record<string, React.ReactNode> = {
  reportReady: <FileText className="size-5" />,
  reportUpdated: <FileText className="size-5" />,
  rxReady: <Pill className="size-5" />,
  appointmentBooked: <CalendarCheck className="size-5" />,
  tokenCalled: <BellRing className="size-5" />,
  paymentReceived: <ReceiptText className="size-5" />,
  sampleRecollection: <FlaskConical className="size-5" />,
  doctorDelayed: <Hourglass className="size-5" />,
}

/** Notifications of the member on screen, newest first (held ones stay hidden until released). */
export function useMemberNotifications(): NotificationRow[] | undefined {
  const db = useDb()
  const member = useMember()
  return useLiveQuery(
    async () =>
      (await db.notifications.where("patientId").equals(member.id).toArray())
        .filter((n) => !n.held)
        .sort((a, b) => b.at - a.at),
    [db, member.id]
  )
}

/** Title and one detail line of a notification, from its title key (never from push text). */
export function useNotificationText(): (n: NotificationRow) => {
  title: string
  detail: string
} {
  const { t, tk, locale, dmy, time, num } = useLocale()
  return React.useCallback(
    (n: NotificationRow) => {
      const key = notificationTitleKey(n)
      const kind = key ? key.split(".").at(-1)! : null
      const p = n.params ?? {}
      if (kind === "doctorDelayed") {
        // Scheduling writes { doctor, doctorBn, minutes }.
        return {
          title: tk(key!, {
            doctor: String(locale === "bn" && p.doctorBn ? p.doctorBn : (p.doctor ?? "")),
            minutes: typeof p.minutes === "number" ? num(p.minutes) : String(p.minutes ?? ""),
          }),
          detail: t("patientApp.delay.inboxDetail"),
        }
      }
      const title = key ? tk(key, n.params) : t("patientApp.push.generic")
      let detail = t("patientApp.inbox.detail.generic")
      if (kind === "paymentReceived") {
        detail =
          p.invoiceNo && p.receiptNo
            ? t("patientApp.inbox.detail.paymentReceived", {
                invoiceNo: p.invoiceNo,
                receiptNo: p.receiptNo,
              })
            : t("patientApp.inbox.detail.paymentPlain")
      } else if (
        kind === "appointmentBooked" &&
        p.doctor &&
        ISO_DAY.test(String(p.date)) &&
        HHMM.test(String(p.time))
      ) {
        // WS-A writes { doctor, doctorBn, date: YYYY-MM-DD, time: HH:MM, source }.
        detail = t("patientApp.inbox.detail.appointmentBookedWith", {
          doctor: String(locale === "bn" && p.doctorBn ? p.doctorBn : p.doctor),
          date: dmy(atDhaka(String(p.date), "12:00")),
          time: time(atDhaka(String(p.date), String(p.time))),
        })
      } else if (kind === "tokenCalled" && p.token && p.room) {
        // The queue writes { token, room }: the display label and the room code.
        detail = t("patientApp.inbox.detail.tokenCalledRoom", {
          token: p.token,
          room: p.room,
        })
      } else if (kind) {
        detail = tk(`patientApp.inbox.detail.${kind}`)
      }
      return { title, detail }
    },
    [t, tk, locale, dmy, time, num]
  )
}

/** One notification row linking to the screen it concerns. */
export function NotificationItem({
  notification,
  isNew,
}: {
  notification: NotificationRow
  isNew: boolean
}) {
  const { t } = useLocale()
  const text = useNotificationText()(notification)
  const key = notificationTitleKey(notification)
  const icon = (key && KIND_ICON[key.split(".").at(-1)!]) || (
    <Bell className="size-5" />
  )
  return (
    <Link
      href={notificationHref(notification)}
      data-testid="app-notification"
      data-notification-id={notification.id}
      data-kind={notification.kind}
      data-read={notification.read}
      className="flex items-start gap-3 rounded-2xl p-3 outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          isNew
            ? "bg-primary text-primary-foreground"
            : "bg-surface-raised text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className="min-w-0 text-[0.875rem] leading-snug font-semibold">
            {text.title}
          </span>
          {isNew ? (
            <span className="shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[0.625rem] font-semibold text-white">
              {t("patientApp.inbox.new")}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {text.detail}
        </span>
        <DateText
          value={notification.at}
          variant="relative"
          className="mt-1 block text-[0.6875rem] text-muted-foreground"
        />
      </span>
      <ChevronRight className="mt-2.5 size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

export function NotificationsScreen() {
  const { t, locale } = useLocale()
  const member = useMember()
  const rows = useMemberNotifications()
  const markRead = useAppCommand(markNotificationsRead)
  const run = markRead.run
  // What was unread when the screen opened stays marked "New" while it is open.
  const [fresh, setFresh] = React.useState<{
    memberId: string
    ids: Set<string>
  } | null>(null)

  React.useEffect(() => {
    if (!rows || (fresh && fresh.memberId === member.id)) return
    const unread = rows.filter((n) => !n.read).map((n) => n.id)
    const timer = window.setTimeout(() => {
      setFresh({ memberId: member.id, ids: new Set(unread) })
      if (unread.length) void run({ patientId: member.id, ids: unread })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [rows, fresh, member.id, run])

  const isNew = (n: NotificationRow) =>
    fresh?.memberId === member.id ? fresh.ids.has(n.id) : !n.read

  return (
    <>
      <ScreenTitle
        title={t("patientApp.inbox.title")}
        subtitle={t("patientApp.inbox.subtitle", {
          name: patientName(member, locale),
        })}
      />
      {!rows ? (
        <AppLoading />
      ) : rows.length ? (
        <AppCard className="flex flex-col p-1.5">
          {rows.map((n) => (
            <NotificationItem key={n.id} notification={n} isNew={isNew(n)} />
          ))}
        </AppCard>
      ) : (
        <AppCard className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-raised text-muted-foreground">
            <Bell className="size-5" />
          </span>
          <p className="text-[0.9375rem] font-semibold">
            {t("patientApp.inbox.empty")}
          </p>
          <p className="max-w-[30ch] text-[0.8125rem] text-muted-foreground">
            {t("patientApp.inbox.emptyHint")}
          </p>
        </AppCard>
      )}
      <p className="mt-4 flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        {t("patientApp.inbox.pushNote")}
      </p>
    </>
  )
}
