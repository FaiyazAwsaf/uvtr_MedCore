/**
 * UVTR_MedCore data model (docs/implementation_plan.md §5). Frozen after Phase 1:
 * workstreams read and write these shapes but never change them. Ask the main
 * agent for a change; it updates the plan first.
 *
 * Conventions
 * - Money is integer poisha (৳1 = 100), fields end in `P`.
 * - Moments are epoch milliseconds on the demo clock (`Ms`), from `now()`.
 * - Calendar days are `ISODate` strings (YYYY-MM-DD, Dhaka time).
 * - Readable document numbers (UHID, Rx, invoice, PO) are separate from `id`.
 */

import type {
  Bilingual,
  BranchCode,
  CompanyCode,
  BranchService,
} from "@/config/brand.config"
import type { Role } from "@/core/rbac/types"
import type { Locale } from "@/lib/i18n/config"

export type { Bilingual, BranchCode, CompanyCode, BranchService, Locale, Role }

/* ================================================================== *
 * Primitives and the base row
 * ================================================================== */

export type Id = string
/** Epoch milliseconds on the demo clock. */
export type Ms = number
/** Calendar day, YYYY-MM-DD. */
export type ISODate = string
/** Clock time of day, HH:MM (24h). */
export type HHMM = string
/** Integer money in poisha (৳1 = 100 poisha). */
export type Poisha = number
export type Sex = "M" | "F"

/** Where a row was written: the central store, or a branch edge store while offline. */
export type Origin = "central" | `edge:${BranchCode}`

/** Fields every domain row carries. The engine sets them; commands never do. */
export type BaseRow = {
  id: Id
  /** Starts at 1 and increments on every update (optimistic concurrency). */
  version: number
  createdAt: Ms
  updatedAt: Ms
  /** Staff id, or "system" for seed and sweeper writes. */
  createdBy: Id
  updatedBy: Id
  origin: Origin
  /** Original event time when the row arrived by offline replay. */
  originAt?: Ms
}

/** The engine-managed fields, stripped from insert inputs. */
export type BaseField = keyof BaseRow

/** Links from one record to others. Used by events, inbox items, movements. */
export type RefKey =
  | "patientId"
  | "appointmentId"
  | "encounterId"
  | "rxId"
  | "rxLineId"
  | "labOrderId"
  | "labItemId"
  | "specimenId"
  | "resultId"
  | "reportId"
  | "imagingOrderId"
  | "invoiceId"
  | "paymentId"
  | "refundId"
  | "transferId"
  | "substitutionId"
  | "prId"
  | "poId"
  | "grnId"
  | "shiftId"
  | "admissionId"
  | "sessionId"
  | "tokenId"
  | "dispenseId"
  | "approvalId"
  | "reviewId"
  | "vendorInvoiceId"
  | "matchId"
  | "payableId"
  | "bedId"
  | "depositId"
  | "settlementId"
  | "creditNoteId"
  | "corporateClientId"
  | "exportId"
export type Refs = Partial<Record<RefKey, Id>>

export type ServiceType =
  | "consultation"
  | "follow-up"
  | "lab"
  | "imaging"
  | "lab-reporting"
  | "imaging-reporting"
  | "procedure"
  | "medicine"
  | "bed"
  | "inpatient-visit"
  | "other"

/* ================================================================== *
 * 5.1 Organisation
 * ================================================================== */

export type CompanyRow = BaseRow & {
  /** id equals code */
  code: CompanyCode
  name: Bilingual
  tin: string
  invoicePrefix: string
}

export type BranchRow = BaseRow & {
  /** id equals code */
  code: BranchCode
  companyId: CompanyCode
  name: Bilingual
  kind: "hospital" | "diagnostic"
  services: BranchService[]
  address: Bilingual
  phone: string
}

export type DepartmentKind =
  | "opd"
  | "lab"
  | "imaging"
  | "pharmacy"
  | "ward"
  | "billing"
  | "store"
  | "reception"
  | "admin"

export type DepartmentRow = BaseRow & {
  branchId: BranchCode
  code: string
  name: Bilingual
  kind: DepartmentKind
}

export type RoomRow = BaseRow & {
  branchId: BranchCode
  departmentId: Id
  /** Short label shown on the display board, e.g. "3" or "C-2" */
  code: string
  name: Bilingual
  kind: "consult" | "collection" | "lab" | "imaging" | "ward" | "counter"
}

/**
 * Known authority strings: `discount:<maxPct>`, `approve:variance`,
 * `approve:refund`, `approve:cancel-after-collection`, `approve:pr:<maxTaka>`,
 * `merge:patients`, `override:payment-gate`, `sign:reports`,
 * `dispense:controlled`, `price:publish`.
 */
export type Authority = string

export type StaffRow = BaseRow & {
  nameEn: string
  nameBn: string
  sex: Sex
  role: Role
  /** null for network-level staff (HQ) */
  branchId: BranchCode | null
  designation: Bilingual
  /** BMDC number for doctors, Pharmacy Council number for pharmacists */
  regNo?: string
  regBody?: "BMDC" | "PCB"
  authorities: Authority[]
  avatarSeed: string
  phone?: string
}

export type PersonaRow = BaseRow & {
  /** Set for staff personas */
  staffId?: Id
  /** Set for the patient-app persona */
  patientId?: Id
  role: Role
  branchId: BranchCode | null
  /** The persona picked by default for its role on the launcher */
  isDefault: boolean
  /** One line describing what this persona demonstrates */
  blurb: Bilingual
  order: number
}

export type SpecialtyRow = BaseRow & {
  code: string
  name: Bilingual
  /** lucide icon name */
  icon: string
  /** Hospital-approved symptom phrases for the health-concern navigator (T2) */
  navigatorSymptoms: Bilingual[]
}

export type DoctorRow = BaseRow & {
  staffId: Id
  specialtyId: Id
  kind: "consultant" | "medical-officer" | "pathologist" | "radiologist"
  bmdcNo: string
  bmdcVerified: boolean
  qualifications: string
  experienceYears: number
  languages: Locale[]
  consultFeeP: Poisha
  followUpFeeP: Poisha
  branchIds: BranchCode[]
  bio: Bilingual
  isDutyDoctor: boolean
}

export type FeeShareRule = {
  serviceType: ServiceType
  basis: "pct-net" | "pct-gross" | "fixed"
  /** Percentage for pct bases, poisha for fixed */
  value: number
  trigger: "billing" | "collection"
}

export type FeeShareContractRow = BaseRow & {
  doctorId: Id
  contractVersion: number
  effectiveFrom: ISODate
  rules: FeeShareRule[]
  whtPct: number
  discountBearer: "hospital" | "consultant" | "pro-rata"
}

/* ================================================================== *
 * 5.2 Identity and household
 * ================================================================== */

export type Relation =
  | "self"
  | "spouse"
  | "son"
  | "daughter"
  | "father"
  | "mother"
  | "brother"
  | "sister"
  | "grandchild"
  | "grandparent"
  | "other"

export type Allergy = {
  substance: string
  /** Drug allergy class used by the Rx allergy alert, e.g. "penicillins" */
  allergyClass?: string
  reaction: string
  severity: "mild" | "moderate" | "severe"
}

export type CurrentMed = {
  genericId?: Id
  brandId?: Id
  name: string
  dose: string
  since?: ISODate
}

export type Problem = {
  icd10: string
  label: string
  since?: ISODate
  status: "active" | "resolved"
}

export type ConsentPurpose =
  | "treatment"
  | "sms"
  | "app"
  | "telemedicine"
  | "corporate-sharing"
  | "research"

export type Consent = {
  purpose: ConsentPurpose
  granted: boolean
  at: Ms
  /** Set when a guardian consented for a minor */
  byPatientId?: Id
}

export type PatientRow = BaseRow & {
  /** 10 digits plus a Luhn check digit, or a provisional P-Bx-###### while offline */
  uhid: string
  provisionalUhid?: string
  /** Former UHIDs (provisional ones, merged records); all remain searchable */
  aliases: string[]
  identityStatus: "active" | "under-review" | "merged"
  mergedInto?: Id
  nameEn: string
  nameBn: string
  /** Normalised tokens for Bangla-tolerant, spelling-variant search */
  nameSearchKeys: string[]
  dob: ISODate
  dobEstimated?: boolean
  sex: Sex
  bloodGroup?: string
  address?: string
  phone?: string
  phoneVerified: boolean
  /** Phone of an attendant for patients without their own; no app access */
  attendantPhone?: string
  nid?: string
  brn?: string
  passport?: string
  householdId?: Id
  relationToHead?: Relation
  guardianPatientId?: Id
  guardianRelation?: Relation
  allergies: Allergy[]
  currentMeds: CurrentMed[]
  problems: Problem[]
  corporateEmployeeId?: Id
  photoSeed: string
  consents: Consent[]
  unidentified?: boolean
  /** Why NID or phone is missing, when they are */
  registrationNote?: string
  registeredAtBranch: BranchCode
}

export type HouseholdRow = BaseRow & {
  phone: string
  memberIds: Id[]
  headPatientId: Id
}

export type FamilyLinkRow = BaseRow & {
  ownerPatientId: Id
  memberPatientId: Id
  kind: "guardian" | "proxy"
  status: "requested" | "granted" | "revoked"
  grantedAt?: Ms
  revokedAt?: Ms
  otpVerifiedAt?: Ms
}

export type DuplicateDecisionRow = BaseRow & {
  candidateIds: Id[]
  newPatientId?: Id
  score: number
  decision: "same" | "different"
  reason: string
  decidedBy: Id
  decidedAt: Ms
}

export type ReviewItemRow = BaseRow & {
  kind: "sync-duplicate" | "identity-conflict"
  branchId: BranchCode
  patientIds: Id[]
  /** Field-level differences for identity conflicts */
  fields?: { field: string; edgeValue: unknown; centralValue: unknown }[]
  status: "open" | "resolved"
  resolution?: "same" | "different" | "kept-central" | "kept-edge"
  reason?: string
  resolvedBy?: Id
  resolvedAt?: Ms
  detail?: string
}

/* ================================================================== *
 * 5.3 Scheduling and queue
 * ================================================================== */

export type VisitType = "first" | "follow-up" | "report"

export type SessionRow = BaseRow & {
  doctorId: Id
  branchId: BranchCode
  roomId: Id
  date: ISODate
  start: HHMM
  end: HHMM
  slotMin: number
  capacity: number
  walkInQuota: number
  visitTypes: VisitType[]
  feeP: Poisha
  followUpFeeP: Poisha
  status: "open" | "delayed" | "blocked" | "closed"
  delayMin: number
  delayReason?: string
  /** Token prefix on the display board, e.g. "M" */
  tokenPrefix: string
}

export type AppointmentRow = BaseRow & {
  sessionId: Id
  patientId: Id
  doctorId: Id
  branchId: BranchCode
  date: ISODate
  slotStart: HHMM
  source: "app" | "call" | "counter" | "walk-in"
  visitType: VisitType
  status:
    | "booked"
    | "checked-in"
    | "in-consult"
    | "done"
    | "no-show"
    | "cancelled"
    | "rebooked"
  bookedBy: Id
  feeBasketLineId?: Id
  tokenId?: Id
  checkedInAt?: Ms
  delayChoice?: "wait" | "rebook" | "transfer" | "refund"
  rebookedToId?: Id
  /** Payload encoded in the check-in QR */
  qrCode: string
}

export type QueueTokenRow = BaseRow & {
  sessionId: Id
  appointmentId: Id
  patientId: Id
  branchId: BranchCode
  roomId: Id
  number: number
  /** Shown on the board, e.g. "M-14"; never a name */
  label: string
  kind: "booked" | "walk-in"
  status: "waiting" | "called" | "skipped" | "recalled" | "in-consult" | "done"
  issuedAt: Ms
  calledAt?: Ms
  /** Queue order after the 2:1 interleave */
  position: number
}

/* ================================================================== *
 * 5.4 Clinical
 * ================================================================== */

export type Vitals = {
  bpSys?: number
  bpDia?: number
  pulse?: number
  tempC?: number
  spo2?: number
  weightKg?: number
  heightCm?: number
  rbs?: number
  recordedAt: Ms
  recordedBy: Id
}

export type EncounterRow = BaseRow & {
  appointmentId?: Id
  patientId: Id
  doctorId: Id
  branchId: BranchCode
  mode: "in-person" | "video"
  type: VisitType
  status: "open" | "signed" | "closed"
  startedAt: Ms
  endedAt?: Ms
  vitals?: Vitals
  templateId?: string
}

export type NoteSections = {
  chiefComplaint: string
  history: string
  examination: string
  assessment: string
  plan: string
}

export type Diagnosis = { icd10: string; label: string; primary: boolean }

export type NoteRow = BaseRow & {
  encounterId: Id
  patientId: Id
  doctorId: Id
  noteVersion: number
  status: "draft" | "signed" | "amended"
  templateId: string
  lang: Locale
  sections: NoteSections
  diagnoses: Diagnosis[]
  amendmentOfId?: Id
  amendReason?: string
  scribeDraftId?: Id
  signedAt?: Ms
}

export type TranscriptLine = {
  id: string
  speaker: "doctor" | "patient" | "attendant"
  lang: Locale
  text: string
  atSec: number
}

export type ScribeDraftRow = BaseRow & {
  encounterId: Id
  scriptId: string
  transcript: TranscriptLine[]
  /** Every draft line links back to transcript lines; never medicines or diagnoses */
  draft: {
    section: keyof NoteSections
    lines: { text: string; transcriptLineIds: string[] }[]
  }[]
  status: "recording" | "drafted" | "accepted" | "discarded"
}

export type PrescriptionRow = BaseRow & {
  /** Shared by every version of the same prescription, e.g. RX-B1-000123 */
  rxNo: string
  rxVersion: number
  encounterId?: Id
  patientId: Id
  doctorId: Id
  branchId: BranchCode
  status: "draft" | "signed" | "superseded" | "replaced"
  /** v2 points to v1 (edit before dispensing) */
  supersedesId?: Id
  /** A new Rx after dispensing points to the old one */
  replacesId?: Id
  mode: "in-person" | "video"
  advice: string
  followUpDate?: ISODate
  /** Tests written on the Rx (the orders themselves live in labOrders) */
  tests: string[]
  vitalsSnapshot?: Vitals
  signedAt?: Ms
  /** Paper Rx back-entered after downtime */
  transcribed?: boolean
}

export type MealTiming = "before" | "after" | "with" | "any"

export type RxLineStatus =
  | "open"
  | "partial"
  | "dispensed"
  | "bought-elsewhere"
  | "awaiting-prescriber"
  | "cancelled"

export type RxLineRow = BaseRow & {
  rxId: Id
  patientId: Id
  branchId: BranchCode
  lineNo: number
  brandId?: Id
  genericId?: Id
  /** Set when the doctor typed a medicine not in the dictionary (flagged, not stock-checked) */
  nonDictionaryName?: string
  strength: string
  form: string
  /** e.g. "1+0+1" */
  dosePattern: string
  mealTiming: MealTiming
  durationDays: number
  qtyPrescribed: number
  instructionsEn: string
  instructionsBn: string
  isAntibiotic: boolean
  isControlled: boolean
  paymentCleared: boolean
  dispensedQty: number
  status: RxLineStatus
  balanceUntil?: Ms
  substitutedFromLineId?: Id
}

export type PharmacyQueueRow = BaseRow & {
  rxId: Id
  rxNo: string
  patientId: Id
  branchId: BranchCode
  status: "waiting" | "in-progress" | "partial" | "done" | "cancelled"
  receivedAt: Ms
}

export type LabItemStatus =
  | "ordered"
  | "paid"
  | "collected"
  | "received"
  | "resulted"
  | "validated"
  | "signed"
  | "released"
  | "cancelled"
  | "rejected"

export type LabOrderRow = BaseRow & {
  orderNo: string
  encounterId?: Id
  patientId: Id
  doctorId?: Id
  branchId: BranchCode
  priority: "routine" | "urgent"
  status: "ordered" | "in-progress" | "completed" | "cancelled"
  source: "doctor" | "counter" | "home-collection"
}

export type LabOrderItemRow = BaseRow & {
  labOrderId: Id
  patientId: Id
  branchId: BranchCode
  testId: Id
  status: LabItemStatus
  specimenId?: Id
  basketLineId?: Id
  invoiceLineId?: Id
  paymentCleared: boolean
  addOnOfItemId?: Id
  isFreeRecollection?: boolean
  recollectionOfItemId?: Id
  cancelReason?: string
  reportId?: Id
}

export type Modality = "xray" | "usg" | "ct" | "mri" | "ecg" | "echo"

export type ImagingOrderRow = BaseRow & {
  orderNo: string
  encounterId?: Id
  patientId: Id
  doctorId?: Id
  branchId: BranchCode
  testId: Id
  modality: Modality
  bodyPart: string
  indication: string
  contrast: boolean
  status: "ordered" | "paid" | "done" | "reported" | "released" | "cancelled"
  basketLineId?: Id
  paymentCleared: boolean
  reportId?: Id
}

export type ImagingReportRow = BaseRow & {
  imagingOrderId: Id
  patientId: Id
  reportVersion: number
  status: "uploaded" | "released" | "superseded"
  pdfName: string
  pdfHash: string
  radiologistId: Id
  summary?: string
  releasedAt?: Ms
  supersedesId?: Id
}

export type InboxItemRow = BaseRow & {
  doctorId: Id
  patientId?: Id
  kind:
    | "result"
    | "abnormal"
    | "critical"
    | "corrected"
    | "substitution"
    | "transfer"
    | "add-on"
    | "info"
  refs: Refs
  titleKey: string
  params?: Record<string, string | number>
  status: "unread" | "read" | "acknowledged" | "actioned"
  ackAt?: Ms
}

/* ================================================================== *
 * 5.5 Lab and imaging
 * ================================================================== */

export type RefRange = {
  sex?: Sex
  ageMinYears?: number
  ageMaxYears?: number
  low?: number
  high?: number
  /** For qualitative results, e.g. "Negative" */
  text?: string
}

/** One measured value of a test. Single-value tests have exactly one. */
export type Analyte = {
  code: string
  name: string
  units?: string
  decimals: number
  ranges: RefRange[]
  criticalLow?: number
  criticalHigh?: number
  qualitative?: boolean
}

export type LabSection =
  | "haematology"
  | "biochemistry"
  | "immunology"
  | "serology"
  | "microbiology"
  | "histopathology"
  | "hormones"
  | "urine"
  | "imaging"
  | "cardiology"

export type Container =
  | "EDTA"
  | "plain"
  | "fluoride"
  | "citrate"
  | "urine-cup"
  | "stool-cup"
  | "swab"
  | "formalin"
  | "none"

export type LabTestRow = BaseRow & {
  code: string
  /** Clinical names stay English (D13); glossBn is an optional Bangla hint */
  name: string
  glossBn?: string
  section: LabSection
  kind: "lab" | "imaging"
  modality?: Modality
  specimen:
    | "blood"
    | "serum"
    | "plasma"
    | "urine"
    | "stool"
    | "swab"
    | "tissue"
    | "none"
  container: Container
  volumeMl: number
  method?: string
  tatHours: number
  analytes: Analyte[]
  /** Hours a collected specimen stays usable (add-on test rule) */
  stabilityHours: number
  sendOut: boolean
  signatoryGroup: "pathology" | "microbiology" | "radiology" | "cardiology"
  priceP: Poisha
  template?: "micro" | "histo"
}

export type SpecimenRow = BaseRow & {
  accessionNo: string
  barcode: string
  patientId: Id
  branchId: BranchCode
  labOrderId: Id
  itemIds: Id[]
  container: Container
  status:
    | "awaiting-collection"
    | "collected"
    | "received"
    | "rejected"
    | "consumed"
    | "cancelled"
  collectedAt?: Ms
  collectedBy?: Id
  receivedAt?: Ms
  receivedBy?: Id
  rejectReason?:
    | "haemolysed"
    | "clotted"
    | "insufficient"
    | "mislabelled"
    | "wrong-container"
    | "other"
  volumeRemainingMl: number
  labelPrintedAt?: Ms
}

export type ResultFlag = "N" | "L" | "H" | "LL" | "HH" | "A"

export type ResultRow = BaseRow & {
  labOrderItemId: Id
  patientId: Id
  testId: Id
  analyteCode: string
  value: number | null
  text?: string
  unit?: string
  flag: ResultFlag
  critical: boolean
  source: "analyser" | "manual"
  secondCheckBy?: Id
  status: "pending" | "validated"
  validatedBy?: Id
  validatedAt?: Ms
  deltaFlag?: boolean
}

export type LabReportRow = BaseRow & {
  /** Shared by every version of the same report */
  reportNo: string
  reportVersion: number
  patientId: Id
  branchId: BranchCode
  labOrderId: Id
  itemIds: Id[]
  status: "draft" | "signed" | "released" | "superseded"
  signedBy?: Id
  signedAt?: Ms
  releasedAt?: Ms
  heldForPayment?: boolean
  correctionReason?: string
  changeSummary?: string
  supersedesId?: Id
  /** SHA-256 of the signed content, shown by QR verification */
  hash?: string
}

export type CriticalCallRow = BaseRow & {
  resultId: Id
  labOrderItemId: Id
  patientId: Id
  branchId: BranchCode
  valueText: string
  calledPerson: string
  calledRole: "ordering-doctor" | "duty-doctor" | "ward"
  calledAt: Ms
  readBack: boolean
  readBackText?: string
  status: "open" | "acknowledged" | "escalated"
  ackAt?: Ms
  escalatedTo?: Id
  escalatedAt?: Ms
  auto?: boolean
  loggedBy: Id
}

/* ================================================================== *
 * 5.6 Medicines, pharmacy and inventory
 * ================================================================== */

export type PharmaCompanyRow = BaseRow & {
  name: string
  shortName: string
  about?: string
}

export type DrugClassRow = BaseRow & {
  name: string
  parentId?: Id
}

export type GenericRow = BaseRow & {
  name: string
  classId: Id
  glossBn?: string
  indications: string
  dosage: string
  contraindications: string
  sideEffects: string
  pregnancyCategory: "A" | "B" | "C" | "D" | "X" | "N/A"
  /** Always "licensed content, Release 2" style placeholder text */
  interactionsNote: string
  isAntibiotic: boolean
  controlledClass?: "narcotic" | "psychotropic"
  /** Allergy class that triggers the allergy alert, e.g. "penicillins" */
  allergyClass?: string
}

export type DosageForm =
  | "tablet"
  | "capsule"
  | "syrup"
  | "suspension"
  | "injection"
  | "cream"
  | "drops"
  | "inhaler"
  | "suppository"
  | "sachet"

export type PackSize = {
  /** e.g. "10 x 10 strip" */
  label: string
  /** Total base units in the pack, e.g. 100 */
  units: number
  /** Units per strip when sold loose by strip, e.g. 10 */
  stripSize?: number
}

export type BrandRow = BaseRow & {
  name: string
  genericId: Id
  companyId: Id
  strength: string
  form: DosageForm
  /** Mock DGDA registration number */
  darNo: string
  packSizes: PackSize[]
  /** Per base unit (tablet, capsule, ml bottle) */
  unitPriceP: Poisha
  mrpP: Poisha
  category: "otc" | "rx" | "controlled"
  isAntibiotic: boolean
  searchKeys: string[]
  unitLabel: Bilingual
}

export type OfferRow = BaseRow & {
  brandId: Id
  /** undefined means all branches */
  branchId?: BranchCode
  text: Bilingual
  setBy: Id
  active: boolean
}

export type BatchRow = BaseRow & {
  brandId: Id
  batchNo: string
  expiry: ISODate
  costP: Poisha
  mrpP: Poisha
  status: "ok" | "quarantine" | "expired"
  vendorId?: Id
}

export type StockLevelRow = BaseRow & {
  branchId: BranchCode
  brandId: Id
  batchId: Id
  /** On-hand, dispensable units (excludes quarantined) */
  qty: number
  quarantinedQty: number
  inTransitIn: number
  inTransitOut: number
  asAt: Ms
}

export type ReorderLevelRow = BaseRow & {
  branchId: BranchCode
  brandId: Id
  reorderLevel: number
  reorderQty: number
}

export type StockMovementRow = BaseRow & {
  branchId: BranchCode
  brandId: Id
  batchId: Id
  type:
    | "opening"
    | "grn"
    | "dispense"
    | "transfer-out"
    | "transfer-in"
    | "return"
    | "adjust"
    | "quarantine"
    | "release"
    | "write-off"
  /** Signed: negative takes stock out */
  qty: number
  refs: Refs
  reason?: string
  at: Ms
}

export type DispenseRow = BaseRow & {
  rxId?: Id
  rxLineId?: Id
  patientId?: Id
  branchId: BranchCode
  saleType: "rx" | "otc"
  brandId: Id
  batchId: Id
  qty: number
  unitPriceP: Poisha
  pharmacistId: Id
  pharmacyCouncilNo: string
  labelPrinted: boolean
  counselled: boolean
  /** Units still owed on the Rx line after this dispense */
  outstandingQty: number
  invoiceLineId?: Id
  at: Ms
}

export type ControlledRegisterRow = BaseRow & {
  dispenseId: Id
  branchId: BranchCode
  brandId: Id
  qty: number
  runningBalance: number
  rxId: Id
  witnessId?: Id
  at: Ms
}

export type SubstitutionRequestRow = BaseRow & {
  rxId: Id
  rxLineId: Id
  patientId: Id
  doctorId: Id
  branchId: BranchCode
  proposedBrandId: Id
  reason: string
  requestedBy: Id
  status: "pending" | "approved" | "rejected"
  decidedBy?: Id
  decidedAt?: Ms
  decisionNote?: string
  resultRxId?: Id
}

export type TransferRow = BaseRow & {
  transferNo: string
  fromBranchId: BranchCode
  toBranchId: BranchCode
  status: "requested" | "approved" | "dispatched" | "received" | "cancelled"
  requestedFrom: "doctor-prompt" | "pharmacy" | "store"
  requestedBy: Id
  dispatchedAt?: Ms
  receivedAt?: Ms
  note?: string
}

export type TransferLineRow = BaseRow & {
  transferId: Id
  brandId: Id
  batchId?: Id
  qtyRequested: number
  qtyDispatched: number
  qtyReceived: number
  discrepancy?: string
}

/* ================================================================== *
 * 5.7 Billing, cash, finance and corporate
 * ================================================================== */

export type PayerType = "self" | "corporate"
export type Tender =
  "cash" | "card" | "bkash" | "nagad" | "deposit" | "corporate"

export type BasketLineRow = BaseRow & {
  patientId: Id
  branchId: BranchCode
  sourceType:
    "consult" | "test" | "imaging" | "rx-line" | "bed" | "procedure" | "other"
  sourceId: Id
  serviceType: ServiceType
  description: string
  descriptionBn?: string
  doctorId?: Id
  qty: number
  unitPriceP: Poisha
  /** Medicine lines: the price may never exceed this (INV-05) */
  mrpP?: Poisha
  status: "open" | "invoiced" | "removed"
  payerType: PayerType
  corporateClientId?: Id
}

export type InvoiceRow = BaseRow & {
  invoiceNo: string
  companyId: CompanyCode
  branchId: BranchCode
  patientId: Id
  date: ISODate
  payerType: PayerType
  corporateClientId?: Id
  subtotalP: Poisha
  discountP: Poisha
  discountPct: number
  discountApprovalId?: Id
  taxP: Poisha
  totalP: Poisha
  /** Sum of confirmed payments */
  paidP: Poisha
  refundedP: Poisha
  status: "unpaid" | "partial" | "paid" | "void" | "refunded"
  offline?: boolean
  shiftId?: Id
  cashierId: Id
}

export type InvoiceLineRow = BaseRow & {
  invoiceId: Id
  basketLineId?: Id
  sourceType: BasketLineRow["sourceType"]
  sourceId: Id
  serviceType: ServiceType
  description: string
  doctorId?: Id
  qty: number
  unitPriceP: Poisha
  amountP: Poisha
  discountP: Poisha
  netP: Poisha
  status: "active" | "cancelled" | "refunded"
}

export type PaymentRow = BaseRow & {
  invoiceId: Id
  patientId: Id
  branchId: BranchCode
  tender: Tender
  amountP: Poisha
  status: "pending" | "confirmed" | "failed" | "timeout" | "refunded"
  /** Terminal, MFS or cheque reference */
  ref?: string
  idempotencyKey: string
  shiftId?: Id
  manualRefFlag?: boolean
  requestedAt: Ms
  confirmedAt?: Ms
}

export type ReceiptRow = BaseRow & {
  receiptNo: string
  invoiceId: Id
  paymentIds: Id[]
  patientId: Id
  branchId: BranchCode
  amountP: Poisha
  at: Ms
}

export type RefundRow = BaseRow & {
  refundNo: string
  invoiceId: Id
  invoiceLineIds: Id[]
  paymentId: Id
  tender: Tender
  amountP: Poisha
  reason: string
  approvalId?: Id
  status: "pending" | "completed" | "failed"
  completedAt?: Ms
  creditNoteId?: Id
}

export type CreditNoteRow = BaseRow & {
  creditNoteNo: string
  invoiceId: Id
  amountP: Poisha
  reason: string
  lines: { invoiceLineId: Id; amountP: Poisha }[]
  /** Absent means a refund's credit note (billing); a corporate dispute reduces the company's share */
  kind?: "refund" | "corporate-dispute"
  corporateClientId?: Id
  approvalId?: Id
}

export type ApprovalKind =
  | "discount"
  | "cancel-after-collection"
  | "refund"
  | "variance"
  | "pr"
  | "merge"
  | "payment-override"
  | "goodwill"
  | "credit-note"
  | "mismatch"

export type ApprovalRow = BaseRow & {
  kind: ApprovalKind
  refs: Refs
  requestedBy: Id
  approverId?: Id
  status: "pending" | "approved" | "rejected"
  /** Inline supervisor overrides verify the simulated PIN */
  pinVerified: boolean
  reason: string
  amountP?: Poisha
  decidedAt?: Ms
}

export type ShiftRow = BaseRow & {
  cashierId: Id
  branchId: BranchCode
  date: ISODate
  openedAt: Ms
  floatP: Poisha
  closedAt?: Ms
  countedP?: Poisha
  /** Denomination (as a string, e.g. "1000") to note count */
  denominations?: Record<string, number>
  /** Expected cash snapshot taken at close */
  expectedP?: Poisha
  varianceP?: Poisha
  status: "open" | "closing" | "closed"
  varianceApprovalId?: Id
}

export type FeeShareAccrualRow = BaseRow & {
  doctorId: Id
  invoiceId: Id
  invoiceLineId: Id
  contractId: Id
  contractVersion: number
  serviceType: ServiceType
  /** YYYY-MM */
  month: string
  patientUhid?: string
  grossP: Poisha
  discountP: Poisha
  netP: Poisha
  basis: FeeShareRule["basis"]
  shareP: Poisha
  whtP: Poisha
  reversalOfId?: Id
  at: Ms
}

export type MfsSettlementRow = BaseRow & {
  provider: "bkash" | "nagad"
  date: ISODate
  lines: {
    ref: string
    amountP: Poisha
    at: Ms
    matchedPaymentId?: Id
    /** "auto" when matched on import by reference, otherwise the staff id who matched it */
    matchedBy?: Id
    /** Finance note on an unmatched line (e.g. "under investigation") */
    note?: string
  }[]
  status: "pending-import" | "imported" | "reconciled"
  importedAt?: Ms
}

export type CorporateClientRow = BaseRow & {
  code: string
  name: Bilingual
  contactName: string
  phone: string
  creditLimitP: Poisha
}

export type CorporateContractRow = BaseRow & {
  clientId: Id
  validFrom: ISODate
  validTo: ISODate
  coveredServices: ServiceType[]
  discountPct: number
  coPayPct: number
  annualLimitP: Poisha
  status: "active" | "expired"
}

export type CorporateEmployeeRow = BaseRow & {
  clientId: Id
  contractId: Id
  employeeNo: string
  patientId?: Id
  nameEn: string
  relation: "employee" | "spouse" | "child" | "parent"
  status: "active" | "left"
  usedP: Poisha
}

/* ---------------- Procurement ---------------- */

export type VendorRow = BaseRow & {
  code: string
  name: string
  phone: string
  kind: "manufacturer-depot" | "distributor" | "general"
  paymentTermsDays: number
}

export type PurchaseRequestRow = BaseRow & {
  prNo: string
  branchId: BranchCode
  requestedBy: Id
  status: "draft" | "submitted" | "approved" | "rejected" | "ordered"
  totalP: Poisha
  /** Who must approve: the lowest tier covering the value whose approver is not the requester */
  approvalTier: "store-manager" | "procurement-head" | "cfo"
  approvalId?: Id
  submittedAt?: Ms
  note?: string
  /** Suggested supplier (the brand's manufacturer depot by default) */
  vendorId?: Id
  decidedBy?: Id
  decidedAt?: Ms
  /** Approver's reason (required on rejection) */
  decisionNote?: string
}

export type PrLineRow = BaseRow & {
  prId: Id
  brandId: Id
  /** Packs when `pack` is set, otherwise base units */
  qty: number
  /** Per pack when `pack` is set, otherwise per base unit */
  estUnitCostP: Poisha
  lineTotalP: Poisha
  /** Ordering pack (from the brand's pack sizes), e.g. a box of 10 x 10 strip = 100 tablets */
  pack?: PackSize
}

export type PurchaseOrderRow = BaseRow & {
  poNo: string
  prId?: Id
  vendorId: Id
  branchId: BranchCode
  status: "issued" | "partial" | "received" | "closed" | "cancelled"
  issuedAt: Ms
  expectedAt?: Ms
  totalP: Poisha
}

export type PoLineRow = BaseRow & {
  poId: Id
  brandId: Id
  /**
   * Quantities and cost count packs when `pack` is set (stock moves in base
   * units: packs x pack.units), otherwise base units. Pending = ordered minus
   * accepted (received minus rejected).
   */
  qtyOrdered: number
  unitCostP: Poisha
  qtyReceived: number
  qtyRejected: number
  pack?: PackSize
}

export type GrnRow = BaseRow & {
  grnNo: string
  poId: Id
  branchId: BranchCode
  receivedBy: Id
  receivedAt: Ms
  status: "partial" | "complete"
  note?: string
}

export type GrnLineRow = BaseRow & {
  grnId: Id
  poLineId: Id
  brandId: Id
  batchNo: string
  expiry: ISODate
  qtyReceived: number
  qtyAccepted: number
  qtyRejected: number
  rejectReason?: "damaged" | "short-expiry" | "wrong-item" | "other"
  quarantine: boolean
  batchId?: Id
}

export type VendorInvoiceRow = BaseRow & {
  /** Our reference (VI-03301) */
  vendorInvoiceNo: string
  vendorId: Id
  poId: Id
  amountP: Poisha
  /** Quantities and unit costs in the PO line's unit (packs when the line has one) */
  lines: { poLineId: Id; qty: number; unitCostP: Poisha }[]
  receivedAt: Ms
  status: "received" | "matched" | "mismatch" | "payable" | "rejected"
  /** The supplier's own invoice number */
  vendorRef?: string
  /** Date printed on the supplier's invoice */
  invoiceDate?: ISODate
}

export type ThreeWayMatchRow = BaseRow & {
  poId: Id
  grnIds: Id[]
  vendorInvoiceId: Id
  status: "matched" | "mismatch" | "resolved"
  diffs: {
    poLineId: Id
    field: "qty" | "price"
    po: number
    grn: number
    invoice: number
  }[]
  resolvedBy?: Id
  note?: string
  /** How finance settled a mismatch */
  resolution?: "pay-po-price" | "accept-invoice" | "reject-invoice"
  resolvedAt?: Ms
  approvalId?: Id
}

export type PayableRow = BaseRow & {
  vendorId: Id
  vendorInvoiceId: Id
  poId: Id
  amountP: Poisha
  dueDate: ISODate
  status: "open" | "scheduled" | "paid"
  /** Payment run date when scheduled */
  scheduledFor?: ISODate
  paidAt?: Ms
  /** Simulated bank transfer reference */
  paymentRef?: string
}

export type AccountingExportRow = BaseRow & {
  date: ISODate
  companyId: CompanyCode
  rows: number
  totalDebitP: Poisha
  totalCreditP: Poisha
  fileName: string
  exportedBy: Id
}

/* ================================================================== *
 * 5.8 Inpatient administration (billing and beds, not a clinical record)
 * ================================================================== */

export type WardRow = BaseRow & {
  branchId: BranchCode
  code: string
  name: Bilingual
  kind: "general" | "semi-private" | "cabin" | "paediatric"
  bedDayRateP: Poisha
}

export type BedRow = BaseRow & {
  wardId: Id
  branchId: BranchCode
  code: string
  status: "vacant" | "occupied" | "cleaning" | "reserved"
  admissionId?: Id
}

export type AdmissionRow = BaseRow & {
  admissionNo: string
  patientId: Id
  branchId: BranchCode
  consultantId: Id
  bedId: Id
  admittedAt: Ms
  dischargedAt?: Ms
  status: "admitted" | "discharged"
  reason: string
  corporateClientId?: Id
  /**
   * Set when the deposit left fell below rules.depositThresholdP and the alert
   * was raised; cleared by a top-up that restores it, so each crossing alerts once.
   */
  depositAlertAt?: Ms
  /** Bed transfers, oldest first: the interim bill charges each day at the ward it began in */
  wardMoves?: {
    at: Ms
    fromBedId: Id
    toBedId: Id
    fromWardId: Id
    toWardId: Id
  }[]
}

export type DepositRow = BaseRow & {
  admissionId: Id
  patientId: Id
  branchId: BranchCode
  amountP: Poisha
  tender: Tender
  paymentId?: Id
  at: Ms
  /** The cashier's open shift: cash deposits count in that drawer's expected cash */
  shiftId?: Id
  cashierId?: Id
  /** Money receipt (RC-B1-000123) */
  receiptNo?: string
  /** Card approval code or bKash / Nagad transaction id (simulated) */
  ref?: string
}

/* ================================================================== *
 * 5.9 Communication, platform and demo
 * ================================================================== */

export type SmsRow = BaseRow & {
  to: string
  patientId?: Id
  branchId?: BranchCode
  lang: Locale
  templateId: string
  /** Never contains results, diagnoses or medicine names */
  text: string
  parts: number
  encoding: "GSM" | "UCS-2"
  kind: "transactional" | "promotional"
  status: "queued" | "sent" | "delivered" | "failed" | "held-offline"
  queuedAt: Ms
  deliveredAt?: Ms
}

export type NotificationRow = BaseRow & {
  patientId: Id
  kind: string
  /** Push text is always generic ("You have a new notification") */
  titleKey: string
  params?: Record<string, string | number>
  refs: Refs
  read: boolean
  at: Ms
  /** Held while the branch is offline; released on central confirmation */
  held?: boolean
}

export type SyncExceptionRow = BaseRow & {
  kind:
    | "stock-negative"
    | "version-conflict"
    | "identity-conflict"
    | "rule-violation"
  branchId: BranchCode
  table: string
  rowId: Id
  detail: string
  status: "open" | "acknowledged"
}

export type DailyStatRow = BaseRow & {
  branchId: BranchCode
  date: ISODate
  dept: "opd" | "lab" | "imaging" | "pharmacy" | "inpatient"
  visits: number
  newPatients: number
  billedP: Poisha
  collectedP: Poisha
  outstandingP: Poisha
  avgWaitMin: number
  labTatMin: number
  expensesP: Poisha
  stockValueP: Poisha
  /**
   * The same day split by service, for the dashboard drill-down (branch to
   * department to service). Keys: OPD specialty code, lab section, imaging
   * modality, pharmacy sale category (rx / otc / controlled), inpatient ward kind.
   */
  services?: { key: string; visits: number; billedP: Poisha }[]
  /** Set on today's baseline row: the figures cover the day only up to this moment */
  asAt?: Ms
}

export type ScenarioRunRow = BaseRow & {
  scenarioId: string
  at: Ms
  personaId: Id
  refs: Refs
}

/* ---------------- Engine-owned (no BaseRow) ---------------- */

export type ActorRef = {
  staffId: Id
  personaId?: Id
  role: Role | "system"
  branchId: BranchCode | null
  name: string
}

export type EventRow = {
  /** Global order within this database; assigned under the commit lock */
  seq: number
  id: Id
  type: string
  v: number
  /** Demo-clock time */
  at: Ms
  /** Wall-clock time the commit happened */
  realAt: number
  actor: ActorRef
  branchId: BranchCode | null
  patientId?: Id
  refs: Refs
  summaryKey: string
  params: Record<string, string | number>
  consumers: string[]
  commitId: Id
  command: string
  origin: Origin
  originAt?: Ms
  replayedAt?: Ms
}

export type AuditAction = "insert" | "update" | "delete" | "blocked" | "system"

export type AuditRow = {
  seq: number
  commitId: Id
  command: string
  at: Ms
  actor: ActorRef
  action: AuditAction
  /** Table name, or "command" for blocked attempts and system entries */
  entity: string
  entityId: Id
  patientId?: Id
  /** Changed fields only, before and after */
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  reason?: string
  approvedBy?: Id
  /** Rule code for blocked attempts */
  code?: string
  origin: Origin
  prevHash: string
  hash: string
}

export type CounterRow = { id: string; value: number }

export type IdempotencyRow = {
  key: string
  commitId: Id
  command: string
  result: unknown
  at: Ms
}

export type AppliedCommitRow = { commitId: Id; appliedAt: Ms; origin: Origin }

/** One change inside a commit, as recorded in the edge outbox. */
export type ChangeOp =
  | { kind: "insert"; table: string; row: BaseRow }
  | {
      kind: "update"
      table: string
      id: Id
      baseVersion: number
      /** Changed fields before the update */
      before: Record<string, unknown>
      after: BaseRow
    }
  | { kind: "delete"; table: string; id: Id; before: BaseRow }

export type OutboxRow = {
  seq: number
  commitId: Id
  command: string
  actor: ActorRef
  at: Ms
  ops: ChangeOp[]
  events: EventRow[]
  audit: AuditRow[]
}

/* ---------------- Control database (demo controls) ---------------- */

export type ClockRow = { id: "clock"; offsetMs: number; updatedAt: number }

export type NetworkRow = {
  branchId: BranchCode
  status: "online" | "offline" | "syncing"
  /** Demo-clock time the branch went offline */
  since?: Ms
  snapshotSeq?: number
  edgeDbName?: string
  queuedCount: number
  lastReplay?: { count: number; conflicts: number; at: Ms }
}

export type DemoMetaRow = {
  id: "meta"
  seedVersion: number
  /** Wall-clock time of the last seed */
  seededAt: number
  /** Demo day the seed is anchored to */
  seedDate: ISODate
}
