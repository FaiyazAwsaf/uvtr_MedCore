/**
 * Business-rule thresholds (plan §3.12). The PRD marks most of these
 * "CONFIRM: HOSPITAL": they are configuration starting points, not constants.
 * Money is integer poisha (৳1 = 100 poisha), hence the `P` suffix.
 */

const taka = (amount: number) => amount * 100

export const rules = {
  /** PRD §10.8. Maximum discount % each authority may grant without escalation. */
  discountAuthority: {
    cashier: 5,
    supervisor: 15,
    branchManager: 100,
  },

  /** PRD §11. Purchase request approval tiers by total value. */
  prApproval: [
    { maxP: taka(50_000), approver: "store-manager" },
    { maxP: taka(5_00_000), approver: "procurement-head" },
    { maxP: Number.POSITIVE_INFINITY, approver: "cfo" },
  ],

  /** PRD §9. Shift variance (either direction) above this needs supervisor approval; the shift then locks. */
  cashVarianceThresholdP: taka(500),

  /** PRD §8.7. Three-way match tolerances (invoice vs PO vs GRN). */
  threeWayMatch: { quantityTolerance: 0, priceTolerancePct: 2 },

  /** PRD §10.9. Consultant fee share. */
  feeShare: {
    consultationPct: 70,
    diagnosticReportingPct: 30,
    basis: "net",
    trigger: "collection",
    withholdingTaxPct: 10,
    discountBearer: "pro-rata",
  },

  /** PRD §10.10. Corporate contracts. */
  corporate: { coPayPct: 20, annualLimitPerEmployeeP: taka(50_000) },

  /** PRD §19. A pending bKash or Nagad payment times out after this; it never unlocks work. */
  mfsPendingTimeoutMin: 15,

  /** PRD §10.2. Queue interleave: booked tokens per walk-in token. */
  walkInInterleave: { booked: 2, walkIn: 1 },

  /** PRD §9. Unacknowledged critical results escalate after this. Auto-escalation is the Tier 2 toggle. */
  criticalEscalationMin: 30,
  criticalAutoEscalation: false,

  /** PRD §9. A partial dispense keeps its balance open this long. */
  dispenseBalanceDays: 7,

  /** PRD §9. What cancelling a paid lab item does at each stage. */
  cancellationByStage: {
    beforeCollection: "cancel-and-refund",
    afterCollection: "supervisor-approval",
    afterValidation: "blocked-goodwill-refund-only",
  },

  /** Objective §3D. An item is "Low" when on-hand stock is at or below its reorder level. */
  lowStock: "on-hand-at-or-below-reorder-level",

  /** PRD §10.19. SMS characters per part: single message, then per part of a concatenated one. Bangla uses UCS-2. */
  smsParts: {
    en: { single: 160, multi: 153 },
    bn: { single: 70, multi: 67 },
  },

  /** PRD §8.8. Inpatient deposit remaining below this raises an alert. */
  depositThresholdP: taka(10_000),

  /** PRD §16. While offline, MFS payments may stay "pending verification" up to this total. */
  offlineMfsPendingLimitP: taka(20_000),

  /** PRD §10.1. UHID: 10 digits plus a Luhn check digit, no branch or date inside. */
  uhid: { digits: 10, checkDigit: "luhn" },

  /** Values used only by simulated connectors and approvals in the demo. */
  simulated: {
    supervisorPin: "1234",
    otp: "123456",
  },
} as const

export type Rules = typeof rules
