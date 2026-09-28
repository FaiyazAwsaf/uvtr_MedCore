"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { Footprints, MonitorPlay, QrCode as QrIcon, Search, X } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { SegmentedPills } from "@/components/motion/segmented"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { branches } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { AppointmentRow, PatientRow, QueueTokenRow } from "@/core/db/schema"
import { usePersona } from "@/core/session/persona"
import { nameKeyFor } from "@/core/search/fuzzy"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { DeskHeader } from "@/modules/identity/components/desk-ui"
import {
  loadSessionInfo,
  type SessionInfo,
} from "@/modules/scheduling/components/use-session-info"

import { boardView, isQueued, isServing, isSessionLive } from "../board"
import { ArrivalsList } from "./arrivals-list"
import { QrScanDialog } from "./qr-scan-dialog"
import { TokenList } from "./token-list"
import { WalkInDialog } from "./walk-in-dialog"

function replaceParam(name: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value) url.searchParams.set(name, value)
  else url.searchParams.delete(name)
  window.history.replaceState(window.history.state, "", url.toString())
}

type QueueData = {
  sessions: SessionInfo[]
  info: Map<string, SessionInfo>
  appointments: AppointmentRow[]
  tokens: QueueTokenRow[]
  patients: Map<string, PatientRow>
}

/** Today's front desk queue at this window's branch (live across windows). */
function useQueueData(branch: string | null, today: string): QueueData | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!branch) return null
    const sessions = await db.sessions.where("[branchId+date]").equals([branch, today]).toArray()
    const [info, appointments, branchTokens] = await Promise.all([
      loadSessionInfo(db, sessions),
      db.appointments.where("[branchId+date]").equals([branch, today]).toArray(),
      db.queueTokens.where("branchId").equals(branch).toArray(),
    ])
    const sessionIds = new Set(sessions.map((s) => s.id))
    const tokens = branchTokens.filter((t) => sessionIds.has(t.sessionId))
    const patientIds = [...new Set(appointments.map((a) => a.patientId))]
    const patients = new Map<string, PatientRow>()
    for (const row of await db.patients.bulkGet(patientIds)) if (row) patients.set(row.id, row)
    const ordered = [...info.values()].sort(
      (a, b) =>
        a.session.start.localeCompare(b.session.start) ||
        (a.room?.code ?? "").localeCompare(b.room?.code ?? "", "en", { numeric: true })
    )
    return { sessions: ordered, info, appointments, tokens, patients }
  }, [db, branch, today])
}

/**
 * Check-in and queue (plan §9 `/reception/queue`): today's sessions at this
 * branch, the booked patients still to arrive with desk check-in, QR check-in
 * (simulated scan), walk-ins in one flow, and each session's tokens in queue
 * order with call, skip and recall.
 */
export function QueueScreen() {
  const params = useSearchParams()
  const persona = usePersona()
  const { t, locale, num, time } = useLocale()
  const branch = persona?.branchId ?? null
  const nowMs = useNow(30_000)
  const today = dhakaDate(nowMs || now())
  const data = useQueueData(branch, today)
  const [sessionId, setSessionId] = React.useState<string | null>(() => params.get("session"))
  const [scope, setScope] = React.useState<"session" | "all">("session")
  const [filter, setFilter] = React.useState("")
  const [walkIn, setWalkIn] = React.useState<{ open: boolean; patientId: string | null }>(() => ({
    open: !!params.get("walkin"),
    patientId: params.get("walkin"),
  }))
  const [qrOpen, setQrOpen] = React.useState(false)
  const [highlight, setHighlight] = React.useState<string | null>(null)
  const activeChip = React.useRef<HTMLButtonElement>(null)

  const tokensBySession = React.useMemo(() => {
    const map = new Map<string, QueueTokenRow[]>()
    for (const token of data?.tokens ?? []) {
      map.set(token.sessionId, [...(map.get(token.sessionId) ?? []), token])
    }
    return map
  }, [data])

  // Default: the busiest session running now (most tokens), else the first of the day.
  const selectedId = React.useMemo(() => {
    if (!data?.sessions.length) return null
    if (sessionId && data.info.has(sessionId)) return sessionId
    const ms = nowMs || now()
    const live = data.sessions.filter(
      (s) => s.session.status !== "blocked" && isSessionLive(s.session, ms)
    )
    const pool = live.length ? live : data.sessions
    return [...pool].sort(
      (a, b) =>
        (tokensBySession.get(b.session.id)?.length ?? 0) -
        (tokensBySession.get(a.session.id)?.length ?? 0)
    )[0].session.id
  }, [data, sessionId, nowMs, tokensBySession])

  React.useEffect(() => replaceParam("session", sessionId), [sessionId])
  React.useEffect(() => {
    // Bring the chosen session's chip into view along the strip (never scroll the page).
    const chip = activeChip.current
    const strip = chip?.parentElement
    if (!chip || !strip) return
    const left = chip.offsetLeft - strip.offsetLeft
    if (left < strip.scrollLeft || left + chip.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - 8), behavior: "smooth" })
    }
  }, [selectedId])

  const selected = selectedId ? data?.info.get(selectedId) : undefined
  const selectedTokens = selectedId ? (tokensBySession.get(selectedId) ?? []) : []
  const view = boardView(selectedTokens)

  const arrivals = React.useMemo(() => {
    const keys = filter.trim().split(/\s+/).map(nameKeyFor).filter(Boolean)
    const digits = filter.replace(/\D/g, "")
    return (data?.appointments ?? [])
      .filter((a) => a.status === "booked")
      .filter((a) => scope === "all" || a.sessionId === selectedId)
      .filter((a) => {
        if (!filter.trim()) return true
        const p = data?.patients.get(a.patientId)
        if (!p) return false
        if (digits.length >= 3 && (p.uhid.includes(digits) || (p.phone ?? "").replace(/\D/g, "").includes(digits)))
          return true
        return keys.length > 0 && keys.every((k) => p.nameSearchKeys.some((s) => s.startsWith(k)))
      })
      .sort((a, b) => a.slotStart.localeCompare(b.slotStart))
  }, [data, scope, selectedId, filter])

  const stats = React.useMemo(() => {
    const tokens = data?.tokens ?? []
    return {
      toArrive: (data?.appointments ?? []).filter((a) => a.status === "booked").length,
      waiting: tokens.filter(isQueued).length,
      serving: tokens.filter(isServing).length,
      seen: tokens.filter((t) => t.status === "done").length,
    }
  }, [data])

  const branchInfo = branches.find((b) => b.code === branch)

  if (!branch) {
    return (
      <div className="surface-card mt-2">
        <EmptyState icon={MonitorPlay} title={t("queue.screen.noBranch")} />
      </div>
    )
  }

  const focusSession = (id: string, tokenId?: string) => {
    setSessionId(id)
    if (tokenId) setHighlight(tokenId)
  }

  return (
    <div className="@container/queue flex flex-col gap-4 py-2">
      <DeskHeader
        title={t("queue.screen.title")}
        subtitle={t("queue.screen.subtitle", {
          branch: branchInfo ? `${branchInfo.name[locale]} (${branch})` : branch,
        })}
        actions={
          <>
            <Button data-testid="queue-walkin-open" onClick={() => setWalkIn({ open: true, patientId: null })}>
              <Footprints />
              {t("queue.screen.walkIn")}
            </Button>
            <Button data-testid="queue-scan-open" variant="outline" onClick={() => setQrOpen(true)}>
              <QrIcon />
              {t("queue.screen.scanQr")}
            </Button>
            <Button
              variant="neutral"
              nativeButton={false}
              render={<a href={`/display/${branch}`} target="_blank" rel="noopener" />}
            >
              <MonitorPlay />
              {t("queue.screen.display")}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2" data-testid="queue-stats">
        {(
          [
            ["toArrive", stats.toArrive, "text-info"],
            ["waiting", stats.waiting, "text-link"],
            ["serving", stats.serving, "text-warning"],
            ["seen", stats.seen, "text-success"],
          ] as const
        ).map(([key, value, tone]) => (
          <span
            key={key}
            className="surface-card inline-flex items-baseline gap-2 rounded-full px-3.5 py-1.5 text-[0.8125rem]"
          >
            <span className={cn("nums text-base font-semibold", tone)}>{num(value)}</span>
            <span className="text-muted-foreground">{t(`queue.stats.${key}`)}</span>
          </span>
        ))}
      </div>

      {!data ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : !data.sessions.length ? (
        <div className="surface-card">
          <EmptyState icon={MonitorPlay} title={t("queue.screen.noSessions")} />
        </div>
      ) : (
        <>
          <div role="tablist" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {data.sessions.map(({ session, staff, room }) => {
              const tokens = tokensBySession.get(session.id) ?? []
              const queued = tokens.filter(isQueued).length
              const active = session.id === selectedId
              const live = isSessionLive(session, nowMs || now())
              return (
                <button
                  key={session.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid="queue-session"
                  data-session-id={session.id}
                  ref={active ? activeChip : undefined}
                  onClick={() => setSessionId(session.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                    active
                      ? "border-primary bg-primary-soft"
                      : "border-transparent bg-card hover:bg-surface-raised",
                    session.status === "blocked" && "opacity-50"
                  )}
                >
                  <span
                    lang="en"
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full font-mono text-sm font-semibold",
                      active ? "bg-primary text-primary-foreground" : "bg-surface-raised text-link"
                    )}
                  >
                    {session.tokenPrefix}
                  </span>
                  <span className="flex flex-col">
                    <span className="max-w-44 truncate text-[0.8125rem] font-medium">
                      {staff ? (locale === "bn" ? staff.nameBn : staff.nameEn) : ""}
                    </span>
                    <span className="nums text-xs text-muted-foreground">
                      {room ? room.name[locale] : ""} · {time(atDhaka(session.date, session.start))}
                      {live ? "" : ` · ${t("queue.screen.notNow")}`}
                    </span>
                  </span>
                  {queued ? (
                    <span className="count-badge nums flex h-5 min-w-5 items-center justify-center px-1.5 text-[0.6875rem] font-semibold">
                      {num(queued)}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          <div className="grid min-w-0 items-start gap-4 @[52rem]/queue:grid-cols-2">
            <section
              data-testid="queue-card"
              data-session-id={selectedId ?? undefined}
              className="surface-card @container flex min-w-0 flex-col gap-3 p-4"
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[0.9375rem] font-semibold">
                    {t("queue.tokens.title", { prefix: selected?.session.tokenPrefix ?? "" })}
                  </h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      selected?.staff ? (locale === "bn" ? selected.staff.nameBn : selected.staff.nameEn) : "",
                      selected?.specialty?.name[locale],
                      selected?.room?.name[locale],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <div className="flex flex-col">
                    <span className="text-[0.6875rem] text-muted-foreground">{t("queue.tokens.serving")}</span>
                    {view.serving ? (
                      <span data-testid="queue-serving" lang="en" className="font-mono text-xl font-bold text-link">
                        {view.serving.label}
                      </span>
                    ) : (
                      <span data-testid="queue-serving" className="text-sm text-muted-foreground">
                        {t("queue.tokens.none")}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[0.6875rem] text-muted-foreground">{t("queue.tokens.next")}</span>
                    <span lang="en" className="font-mono text-sm font-semibold">
                      {view.next.map((tk) => tk.label).join(", ") || t("queue.tokens.none")}
                    </span>
                  </div>
                </div>
              </header>
              <TokenList tokens={selectedTokens} patients={data.patients} highlightId={highlight} />
            </section>

            <section className="surface-card @container flex min-w-0 flex-col gap-3 p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[0.9375rem] font-semibold">
                  {t("queue.arrivals.title", { count: num(arrivals.length) })}
                </h2>
                <SegmentedPills
                  size="sm"
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: "session", label: t("queue.arrivals.thisSession") },
                    { value: "all", label: t("queue.arrivals.allSessions") },
                  ]}
                />
              </header>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-testid="arrivals-filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("queue.arrivals.filter")}
                  aria-label={t("queue.arrivals.filter")}
                  className="h-9 pr-9 pl-9"
                />
                {filter ? (
                  <button
                    type="button"
                    aria-label={t("common.clear")}
                    onClick={() => setFilter("")}
                    className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
              <ArrivalsList
                appointments={arrivals}
                patients={data.patients}
                sessions={data.info}
                nowMs={nowMs || now()}
                showDoctor={scope === "all"}
                onCheckedIn={(appointment, tokenId) => focusSession(appointment.sessionId, tokenId)}
              />
            </section>
          </div>

          <WalkInDialog
            open={walkIn.open}
            onOpenChange={(open) => {
              setWalkIn((current) => ({ ...current, open }))
              if (!open) replaceParam("walkin", null)
            }}
            sessions={data.sessions}
            appointments={data.appointments}
            nowMs={nowMs || now()}
            defaultSessionId={selectedId}
            initialPatientId={walkIn.patientId}
            onIssued={(issued) => focusSession(issued.sessionId, issued.tokenId)}
          />
          <QrScanDialog
            open={qrOpen}
            onOpenChange={setQrOpen}
            appointments={data.appointments}
            patients={data.patients}
            sessions={data.info}
            onCheckedIn={(scanned) => focusSession(scanned.sessionId, scanned.tokenId)}
          />
        </>
      )}
    </div>
  )
}
