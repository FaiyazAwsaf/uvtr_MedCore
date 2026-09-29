import type { EventCatalog } from "@/core/events/types"

const c = {
  lab: "billing.consumers.lab",
  imaging: "billing.consumers.imaging",
  pharmacy: "billing.consumers.pharmacy",
  feeShare: "billing.consumers.feeShare",
  cashShift: "billing.consumers.cashShift",
  finance: "billing.consumers.finance",
  audit: "billing.consumers.audit",
  patientApp: "billing.consumers.patientApp",
} as const

/**
 * Domain events emitted by this module (plan §3.4). A pending bKash or Nagad
 * payment is shown going to the cash shift and the patient app only: it
 * never reaches the lab or pharmacy until it is confirmed.
 */
export const billingEvents: EventCatalog = {
  InvoiceIssued: {
    module: "billing",
    labelKey: "billing.events.invoiceIssued",
    consumers: [c.cashShift, c.patientApp, c.audit],
    severity: "info",
  },
  PaymentReceived: {
    module: "billing",
    labelKey: "billing.events.paymentReceived",
    consumers: [c.lab, c.pharmacy, c.feeShare, c.cashShift, c.audit, c.patientApp],
    severity: "success",
  },
  PaymentPending: {
    module: "billing",
    labelKey: "billing.events.paymentPending",
    consumers: [c.cashShift, c.patientApp, c.audit],
    severity: "warning",
  },
  PaymentTimedOut: {
    module: "billing",
    labelKey: "billing.events.paymentTimedOut",
    consumers: [c.finance, c.cashShift, c.audit],
    severity: "warning",
  },
  SampleUnlocked: {
    module: "billing",
    labelKey: "billing.events.sampleUnlocked",
    consumers: [c.lab],
    severity: "success",
  },
  ImagingUnlocked: {
    module: "billing",
    labelKey: "billing.events.imagingUnlocked",
    consumers: [c.imaging],
    severity: "success",
  },
  DispenseUnlocked: {
    module: "billing",
    labelKey: "billing.events.dispenseUnlocked",
    consumers: [c.pharmacy],
    severity: "success",
  },
  FeeShareAccrued: {
    module: "billing",
    labelKey: "billing.events.feeShareAccrued",
    consumers: [c.feeShare, c.finance, c.audit],
    severity: "info",
  },
  DiscountApproved: {
    module: "billing",
    labelKey: "billing.events.discountApproved",
    consumers: [c.finance, c.audit],
    severity: "info",
  },
  ShiftOpened: {
    module: "billing",
    labelKey: "billing.events.shiftOpened",
    consumers: [c.cashShift, c.finance, c.audit],
    severity: "info",
  },
  ShiftClosed: {
    module: "billing",
    labelKey: "billing.events.shiftClosed",
    consumers: [c.cashShift, c.finance, c.audit],
    severity: "info",
  },
  VarianceApproved: {
    module: "billing",
    labelKey: "billing.events.varianceApproved",
    consumers: [c.cashShift, c.finance, c.audit],
    severity: "warning",
  },
  RefundApproved: {
    module: "billing",
    labelKey: "billing.events.refundApproved",
    consumers: [c.finance, c.audit],
    severity: "info",
  },
  ServiceCancelled: {
    module: "billing",
    labelKey: "billing.events.serviceCancelled",
    consumers: [c.lab, c.imaging, c.patientApp, c.audit],
    severity: "warning",
  },
  RefundIssued: {
    module: "billing",
    labelKey: "billing.events.refundIssued",
    consumers: [c.cashShift, c.finance, c.patientApp, c.audit],
    severity: "info",
  },
  CreditNoteIssued: {
    module: "billing",
    labelKey: "billing.events.creditNoteIssued",
    consumers: [c.finance, c.audit],
    severity: "info",
  },
  FeeShareReversed: {
    module: "billing",
    labelKey: "billing.events.feeShareReversed",
    consumers: [c.feeShare, c.finance, c.audit],
    severity: "info",
  },
}
