import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by this module (plan §3.4). */
export const schedulingEvents: EventCatalog = {
  AppointmentBooked: {
    module: "scheduling",
    labelKey: "scheduling.events.appointmentBooked",
    consumers: [
      "scheduling.consumers.reception",
      "scheduling.consumers.doctorWorklist",
      "scheduling.consumers.patientApp",
      "scheduling.consumers.sms",
    ],
    severity: "success",
  },
  SessionDelayed: {
    module: "scheduling",
    labelKey: "scheduling.events.sessionDelayed",
    consumers: [
      "scheduling.consumers.sms",
      "scheduling.consumers.patientApp",
      "scheduling.consumers.reception",
    ],
    severity: "warning",
  },
  DelayChoiceRecorded: {
    module: "scheduling",
    labelKey: "scheduling.events.delayChoiceRecorded",
    consumers: ["scheduling.consumers.reception", "scheduling.consumers.doctorWorklist"],
    severity: "info",
  },
  AppointmentRebooked: {
    module: "scheduling",
    labelKey: "scheduling.events.appointmentRebooked",
    consumers: [
      "scheduling.consumers.reception",
      "scheduling.consumers.doctorWorklist",
      "scheduling.consumers.patientApp",
      "scheduling.consumers.sms",
    ],
    severity: "info",
  },
  AppointmentCancelled: {
    module: "scheduling",
    labelKey: "scheduling.events.appointmentCancelled",
    consumers: [
      "scheduling.consumers.reception",
      "scheduling.consumers.doctorWorklist",
      "scheduling.consumers.patientApp",
      "scheduling.consumers.billing",
    ],
    severity: "warning",
  },
}
