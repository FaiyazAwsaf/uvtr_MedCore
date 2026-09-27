import { z } from "zod"

import type { QueueTokenRow } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"

import { interleavePositions } from "./interleave"

/**
 * Queue commands (plan §6 `queue.checkIn`, `queue.call/skip/recall`). Written
 * ahead of Phase 2 as a shared contract: the front desk (WS-A) and the doctor's
 * worklist (WS-B) both use them. WS-A owns and may extend them. Starting and
 * finishing the consultation (token in-consult and done) belong to WS-B's
 * consultation commands.
 */

/** Re-number queue positions for a session: issue order, 2 booked then 1 walk-in. */
async function resequence(tx: Tx, sessionId: string): Promise<void> {
  const tokens = (await tx.list("queueTokens", "sessionId", sessionId)).sort(
    (a, b) => a.number - b.number
  )
  const positions = interleavePositions(tokens.map((t) => t.kind))
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].position !== positions[i]) {
      await tx.update("queueTokens", tokens[i].id, { position: positions[i] })
    }
  }
}

async function roomLabel(tx: Tx, roomId: string): Promise<string> {
  return (await tx.find("rooms", roomId))?.code ?? ""
}

/** Check a booked patient in and issue a token (desk, or QR self check-in in the app). */
export const checkIn = defineCommand({
  name: "queue.checkIn",
  roles: ["receptionist", "patient"],
  input: z.object({
    appointmentId: z.string(),
    idempotencyKey: z.string().optional(),
  }),
  async run(tx, input) {
    const appointment = await tx.get("appointments", input.appointmentId)
    if (appointment.status !== "booked") {
      tx.reject("NOT_CHECKABLE", { status: appointment.status })
    }
    if (appointment.date !== tx.today()) {
      tx.reject("NOT_TODAY", { date: appointment.date })
    }
    const session = await tx.get("sessions", appointment.sessionId)
    if (session.status === "blocked" || session.status === "closed") {
      tx.reject("SESSION_UNAVAILABLE", { status: session.status })
    }
    const existing = await tx.list("queueTokens", "sessionId", session.id)
    const number = existing.reduce((max, t) => Math.max(max, t.number), 0) + 1
    const label = `${session.tokenPrefix}-${number}`
    const kind: QueueTokenRow["kind"] = appointment.source === "walk-in" ? "walk-in" : "booked"
    const token = tx.insert("queueTokens", {
      sessionId: session.id,
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      branchId: session.branchId,
      roomId: session.roomId,
      number,
      label,
      kind,
      status: "waiting",
      issuedAt: tx.now(),
      position: number,
    })
    await resequence(tx, session.id)
    await tx.update("appointments", appointment.id, {
      status: "checked-in",
      checkedInAt: tx.now(),
      tokenId: token.id,
    })
    const refs = {
      patientId: appointment.patientId,
      appointmentId: appointment.id,
      sessionId: session.id,
      tokenId: token.id,
    }
    tx.emit("PatientCheckedIn", { branchId: session.branchId, refs, params: { token: label } })
    tx.emit("TokenIssued", {
      branchId: session.branchId,
      refs,
      params: { token: label, room: await roomLabel(tx, session.roomId) },
    })
    const placed = await tx.get("queueTokens", token.id)
    return { tokenId: token.id, label, position: placed.position }
  },
})

const tokenInput = z.object({
  tokenId: z.string(),
  expectedVersion: z.number().int().optional(),
})

async function moveToken(
  tx: Tx,
  input: z.output<typeof tokenInput>,
  from: QueueTokenRow["status"][],
  to: QueueTokenRow["status"],
  event: string
) {
  const token = await tx.get("queueTokens", input.tokenId, {
    expectedVersion: input.expectedVersion,
  })
  if (!from.includes(token.status)) {
    tx.reject("TOKEN_STATE", { token: token.label, status: token.status })
  }
  const updated = await tx.update("queueTokens", token.id, {
    status: to,
    calledAt: to === "called" ? tx.now() : token.calledAt,
  })
  tx.emit(event, {
    branchId: token.branchId,
    refs: {
      patientId: token.patientId,
      appointmentId: token.appointmentId,
      sessionId: token.sessionId,
      tokenId: token.id,
    },
    params: { token: token.label, room: await roomLabel(tx, token.roomId) },
  })
  return { tokenId: updated.id, status: updated.status }
}

/** Call a token to the room: the display board shows its number (never a name). */
export const callToken = defineCommand({
  name: "queue.call",
  roles: ["doctor", "receptionist"],
  input: tokenInput,
  run: (tx, input) =>
    moveToken(tx, input, ["waiting", "recalled", "skipped"], "called", "TokenCalled"),
})

/** The called patient did not come in: skip the token (it can be recalled). */
export const skipToken = defineCommand({
  name: "queue.skip",
  roles: ["doctor", "receptionist"],
  input: tokenInput,
  run: (tx, input) => moveToken(tx, input, ["called"], "skipped", "TokenSkipped"),
})

/** Bring a skipped token back into the queue. */
export const recallToken = defineCommand({
  name: "queue.recall",
  roles: ["doctor", "receptionist"],
  input: tokenInput,
  run: (tx, input) => moveToken(tx, input, ["skipped"], "recalled", "TokenRecalled"),
})
