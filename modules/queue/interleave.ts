import { rules } from "@/config/rules.config"
import type { QueueTokenRow } from "@/core/db/schema"

/**
 * Queue order for tokens in issue order: 2 booked, then 1 walk-in
 * (PRD §10.2, `rules.walkInInterleave`). Returns a 1-based position for each
 * token. Shared by live check-in and the seed so both order queues alike.
 */
export function interleavePositions(kinds: QueueTokenRow["kind"][]): number[] {
  const booked: number[] = []
  const walkIn: number[] = []
  kinds.forEach((k, i) => (k === "booked" ? booked : walkIn).push(i))
  const order: number[] = []
  const { booked: nb, walkIn: nw } = rules.walkInInterleave
  while (booked.length || walkIn.length) {
    for (let i = 0; i < nb && booked.length; i++) order.push(booked.shift()!)
    for (let i = 0; i < nw && walkIn.length; i++) order.push(walkIn.shift()!)
  }
  const positions = new Array<number>(kinds.length)
  order.forEach((tokenIndex, pos) => (positions[tokenIndex] = pos + 1))
  return positions
}
