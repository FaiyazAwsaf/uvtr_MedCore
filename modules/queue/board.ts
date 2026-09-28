import { atDhaka, HOUR } from "@/core/clock/dates"
import type { Ms, QueueTokenRow, SessionRow } from "@/core/db/schema"

/**
 * How a session's tokens read on the queue screens and the display board:
 * the token now being served, the next ones in queue order (the 2 booked :
 * 1 walk-in positions), and the rest still waiting. Shared by the front desk
 * queue, the TV board and anyone else who needs the same answer.
 */

type TokenLike = Pick<
  QueueTokenRow,
  "id" | "label" | "status" | "position" | "calledAt" | "number"
>

/** Waiting to be called (a recalled token is back in the queue at its position). */
export function isQueued(token: Pick<QueueTokenRow, "status">) {
  return token.status === "waiting" || token.status === "recalled"
}

/** Called to the room or in consultation: what the board shows as "now serving". */
export function isServing(token: Pick<QueueTokenRow, "status">) {
  return token.status === "called" || token.status === "in-consult"
}

/** Tokens in queue order (position, then issue number). */
export function byPosition<T extends Pick<QueueTokenRow, "position" | "number">>(
  tokens: T[]
): T[] {
  return [...tokens].sort((a, b) => a.position - b.position || a.number - b.number)
}

export type BoardView<T extends TokenLike> = {
  /** The most recently called token still with the doctor */
  serving?: T
  /** The next tokens to be called */
  next: T[]
  /** Everyone else still waiting, in order */
  waiting: T[]
  /** Skipped tokens (not shown on the TV) */
  skipped: T[]
  done: number
}

export function boardView<T extends TokenLike>(tokens: T[], nextCount = 2): BoardView<T> {
  const serving = tokens
    .filter(isServing)
    .sort((a, b) => (b.calledAt ?? 0) - (a.calledAt ?? 0))[0]
  const queued = byPosition(tokens.filter(isQueued))
  return {
    serving,
    next: queued.slice(0, nextCount),
    waiting: queued.slice(nextCount),
    skipped: byPosition(tokens.filter((t) => t.status === "skipped")),
    done: tokens.filter((t) => t.status === "done").length,
  }
}

/** A session is on the board from an hour before it starts until an hour after it ends. */
export function isSessionLive(
  session: Pick<SessionRow, "date" | "start" | "end">,
  nowMs: Ms
): boolean {
  return (
    nowMs >= atDhaka(session.date, session.start) - HOUR &&
    nowMs <= atDhaka(session.date, session.end) + HOUR
  )
}

/**
 * Sessions to show on a branch's board: live ones, or any with patients still
 * waiting or being served. One session per room (the live one wins).
 */
export function boardSessions<S extends Pick<
  SessionRow,
  "id" | "roomId" | "date" | "start" | "end" | "status"
>>(
  sessions: S[],
  tokensBySession: Map<string, Pick<QueueTokenRow, "status">[]>,
  nowMs: Ms
): S[] {
  const byRoom = new Map<string, S>()
  const score = (s: S) => {
    const tokens = tokensBySession.get(s.id) ?? []
    const active = tokens.some((t) => isQueued(t) || isServing(t))
    return (isSessionLive(s, nowMs) ? 2 : 0) + (active ? 1 : 0)
  }
  for (const session of sessions) {
    if (session.status === "blocked" || session.status === "closed") continue
    if (score(session) === 0) continue
    const current = byRoom.get(session.roomId)
    if (!current || score(session) > score(current)) byRoom.set(session.roomId, session)
  }
  return [...byRoom.values()]
}

/** Room codes sort as numbers where they are numbers ("2" before "10"). */
export function compareRoomCodes(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true })
}
