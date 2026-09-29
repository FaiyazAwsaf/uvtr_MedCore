import type { EventCatalog } from "@/core/events/types"

const C = {
  labWorklist: "lab.consumers.labWorklist",
  specimenIntake: "lab.consumers.specimenIntake",
  analyserBench: "lab.consumers.analyserBench",
  validation: "lab.consumers.validation",
  pathologist: "lab.consumers.pathologist",
  doctorInbox: "lab.consumers.doctorInbox",
  patientApp: "lab.consumers.patientApp",
  sms: "lab.consumers.sms",
  billing: "lab.consumers.billing",
  dutyDoctor: "lab.consumers.dutyDoctor",
  audit: "lab.consumers.audit",
} as const

/** Domain events emitted by this module (plan §3.4). */
export const labEvents: EventCatalog = {
  SpecimenCollected: {
    module: "lab",
    labelKey: "lab.events.SpecimenCollected",
    consumers: [C.specimenIntake, C.audit],
    severity: "info",
  },
  SpecimenReceived: {
    module: "lab",
    labelKey: "lab.events.SpecimenReceived",
    consumers: [C.analyserBench, C.audit],
    severity: "info",
  },
  SpecimenRejected: {
    module: "lab",
    labelKey: "lab.events.SpecimenRejected",
    consumers: [C.labWorklist, C.sms, C.patientApp, C.audit],
    severity: "warning",
  },
  RecollectionOrdered: {
    module: "lab",
    labelKey: "lab.events.RecollectionOrdered",
    consumers: [C.labWorklist, C.sms, C.patientApp],
    severity: "info",
  },
  ResultsReceived: {
    module: "lab",
    labelKey: "lab.events.ResultsReceived",
    consumers: [C.validation],
    severity: "info",
  },
  ResultsEnteredManually: {
    module: "lab",
    labelKey: "lab.events.ResultsEnteredManually",
    consumers: [C.validation, C.audit],
    severity: "info",
  },
  CriticalFlagged: {
    module: "lab",
    labelKey: "lab.events.CriticalFlagged",
    consumers: [C.validation, C.pathologist],
    severity: "critical",
  },
  TechnicallyValidated: {
    module: "lab",
    labelKey: "lab.events.TechnicallyValidated",
    consumers: [C.pathologist],
    severity: "success",
  },
  ReportSigned: {
    module: "lab",
    labelKey: "lab.events.ReportSigned",
    consumers: [C.audit],
    severity: "success",
  },
  ReportReleased: {
    module: "lab",
    labelKey: "lab.events.ReportReleased",
    consumers: [C.doctorInbox, C.patientApp, C.sms, C.audit],
    severity: "success",
  },
  ReportHeldForPayment: {
    module: "lab",
    labelKey: "lab.events.ReportHeldForPayment",
    consumers: [C.billing, C.audit],
    severity: "warning",
  },
  ReportCorrected: {
    module: "lab",
    labelKey: "lab.events.ReportCorrected",
    consumers: [C.doctorInbox, C.patientApp, C.sms, C.audit],
    severity: "warning",
  },
  CriticalCallLogged: {
    module: "lab",
    labelKey: "lab.events.CriticalCallLogged",
    consumers: [C.dutyDoctor, C.audit],
    severity: "critical",
  },
  CriticalAcknowledged: {
    module: "lab",
    labelKey: "lab.events.CriticalAcknowledged",
    consumers: [C.pathologist, C.audit],
    severity: "success",
  },
  CriticalEscalated: {
    module: "lab",
    labelKey: "lab.events.CriticalEscalated",
    consumers: [C.dutyDoctor, C.doctorInbox, C.audit],
    severity: "critical",
  },
  AddOnRequested: {
    module: "lab",
    labelKey: "lab.events.AddOnRequested",
    consumers: [C.labWorklist, C.audit],
    severity: "info",
  },
  AddOnApproved: {
    module: "lab",
    labelKey: "lab.events.AddOnApproved",
    consumers: [C.billing, C.doctorInbox, C.analyserBench, C.audit],
    severity: "success",
  },
  AddOnNewCollection: {
    module: "lab",
    labelKey: "lab.events.AddOnNewCollection",
    consumers: [C.labWorklist, C.billing, C.doctorInbox, C.audit],
    severity: "warning",
  },
}
