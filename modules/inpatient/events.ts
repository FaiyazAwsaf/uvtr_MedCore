import type { EventCatalog } from "@/core/events/types"

const c = {
  bedBoard: "inpatient.consumers.bedBoard",
  cashier: "inpatient.consumers.cashier",
  cashShift: "inpatient.consumers.cashShift",
  finance: "inpatient.consumers.finance",
  audit: "inpatient.consumers.audit",
} as const

/**
 * Domain events emitted by this module (plan §3.4): "Inpatient billing and
 * beds", administrative only. The bed board and the cashier's deposit desk
 * both follow stays live; cash deposits land in the cashier's shift.
 */
export const inpatientEvents: EventCatalog = {
  PatientAdmitted: {
    module: "inpatient",
    labelKey: "inpatient.events.patientAdmitted",
    consumers: [c.bedBoard, c.cashier, c.finance, c.audit],
    severity: "success",
  },
  BedTransferred: {
    module: "inpatient",
    labelKey: "inpatient.events.bedTransferred",
    consumers: [c.bedBoard, c.cashier, c.audit],
    severity: "info",
  },
  BedStatusChanged: {
    module: "inpatient",
    labelKey: "inpatient.events.bedStatusChanged",
    consumers: [c.bedBoard, c.audit],
    severity: "info",
  },
  DepositReceived: {
    module: "inpatient",
    labelKey: "inpatient.events.depositReceived",
    consumers: [c.cashier, c.cashShift, c.bedBoard, c.finance, c.audit],
    severity: "success",
  },
  DepositLow: {
    module: "inpatient",
    labelKey: "inpatient.events.depositLow",
    consumers: [c.cashier, c.bedBoard, c.finance],
    severity: "warning",
  },
  DepositAlertCleared: {
    module: "inpatient",
    labelKey: "inpatient.events.depositAlertCleared",
    consumers: [c.cashier, c.bedBoard, c.finance],
    severity: "success",
  },
  InterimBillIssued: {
    module: "inpatient",
    labelKey: "inpatient.events.interimBillIssued",
    consumers: [c.cashier, c.finance, c.audit],
    severity: "info",
  },
}
