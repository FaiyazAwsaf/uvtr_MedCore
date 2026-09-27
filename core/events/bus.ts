import type { BranchCode } from "@/config/brand.config"
import type { Refs } from "@/core/db/schema"

/**
 * Cross-window notices over BroadcastChannel (plan §3.6). Data sync itself is
 * Dexie liveQuery; the bus carries toasts, drawer flashes and control signals.
 * BroadcastChannel does not echo to the sender, so publish() also delivers to
 * this window's own listeners (with `local: true`).
 */

export type BusEvent = {
  seq: number
  type: string
  summaryKey: string
  params: Record<string, string | number>
  refs: Refs
  patientId?: string
}

export type BusMessage =
  | {
      kind: "commit"
      /** Database the commit landed in: central or an edge store */
      db: string
      commitId: string
      command: string
      branchId: BranchCode | null
      events: BusEvent[]
    }
  | { kind: "reset" }
  | { kind: "reload"; reason?: string }
  | { kind: "clock"; offsetMs: number }
  | { kind: "network"; branchId: BranchCode }

export type BusEnvelope = BusMessage & { local: boolean }

const CHANNEL_NAME = "mc-bus"
const listeners = new Set<(message: BusEnvelope) => void>()
let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined")
    return null
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<BusMessage>) => {
      const envelope = { ...event.data, local: false }
      listeners.forEach((listener) => listener(envelope))
    }
  }
  return channel
}

export function publish(message: BusMessage): void {
  getChannel()?.postMessage(message)
  const envelope = { ...message, local: true }
  listeners.forEach((listener) => listener(envelope))
}

export function subscribe(listener: (message: BusEnvelope) => void): () => void {
  getChannel()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
