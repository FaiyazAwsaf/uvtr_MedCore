"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  Bell,
  CalendarCheck,
  CalendarPlus,
  FileText,
  House,
  ReceiptText,
  type LucideIcon,
} from "lucide-react"

import { HospitalLogo } from "@/components/shared/hospital-brand"
import { hospital } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type { Id, NotificationRow } from "@/core/db/schema"
import { LOCALE_META, LOCALES } from "@/lib/i18n/config"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { unseenNotifications } from "../lib/notifications"
import { useFamily } from "./data"
import { FamilySheetProvider, FamilySwitcher } from "./family-switcher"
import { PhoneBanner } from "./phone"

/** Compact EN / বাং switch for the app header (this window's language). */
function LangSwitch() {
  const { t, locale, setLocale } = useLocale()
  return (
    <div
      role="radiogroup"
      aria-label={t("patientApp.header.language")}
      className="flex h-9 shrink-0 items-center rounded-full bg-surface-raised p-0.5"
    >
      {LOCALES.map((code) => {
        const active = code === locale
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={active}
            lang={code}
            data-testid={`app-header-lang-${code}`}
            onClick={() => setLocale(code)}
            className={cn(
              "flex h-8 min-w-9 items-center justify-center rounded-full px-2 text-xs font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            )}
          >
            {LOCALE_META[code].short}
          </button>
        )
      })}
    </div>
  )
}

/** Notifications of every member this account may see, newest first. */
function useFamilyNotifications(): NotificationRow[] | undefined {
  const db = useDb()
  const { members } = useFamily()
  const key = members.map((m) => m.patient.id).join(",")
  return useLiveQuery(
    async () =>
      (
        await db.notifications
          .where("patientId")
          .anyOf(key.split(","))
          .toArray()
      ).sort((a, b) => b.at - a.at),
    [db, key]
  )
}

function NotificationBell() {
  const { t, num } = useLocale()
  const { member } = useFamily()
  const all = useFamilyNotifications()
  const unread = (all ?? []).filter(
    (n) => n.patientId === member.patient.id && !n.read && !n.held
  ).length
  return (
    <Link
      href="/app/notifications"
      data-testid="app-bell"
      aria-label={
        unread
          ? `${t("patientApp.header.notifications")}, ${t("patientApp.header.unread", { count: num(unread) })}`
          : t("patientApp.header.notifications")
      }
      className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-raised outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <Bell className="size-5" />
      {unread ? (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-destructive px-1 text-[0.625rem] font-semibold text-white">
          {num(unread)}
        </span>
      ) : null}
    </Link>
  )
}

/**
 * Push-style banner for notifications that arrive while the app is open, for
 * any member the account may see. It never carries health data: the text is
 * always "You have a new notification" (plan §11); the app shows the detail.
 */
function PushBanners() {
  const { t, locale } = useLocale()
  const router = useRouter()
  const { selectMember } = useFamily()
  const rows = useFamilyNotifications()
  const seen = React.useRef<Set<Id> | null>(null)
  const [banner, setBanner] = React.useState<NotificationRow | null>(null)

  React.useEffect(() => {
    if (!rows) return
    if (!seen.current) {
      seen.current = new Set(rows.map((n) => n.id))
      return
    }
    const fresh = unseenNotifications(seen.current, rows)
    for (const n of rows) seen.current.add(n.id)
    if (fresh.length) {
      const timer = window.setTimeout(() => setBanner(fresh[0]), 0)
      return () => window.clearTimeout(timer)
    }
  }, [rows])

  const close = React.useCallback(() => setBanner(null), [])

  return (
    <PhoneBanner
      key={banner?.id}
      open={!!banner}
      onClose={close}
      onOpen={() => {
        if (!banner) return
        selectMember(banner.patientId)
        router.push("/app/notifications")
      }}
      label={t("patientApp.push.open")}
      testId="app-push"
      icon={<HospitalLogo size={40} />}
      title={hospital.shortName[locale]}
      meta={t("patientApp.push.now")}
    >
      {t("patientApp.push.generic")}
    </PhoneBanner>
  )
}

type Tab = { href: string; label: string; icon: LucideIcon; match: string[] }

function TabBar() {
  const { t } = useLocale()
  const pathname = usePathname()
  const tabs: Tab[] = [
    {
      href: "/app",
      label: t("patientApp.tabs.home"),
      icon: House,
      match: ["/app"],
    },
    {
      href: "/app/doctors",
      label: t("patientApp.tabs.book"),
      icon: CalendarPlus,
      match: ["/app/doctors", "/app/book"],
    },
    {
      href: "/app/appointments",
      label: t("patientApp.tabs.visits"),
      icon: CalendarCheck,
      match: ["/app/appointments"],
    },
    {
      href: "/app/reports",
      label: t("patientApp.tabs.records"),
      icon: FileText,
      match: ["/app/reports", "/app/prescriptions"],
    },
    {
      href: "/app/bills",
      label: t("patientApp.tabs.bills"),
      icon: ReceiptText,
      match: ["/app/bills"],
    },
  ]
  return (
    <nav
      aria-label={t("patientApp.tabs.label")}
      className="sticky bottom-0 z-30 grid grid-cols-5 border-t border-hairline bg-background/95 px-1 pt-1.5 pb-2 backdrop-blur min-[30rem]:pb-5"
    >
      {tabs.map((tab) => {
        const active = tab.match.includes(pathname)
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-testid={`app-tab-${tab.href.split("/")[2] ?? "home"}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[0.6875rem] leading-none font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              active
                ? "text-link"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "flex h-8 w-12 items-center justify-center rounded-full transition-colors",
                active && "bg-primary-soft"
              )}
            >
              <Icon className="size-5" />
            </span>
            <span className="max-w-full truncate px-0.5">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

/** Scroll the phone screen back to the top when the screen changes. */
function useScrollTopOnNavigate(ref: React.RefObject<HTMLElement | null>) {
  const pathname = usePathname()
  React.useEffect(() => {
    ref.current?.closest('[data-slot="phone-screen"]')?.scrollTo({ top: 0 })
  }, [pathname, ref])
}

/** Header, content and tab bar around every signed-in screen. */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const { t } = useLocale()
  const ref = React.useRef<HTMLDivElement>(null)
  useScrollTopOnNavigate(ref)

  return (
    <FamilySheetProvider>
      <div ref={ref} className="flex flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-hairline bg-background/95 px-3 py-2 backdrop-blur">
          <Link
            href="/app"
            aria-label={t("patientApp.header.home")}
            className="shrink-0 rounded-[0.7rem] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <HospitalLogo size={34} />
          </Link>
          <FamilySwitcher />
          <LangSwitch />
          <NotificationBell />
        </header>
        <main className="flex flex-1 flex-col px-4 pt-3 pb-6">{children}</main>
        <TabBar />
        <PushBanners />
      </div>
    </FamilySheetProvider>
  )
}
