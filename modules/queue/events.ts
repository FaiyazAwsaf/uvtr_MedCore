import type { EventCatalog } from "@/core/events/types"

const QUEUE_CONSUMERS = [
  "queue.consumers.displayBoard",
  "queue.consumers.doctorWorklist",
  "queue.consumers.patientApp",
]

/** Domain events emitted by this module (plan §3.4). */
export const queueEvents: EventCatalog = {
  PatientCheckedIn: {
    module: "queue",
    labelKey: "queue.events.patientCheckedIn",
    consumers: QUEUE_CONSUMERS,
    severity: "success",
  },
  TokenIssued: {
    module: "queue",
    labelKey: "queue.events.tokenIssued",
    consumers: QUEUE_CONSUMERS,
    severity: "info",
  },
  TokenCalled: {
    module: "queue",
    labelKey: "queue.events.tokenCalled",
    consumers: QUEUE_CONSUMERS,
    severity: "info",
  },
  TokenSkipped: {
    module: "queue",
    labelKey: "queue.events.tokenSkipped",
    consumers: QUEUE_CONSUMERS,
    severity: "warning",
  },
  TokenRecalled: {
    module: "queue",
    labelKey: "queue.events.tokenRecalled",
    consumers: QUEUE_CONSUMERS,
    severity: "info",
  },
}
