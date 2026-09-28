import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by this module (plan §3.4). */
export const identityEvents: EventCatalog = {
  PatientRegistered: {
    module: "identity",
    labelKey: "identity.events.patientRegistered",
    consumers: ["identity.consumers.registry", "identity.consumers.audit"],
    severity: "success",
  },
  DuplicateWarningResolved: {
    module: "identity",
    labelKey: "identity.events.duplicateWarningResolved",
    consumers: ["identity.consumers.dataSteward", "identity.consumers.audit"],
    severity: "warning",
  },
}
