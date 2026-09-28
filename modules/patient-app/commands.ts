import { z } from "zod"

import { defineCommand } from "@/core/engine/defineCommand"

import { linkAllows } from "./lib/family"

/**
 * Mark a family member's notifications as read when the patient opens them in
 * the app. The acting patient (the persona's patient id) may only touch their
 * own notifications or those of a member they hold a granted link for
 * (HAZ-14); anything else is refused as FAMILY_ACCESS_DENIED.
 */
export const markNotificationsRead = defineCommand({
  name: "patientApp.markNotificationsRead",
  roles: ["patient"],
  input: z.object({
    patientId: z.string(),
    /** Only these notifications; every unread one of the member when absent */
    ids: z.array(z.string()).optional(),
  }),
  async run(tx, input) {
    const accountId = tx.actor.staffId
    if (input.patientId !== accountId) {
      const member = await tx.find("patients", input.patientId)
      const links = await tx.list("familyLinks", "ownerPatientId", accountId)
      if (
        !links.some((link) => linkAllows(link, accountId, member, tx.today()))
      ) {
        tx.reject("FAMILY_ACCESS_DENIED", { patientId: input.patientId })
      }
    }
    const wanted = input.ids ? new Set(input.ids) : null
    const unread = (
      await tx.list("notifications", "patientId", input.patientId)
    ).filter((n) => !n.read && (!wanted || wanted.has(n.id)))
    for (const notification of unread) {
      await tx.update("notifications", notification.id, { read: true })
    }
    return { count: unread.length }
  },
})
