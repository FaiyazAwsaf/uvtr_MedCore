import type { EventCatalog } from "@/core/events/types"
import { identityEvents } from "@/modules/identity/events"
import { schedulingEvents } from "@/modules/scheduling/events"
import { queueEvents } from "@/modules/queue/events"
import { consultationEvents } from "@/modules/consultation/events"
import { prescribingEvents } from "@/modules/prescribing/events"
import { ordersEvents } from "@/modules/orders/events"
import { libraryEvents } from "@/modules/medicine-library/events"
import { billingEvents } from "@/modules/billing/events"
import { labEvents } from "@/modules/lab/events"
import { imagingEvents } from "@/modules/imaging/events"
import { pharmacyEvents } from "@/modules/pharmacy/events"
import { inventoryEvents } from "@/modules/inventory/events"
import { procurementEvents } from "@/modules/procurement/events"
import { financeEvents } from "@/modules/finance/events"
import { inpatientEvents } from "@/modules/inpatient/events"
import { commsEvents } from "@/modules/comms/events"
import { dashboardsEvents } from "@/modules/dashboards/events"
import { patientAppEvents } from "@/modules/patient-app/events"
import { conceptsEvents } from "@/modules/concepts/events"
import { demoEvents } from "@/modules/demo/events"

/** The merged event catalog. Only the main agent edits this file. */
export const EVENT_CATALOG: EventCatalog = {
  ...identityEvents,
  ...schedulingEvents,
  ...queueEvents,
  ...consultationEvents,
  ...prescribingEvents,
  ...ordersEvents,
  ...libraryEvents,
  ...billingEvents,
  ...labEvents,
  ...imagingEvents,
  ...pharmacyEvents,
  ...inventoryEvents,
  ...procurementEvents,
  ...financeEvents,
  ...inpatientEvents,
  ...commsEvents,
  ...dashboardsEvents,
  ...patientAppEvents,
  ...conceptsEvents,
  ...demoEvents,
}
