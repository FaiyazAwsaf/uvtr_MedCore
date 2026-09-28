import type { BranchCode } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { notifyPatient, queueSms } from "@/core/comms/sms"
import type {
  BasketLineRow,
  CorporateClientRow,
  CorporateContractRow,
  CorporateEmployeeRow,
  Id,
  InvoiceLineRow,
  InvoiceRow,
  LabOrderItemRow,
  PatientRow,
  PaymentRow,
  Poisha,
  ShiftRow,
  Tender,
} from "@/core/db/schema"
import type { Row, TableName } from "@/core/db/tables"
import { nextInvoiceNo, nextReceiptNo } from "@/core/engine/docNumbers"
import type { Tx } from "@/core/engine/types"
import { createSpecimensForItems } from "@/core/lab/specimens"
import type { Locale } from "@/lib/i18n/config"
import { formatMoney } from "@/lib/i18n/format"

import { billingBn } from "./i18n/bn"
import { billingEn } from "./i18n/en"
import {
  computeBill,
  contractInForce,
  feeShareAmounts,
  feeShareRuleFor,
  isMfs,
  type CoverInfo,
} from "./pricing"
import { corporateRef, mfsTrxId } from "./simulated"

/**
 * The transaction internals shared by every billing command. There is ONE
 * path from money to work: `refreshInvoice` recomputes an invoice from its
 * CONFIRMED payments and, the moment it becomes fully paid, `settleInvoice`
 * applies every unlock in the same commit. Pending bKash or Nagad payments
 * are never counted, so they can never unlock anything (INV-09).
 */

/* ------------------------------------------------------------------ *
 * Event parameters (the stream drawer shows them in both languages)
 * ------------------------------------------------------------------ */

/** Money in both languages, for event labels: `{amount}` in EN, `{amountBn}` in BN. */
export function moneyParams(poisha: Poisha, key = "amount"): Record<string, string> {
  return { [key]: formatMoney(poisha, "en"), [`${key}Bn`]: formatMoney(poisha, "bn") }
}

/** A tender's name in both languages, from this module's dictionaries. */
export function tenderParams(tender: Tender): Record<string, string> {
  return { tender: billingEn.billing.tender[tender], tenderBn: billingBn.billing.tender[tender] }
}

/* ------------------------------------------------------------------ *
 * Shift, patient and access checks
 * ------------------------------------------------------------------ */

/** The acting cashier's open shift at a branch, if any. */
export async function openShiftOf(
  tx: Tx,
  cashierId: Id,
  branch: BranchCode
): Promise<ShiftRow | undefined> {
  const open = await tx.list("shifts", "[branchId+status]", [branch, "open"])
  return open.find((shift) => shift.cashierId === cashierId)
}

/** The actor's branch, or a rejection for network-level personas. */
export function actorBranch(tx: Tx): BranchCode {
  const branch = tx.actor.branchId
  if (!branch) tx.reject("NO_BRANCH", {})
  return branch
}

/**
 * Patient-app access (plan §9 `/app`): a patient may pay for themself and for
 * family members whose link to their account is granted (guardian or proxy).
 */
export async function patientMayActFor(tx: Tx, patientId: Id): Promise<boolean> {
  const self = tx.actor.staffId
  if (self === patientId) return true
  const links = await tx.list("familyLinks", "ownerPatientId", self)
  return links.some((link) => link.memberPatientId === patientId && link.status === "granted")
}

export async function billablePatient(tx: Tx, patientId: Id): Promise<PatientRow> {
  const patient = await tx.get("patients", patientId)
  if (patient.identityStatus === "merged") {
    const survivor = patient.mergedInto ? await tx.find("patients", patient.mergedInto) : undefined
    tx.reject("PATIENT_MERGED", { uhid: survivor?.uhid ?? patient.uhid })
  }
  return patient
}

/* ------------------------------------------------------------------ *
 * Basket lines
 * ------------------------------------------------------------------ */

/**
 * Loads the basket lines being billed and checks each one: it exists, is
 * still open (another window may have billed it a moment ago), belongs to
 * this patient and branch, and its order was not cancelled or replaced in
 * the meantime. Anything stale is refused with the line's name, so the
 * cashier can untick it; nothing is ever billed twice.
 */
export async function loadBillLines(
  tx: Tx,
  opts: { patientId: Id; lineIds: Id[]; branch?: BranchCode }
): Promise<{ lines: BasketLineRow[]; branch: BranchCode }> {
  const ids = [...new Set(opts.lineIds)]
  if (!ids.length) tx.reject("NOTHING_SELECTED", {})
  const lines: BasketLineRow[] = []
  for (const id of ids) {
    const line = await tx.find("basketLines", id)
    if (!line) tx.reject("LINE_NOT_FOUND", {})
    if (line.patientId !== opts.patientId) {
      tx.reject("LINE_WRONG_PATIENT", { item: line.description })
    }
    if (line.status !== "open") tx.reject("LINE_NOT_OPEN", { item: line.description })
    if (opts.branch && line.branchId !== opts.branch) {
      tx.reject("LINE_WRONG_BRANCH", { item: line.description })
    }
    lines.push(line)
  }
  const branch = opts.branch ?? lines[0].branchId
  if (lines.some((line) => line.branchId !== branch)) tx.reject("LINES_MIXED_BRANCH", {})
  for (const line of lines) {
    if (!(await sourceBillable(tx, line))) {
      tx.reject("SOURCE_UNAVAILABLE", { item: line.description })
    }
  }
  return { lines, branch }
}

/** Whether the order behind a basket line can still be charged. */
async function sourceBillable(tx: Tx, line: BasketLineRow): Promise<boolean> {
  switch (line.sourceType) {
    case "test": {
      const item = await tx.find("labOrderItems", line.sourceId)
      return !!item && item.status !== "cancelled" && item.status !== "rejected"
    }
    case "imaging": {
      const order = await tx.find("imagingOrders", line.sourceId)
      return !!order && order.status !== "cancelled"
    }
    case "rx-line": {
      const rxLine = await tx.find("rxLines", line.sourceId)
      if (!rxLine || (rxLine.status !== "open" && rxLine.status !== "partial")) return false
      const rx = await tx.find("prescriptions", rxLine.rxId)
      return !!rx && rx.status === "signed"
    }
    case "consult": {
      const appointment = await tx.find("appointments", line.sourceId)
      return !!appointment && appointment.status !== "cancelled"
    }
    default:
      return true
  }
}

/* ------------------------------------------------------------------ *
 * Corporate cover
 * ------------------------------------------------------------------ */

export type Cover = CoverInfo & {
  employee: CorporateEmployeeRow
  contract: CorporateContractRow
  client?: CorporateClientRow
}

/** Reads by id: a transaction, or a database for live screens. */
export type RowReader = {
  find<T extends TableName>(table: T, id: Id): Promise<Row<T> | undefined>
}

/**
 * The patient's corporate cover today (PRD §10.10), or null: an active
 * employee or dependant on an active contract that is valid today. Lines
 * marked corporate without a live cover are billed to the patient.
 */
export async function coverFor(
  reader: RowReader,
  patient: PatientRow,
  today: string
): Promise<Cover | null> {
  if (!patient.corporateEmployeeId) return null
  const employee = await reader.find("corporateEmployees", patient.corporateEmployeeId)
  if (!employee || employee.status !== "active") return null
  const contract = await reader.find("corporateContracts", employee.contractId)
  if (
    !contract ||
    contract.status !== "active" ||
    today < contract.validFrom ||
    today > contract.validTo
  ) {
    return null
  }
  const client = await reader.find("corporateClients", employee.clientId)
  return {
    clientId: employee.clientId,
    coPayPct: contract.coPayPct,
    coveredServices: contract.coveredServices,
    remainingLimitP: Math.max(0, contract.annualLimitP - employee.usedP),
    employee,
    contract,
    client,
  }
}

/* ------------------------------------------------------------------ *
 * Invoice and payments
 * ------------------------------------------------------------------ */

export type NewInvoice = {
  invoice: InvoiceRow
  lines: InvoiceLineRow[]
  corporateShareP: Poisha
  patientDueP: Poisha
  cover: Cover | null
}

/**
 * One invoice for the branch's company (numbered per company, branch and
 * fiscal year, from the offline range while the branch is offline), with
 * one balanced line per basket line and the discount spread pro rata
 * (INV-03). The basket lines become invoiced; lab items are linked to their
 * invoice line. The invoice starts unpaid: payments are added next and
 * `refreshInvoice` sets what was actually received.
 */
export async function createInvoice(
  tx: Tx,
  opts: {
    patient: PatientRow
    branch: BranchCode
    lines: BasketLineRow[]
    discountPct: number
    discountApprovalId?: Id
    shiftId?: Id
    cashierId: Id
  }
): Promise<NewInvoice> {
  const cover = await coverFor(tx, opts.patient, tx.today())
  const bill = computeBill(opts.lines, opts.discountPct, cover)
  const { invoiceNo, companyId, offline } = await nextInvoiceNo(tx, opts.branch)
  const invoice = tx.insert("invoices", {
    invoiceNo,
    companyId,
    branchId: opts.branch,
    patientId: opts.patient.id,
    date: tx.today(),
    payerType: bill.payerType,
    corporateClientId: bill.payerType === "corporate" ? cover?.clientId : undefined,
    subtotalP: bill.subtotalP,
    discountP: bill.discountP,
    discountPct: opts.discountPct,
    discountApprovalId: opts.discountApprovalId,
    taxP: bill.taxP,
    totalP: bill.totalP,
    paidP: 0,
    refundedP: 0,
    status: "unpaid",
    offline: offline || undefined,
    shiftId: opts.shiftId,
    cashierId: opts.cashierId,
  })

  const invoiceLines: InvoiceLineRow[] = []
  for (const [index, basket] of opts.lines.entries()) {
    const priced = bill.lines[index]
    const line = tx.insert("invoiceLines", {
      invoiceId: invoice.id,
      basketLineId: basket.id,
      sourceType: basket.sourceType,
      sourceId: basket.sourceId,
      serviceType: basket.serviceType,
      description: basket.description,
      doctorId: basket.doctorId,
      qty: priced.qty,
      unitPriceP: priced.unitPriceP,
      amountP: priced.amountP,
      discountP: priced.discountP,
      netP: priced.netP,
      status: "active",
    })
    invoiceLines.push(line)
    await tx.update("basketLines", basket.id, { status: "invoiced" })
    if (basket.sourceType === "test") {
      const item = await tx.find("labOrderItems", basket.sourceId)
      if (item && !item.invoiceLineId) {
        await tx.update("labOrderItems", item.id, { invoiceLineId: line.id })
      }
    }
  }

  // The company's share is posted to its account at once (a confirmed
  // bypass, plan §3.3.1 INV-10); it counts against the employee's limit.
  if (cover && bill.corporateShareP > 0) {
    await tx.update("corporateEmployees", cover.employee.id, {
      usedP: cover.employee.usedP + bill.corporateShareP,
    })
    tx.insert("payments", {
      invoiceId: invoice.id,
      patientId: opts.patient.id,
      branchId: opts.branch,
      tender: "corporate",
      amountP: bill.corporateShareP,
      status: "confirmed",
      ref: corporateRef(cover.client?.code ?? cover.clientId, invoice.id),
      idempotencyKey: `${invoice.id}:corporate`,
      shiftId: opts.shiftId,
      requestedAt: tx.now(),
      confirmedAt: tx.now(),
    })
  }

  tx.emit("InvoiceIssued", {
    branchId: opts.branch,
    refs: { patientId: opts.patient.id, invoiceId: invoice.id },
    params: { invoiceNo, lines: invoiceLines.length, ...moneyParams(bill.totalP) },
  })
  return {
    invoice,
    lines: invoiceLines,
    corporateShareP: bill.corporateShareP,
    patientDueP: bill.patientDueP,
    cover,
  }
}

export type TenderInput = {
  tender: "cash" | "card" | "bkash" | "nagad"
  amountP: Poisha
  /** Cash handed over, for the change (cash only) */
  tenderedP?: Poisha
  /** Terminal approval code (card only) */
  ref?: string
}

/**
 * Checks counter tenders against what is due: they must add up exactly, a
 * card needs its terminal approval, cash received must cover the cash part,
 * and offline bKash or Nagad stays within the pending-verification limit
 * (PRD §16). Returns the change due.
 */
export async function checkTenders(
  tx: Tx,
  tenders: TenderInput[],
  dueP: Poisha,
  branch: BranchCode
): Promise<{ changeDueP: Poisha }> {
  const tenderedP = tenders.reduce((sum, t) => sum + t.amountP, 0)
  if (tenderedP !== dueP) tx.reject("TENDER_MISMATCH", { tenderedP, dueP })
  let changeDueP = 0
  for (const t of tenders) {
    if (t.tender === "card" && !t.ref) tx.reject("CARD_NOT_APPROVED", {})
    if (t.tender === "cash" && t.tenderedP !== undefined) {
      if (t.tenderedP < t.amountP) {
        tx.reject("CASH_SHORT", { tenderedP: t.tenderedP, amountP: t.amountP })
      }
      changeDueP += t.tenderedP - t.amountP
    }
  }
  const newMfsP = tenders.filter((t) => isMfs(t.tender)).reduce((s, t) => s + t.amountP, 0)
  if (tx.isEdge && newMfsP > 0) {
    const pending = (await tx.list("payments", "status", "pending")).filter(
      (p) => p.branchId === branch && isMfs(p.tender)
    )
    const pendingP = pending.reduce((sum, p) => sum + p.amountP, 0) + newMfsP
    if (pendingP > rules.offlineMfsPendingLimitP) {
      tx.reject("OFFLINE_MFS_LIMIT", { limitP: rules.offlineMfsPendingLimitP })
    }
  }
  return { changeDueP }
}

/**
 * Counter payments on an invoice: cash and approved cards are confirmed at
 * once; bKash and Nagad start pending (a push to the customer's phone) and
 * unlock nothing until confirmed. Each payment carries the checkout's
 * idempotency key, suffixed per tender.
 */
export function addPayments(
  tx: Tx,
  opts: {
    invoice: InvoiceRow
    tenders: TenderInput[]
    idempotencyKey: string
    shiftId?: Id
  }
): PaymentRow[] {
  const { invoice } = opts
  return opts.tenders.map((t, index) => {
    const pending = isMfs(t.tender)
    const payment = tx.insert("payments", {
      invoiceId: invoice.id,
      patientId: invoice.patientId,
      branchId: invoice.branchId,
      tender: t.tender,
      amountP: t.amountP,
      status: pending ? "pending" : "confirmed",
      ref: t.tender === "card" ? t.ref : undefined,
      idempotencyKey: `${opts.idempotencyKey}:${index + 1}`,
      shiftId: opts.shiftId,
      requestedAt: tx.now(),
      confirmedAt: pending ? undefined : tx.now(),
    })
    const params = { invoiceNo: invoice.invoiceNo, ...tenderParams(t.tender), ...moneyParams(t.amountP) }
    const refs = { patientId: invoice.patientId, invoiceId: invoice.id, paymentId: payment.id }
    if (pending) {
      tx.emit("PaymentPending", { branchId: invoice.branchId, refs, params })
    } else {
      tx.emit("PaymentReceived", { branchId: invoice.branchId, refs, params })
    }
    return payment
  })
}

/** Confirm a pending bKash or Nagad payment (the customer approved the push). */
export async function confirmPayment(
  tx: Tx,
  payment: PaymentRow,
  invoice: InvoiceRow,
  trxId?: string
): Promise<PaymentRow> {
  const confirmed = await tx.update("payments", payment.id, {
    status: "confirmed",
    confirmedAt: tx.now(),
    ref: trxId ?? payment.ref ?? mfsTrxId(payment.tender, payment.id),
  })
  tx.emit("PaymentReceived", {
    branchId: invoice.branchId,
    refs: { patientId: invoice.patientId, invoiceId: invoice.id, paymentId: payment.id },
    params: {
      invoiceNo: invoice.invoiceNo,
      ...tenderParams(payment.tender),
      ...moneyParams(payment.amountP),
    },
  })
  return confirmed
}

/** Money on an invoice that counts as received (refunds are tracked separately). */
function receivedP(payments: PaymentRow[]): Poisha {
  return payments
    .filter((p) => p.status === "confirmed" || p.status === "refunded")
    .reduce((sum, p) => sum + p.amountP, 0)
}

export type Settlement = {
  receiptId: Id
  receiptNo: string
  labItems: number
  specimens: number
  imagingOrders: number
  rxLines: number
  accruals: number
}

/**
 * Recompute an invoice from its confirmed payments (INV-03: paid only when
 * confirmed money covers the whole total) and settle it the moment it
 * becomes fully paid. Safe to call after any payment change.
 */
export async function refreshInvoice(
  tx: Tx,
  invoiceId: Id,
  opts: { smsLang?: Locale } = {}
): Promise<{ invoice: InvoiceRow; settlement?: Settlement }> {
  const current = await tx.get("invoices", invoiceId)
  if (current.status === "void" || current.status === "refunded") return { invoice: current }
  const payments = await tx.list("payments", "invoiceId", invoiceId)
  const paidP = receivedP(payments)
  if (paidP > current.totalP) tx.reject("INVOICE_OVERPAID", { invoiceNo: current.invoiceNo })
  const status: InvoiceRow["status"] =
    paidP === current.totalP ? "paid" : paidP > 0 ? "partial" : "unpaid"
  const invoice =
    paidP !== current.paidP || status !== current.status
      ? await tx.update("invoices", invoiceId, { paidP, status })
      : current
  if (status === "paid" && current.status !== "paid") {
    const settlement = await settleInvoice(tx, invoice, payments, opts.smsLang ?? "bn")
    return { invoice, settlement }
  }
  return { invoice }
}

/**
 * Everything a fully paid invoice unlocks, in the paying commit (plan §6):
 * lab items cleared and paid with specimens awaiting collection, imaging
 * orders paid, Rx lines cleared for dispensing, the consultation settled,
 * consultant fee share accrued on collection with withholding tax, a
 * receipt, a "payment received" SMS to a verified phone and a patient-app
 * notification. Orders cancelled in the meantime are skipped, never charged
 * twice and never crash the payment.
 */
async function settleInvoice(
  tx: Tx,
  invoice: InvoiceRow,
  payments: PaymentRow[],
  smsLang: Locale
): Promise<Settlement> {
  const branch = invoice.branchId
  const lines = (await tx.list("invoiceLines", "invoiceId", invoice.id)).filter(
    (line) => line.status === "active"
  )
  const patient = await tx.get("patients", invoice.patientId)
  const refsBase = { patientId: patient.id, invoiceId: invoice.id }

  /* The payment gate (INV-10): clear every paid line's work */
  const paidItems: LabOrderItemRow[] = []
  const rxCleared = new Map<Id, number>()
  let imagingOrders = 0
  for (const line of lines) {
    if (line.sourceType === "test") {
      const item = await tx.find("labOrderItems", line.sourceId)
      if (!item || item.status === "cancelled" || item.status === "rejected") continue
      paidItems.push(
        await tx.update("labOrderItems", item.id, {
          paymentCleared: true,
          status: item.status === "ordered" ? "paid" : item.status,
          invoiceLineId: item.invoiceLineId ?? line.id,
        })
      )
    } else if (line.sourceType === "imaging") {
      const order = await tx.find("imagingOrders", line.sourceId)
      if (!order || order.status === "cancelled") continue
      await tx.update("imagingOrders", order.id, {
        paymentCleared: true,
        status: order.status === "ordered" ? "paid" : order.status,
      })
      imagingOrders += 1
      tx.emit("ImagingUnlocked", {
        branchId: branch,
        refs: { ...refsBase, imagingOrderId: order.id },
        params: { orderNo: order.orderNo },
      })
    } else if (line.sourceType === "rx-line") {
      const rxLine = await tx.find("rxLines", line.sourceId)
      if (!rxLine || rxLine.status === "cancelled" || rxLine.status === "bought-elsewhere") {
        continue
      }
      if (!rxLine.paymentCleared) {
        await tx.update("rxLines", rxLine.id, { paymentCleared: true })
      }
      rxCleared.set(rxLine.rxId, (rxCleared.get(rxLine.rxId) ?? 0) + 1)
    }
    // Consultation lines: nothing is gated; the paid invoice settles them.
  }

  const specimens = await createSpecimensForItems(tx, paidItems)
  const byOrder = new Map<Id, number>()
  for (const item of paidItems) byOrder.set(item.labOrderId, (byOrder.get(item.labOrderId) ?? 0) + 1)
  for (const [labOrderId, count] of byOrder) {
    const order = await tx.find("labOrders", labOrderId)
    if (order?.status === "ordered") await tx.update("labOrders", order.id, { status: "in-progress" })
    tx.emit("SampleUnlocked", {
      branchId: branch,
      refs: { ...refsBase, labOrderId },
      params: { count, orderNo: order?.orderNo ?? "" },
    })
  }
  for (const [rxId, count] of rxCleared) {
    const rx = await tx.find("prescriptions", rxId)
    tx.emit("DispenseUnlocked", {
      branchId: branch,
      refs: { ...refsBase, rxId },
      params: { count, rxNo: rx?.rxNo ?? "" },
    })
  }

  /* Fee share on collection (PRD §10.9) */
  let accruals = 0
  const day = tx.today()
  for (const line of lines) {
    if (!line.doctorId) continue
    const existing = await tx.list("feeShareAccruals", "invoiceLineId", line.id)
    if (existing.some((a) => !a.reversalOfId)) continue
    const contract = contractInForce(
      await tx.list("feeShareContracts", "doctorId", line.doctorId),
      day
    )
    const rule = contract ? feeShareRuleFor(contract, line.serviceType) : undefined
    if (!contract || !rule) continue
    const { shareP, whtP } = feeShareAmounts(rule, contract, line)
    tx.insert("feeShareAccruals", {
      doctorId: line.doctorId,
      invoiceId: invoice.id,
      invoiceLineId: line.id,
      contractId: contract.id,
      contractVersion: contract.contractVersion,
      serviceType: line.serviceType,
      month: day.slice(0, 7),
      patientUhid: patient.uhid,
      grossP: line.amountP,
      discountP: line.discountP,
      netP: line.netP,
      basis: rule.basis,
      shareP,
      whtP,
      at: tx.now(),
    })
    accruals += 1
    const doctor = await tx.find("doctors", line.doctorId)
    const staff = doctor ? await tx.find("staff", doctor.staffId) : undefined
    tx.emit("FeeShareAccrued", {
      branchId: branch,
      refs: refsBase,
      params: {
        doctor: staff?.nameEn ?? line.doctorId,
        doctorBn: staff?.nameBn ?? staff?.nameEn ?? line.doctorId,
        ...moneyParams(shareP),
      },
    })
  }

  /* Receipt, SMS and the patient-app notice */
  const confirmed = payments.filter((p) => p.status === "confirmed")
  const fromPatientP = confirmed
    .filter((p) => p.tender !== "corporate")
    .reduce((sum, p) => sum + p.amountP, 0)
  const receiptNo = await nextReceiptNo(tx, branch)
  const receipt = tx.insert("receipts", {
    receiptNo,
    invoiceId: invoice.id,
    paymentIds: confirmed.map((p) => p.id),
    patientId: patient.id,
    branchId: branch,
    amountP: fromPatientP,
    at: tx.now(),
  })
  const smsConsent = patient.consents.find((c) => c.purpose === "sms")
  if (patient.phone && patient.phoneVerified && smsConsent?.granted !== false && fromPatientP > 0) {
    queueSms(tx, {
      to: patient.phone,
      patientId: patient.id,
      lang: smsLang,
      templateId: "payment-received",
      params: { amount: formatMoney(fromPatientP, smsLang), receiptNo },
    })
  }
  notifyPatient(tx, {
    patientId: patient.id,
    kind: "paymentReceived",
    titleKey: "patientApp.notifications.paymentReceived",
    params: { invoiceNo: invoice.invoiceNo, receiptNo },
    refs: refsBase,
  })

  return {
    receiptId: receipt.id,
    receiptNo,
    labItems: paidItems.length,
    specimens: specimens.length,
    imagingOrders,
    rxLines: [...rxCleared.values()].reduce((sum, n) => sum + n, 0),
    accruals,
  }
}
