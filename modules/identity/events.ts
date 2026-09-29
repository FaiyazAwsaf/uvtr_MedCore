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
  PatientsMerged: {
    module: "identity",
    labelKey: "identity.events.patientsMerged",
    consumers: [
      "identity.consumers.registry",
      "identity.consumers.dataSteward",
      "identity.consumers.reception",
      "identity.consumers.audit",
    ],
    severity: "warning",
  },
  IdentityReviewResolved: {
    module: "identity",
    labelKey: "identity.events.identityReviewResolved",
    consumers: ["identity.consumers.dataSteward", "identity.consumers.audit"],
    severity: "info",
  },
  PatientContactUpdated: {
    module: "identity",
    labelKey: "identity.events.patientContactUpdated",
    consumers: [
      "identity.consumers.registry",
      "identity.consumers.patientApp",
      "identity.consumers.audit",
    ],
    severity: "info",
  },
}
