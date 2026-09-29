import type { EventCatalog } from "@/core/events/types"

const c = (key: string) => `procurement.consumers.${key}`

/**
 * Domain events emitted by this module (plan §3.4). The three-way match and
 * payable events a vendor invoice raises (ThreeWayMatched, ThreeWayMismatch,
 * PayableCreated) are finance's and live in modules/finance/events.ts.
 */
export const procurementEvents: EventCatalog = {
  PurchaseRequestSaved: {
    module: "procurement",
    labelKey: "procurement.events.purchaseRequestSaved",
    consumers: [c("store")],
    severity: "info",
  },
  PurchaseRequestSubmitted: {
    module: "procurement",
    labelKey: "procurement.events.purchaseRequestSubmitted",
    consumers: [c("approverInbox"), c("dashboard")],
    severity: "info",
  },
  PurchaseRequestApproved: {
    module: "procurement",
    labelKey: "procurement.events.purchaseRequestApproved",
    consumers: [c("store"), c("dashboard"), c("audit")],
    severity: "success",
  },
  PurchaseRequestRejected: {
    module: "procurement",
    labelKey: "procurement.events.purchaseRequestRejected",
    consumers: [c("store"), c("audit")],
    severity: "warning",
  },
  PurchaseOrderIssued: {
    module: "procurement",
    labelKey: "procurement.events.purchaseOrderIssued",
    consumers: [c("vendor"), c("finance"), c("dashboard")],
    severity: "info",
  },
  GoodsReceived: {
    module: "procurement",
    labelKey: "procurement.events.goodsReceived",
    consumers: [c("stock"), c("finance")],
    severity: "success",
  },
  BatchQuarantined: {
    module: "procurement",
    labelKey: "procurement.events.batchQuarantined",
    consumers: [c("stock"), c("finance")],
    severity: "warning",
  },
  PurchaseOrderClosed: {
    module: "procurement",
    labelKey: "procurement.events.purchaseOrderClosed",
    consumers: [c("finance"), c("dashboard")],
    severity: "success",
  },
}
