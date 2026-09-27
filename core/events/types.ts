/** Display metadata for one domain event type (plan §3.4). */
export type EventDef = {
  /** Owning module, e.g. "prescribing" */
  module: string
  /** i18n key for the event label shown in the stream drawer */
  labelKey: string
  /** i18n keys of the consumers shown as "→ Pharmacy queue · Billing · Audit" */
  consumers: string[]
  severity?: "info" | "success" | "warning" | "critical"
}

/** Event type name (e.g. "PrescriptionSigned") to its display metadata. */
export type EventCatalog = Record<string, EventDef>
