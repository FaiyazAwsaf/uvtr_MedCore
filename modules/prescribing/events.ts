import type { EventCatalog } from "@/core/events/types"

const RX_CONSUMERS = [
  "prescribing.consumers.pharmacyQueue",
  "prescribing.consumers.billing",
  "prescribing.consumers.patientApp",
  "prescribing.consumers.audit",
]

/** Domain events emitted by this module (plan §3.4). */
export const prescribingEvents: EventCatalog = {
  PrescriptionSigned: {
    module: "prescribing",
    labelKey: "prescribing.events.prescriptionSigned",
    consumers: RX_CONSUMERS,
    severity: "success",
  },
  PrescriptionRevised: {
    module: "prescribing",
    labelKey: "prescribing.events.prescriptionRevised",
    consumers: RX_CONSUMERS,
    severity: "warning",
  },
  PrescriptionReplaced: {
    module: "prescribing",
    labelKey: "prescribing.events.prescriptionReplaced",
    consumers: RX_CONSUMERS,
    severity: "warning",
  },
  SubstitutionApproved: {
    module: "prescribing",
    labelKey: "prescribing.events.substitutionApproved",
    consumers: [
      "prescribing.consumers.pharmacyQueue",
      "prescribing.consumers.doctorInbox",
      "prescribing.consumers.audit",
    ],
    severity: "success",
  },
  SubstitutionRejected: {
    module: "prescribing",
    labelKey: "prescribing.events.substitutionRejected",
    consumers: [
      "prescribing.consumers.pharmacyQueue",
      "prescribing.consumers.doctorInbox",
      "prescribing.consumers.audit",
    ],
    severity: "warning",
  },
}
