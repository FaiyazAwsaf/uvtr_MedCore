import type { EventCatalog } from "@/core/events/types"

const c = (key: string) => `pharmacy.consumers.${key}`

/** Domain events emitted by this module (plan §3.4). */
export const pharmacyEvents: EventCatalog = {
  DispenseCompleted: {
    module: "pharmacy",
    labelKey: "pharmacy.events.dispenseCompleted",
    consumers: [c("stock"), c("billing"), c("patientApp"), c("audit")],
    severity: "success",
  },
  DispensePartial: {
    module: "pharmacy",
    labelKey: "pharmacy.events.dispensePartial",
    consumers: [c("stock"), c("billing"), c("patientApp"), c("audit")],
    severity: "warning",
  },
  BoughtElsewhereRecorded: {
    module: "pharmacy",
    labelKey: "pharmacy.events.boughtElsewhere",
    consumers: [c("billing"), c("patientApp"), c("audit")],
    severity: "info",
  },
  SubstitutionRequested: {
    module: "pharmacy",
    labelKey: "pharmacy.events.substitutionRequested",
    consumers: [c("doctorInbox"), c("pharmacyQueue"), c("audit")],
    severity: "warning",
  },
  MedicineSentToCashier: {
    module: "pharmacy",
    labelKey: "pharmacy.events.sentToCashier",
    consumers: [c("billing"), c("audit")],
    severity: "info",
  },
  CounterSaleCompleted: {
    module: "pharmacy",
    labelKey: "pharmacy.events.counterSale",
    consumers: [c("stock"), c("billing"), c("audit")],
    severity: "success",
  },
  ReturnQuarantined: {
    module: "pharmacy",
    labelKey: "pharmacy.events.returnQuarantined",
    consumers: [c("stock"), c("billing"), c("audit")],
    severity: "info",
  },
  ReturnAccepted: {
    module: "pharmacy",
    labelKey: "pharmacy.events.returnAccepted",
    consumers: [c("stock"), c("audit")],
    severity: "success",
  },
  ReturnDiscarded: {
    module: "pharmacy",
    labelKey: "pharmacy.events.returnDiscarded",
    consumers: [c("stock"), c("audit")],
    severity: "warning",
  },
  BalanceReadyNotified: {
    module: "pharmacy",
    labelKey: "pharmacy.events.balanceReady",
    consumers: [c("sms"), c("patientApp")],
    severity: "info",
  },
  BalanceExpired: {
    module: "pharmacy",
    labelKey: "pharmacy.events.balanceExpired",
    consumers: [c("pharmacyQueue"), c("patientApp")],
    severity: "info",
  },
}
