import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by this module (plan §3.4). */
export const imagingEvents: EventCatalog = {
  ImagingStudyCompleted: {
    module: "imaging",
    labelKey: "imaging.events.ImagingStudyCompleted",
    consumers: ["imaging.consumers.radiologist", "lab.consumers.audit"],
    severity: "info",
  },
  ImagingReportUploaded: {
    module: "imaging",
    labelKey: "imaging.events.ImagingReportUploaded",
    consumers: ["lab.consumers.audit"],
    severity: "info",
  },
  ImagingReportReleased: {
    module: "imaging",
    labelKey: "imaging.events.ImagingReportReleased",
    consumers: [
      "lab.consumers.doctorInbox",
      "lab.consumers.patientApp",
      "lab.consumers.sms",
      "lab.consumers.audit",
    ],
    severity: "success",
  },
}
