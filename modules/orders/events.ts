import type { EventCatalog } from "@/core/events/types"

/** Domain events emitted by this module (plan §3.4). */
export const ordersEvents: EventCatalog = {
  TestOrdered: {
    module: "orders",
    labelKey: "orders.events.testOrdered",
    consumers: [
      "orders.consumers.labWorklist",
      "orders.consumers.billing",
      "orders.consumers.audit",
    ],
    severity: "info",
  },
  ImagingOrdered: {
    module: "orders",
    labelKey: "orders.events.imagingOrdered",
    consumers: [
      "orders.consumers.imaging",
      "orders.consumers.billing",
      "orders.consumers.audit",
    ],
    severity: "info",
  },
}
