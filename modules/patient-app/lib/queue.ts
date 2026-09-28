import type { Id, QueueTokenRow } from "@/core/db/schema"

/**
 * The live queue as the patient sees it: the token the display board is
 * serving and the patient's own place. Positions come from the 2:1
 * booked/walk-in interleave that `queue.checkIn` writes.
 */

/** Tokens still waiting for their turn (a recalled token is back in line). */
const IN_LINE: QueueTokenRow["status"][] = ["waiting", "recalled"]

export type NowServing = {
  token: QueueTokenRow
  /** "serving": called and not finished; "last-called": finished, nobody called since */
  state: "serving" | "last-called"
}

function latestCalled(tokens: QueueTokenRow[]): QueueTokenRow | undefined {
  return [...tokens]
    .filter((t) => t.calledAt !== undefined)
    .sort(
      (a, b) => (b.calledAt ?? 0) - (a.calledAt ?? 0) || b.position - a.position
    )[0]
}

/** The token on the display board for a session, or null before anyone is called. */
export function nowServing(tokens: QueueTokenRow[]): NowServing | null {
  const serving = latestCalled(
    tokens.filter((t) => t.status === "called" || t.status === "in-consult")
  )
  if (serving) return { token: serving, state: "serving" }
  const finished = latestCalled(tokens.filter((t) => t.status === "done"))
  return finished ? { token: finished, state: "last-called" } : null
}

/** How many tokens are still waiting in the session. */
export function waitingCount(tokens: QueueTokenRow[]): number {
  return tokens.filter((t) => IN_LINE.includes(t.status)).length
}

export type MyQueue =
  | { state: "waiting"; token: QueueTokenRow; ahead: number }
  | { state: "called"; token: QueueTokenRow }
  | { state: "skipped"; token: QueueTokenRow }
  | { state: "done"; token: QueueTokenRow }

/** The patient's own place in the queue, or null without a token. */
export function myQueue(
  tokens: QueueTokenRow[],
  tokenId: Id | undefined
): MyQueue | null {
  const token = tokenId ? tokens.find((t) => t.id === tokenId) : undefined
  if (!token) return null
  switch (token.status) {
    case "called":
    case "in-consult":
      return { state: "called", token }
    case "skipped":
      return { state: "skipped", token }
    case "done":
      return { state: "done", token }
    default: {
      const ahead = tokens.filter(
        (t) =>
          t.id !== token.id &&
          IN_LINE.includes(t.status) &&
          t.position < token.position
      ).length
      return { state: "waiting", token, ahead }
    }
  }
}
