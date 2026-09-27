import { z } from "zod"

import type { SweepJob } from "@/core/clock/types"
import { defineCommand } from "@/core/engine/defineCommand"

/** Simulated aggregator delay before a queued SMS reports delivered. */
const DELIVERY_DELAY_MS = 3_000

const markDelivered = defineCommand({
  name: "comms.markDelivered",
  roles: [],
  input: z.object({ ids: z.array(z.string()) }),
  async run(tx, input) {
    for (const id of input.ids) {
      const sms = await tx.get("sms", id)
      if (sms.status === "queued" || sms.status === "sent") {
        await tx.update("sms", id, { status: "delivered", deliveredAt: tx.now() })
      }
    }
  },
})

/** Time-driven jobs owned by this module (plan §3.8). */
export const commsJobs: SweepJob[] = [
  {
    id: "comms.deliverSms",
    async run(ctx) {
      // SMS delivery needs the internet: never on an offline edge store.
      if (ctx.db.kind === "edge") return
      const due = await ctx.db.sms
        .where("status")
        .equals("queued")
        .filter((sms) => ctx.now - sms.queuedAt >= DELIVERY_DELAY_MS)
        .toArray()
      if (due.length) await ctx.commitSystem(markDelivered, { ids: due.map((s) => s.id) })
    },
  },
]
