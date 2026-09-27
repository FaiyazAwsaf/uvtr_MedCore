/**
 * Table registry: every IndexedDB table, its Dexie index definition, and the
 * row type it stores. The engine, the edge snapshot and the seed all iterate
 * this list, so a table exists everywhere once it is declared here.
 *
 * Dexie index syntax: the first entry is the primary key; `&x` unique,
 * `*x` multi-entry, `[a+b]` compound.
 */

import type * as S from "./schema"

export interface TableRows {
  /* 5.1 Organisation */
  companies: S.CompanyRow
  branches: S.BranchRow
  departments: S.DepartmentRow
  rooms: S.RoomRow
  staff: S.StaffRow
  personas: S.PersonaRow
  specialties: S.SpecialtyRow
  doctors: S.DoctorRow
  feeShareContracts: S.FeeShareContractRow
  /* 5.2 Identity */
  patients: S.PatientRow
  households: S.HouseholdRow
  familyLinks: S.FamilyLinkRow
  duplicateDecisions: S.DuplicateDecisionRow
  reviewQueue: S.ReviewItemRow
  /* 5.3 Scheduling */
  sessions: S.SessionRow
  appointments: S.AppointmentRow
  queueTokens: S.QueueTokenRow
  /* 5.4 Clinical */
  encounters: S.EncounterRow
  notes: S.NoteRow
  scribeDrafts: S.ScribeDraftRow
  prescriptions: S.PrescriptionRow
  rxLines: S.RxLineRow
  pharmacyQueue: S.PharmacyQueueRow
  labOrders: S.LabOrderRow
  labOrderItems: S.LabOrderItemRow
  imagingOrders: S.ImagingOrderRow
  imagingReports: S.ImagingReportRow
  inboxItems: S.InboxItemRow
  /* 5.5 Lab */
  labTests: S.LabTestRow
  specimens: S.SpecimenRow
  results: S.ResultRow
  labReports: S.LabReportRow
  criticalCalls: S.CriticalCallRow
  /* 5.6 Medicines and stock */
  pharmaCompanies: S.PharmaCompanyRow
  drugClasses: S.DrugClassRow
  generics: S.GenericRow
  brands: S.BrandRow
  offers: S.OfferRow
  batches: S.BatchRow
  stockLevels: S.StockLevelRow
  reorderLevels: S.ReorderLevelRow
  stockMovements: S.StockMovementRow
  dispenses: S.DispenseRow
  controlledRegister: S.ControlledRegisterRow
  substitutionRequests: S.SubstitutionRequestRow
  transfers: S.TransferRow
  transferLines: S.TransferLineRow
  /* 5.7 Billing, finance, corporate, procurement */
  basketLines: S.BasketLineRow
  invoices: S.InvoiceRow
  invoiceLines: S.InvoiceLineRow
  payments: S.PaymentRow
  receipts: S.ReceiptRow
  refunds: S.RefundRow
  creditNotes: S.CreditNoteRow
  approvals: S.ApprovalRow
  shifts: S.ShiftRow
  feeShareAccruals: S.FeeShareAccrualRow
  mfsSettlements: S.MfsSettlementRow
  corporateClients: S.CorporateClientRow
  corporateContracts: S.CorporateContractRow
  corporateEmployees: S.CorporateEmployeeRow
  vendors: S.VendorRow
  purchaseRequests: S.PurchaseRequestRow
  prLines: S.PrLineRow
  purchaseOrders: S.PurchaseOrderRow
  poLines: S.PoLineRow
  grns: S.GrnRow
  grnLines: S.GrnLineRow
  vendorInvoices: S.VendorInvoiceRow
  threeWayMatches: S.ThreeWayMatchRow
  payables: S.PayableRow
  accountingExports: S.AccountingExportRow
  /* 5.8 Inpatient */
  wards: S.WardRow
  beds: S.BedRow
  admissions: S.AdmissionRow
  deposits: S.DepositRow
  /* 5.9 Communication and demo */
  sms: S.SmsRow
  notifications: S.NotificationRow
  syncExceptions: S.SyncExceptionRow
  dailyStats: S.DailyStatRow
  scenarioRuns: S.ScenarioRunRow
}

/** Domain tables: rows carry BaseRow and are written only through the engine. */
export type TableName = keyof TableRows
export type Row<T extends TableName> = TableRows[T]

export type TableSpec = {
  /** Dexie index definition; the primary key is always `id` */
  indexes: string
  /**
   * Field holding the patient id, so audit rows and events can be filtered
   * by patient. "id" for the patients table itself.
   */
  patientField?: string
  /** Rows may be removed (everything else is only ever updated). */
  deletable?: boolean
  /**
   * Numeric fields merged as deltas during offline replay (stock and similar
   * counters), rather than last-writer-wins.
   */
  deltaFields?: string[]
}

export const TABLE_SPECS: { [T in TableName]: TableSpec } = {
  /* 5.1 Organisation */
  companies: { indexes: "id, code" },
  branches: { indexes: "id, code, companyId" },
  departments: { indexes: "id, branchId, kind" },
  rooms: { indexes: "id, branchId, departmentId, kind" },
  staff: { indexes: "id, role, branchId" },
  personas: { indexes: "id, staffId, role, branchId" },
  specialties: { indexes: "id, code" },
  doctors: { indexes: "id, staffId, specialtyId, kind, *branchIds" },
  feeShareContracts: { indexes: "id, doctorId" },

  /* 5.2 Identity */
  patients: {
    indexes:
      "id, &uhid, provisionalUhid, *aliases, nid, brn, phone, householdId, identityStatus, *nameSearchKeys, guardianPatientId, corporateEmployeeId, registeredAtBranch",
    patientField: "id",
  },
  households: { indexes: "id, &phone, headPatientId" },
  familyLinks: {
    indexes: "id, ownerPatientId, memberPatientId, status",
    patientField: "memberPatientId",
  },
  duplicateDecisions: { indexes: "id, *candidateIds, newPatientId" },
  reviewQueue: { indexes: "id, kind, status, branchId, *patientIds" },

  /* 5.3 Scheduling */
  sessions: {
    indexes:
      "id, doctorId, branchId, date, status, [branchId+date], [doctorId+date]",
  },
  appointments: {
    indexes:
      "id, sessionId, patientId, doctorId, branchId, date, status, [sessionId+status], [branchId+date]",
    patientField: "patientId",
  },
  queueTokens: {
    indexes:
      "id, sessionId, appointmentId, patientId, branchId, status, [sessionId+status]",
    patientField: "patientId",
  },

  /* 5.4 Clinical */
  encounters: {
    indexes: "id, appointmentId, patientId, doctorId, branchId, status",
    patientField: "patientId",
  },
  notes: {
    indexes: "id, encounterId, patientId, doctorId, status",
    patientField: "patientId",
  },
  scribeDrafts: { indexes: "id, encounterId" },
  prescriptions: {
    indexes: "id, rxNo, encounterId, patientId, doctorId, branchId, status",
    patientField: "patientId",
  },
  rxLines: {
    indexes: "id, rxId, patientId, branchId, brandId, genericId, status",
    patientField: "patientId",
  },
  pharmacyQueue: {
    indexes: "id, rxId, patientId, branchId, status, [branchId+status]",
    patientField: "patientId",
  },
  labOrders: {
    indexes: "id, orderNo, encounterId, patientId, branchId, status",
    patientField: "patientId",
  },
  labOrderItems: {
    indexes:
      "id, labOrderId, patientId, branchId, testId, specimenId, status, reportId, [branchId+status]",
    patientField: "patientId",
  },
  imagingOrders: {
    indexes: "id, orderNo, encounterId, patientId, branchId, status",
    patientField: "patientId",
  },
  imagingReports: {
    indexes: "id, imagingOrderId, patientId, status",
    patientField: "patientId",
  },
  inboxItems: {
    indexes: "id, doctorId, patientId, kind, status, [doctorId+status]",
    patientField: "patientId",
  },

  /* 5.5 Lab */
  labTests: { indexes: "id, code, section, kind" },
  specimens: {
    indexes:
      "id, &accessionNo, barcode, patientId, branchId, labOrderId, status, [branchId+status]",
    patientField: "patientId",
  },
  results: {
    indexes: "id, labOrderItemId, patientId, testId, status",
    patientField: "patientId",
  },
  labReports: {
    indexes: "id, reportNo, patientId, branchId, labOrderId, status",
    patientField: "patientId",
  },
  criticalCalls: {
    indexes: "id, resultId, patientId, branchId, status",
    patientField: "patientId",
  },

  /* 5.6 Medicines and stock */
  pharmaCompanies: { indexes: "id, name" },
  drugClasses: { indexes: "id, name, parentId" },
  generics: { indexes: "id, name, classId, allergyClass" },
  brands: {
    indexes: "id, name, genericId, companyId, category, *searchKeys",
  },
  offers: { indexes: "id, brandId, branchId" },
  batches: { indexes: "id, brandId, batchNo, expiry, status" },
  stockLevels: {
    indexes:
      "id, branchId, brandId, batchId, [branchId+brandId], [branchId+batchId]",
    deltaFields: ["qty", "quarantinedQty", "inTransitIn", "inTransitOut"],
  },
  reorderLevels: { indexes: "id, branchId, brandId, [branchId+brandId]" },
  stockMovements: {
    indexes: "id, branchId, brandId, batchId, type, at",
  },
  dispenses: {
    indexes: "id, rxId, rxLineId, patientId, branchId, brandId, at",
    patientField: "patientId",
  },
  controlledRegister: { indexes: "id, dispenseId, branchId, brandId, at" },
  substitutionRequests: {
    indexes: "id, rxId, rxLineId, patientId, doctorId, branchId, status",
    patientField: "patientId",
  },
  transfers: {
    indexes: "id, transferNo, fromBranchId, toBranchId, status",
  },
  transferLines: { indexes: "id, transferId, brandId" },

  /* 5.7 Billing, finance, corporate, procurement */
  basketLines: {
    indexes:
      "id, patientId, branchId, sourceType, sourceId, status, [patientId+status]",
    patientField: "patientId",
  },
  invoices: {
    indexes:
      "id, &invoiceNo, patientId, companyId, branchId, date, status, shiftId",
    patientField: "patientId",
  },
  invoiceLines: {
    indexes: "id, invoiceId, basketLineId, sourceId, doctorId, status",
  },
  payments: {
    indexes:
      "id, invoiceId, patientId, branchId, shiftId, tender, status, idempotencyKey",
    patientField: "patientId",
  },
  receipts: {
    indexes: "id, receiptNo, invoiceId, patientId, branchId",
    patientField: "patientId",
  },
  refunds: { indexes: "id, refundNo, invoiceId, paymentId, status" },
  creditNotes: { indexes: "id, creditNoteNo, invoiceId" },
  approvals: { indexes: "id, kind, status, approverId, requestedBy" },
  shifts: {
    indexes: "id, cashierId, branchId, date, status, [branchId+status]",
  },
  feeShareAccruals: {
    indexes:
      "id, doctorId, invoiceId, invoiceLineId, month, [doctorId+month]",
  },
  mfsSettlements: { indexes: "id, provider, date, status" },
  corporateClients: { indexes: "id, code" },
  corporateContracts: { indexes: "id, clientId, status" },
  corporateEmployees: {
    indexes: "id, clientId, contractId, patientId, status",
    patientField: "patientId",
  },
  vendors: { indexes: "id, code" },
  purchaseRequests: { indexes: "id, prNo, branchId, status" },
  prLines: { indexes: "id, prId, brandId" },
  purchaseOrders: {
    indexes: "id, &poNo, prId, vendorId, branchId, status",
  },
  poLines: { indexes: "id, poId, brandId" },
  grns: { indexes: "id, grnNo, poId, branchId, status" },
  grnLines: { indexes: "id, grnId, poLineId, brandId" },
  vendorInvoices: { indexes: "id, vendorInvoiceNo, vendorId, poId, status" },
  threeWayMatches: { indexes: "id, poId, vendorInvoiceId, status" },
  payables: { indexes: "id, vendorId, vendorInvoiceId, poId, status" },
  accountingExports: { indexes: "id, date, companyId" },

  /* 5.8 Inpatient */
  wards: { indexes: "id, branchId" },
  beds: { indexes: "id, wardId, branchId, status" },
  admissions: {
    indexes: "id, admissionNo, patientId, branchId, bedId, status",
    patientField: "patientId",
  },
  deposits: {
    indexes: "id, admissionId, patientId",
    patientField: "patientId",
  },

  /* 5.9 Communication and demo */
  sms: {
    indexes: "id, patientId, branchId, status, queuedAt",
    patientField: "patientId",
  },
  notifications: {
    indexes: "id, patientId, read, at",
    patientField: "patientId",
  },
  syncExceptions: { indexes: "id, kind, branchId, status" },
  dailyStats: { indexes: "id, branchId, date, dept, [branchId+date]" },
  scenarioRuns: { indexes: "id, scenarioId, at" },
}

export const TABLE_NAMES = Object.keys(TABLE_SPECS) as TableName[]

/** Engine-owned tables, present in every data database. */
export const PLATFORM_STORES = {
  events: "seq, id, type, at, branchId, patientId, commitId, command",
  audit: "seq, commitId, entity, entityId, patientId, at, action",
  counters: "id",
  idempotency: "key, commitId, at",
  appliedCommits: "commitId, appliedAt",
} as const

/** Present only in branch edge databases (plan §3.7). */
export const EDGE_ONLY_STORES = {
  outbox: "seq, commitId, at",
} as const

export function isTableName(name: string): name is TableName {
  return name in TABLE_SPECS
}
