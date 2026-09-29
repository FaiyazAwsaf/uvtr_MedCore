import { z } from "zod"

import type { BranchCode } from "@/config/brand.config"
import type { AdmissionRow, BedRow, DepositRow, Id, Poisha, WardRow } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import { nextAdmissionNo, nextReceiptNo } from "@/core/engine/docNumbers"
import type { Tx } from "@/core/engine/types"
import type { InterimBill } from "@/core/inpatient/interim"
import { actorBranch, coverFor, moneyParams, requireShift, tenderParams } from "@/modules/billing/settle"

import {
  bedStatusParams,
  mayChangeBed,
  nameParams,
  patientParams,
  stayBill,
  wardParams,
  wardRefusal,
} from "./stay"

/**
 * Inpatient billing and beds (plan §5.8, §12 WS-J). Administrative only:
 * admissions, beds, deposits and the interim bill; never a clinical record.
 * Each command is ONE atomic commit, refuses with a rule code explained under
 * `inpatient.rules.<CODE>`, and emits an event for every state change.
 */

const idempotencyKey = z.string().min(8).max(80)

/* ------------------------------------------------------------------ *
 * Shared checks
 * ------------------------------------------------------------------ */

/** An admitted stay at the actor's branch (only that branch changes it). */
async function ownStay(
  tx: Tx,
  admissionId: Id,
  branch: BranchCode,
  expectedVersion?: number
): Promise<AdmissionRow> {
  const admission = await tx.get("admissions", admissionId, { expectedVersion })
  if (admission.branchId !== branch) tx.reject("STAY_OTHER_BRANCH", { branch: admission.branchId })
  if (admission.status !== "admitted") {
    tx.reject("NOT_ADMITTED", { admissionNo: admission.admissionNo })
  }
  return admission
}

/** A bed at the actor's branch that can take a patient (vacant, or reserved when allowed). */
function checkFreeBed(tx: Tx, bed: BedRow, branch: BranchCode, allowReserved: boolean): void {
  if (bed.branchId !== branch) tx.reject("BED_OTHER_BRANCH", { bed: bed.code, branch: bed.branchId })
  if (bed.status === "occupied") tx.reject("BED_OCCUPIED", { bed: bed.code })
  if (bed.status === "cleaning") tx.reject("BED_BEING_CLEANED", { bed: bed.code })
  if (bed.status === "reserved" && !allowReserved) tx.reject("BED_RESERVED", { bed: bed.code })
}

/** The interim bill of a stay as this transaction sees it (its own deposits included). */
async function billInTx(tx: Tx, admission: AdmissionRow): Promise<{
  bill: InterimBill
  deposits: DepositRow[]
}> {
  const bed = await tx.get("beds", admission.bedId)
  const ward = await tx.get("wards", bed.wardId)
  const wardById = new Map<Id, WardRow>([[ward.id, ward]])
  for (const move of admission.wardMoves ?? []) {
    for (const id of [move.fromWardId, move.toWardId]) {
      const row = wardById.get(id) ?? (await tx.find("wards", id))
      if (row) wardById.set(id, row)
    }
  }
  const consultant = await tx.find("doctors", admission.consultantId)
  const deposits = await tx.list("deposits", "admissionId", admission.id)
  return {
    bill: stayBill({ admission, ward, wardById, consultant, deposits, at: tx.now() }),
    deposits,
  }
}

async function consultantParams(tx: Tx, doctorId: Id) {
  const doctor = await tx.find("doctors", doctorId)
  const staff = doctor ? await tx.find("staff", doctor.staffId) : undefined
  return nameParams("consultant", staff, doctorId)
}

/* ------------------------------------------------------------------ *
 * inpatient.admit
 * ------------------------------------------------------------------ */

export type AdmitResult = { admissionId: Id; admissionNo: string; bedCode: string }

/**
 * Admit a registered patient to a vacant or reserved bed at the receptionist's
 * branch under a consultant who works there. `bedVersion` is the bed as the
 * receptionist saw it: if another window admitted into it first, the commit
 * conflicts ("Record changed") instead of double-booking the bed. The
 * patient's corporate cover, when they have one today, is kept on the stay.
 */
export const admit = defineCommand({
  name: "inpatient.admit",
  roles: ["receptionist"],
  input: z.object({
    patientId: z.string().min(1),
    bedId: z.string().min(1),
    bedVersion: z.number().int().positive(),
    consultantId: z.string().min(1),
    reason: z.string().max(160),
    idempotencyKey: idempotencyKey.optional(),
  }),
  async run(tx, input): Promise<AdmitResult> {
    const branch = actorBranch(tx)
    const bed = await tx.get("beds", input.bedId, { expectedVersion: input.bedVersion })
    checkFreeBed(tx, bed, branch, true)
    const ward = await tx.get("wards", bed.wardId)

    const patient = await tx.get("patients", input.patientId)
    if (patient.identityStatus === "merged") {
      const survivor = patient.mergedInto ? await tx.find("patients", patient.mergedInto) : undefined
      tx.reject("PATIENT_MERGED", { uhid: survivor?.uhid ?? patient.uhid })
    }
    const current = (await tx.list("admissions", "patientId", patient.id)).find(
      (a) => a.status === "admitted"
    )
    if (current) {
      tx.reject("ALREADY_ADMITTED", { admissionNo: current.admissionNo, branch: current.branchId })
    }
    const refusal = wardRefusal(ward, patient, tx.today())
    if (refusal) tx.reject(refusal, { ward: ward.code })

    const doctor = await tx.find("doctors", input.consultantId)
    if (!doctor || doctor.kind !== "consultant") return tx.reject("NOT_A_CONSULTANT", {})
    if (!doctor.branchIds.includes(branch)) tx.reject("CONSULTANT_NOT_AT_BRANCH", { branch })
    const reason = input.reason.trim()
    if (!reason) tx.reject("REASON_REQUIRED", {})

    const cover = await coverFor(tx, patient, tx.today())
    const admissionNo = await nextAdmissionNo(tx, branch)
    const admission = tx.insert("admissions", {
      admissionNo,
      patientId: patient.id,
      branchId: branch,
      consultantId: doctor.id,
      bedId: bed.id,
      admittedAt: tx.now(),
      status: "admitted",
      reason,
      corporateClientId: cover?.clientId,
    })
    await tx.update("beds", bed.id, { status: "occupied", admissionId: admission.id })

    tx.emit("PatientAdmitted", {
      refs: { patientId: patient.id, admissionId: admission.id, bedId: bed.id },
      params: {
        admissionNo,
        bed: bed.code,
        ...patientParams(patient),
        ...wardParams(ward),
        ...(await consultantParams(tx, doctor.id)),
      },
    })
    return { admissionId: admission.id, admissionNo, bedCode: bed.code }
  },
})

/* ------------------------------------------------------------------ *
 * inpatient.transferBed
 * ------------------------------------------------------------------ */

/**
 * Move an admitted patient to a vacant bed at the same branch. The old bed
 * goes for cleaning; the stay keeps its admission number, deposits and day
 * count. `toBedVersion` guards against another window taking the bed first.
 */
export const transferBed = defineCommand({
  name: "inpatient.transferBed",
  roles: ["receptionist"],
  input: z.object({
    admissionId: z.string().min(1),
    toBedId: z.string().min(1),
    toBedVersion: z.number().int().positive(),
    admissionVersion: z.number().int().positive().optional(),
    idempotencyKey: idempotencyKey.optional(),
  }),
  async run(tx, input) {
    const branch = actorBranch(tx)
    const admission = await ownStay(tx, input.admissionId, branch, input.admissionVersion)
    const to = await tx.get("beds", input.toBedId, { expectedVersion: input.toBedVersion })
    if (to.id === admission.bedId) tx.reject("SAME_BED", { bed: to.code })
    checkFreeBed(tx, to, branch, false)
    const toWard = await tx.get("wards", to.wardId)
    const patient = await tx.get("patients", admission.patientId)
    const refusal = wardRefusal(toWard, patient, tx.today())
    if (refusal) tx.reject(refusal, { ward: toWard.code })

    const from = await tx.get("beds", admission.bedId)
    await tx.update("beds", from.id, { status: "cleaning", admissionId: undefined })
    await tx.update("beds", to.id, { status: "occupied", admissionId: admission.id })
    await tx.update("admissions", admission.id, {
      bedId: to.id,
      wardMoves: [
        ...(admission.wardMoves ?? []),
        { at: tx.now(), fromBedId: from.id, toBedId: to.id, fromWardId: from.wardId, toWardId: to.wardId },
      ],
    })

    tx.emit("BedTransferred", {
      refs: { patientId: patient.id, admissionId: admission.id, bedId: to.id },
      params: {
        admissionNo: admission.admissionNo,
        from: from.code,
        to: to.code,
        ...patientParams(patient),
        ...wardParams(toWard),
      },
    })
    return { admissionId: admission.id, fromBed: from.code, toBed: to.code }
  },
})

/* ------------------------------------------------------------------ *
 * inpatient.setBedStatus
 * ------------------------------------------------------------------ */

/**
 * Housekeeping on the bed board: a cleaned bed is marked ready (vacant), and
 * a vacant bed is reserved for an incoming patient or released again.
 */
export const setBedStatus = defineCommand({
  name: "inpatient.setBedStatus",
  roles: ["receptionist"],
  input: z.object({
    bedId: z.string().min(1),
    status: z.enum(["vacant", "reserved"]),
    expectedVersion: z.number().int().positive(),
  }),
  async run(tx, input) {
    const branch = actorBranch(tx)
    const bed = await tx.get("beds", input.bedId, { expectedVersion: input.expectedVersion })
    if (bed.branchId !== branch) tx.reject("BED_OTHER_BRANCH", { bed: bed.code, branch: bed.branchId })
    if (bed.status === "occupied") tx.reject("BED_OCCUPIED", { bed: bed.code })
    if (!mayChangeBed(bed.status, input.status)) tx.reject("BED_CHANGE_NOT_ALLOWED", { bed: bed.code })
    const ward = await tx.get("wards", bed.wardId)
    await tx.update("beds", bed.id, { status: input.status })
    tx.emit("BedStatusChanged", {
      refs: { bedId: bed.id },
      params: { bed: bed.code, ...wardParams(ward), ...bedStatusParams(input.status) },
    })
    return { bedId: bed.id, status: input.status }
  },
})

/* ------------------------------------------------------------------ *
 * inpatient.takeDeposit
 * ------------------------------------------------------------------ */

export type DepositResult = {
  depositId: Id
  receiptNo: string
  /** Deposit left after this deposit (negative when the stay still owes) */
  balanceP: Poisha
  changeDueP: Poisha
  /** The deposit brought the stay back above the alert level and cleared it */
  alertCleared: boolean
}

/**
 * A deposit at the cashier's counter against an admitted stay, on the
 * cashier's open shift (cash deposits count in that drawer's expected cash).
 * Cash takes the amount received for the change; a card needs the simulated
 * terminal's approval code; bKash and Nagad need the customer's simulated
 * approval in the app, which gives the transaction id (and need the internet,
 * so not while the branch is offline). Issues a money receipt number. If the
 * deposit left rises back to the threshold, the deposit alert clears in the
 * same commit, so the next crossing alerts again.
 */
export const takeDeposit = defineCommand({
  name: "inpatient.takeDeposit",
  roles: ["cashier"],
  input: z.object({
    admissionId: z.string().min(1),
    amountP: z.number().int(),
    tender: z.enum(["cash", "card", "bkash", "nagad"]),
    tenderedP: z.number().int().nonnegative().optional(),
    ref: z.string().trim().min(1).max(40).optional(),
    idempotencyKey,
  }),
  async run(tx, input): Promise<DepositResult> {
    const branch = actorBranch(tx)
    const shift = await requireShift(tx, branch)
    const admission = await ownStay(tx, input.admissionId, branch)
    if (input.amountP <= 0) tx.reject("AMOUNT_INVALID", {})
    let changeDueP = 0
    if (input.tender === "cash" && input.tenderedP !== undefined) {
      if (input.tenderedP < input.amountP) {
        tx.reject("CASH_SHORT", { tenderedP: input.tenderedP, amountP: input.amountP })
      }
      changeDueP = input.tenderedP - input.amountP
    }
    if (input.tender === "card" && !input.ref) tx.reject("CARD_NOT_APPROVED", {})
    if (input.tender === "bkash" || input.tender === "nagad") {
      if (tx.isEdge) tx.reject("MFS_OFFLINE", {})
      if (!input.ref) tx.reject("MFS_NOT_APPROVED", {})
    }

    const patient = await tx.get("patients", admission.patientId)
    const receiptNo = await nextReceiptNo(tx, branch)
    const deposit = tx.insert("deposits", {
      admissionId: admission.id,
      patientId: patient.id,
      branchId: branch,
      amountP: input.amountP,
      tender: input.tender,
      at: tx.now(),
      shiftId: shift.id,
      cashierId: tx.actor.staffId,
      receiptNo,
      ref: input.tender === "cash" ? undefined : input.ref,
    })

    const { bill } = await billInTx(tx, admission)
    const refs = { patientId: patient.id, admissionId: admission.id, depositId: deposit.id }
    tx.emit("DepositReceived", {
      refs: { ...refs, shiftId: shift.id },
      params: {
        admissionNo: admission.admissionNo,
        receiptNo,
        ...patientParams(patient),
        ...moneyParams(input.amountP),
        ...tenderParams(input.tender),
      },
    })
    const alertCleared = admission.depositAlertAt !== undefined && !bill.low
    if (alertCleared) {
      await tx.update("admissions", admission.id, { depositAlertAt: undefined })
      tx.emit("DepositAlertCleared", {
        refs,
        params: {
          admissionNo: admission.admissionNo,
          ...patientParams(patient),
          ...moneyParams(bill.balanceP, "balance"),
        },
      })
    }
    return { depositId: deposit.id, receiptNo, balanceP: bill.balanceP, changeDueP, alertCleared }
  },
})

/* ------------------------------------------------------------------ *
 * inpatient.issueInterimBill
 * ------------------------------------------------------------------ */

export type InterimIssue = {
  admissionNo: string
  at: number
  days: number
  chargesP: Poisha
  depositsP: Poisha
  balanceP: Poisha
}

/**
 * Record that an interim bill was issued (viewed and printed) for a stay,
 * with its figures at this moment. Nothing is invoiced: the final invoice is
 * made at discharge, so no invoice rows are written.
 */
export const issueInterimBill = defineCommand({
  name: "inpatient.issueInterimBill",
  roles: ["cashier", "receptionist"],
  input: z.object({ admissionId: z.string().min(1) }),
  async run(tx, input): Promise<InterimIssue> {
    const branch = actorBranch(tx)
    const admission = await ownStay(tx, input.admissionId, branch)
    const patient = await tx.get("patients", admission.patientId)
    const { bill } = await billInTx(tx, admission)
    tx.emit("InterimBillIssued", {
      refs: { patientId: patient.id, admissionId: admission.id },
      params: {
        admissionNo: admission.admissionNo,
        days: bill.days,
        ...patientParams(patient),
        ...moneyParams(bill.chargesP, "charges"),
        ...moneyParams(bill.depositsP, "deposits"),
        ...moneyParams(bill.balanceP, "balance"),
      },
    })
    return {
      admissionNo: admission.admissionNo,
      at: tx.now(),
      days: bill.days,
      chargesP: bill.chargesP,
      depositsP: bill.depositsP,
      balanceP: bill.balanceP,
    }
  },
})

/* ------------------------------------------------------------------ *
 * inpatient.raiseDepositAlert (sweeper only)
 * ------------------------------------------------------------------ */

/**
 * Raise the deposit threshold alert for a stay (plan §3.8, PRD §8.8): its
 * deposit left fell below `rules.depositThresholdP`. Committed by the leader
 * window's sweeper as the System actor. Idempotent: a stay whose alert is
 * already raised, that is no longer admitted, or is no longer low (a top-up
 * landed meanwhile) is left alone, so each crossing alerts exactly once.
 */
export const raiseDepositAlert = defineCommand({
  name: "inpatient.raiseDepositAlert",
  roles: [],
  input: z.object({ admissionId: z.string().min(1) }),
  async run(tx, input): Promise<{ raised: boolean }> {
    const admission = await tx.get("admissions", input.admissionId)
    if (admission.status !== "admitted" || admission.depositAlertAt !== undefined) {
      return { raised: false }
    }
    const { bill } = await billInTx(tx, admission)
    if (!bill.low) return { raised: false }
    const patient = await tx.get("patients", admission.patientId)
    await tx.update("admissions", admission.id, { depositAlertAt: tx.now() })
    tx.emit("DepositLow", {
      branchId: admission.branchId,
      refs: { patientId: patient.id, admissionId: admission.id },
      params: {
        admissionNo: admission.admissionNo,
        days: bill.days,
        ...patientParams(patient),
        ...moneyParams(bill.balanceP, "balance"),
      },
    })
    return { raised: true }
  },
})
