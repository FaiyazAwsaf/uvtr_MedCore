import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by this module (plan §3.4). */
export const consultationEvents: EventCatalog = {
  EncounterStarted: {
    module: "consultation",
    labelKey: "consultation.events.encounterStarted",
    consumers: [
      "consultation.consumers.ehr",
      "consultation.consumers.worklist",
      "consultation.consumers.audit",
    ],
    severity: "info",
  },
  EncounterReopened: {
    module: "consultation",
    labelKey: "consultation.events.encounterReopened",
    consumers: [
      "consultation.consumers.ehr",
      "consultation.consumers.worklist",
      "consultation.consumers.audit",
    ],
    severity: "warning",
  },
  VitalsRecorded: {
    module: "consultation",
    labelKey: "consultation.events.vitalsRecorded",
    consumers: ["consultation.consumers.ehr", "consultation.consumers.audit"],
    severity: "info",
  },
  ScribeDraftReady: {
    module: "consultation",
    labelKey: "consultation.events.scribeDraftReady",
    consumers: ["consultation.consumers.doctorReview", "consultation.consumers.audit"],
    severity: "info",
  },
  ScribeDraftAccepted: {
    module: "consultation",
    labelKey: "consultation.events.scribeDraftAccepted",
    consumers: ["consultation.consumers.ehr", "consultation.consumers.audit"],
    severity: "info",
  },
  NoteSigned: {
    module: "consultation",
    labelKey: "consultation.events.noteSigned",
    consumers: ["consultation.consumers.ehr", "consultation.consumers.audit"],
    severity: "success",
  },
  NoteAmended: {
    module: "consultation",
    labelKey: "consultation.events.noteAmended",
    consumers: ["consultation.consumers.ehr", "consultation.consumers.audit"],
    severity: "warning",
  },
  ConsultationFinished: {
    module: "consultation",
    labelKey: "consultation.events.consultationFinished",
    consumers: [
      "consultation.consumers.worklist",
      "consultation.consumers.displayBoard",
      "consultation.consumers.ehr",
      "consultation.consumers.audit",
    ],
    severity: "success",
  },
  InboxAcknowledged: {
    module: "consultation",
    labelKey: "consultation.events.inboxAcknowledged",
    consumers: ["consultation.consumers.doctorInbox", "consultation.consumers.audit"],
    severity: "info",
  },
}
