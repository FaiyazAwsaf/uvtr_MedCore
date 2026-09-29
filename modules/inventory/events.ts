import type { EventCatalog } from "@/core/events/types"

const c = (key: string) => `inventory.consumers.${key}`

/** Domain events emitted by this module (plan §3.4). */
export const inventoryEvents: EventCatalog = {
  TransferRequested: {
    module: "inventory",
    labelKey: "inventory.events.transferRequested",
    consumers: [c("bothBranches"), c("doctor"), c("pharmacy")],
    severity: "info",
  },
  TransferDispatched: {
    module: "inventory",
    labelKey: "inventory.events.transferDispatched",
    consumers: [c("bothBranches"), c("doctor"), c("pharmacy")],
    severity: "info",
  },
  TransferReceived: {
    module: "inventory",
    labelKey: "inventory.events.transferReceived",
    consumers: [c("bothBranches"), c("doctor"), c("pharmacy")],
    severity: "success",
  },
  StockAdjusted: {
    module: "inventory",
    labelKey: "inventory.events.stockAdjusted",
    consumers: [c("store"), c("pharmacy"), c("dashboard")],
    severity: "info",
  },
  StockBelowReorder: {
    module: "inventory",
    labelKey: "inventory.events.stockBelowReorder",
    consumers: [c("store"), c("dashboard")],
    severity: "warning",
  },
}
