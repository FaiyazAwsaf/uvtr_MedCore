import type { Id, NotificationRow } from "@/core/db/schema"

/**
 * Patient-app notifications (plan §11: push carries no health data). Other
 * workstreams write rows with `titleKey: "patientApp.notifications.<kind>"`;
 * the push banner always reads "You have a new notification" and only the
 * screen inside the app shows the titled detail.
 */

/** Kinds with a title under `patientApp.notifications.*`. */
export const NOTIFICATION_KINDS = [
  "reportReady",
  "reportUpdated",
  "rxReady",
  "appointmentBooked",
  "tokenCalled",
  "paymentReceived",
  "sampleRecollection",
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

const PREFIX = "patientApp.notifications."

/** The i18n key for a notification's title, or null when it is not one of ours. */
export function notificationTitleKey(
  notification: Pick<NotificationRow, "titleKey" | "kind">
): string | null {
  const kind = notification.titleKey.startsWith(PREFIX)
    ? notification.titleKey.slice(PREFIX.length)
    : notification.kind
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind)
    ? `${PREFIX}${kind}`
    : null
}

/** The screen a notification opens, with the record to bring into view. */
export function notificationHref(
  notification: Pick<NotificationRow, "refs">
): string {
  const { refs } = notification
  if (refs.reportId) return `/app/reports?focus=${refs.reportId}`
  if (refs.imagingOrderId) return `/app/reports?focus=${refs.imagingOrderId}`
  if (refs.rxId) return `/app/prescriptions?focus=${refs.rxId}`
  if (refs.appointmentId) return `/app/appointments?focus=${refs.appointmentId}`
  if (refs.tokenId) return "/app/appointments"
  if (refs.invoiceId) return `/app/bills?focus=${refs.invoiceId}`
  if (refs.paymentId) return "/app/bills"
  return "/app/notifications"
}

/** Notifications that are not in `seen`, newest first (the push banner shows these). */
export function unseenNotifications(
  seen: ReadonlySet<Id>,
  current: NotificationRow[]
): NotificationRow[] {
  return current
    .filter((n) => !seen.has(n.id) && !n.held)
    .sort((a, b) => b.at - a.at)
}
