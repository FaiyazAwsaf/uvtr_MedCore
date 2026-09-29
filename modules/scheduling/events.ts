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
}
