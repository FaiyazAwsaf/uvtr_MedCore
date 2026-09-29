import type { EventCatalog } from "@/core/events/types"

const c = (key: string) => `finance.consumers.${key}`

/**
 * Domain events emitted by this module (plan §3.4). The three-way match and
 * payable events are raised by procurement (a vendor invoice that matches)
 * and by finance (a resolved mismatch); both go through
 * core/finance/payables.ts and core/procurement/rules.ts. The rest are the
 * finance commands in ./commands.ts.
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
  SettlementImported: {
    module: "finance",
    labelKey: "finance.events.settlementImported",
    consumers: [c("mfs"), c("cashControl"), c("audit")],
    severity: "info",
  },
  SettlementLineMatched: {
    module: "finance",
    labelKey: "finance.events.settlementLineMatched",
    consumers: [c("mfs"), c("cashControl"), c("audit")],
    severity: "success",
  },
  SettlementLineNoted: {
    module: "finance",
    labelKey: "finance.events.settlementLineNoted",
    consumers: [c("mfs"), c("audit")],
    severity: "info",
  },
  SettlementReconciled: {
    module: "finance",
    labelKey: "finance.events.settlementReconciled",
    consumers: [c("mfs"), c("cashControl"), c("dashboard"), c("audit")],
    severity: "success",
  },
  MismatchResolved: {
    module: "finance",
    labelKey: "finance.events.mismatchResolved",
    consumers: [c("worklist"), c("payables"), c("procurement"), c("audit")],
    severity: "success",
  },
  CfoApproved: {
    module: "finance",
    labelKey: "finance.events.cfoApproved",
    consumers: [c("approvals"), c("audit")],
    severity: "warning",
  },
  PayableScheduled: {
    module: "finance",
    labelKey: "finance.events.payableScheduled",
    consumers: [c("payables"), c("audit")],
    severity: "info",
  },
  PayablePaid: {
    module: "finance",
    labelKey: "finance.events.payablePaid",
    consumers: [c("payables"), c("procurement"), c("dashboard"), c("audit")],
    severity: "success",
  },
  CorporateCreditNoteIssued: {
    module: "finance",
    labelKey: "finance.events.corporateCreditNoteIssued",
    consumers: [c("corporate"), c("accounting"), c("audit")],
    severity: "info",
  },
  AccountingExported: {
    module: "finance",
    labelKey: "finance.events.accountingExported",
    consumers: [c("accounting"), c("audit")],
    severity: "info",
  },
}
