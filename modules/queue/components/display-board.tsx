"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { AnimatePresence, motion } from "motion/react"
import { MonitorX } from "lucide-react"

import { HospitalWordmark } from "@/components/shared/hospital-brand"
import { branches } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDbInfo } from "@/core/db/DbProvider"
import { getEdgeDb } from "@/core/db/database"
import type { QueueTokenRow } from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { dictionaries, lookup } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { SpecialtyIcon } from "@/modules/scheduling/components/specialty-icon"
import {
  loadSessionInfo,
  type SessionInfo,
} from "@/modules/scheduling/components/use-session-info"

import { boardSessions, boardView, compareRoomCodes } from "../board"

const WAITING_SHOWN = 6

/**
 * The queue display board (plan §9 `/display/[branchId]`): a full-screen TV
 * in the hospital's brand with, per room, the token now being served and the
 * next ones. Token numbers only, never names (plan §11). Updates live.
 */
export function DisplayBoard({ branchId }: { branchId: string }) {
  const { t, locale, time, date } = useLocale()
  const code = branchId.toUpperCase()
  const branch = branches.find((b) => b.code === code)
  const { db: windowDb, network } = useDbInfo()
  // The TV sits on the branch's own network: while the branch is cut off it
  // shows the branch server's queue, like the branch's staff windows do.
  const offline = !!branch && network.some((n) => n.branchId === branch.code && n.status !== "online")
  const db = offline && branch ? getEdgeDb(branch.code) : windowDb
  const nowMs = useNow(1000)
  const today = dhakaDate(nowMs || now())

  const data = useLiveQuery(async () => {
    if (!branch) return null
    const sessions = await db.sessions.where("[branchId+date]").equals([branch.code, today]).toArray()
    const sessionIds = new Set(sessions.map((s) => s.id))
    const tokens = (await db.queueTokens.where("branchId").equals(branch.code).toArray()).filter((t) =>
      sessionIds.has(t.sessionId)
    )
    const info = await loadSessionInfo(db, sessions)
    return { sessions, tokens, info }
  }, [db, branch, today])

  const rooms = React.useMemo(() => {
    if (!data) return []
    const bySession = new Map<string, QueueTokenRow[]>()
    for (const token of data.tokens) {
      bySession.set(token.sessionId, [...(bySession.get(token.sessionId) ?? []), token])
    }
    return boardSessions(data.sessions, bySession, nowMs || now())
      .map((session) => ({
        info: data.info.get(session.id)!,
        tokens: bySession.get(session.id) ?? [],
      }))
      .filter((room) => room.info)
      .sort((a, b) => compareRoomCodes(a.info.room?.code ?? "", b.info.room?.code ?? ""))
  }, [data, nowMs])

  const cols = rooms.length <= 1 ? 1 : rooms.length <= 4 ? 2 : rooms.length <= 6 ? 3 : 4
  const rows = Math.max(1, Math.ceil(rooms.length / cols))
  const other = locale === "bn" ? "en" : "bn"

  return (
    <div data-testid="display-board" data-branch={code} className="flex min-h-svh flex-col gap-[2vh] px-[2.5vw] py-[2.5vh]">
      <header className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <HospitalWordmark size={44} className="[&>span:last-child]:text-[clamp(1rem,2.4vh,1.75rem)]" />
          {branch ? (
            <span className="hidden truncate border-l border-hairline pl-4 text-[clamp(0.9rem,2.2vh,1.5rem)] text-muted-foreground sm:inline">
              {branch.name[locale]} ({branch.code}) · {t("queue.display.opd")}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className="inline-flex items-center gap-2 text-[clamp(0.75rem,1.6vh,1rem)] text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-success" />
            {t("queue.display.live")}
          </span>
          <div className="flex flex-col items-end">
            <span data-testid="display-clock" className="nums text-[clamp(1.5rem,5.5vh,4rem)] leading-none font-semibold">
              {nowMs ? time(nowMs) : ""}
            </span>
            <span className="text-[clamp(0.75rem,1.8vh,1.125rem)] text-muted-foreground">
              {nowMs ? date(nowMs, { weekday: "long", day: "numeric", month: "long" }) : ""}
            </span>
          </div>
        </div>
      </header>

      {!branch ? (
        <BoardMessage title={t("queue.display.unknownBranch", { branch: branchId })} />
      ) : !data ? (
        <div className="flex-1" />
      ) : rooms.length === 0 ? (
        <BoardMessage title={t("queue.display.noClinic")} />
      ) : (
        <main
          className="grid min-h-0 flex-1 gap-[1.4vw]"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {rooms.map(({ info, tokens }) => (
            <RoomCard key={info.session.id} info={info} tokens={tokens} cols={cols} rows={rows} />
          ))}
        </main>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-hairline pt-[1.4vh] text-[clamp(0.8rem,2vh,1.35rem)]">
        <span>{t("queue.display.footer")}</span>
        <span lang={other} className="text-muted-foreground">
          {lookup(dictionaries[other], "queue.display.footer")}
        </span>
      </footer>
    </div>
  )
}

function BoardMessage({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <span className="icon-well flex size-16 items-center justify-center text-muted-foreground">
        <MonitorX className="size-8" />
      </span>
      <p className="text-[clamp(1.25rem,3.5vh,2.5rem)] font-semibold text-muted-foreground">{title}</p>
    </div>
  )
}

function RoomCard({
  info,
  tokens,
  cols,
  rows,
}: {
  info: SessionInfo
  tokens: QueueTokenRow[]
  cols: number
  rows: number
}) {
  const { t, locale, num } = useLocale()
  const view = boardView(tokens)
  const serving = view.serving
  const flash = useFlashOnChange(serving?.id ?? null, 2400)
  const waiting = view.waiting.slice(0, WAITING_SHOWN)
  const more = view.waiting.length - waiting.length
  // Sizes follow the viewport and the grid, so a quarter screen and a TV both work.
  const big = `clamp(2.5rem, min(${(17 / rows).toFixed(2)}vh, ${(15 / cols).toFixed(2)}vw), 13rem)`
  const mid = `clamp(1.1rem, min(${(6.5 / rows).toFixed(2)}vh, ${(6 / cols).toFixed(2)}vw), 5rem)`
  const small = `clamp(0.8rem, min(${(3 / rows).toFixed(2)}vh, ${(2.6 / cols).toFixed(2)}vw), 2rem)`
  const roomCode = info.room?.code ?? ""

  return (
    <section
      data-testid="display-room"
      data-room={roomCode}
      data-session-id={info.session.id}
      className={cn(
        "surface-card flex min-h-0 min-w-0 flex-col justify-between gap-[1vh] overflow-hidden px-[1.6vw] py-[1.8vh]",
        flash && "ring-4 ring-primary/70"
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="truncate leading-tight font-bold" style={{ fontSize: mid }}>
          {info.room?.name[locale] ?? roomCode}
        </h2>
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground" style={{ fontSize: small }}>
          <SpecialtyIcon name={info.specialty?.icon} className="size-[1.2em] shrink-0 text-link" />
          <span className="truncate">{info.specialty?.name[locale]}</span>
        </span>
      </header>

      <div className={cn("flex min-h-0 flex-col items-center justify-center rounded-lg py-[0.5vh]", flash)}>
        <span className="text-muted-foreground uppercase" style={{ fontSize: small }}>
          {t("queue.display.nowServing")}
        </span>
        <div data-testid="display-now-serving" data-token={serving?.label ?? ""} className="flex items-center justify-center">
          <AnimatePresence mode="popLayout" initial={false}>
            {serving ? (
              <motion.span
                key={serving.id}
                lang="en"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.15 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                className="font-mono leading-none font-bold tracking-tight text-primary"
                style={{ fontSize: big }}
              >
                {serving.label}
              </motion.span>
            ) : (
              <motion.span
                key="none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="leading-tight font-semibold text-muted-foreground"
                style={{ fontSize: mid }}
              >
                {t("queue.display.pleaseWait")}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex flex-col gap-[0.8vh]">
        <div className="flex items-baseline gap-3">
          <span className="shrink-0 text-muted-foreground" style={{ fontSize: small }}>
            {t("queue.display.next")}
          </span>
          <div data-testid="display-next" className="flex min-w-0 flex-wrap items-baseline gap-x-[1vw]">
            {view.next.length ? (
              view.next.map((token) => (
                <span
                  key={token.id}
                  lang="en"
                  data-token={token.label}
                  className="font-mono leading-none font-semibold"
                  style={{ fontSize: mid }}
                >
                  {token.label}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground" style={{ fontSize: small }}>
                {t("queue.display.noneWaiting")}
              </span>
            )}
          </div>
        </div>
        {waiting.length ? (
          <div data-testid="display-waiting" className="flex min-w-0 flex-wrap items-center gap-[0.5vw]" style={{ fontSize: small }}>
            <span className="text-muted-foreground">{t("queue.display.waiting")}</span>
            {waiting.map((token) => (
              <span key={token.id} lang="en" data-token={token.label} className="rounded-full bg-surface-raised px-[0.6em] py-[0.1em] font-mono">
                {token.label}
              </span>
            ))}
            {more > 0 ? (
              <span className="text-muted-foreground">{t("queue.display.more", { count: num(more) })}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
