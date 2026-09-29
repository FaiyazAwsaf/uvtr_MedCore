import type { EventCatalog } from "@/core/events/types"

const c = (key: string) => `finance.consumers.${key}`

/**
 * Domain events emitted by this module (plan §3.4). The three-way match and
 * payable events are raised by procurement (a vendor invoice that matches)
 * and by finance (a resolved mismatch); both go through
 * core/finance/payables.ts and core/procurement/rules.ts.
 */
export const financeEvents: EventCatalog = {
  ThreeWayMatched: {
    module: "finance",
    labelKey: "finance.events.threeWayMatched",
    consumers: [c("payables"), c("dashboard")],
    severity: "success",
  },
  ThreeWayMismatch: {
    module: "finance",
    labelKey: "finance.events.threeWayMismatch",
    consumers: [c("worklist"), c("dashboard")],
    severity: "warning",
  },
  PayableCreated: {
    module: "finance",
    labelKey: "finance.events.payableCreated",
    consumers: [c("payables"), c("dashboard")],
    severity: "info",
  },
}
