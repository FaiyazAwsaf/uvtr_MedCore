import { z } from "zod"

import { notifyPatient } from "@/core/comms/sms"
import type { QueueTokenRow } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import type { Tx } from "@/core/engine/types"
import {
  appNotificationsAllowed,
  bookInTx,
  bookInput,
} from "@/modules/scheduling/commands"

import { interleavePositions } from "./interleave"

/**
 * Queue commands (plan §6 `queue.checkIn`, `queue.call/skip/recall`), shared
 * by the front desk (WS-A, owner), the doctor's worklist (WS-B) and the
 * patient app (WS-G). Starting and finishing the consultation (token
 * in-consult and done) belong to WS-B's consultation commands.
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

/** How the patient checked in: at the desk, by scanning the slip's QR, or in the app. */
export const CHECK_IN_METHODS = ["desk", "qr", "app"] as const
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number]

export type CheckInResult = { tokenId: string; label: string; position: number }

/** Check-in itself, reusable inside other commands (the walk-in flow). */
export async function checkInTx(
  tx: Tx,
  input: { appointmentId: string; method?: CheckInMethod }
): Promise<CheckInResult> {
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
  const method = input.method ?? (tx.actor.role === "patient" ? "app" : "desk")
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
  const room = await roomLabel(tx, session.roomId)
  tx.emit("PatientCheckedIn", {
    branchId: session.branchId,
    refs,
    params: { token: label, method },
  })
  tx.emit("TokenIssued", {
    branchId: session.branchId,
    refs,
    params: { token: label, room, kind },
  })
  const placed = await tx.get("queueTokens", token.id)
  return { tokenId: token.id, label, position: placed.position }
}

/** Check a booked patient in and issue a token (desk, simulated QR scan, or the app). */
export const checkIn = defineCommand({
  name: "queue.checkIn",
  roles: ["receptionist", "patient"],
  input: z.object({
    appointmentId: z.string(),
    /** Defaults to "app" for the patient role and "desk" otherwise */
    method: z.enum(CHECK_IN_METHODS).optional(),
    idempotencyKey: z.string().optional(),
  }),
  run: (tx, input) => checkInTx(tx, input),
})

/**
 * A walk-in in one step (plan §9 `/reception/queue`): book into today's
 * session with source walk-in (the session's walk-in quota) and issue the
 * token in the same commit, so there is never a walk-in without a token.
 */
export const walkIn = defineCommand({
  name: "queue.walkIn",
  roles: ["receptionist"],
  input: bookInput
    .pick({ sessionId: true, patientId: true, visitType: true, smsLang: true })
    .extend({ idempotencyKey: z.string().optional() }),
  async run(tx, input) {
    const booked = await bookInTx(tx, { ...input, source: "walk-in" })
    const token = await checkInTx(tx, {
      appointmentId: booked.appointmentId,
      method: "desk",
    })
    return { ...booked, ...token }
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
  const room = await roomLabel(tx, token.roomId)
  const refs = {
    patientId: token.patientId,
    appointmentId: token.appointmentId,
    sessionId: token.sessionId,
    tokenId: token.id,
  }
  tx.emit(event, {
    branchId: token.branchId,
    refs,
    params: { token: token.label, room },
  })
  return { tokenId: updated.id, status: updated.status, label: token.label, room, refs }
}

/**
 * Call a token to the room: the display board shows its number (never a name)
 * and the patient app gets a generic notification.
 */
export const callToken = defineCommand({
  name: "queue.call",
  roles: ["doctor", "receptionist"],
  input: tokenInput,
  async run(tx, input) {
    const moved = await moveToken(
      tx,
      input,
      ["waiting", "recalled", "skipped"],
      "called",
      "TokenCalled"
    )
    const patient = await tx.find("patients", moved.refs.patientId)
    if (patient && appNotificationsAllowed(patient)) {
      notifyPatient(tx, {
        patientId: patient.id,
        kind: "token-called",
        titleKey: "patientApp.notifications.tokenCalled",
        params: { token: moved.label, room: moved.room },
        refs: moved.refs,
      })
    }
    return { tokenId: moved.tokenId, status: moved.status }
  },
})

/** The called patient did not come in: skip the token (it can be recalled). */
export const skipToken = defineCommand({
  name: "queue.skip",
  roles: ["doctor", "receptionist"],
  input: tokenInput,
  async run(tx, input) {
    const moved = await moveToken(tx, input, ["called"], "skipped", "TokenSkipped")
    return { tokenId: moved.tokenId, status: moved.status }
  },
})

/** Bring a skipped token back into the queue. */
export const recallToken = defineCommand({
  name: "queue.recall",
  roles: ["doctor", "receptionist"],
  input: tokenInput,
  async run(tx, input) {
    const moved = await moveToken(tx, input, ["skipped"], "recalled", "TokenRecalled")
    return { tokenId: moved.tokenId, status: moved.status }
  },
})
