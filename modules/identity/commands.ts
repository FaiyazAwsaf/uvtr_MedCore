import { z } from "zod"

import { ageOn } from "@/core/clock/dates"
import { newId } from "@/core/db/ids"
import { groupUhid } from "@/core/db/numbering"
import type { Consent, Id, PatientRow, Relation } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import { nextUhid } from "@/core/engine/docNumbers"
import type { Tx } from "@/core/engine/types"
import { findLikelyDuplicates, nameKeys } from "@/core/search/fuzzy"

import { isIdentityField, parseReviewDetail } from "./review"

import {
  BLOOD_GROUPS,
  BRN_PATTERN,
  canBeGuardian,
  ID_MISSING_NOTES,
  ID_MISSING_REASONS,
  isMinor,
  NID_PATTERN,
  NO_OWN_PHONE_NOTE,
  PASSPORT_PATTERN,
  PHONE_PATTERN,
  photoSeedFor,
} from "./registration"

const RELATION_VALUES = [
  "self",
  "spouse",
  "son",
  "daughter",
  "father",
  "mother",
  "brother",
  "sister",
  "grandchild",
  "grandparent",
  "other",
] as const satisfies readonly Relation[]

const relation = z.enum(RELATION_VALUES)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const phone = z.string().regex(PHONE_PATTERN)

const DECISION_BN = { same: "একই ব্যক্তি", different: "ভিন্ন ব্যক্তি" } as const

export const registerInput = z.object({
  nameEn: z.string().trim().min(2).max(80),
  nameBn: z.string().trim().min(1).max(80),
  dob: isoDate,
  dobEstimated: z.boolean().default(false),
  sex: z.enum(["M", "F"]),
  phone: phone.optional(),
  /** For patients without their own phone (no app access) */
  attendantPhone: phone.optional(),
  nid: z.string().regex(NID_PATTERN).optional(),
  brn: z.string().regex(BRN_PATTERN).optional(),
  passport: z.string().regex(PASSPORT_PATTERN).optional(),
  /** Required when no NID, BRN or passport is recorded */
  idMissingReason: z.enum(ID_MISSING_REASONS).optional(),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  address: z.string().trim().max(160).optional(),
  household: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("join"), householdId: z.string(), relation }),
      z.object({ mode: z.literal("new") }),
      z.object({ mode: z.literal("none") }),
    ])
    .default({ mode: "none" }),
  /** Mandatory under 18: an adult picked from the household, and their relation to the child */
  guardian: z.object({ patientId: z.string(), relation }).optional(),
  /** Consent per purpose; for a minor the guardian gives them */
  consents: z.object({
    treatment: z.boolean(),
    sms: z.boolean(),
    app: z.boolean(),
  }),
  /**
   * The front desk's answer to the ranked duplicate warning: "different
   * person", with the reason. Required whenever likely duplicates exist.
   */
  duplicateDecision: z
    .object({
      candidateIds: z.array(z.string()).min(1),
      score: z.number().min(0).max(1),
      reason: z.string().trim().min(3).max(300),
    })
    .optional(),
  idempotencyKey: z.string().optional(),
})

export type RegisterInput = z.input<typeof registerInput>

/**
 * Register a patient (plan §6 `identity.register`, PRD §10.1): one commit
 * with the patient (UHID from `nextUhid`, provisional while the branch is
 * offline), the household link, the guardian and consents per purpose, and
 * the recorded answer to the duplicate warning.
 *
 * - An exact NID or BRN match is refused by the engine's INV-02, which also
 *   audits the attempt; this command lets it through to that check.
 * - Likely duplicates (fuzzy name, date of birth, phone) must have been
 *   answered "different person" with a reason, or nothing is saved.
 * - Under 18 needs an adult guardian and the guardian's treatment consent
 *   (INV-11 is the engine's safety net).
 */
export const registerPatient = defineCommand({
  name: "identity.register",
  roles: ["receptionist"],
  input: registerInput,
  async run(tx, input) {
    const today = tx.today()
    const branch = tx.actor.branchId
    if (!branch) return tx.reject("BRANCH_REQUIRED", {})
    if (input.dob > today) tx.reject("DOB_IN_FUTURE", {})
    if (ageOn(input.dob, today) > 120) tx.reject("DOB_INVALID", {})

    const contact = input.phone ?? input.attendantPhone
    if (!contact) return tx.reject("CONTACT_REQUIRED", {})
    if (!input.nid && !input.brn && !input.passport && !input.idMissingReason) {
      tx.reject("ID_REASON_REQUIRED", {})
    }
    if (!input.consents.treatment) tx.reject("TREATMENT_CONSENT_REQUIRED", {})

    const minor = isMinor(input.dob, today)
    let guardian: PatientRow | undefined
    if (minor) {
      if (!input.guardian) return tx.reject("GUARDIAN_REQUIRED", { name: input.nameEn })
      guardian = await tx.get("patients", input.guardian.patientId)
      if (!canBeGuardian(guardian, today)) {
        tx.reject("GUARDIAN_NOT_ADULT", { uhid: guardian.uhid })
      }
    }

    const household = input.household
    if (household.mode === "join") {
      const row = await tx.get("households", household.householdId)
      if (row.phone !== contact) tx.reject("HOUSEHOLD_PHONE_MISMATCH", { phone: row.phone })
    } else if (household.mode === "new") {
      if ((await tx.list("households", "phone", contact)).length) {
        tx.reject("HOUSEHOLD_EXISTS", { phone: contact })
      }
    }

    // The duplicate warning must have been answered. An exact NID or BRN
    // match is left to INV-02, which blocks it and audits the attempt.
    const active = await tx.list("patients", "identityStatus", "active")
    const exactId = active.some(
      (p) => (input.nid && p.nid === input.nid) || (input.brn && p.brn === input.brn)
    )
    if (!exactId && !input.duplicateDecision) {
      const candidates = findLikelyDuplicates(
        {
          nameEn: input.nameEn,
          dob: input.dob,
          phone: contact,
          nid: input.nid,
          brn: input.brn,
        },
        active,
        { limit: 10 }
      )
      if (candidates.length) {
        tx.reject("DUPLICATE_UNRESOLVED", { count: candidates.length })
      }
    }

    const { uhid, provisional } = await nextUhid(tx)
    const id = newId("pat")
    const householdId =
      household.mode === "join"
        ? household.householdId
        : household.mode === "new"
          ? newId("hh")
          : undefined
    const at = tx.now()
    const byPatientId = guardian?.id
    const consents: Consent[] = [
      { purpose: "treatment", granted: true, at, byPatientId },
      { purpose: "sms", granted: input.consents.sms && !!input.phone, at, byPatientId },
      { purpose: "app", granted: input.consents.app, at, byPatientId },
    ]
    const notes = [
      input.idMissingReason && !input.nid && !input.brn && !input.passport
        ? ID_MISSING_NOTES[input.idMissingReason]
        : undefined,
      input.phone ? undefined : NO_OWN_PHONE_NOTE,
    ].filter(Boolean)

    const patient = tx.insert("patients", {
      id,
      uhid,
      provisionalUhid: provisional ? uhid : undefined,
      aliases: [],
      identityStatus: "active",
      nameEn: input.nameEn,
      nameBn: input.nameBn,
      nameSearchKeys: nameKeys(input.nameEn, input.nameBn),
      dob: input.dob,
      dobEstimated: input.dobEstimated || undefined,
      sex: input.sex,
      bloodGroup: input.bloodGroup,
      address: input.address,
      phone: input.phone,
      phoneVerified: false,
      attendantPhone: input.phone ? undefined : input.attendantPhone,
      nid: input.nid,
      brn: input.brn,
      passport: input.passport,
      householdId,
      relationToHead:
        household.mode === "join"
          ? household.relation
          : household.mode === "new"
            ? "self"
            : undefined,
      guardianPatientId: guardian?.id,
      guardianRelation: guardian ? input.guardian?.relation : undefined,
      allergies: [],
      currentMeds: [],
      problems: [],
      photoSeed: photoSeedFor(id, input.sex, input.dob, today),
      consents,
      registrationNote: notes.length ? notes.join("; ") : undefined,
      registeredAtBranch: branch,
    })

    if (household.mode === "join") {
      const row = await tx.get("households", household.householdId)
      await tx.update("households", row.id, { memberIds: [...row.memberIds, id] })
    } else if (household.mode === "new") {
      tx.insert("households", {
        id: householdId,
        phone: contact,
        memberIds: [id],
        headPatientId: id,
      })
    }

    const refs = { patientId: patient.id }
    if (input.duplicateDecision) {
      const decision = input.duplicateDecision
      tx.insert("duplicateDecisions", {
        candidateIds: decision.candidateIds,
        newPatientId: id,
        score: decision.score,
        decision: "different",
        reason: decision.reason,
        decidedBy: tx.actor.staffId,
        decidedAt: at,
      })
      tx.auditContext({ reason: decision.reason })
      tx.emit("DuplicateWarningResolved", {
        refs,
        params: {
          decision: "different",
          decisionBn: DECISION_BN.different,
          count: decision.candidateIds.length,
          uhid: groupUhid(uhid),
        },
      })
    }
    tx.emit("PatientRegistered", {
      refs,
      params: {
        name: input.nameEn,
        nameBn: input.nameBn,
        uhid: groupUhid(uhid),
        provisional: provisional ? 1 : 0,
      },
    })
    return { patientId: id, uhid, provisional }
  },
})

/**
 * The front desk answered the duplicate warning with "same person": nothing is
 * registered, the existing record opens, and the decision is recorded
 * (plan §5.2 `duplicateDecisions`, HAZ-02).
 */
export const confirmExistingPatient = defineCommand({
  name: "identity.resolveDuplicate",
  roles: ["receptionist"],
  input: z.object({
    /** The existing record the front desk picked */
    patientId: z.string(),
    /** Every candidate the warning showed */
    candidateIds: z.array(z.string()).min(1),
    score: z.number().min(0).max(1),
    reason: z.string().trim().max(300).optional(),
  }),
  async run(tx, input) {
    const patient = await tx.get("patients", input.patientId)
    if (patient.identityStatus === "merged") {
      tx.reject("PATIENT_MERGED", { uhid: patient.uhid })
    }
    const candidateIds = [
      patient.id,
      ...input.candidateIds.filter((candidate) => candidate !== patient.id),
    ]
    const reason = input.reason || "Existing record confirmed at the front desk"
    tx.insert("duplicateDecisions", {
      candidateIds,
      score: input.score,
      decision: "same",
      reason,
      decidedBy: tx.actor.staffId,
      decidedAt: tx.now(),
    })
    tx.auditContext({ reason })
    tx.emit("DuplicateWarningResolved", {
      refs: { patientId: patient.id },
      params: {
        decision: "same",
        decisionBn: DECISION_BN.same,
        count: candidateIds.length,
        uhid: groupUhid(patient.uhid),
      },
    })
    return { patientId: patient.id }
  },
})

/* ------------------------------------------------------------------ *
 * Data steward review queue (plan §3.7, HAZ-02, HAZ-08)
 * ------------------------------------------------------------------ */

/** Authority a second person needs to confirm a merge (HAZ-02). */
export const MERGE_AUTHORITY = "merge:patients"

const RESOLUTION_BN = {
  same: "একই ব্যক্তি, একীভূত",
  different: "ভিন্ন ব্যক্তি",
  "kept-central": "কেন্দ্রীয় তথ্য রাখা হয়েছে",
  "kept-edge": "শাখার তথ্য রাখা হয়েছে",
} as const
const RESOLUTION_EN = {
  same: "same person, merged",
  different: "different people",
  "kept-central": "central details kept",
  "kept-edge": "branch details kept",
} as const

const approvalInput = z.object({
  approverStaffId: z.string(),
  reason: z.string().trim().min(3).max(300),
  pinVerified: z.literal(true),
})

export const resolveReviewInput = z.discriminatedUnion("decision", [
  z.object({
    reviewId: z.string(),
    decision: z.literal("same"),
    /** The record that stays (the one already on central) */
    survivorId: z.string(),
    /** The record merged into it (it keeps its history, marked merged) */
    mergedId: z.string(),
    /** The second person's confirmation (supervisor override, simulated PIN) */
    approval: approvalInput,
  }),
  z.object({
    reviewId: z.string(),
    decision: z.literal("different"),
    reason: z.string().trim().min(3).max(300),
  }),
  z.object({
    reviewId: z.string(),
    decision: z.literal("fields"),
    /** Identity conflicts: which side's value to keep, per field */
    keep: z.record(z.string(), z.enum(["central", "edge"])),
    reason: z.string().trim().max(300).optional(),
  }),
])

export type ResolveReviewInput = z.input<typeof resolveReviewInput>

export type ResolveReviewResult = {
  reviewId: Id
  resolution: "same" | "different" | "kept-central" | "kept-edge"
  survivorId?: Id
  approvalId?: Id
  /** Merge: appointments and basket lines moved to the survivor */
  moved?: { appointments: number; basketLines: number }
}

/**
 * The merged record's open work moves to the survivor: appointments still to
 * be seen (with their queue tokens) and unpaid basket lines. Paid invoices,
 * encounters and results stay on the merged record, which remains readable.
 */
async function moveOpenWork(tx: Tx, fromId: Id, toId: Id) {
  const appointments = (await tx.list("appointments", "patientId", fromId)).filter(
    (a) => a.status === "booked" || a.status === "checked-in"
  )
  for (const appointment of appointments) {
    await tx.update("appointments", appointment.id, { patientId: toId })
    if (appointment.tokenId) {
      const token = await tx.find("queueTokens", appointment.tokenId)
      if (token) await tx.update("queueTokens", token.id, { patientId: toId })
    }
  }
  const lines = (await tx.list("basketLines", "patientId", fromId)).filter(
    (l) => l.status === "open"
  )
  for (const line of lines) {
    await tx.update("basketLines", line.id, { patientId: toId })
  }
  return { appointments: appointments.length, basketLines: lines.length }
}

/**
 * Resolve an item of the data steward's review queue (plan §3.7):
 * - sync duplicate, "same person": a two-person merge (HAZ-02). A second
 *   person holding `merge:patients` confirms with their PIN. The survivor keeps
 *   the other record's UHIDs as searchable aliases; the other record becomes
 *   "merged" (nothing is deleted) and its open work moves to the survivor.
 * - sync duplicate, "different people": with a reason; both records active.
 * - identity conflict: keep the central or the branch value, field by field.
 * The decision, the approval and the reason are recorded and audited.
 */
export const resolveReview = defineCommand({
  name: "identity.resolveReview",
  roles: ["receptionist"],
  input: resolveReviewInput,
  async run(tx, input): Promise<ResolveReviewResult> {
    const item = await tx.get("reviewQueue", input.reviewId)
    if (item.status !== "open") tx.reject("REVIEW_ALREADY_RESOLVED", {})
    const at = tx.now()

    if (input.decision === "same") {
      if (item.kind !== "sync-duplicate") tx.reject("REVIEW_WRONG_KIND", {})
      if (
        input.survivorId === input.mergedId ||
        !item.patientIds.includes(input.survivorId) ||
        !item.patientIds.includes(input.mergedId)
      ) {
        tx.reject("REVIEW_WRONG_RECORDS", {})
      }
      const survivor = await tx.get("patients", input.survivorId)
      const merged = await tx.get("patients", input.mergedId)
      for (const p of [survivor, merged]) {
        if (p.identityStatus === "merged") tx.reject("PATIENT_MERGED", { uhid: p.uhid })
      }
      // Two people: whoever asks, and a second person who holds the authority.
      if (input.approval.approverStaffId === tx.actor.staffId) {
        tx.reject("APPROVER_SAME_PERSON", {})
      }
      const approver = await tx.find("staff", input.approval.approverStaffId)
      if (
        !approver ||
        !(approver.authorities.includes(MERGE_AUTHORITY) || approver.authorities.includes("*"))
      ) {
        return tx.reject("MERGE_APPROVER_LACKS_AUTHORITY", {
          name: approver?.nameEn ?? input.approval.approverStaffId,
        })
      }
      const reason = input.approval.reason

      const aliases = [
        ...new Set(
          [
            ...survivor.aliases,
            merged.uhid,
            ...merged.aliases,
            merged.provisionalUhid,
          ].filter((a): a is string => !!a && a !== survivor.uhid)
        ),
      ]
      await tx.update("patients", survivor.id, {
        aliases,
        nameSearchKeys: [...new Set([...survivor.nameSearchKeys, ...merged.nameSearchKeys])],
        identityStatus: "active",
      })
      await tx.update("patients", merged.id, {
        identityStatus: "merged",
        mergedInto: survivor.id,
      })
      const moved = await moveOpenWork(tx, merged.id, survivor.id)

      const approval = tx.insert("approvals", {
        kind: "merge",
        refs: { patientId: survivor.id, reviewId: item.id },
        requestedBy: tx.actor.staffId,
        approverId: approver.id,
        status: "approved",
        pinVerified: true,
        reason,
        decidedAt: at,
      })
      const match = parseReviewDetail(item.detail).get(survivor.id)
      tx.insert("duplicateDecisions", {
        candidateIds: [survivor.id, merged.id],
        score: match?.score ?? 1,
        decision: "same",
        reason,
        decidedBy: tx.actor.staffId,
        decidedAt: at,
      })
      await tx.update("reviewQueue", item.id, {
        status: "resolved",
        resolution: "same",
        reason,
        resolvedBy: tx.actor.staffId,
        resolvedAt: at,
      })
      tx.auditContext({ reason, approvedBy: approver.id })
      tx.emit("PatientsMerged", {
        refs: { patientId: survivor.id, reviewId: item.id, approvalId: approval.id },
        params: {
          uhid: groupUhid(survivor.uhid),
          alias: groupUhid(merged.uhid),
          approver: approver.nameEn,
          approverBn: approver.nameBn,
        },
      })
      return {
        reviewId: item.id,
        resolution: "same",
        survivorId: survivor.id,
        approvalId: approval.id,
        moved,
      }
    }

    if (input.decision === "different") {
      if (item.kind !== "sync-duplicate") tx.reject("REVIEW_WRONG_KIND", {})
      // Both stay (INV-02 still refuses a shared NID or BRN, and audits it).
      for (const id of item.patientIds) {
        const patient = await tx.get("patients", id)
        if (patient.identityStatus === "under-review") {
          await tx.update("patients", id, { identityStatus: "active" })
        }
      }
      const [incoming, ...others] = item.patientIds
      const matches = parseReviewDetail(item.detail)
      tx.insert("duplicateDecisions", {
        candidateIds: others,
        newPatientId: incoming,
        score: Math.max(0, ...others.map((id) => matches.get(id)?.score ?? 0)),
        decision: "different",
        reason: input.reason,
        decidedBy: tx.actor.staffId,
        decidedAt: at,
      })
      await tx.update("reviewQueue", item.id, {
        status: "resolved",
        resolution: "different",
        reason: input.reason,
        resolvedBy: tx.actor.staffId,
        resolvedAt: at,
      })
      tx.auditContext({ reason: input.reason })
      tx.emit("IdentityReviewResolved", {
        refs: { patientId: incoming, reviewId: item.id },
        params: {
          decision: RESOLUTION_EN.different,
          decisionBn: RESOLUTION_BN.different,
        },
      })
      return { reviewId: item.id, resolution: "different" }
    }

    // Identity conflict: every field needs an answer.
    if (item.kind !== "identity-conflict") tx.reject("REVIEW_WRONG_KIND", {})
    const fields = item.fields ?? []
    const missing = fields.filter((f) => !input.keep[f.field])
    if (missing.length) tx.reject("REVIEW_FIELD_CHOICE_REQUIRED", { count: missing.length })
    const patientId = item.patientIds[0]
    const patient = await tx.get("patients", patientId)
    const patch: Record<string, unknown> = {}
    for (const f of fields) {
      if (input.keep[f.field] === "edge" && isIdentityField(f.field)) {
        patch[f.field] = f.edgeValue
      }
    }
    if ("nameEn" in patch || "nameBn" in patch) {
      patch.nameSearchKeys = nameKeys(
        String(patch.nameEn ?? patient.nameEn),
        String(patch.nameBn ?? patient.nameBn)
      )
    }
    if (Object.keys(patch).length) {
      await tx.update("patients", patientId, patch as Partial<PatientRow>)
    }
    const resolution = fields.some((f) => input.keep[f.field] === "edge")
      ? "kept-edge"
      : "kept-central"
    const reason =
      input.reason ||
      fields.map((f) => `${f.field}: ${input.keep[f.field]}`).join(", ")
    await tx.update("reviewQueue", item.id, {
      status: "resolved",
      resolution,
      reason,
      resolvedBy: tx.actor.staffId,
      resolvedAt: at,
    })
    tx.auditContext({ reason })
    tx.emit("IdentityReviewResolved", {
      refs: { patientId, reviewId: item.id },
      params: {
        decision: RESOLUTION_EN[resolution],
        decisionBn: RESOLUTION_BN[resolution],
      },
    })
    return { reviewId: item.id, resolution }
  },
})

/* ------------------------------------------------------------------ *
 * Contact details (plan §10 S16: optimistic concurrency)
 * ------------------------------------------------------------------ */

export const updateContactInput = z.object({
  patientId: z.string(),
  /** The version the form was opened on: a newer save by anyone is a conflict */
  expectedVersion: z.number().int().min(1),
  phone: phone.optional(),
  attendantPhone: phone.optional(),
  address: z.string().trim().max(160).optional(),
})

/**
 * Change a patient's contact details from the front desk. The form sends the
 * version it was opened on, so a save made meanwhile in another window is
 * refused with the engine's conflict ("changed by <name> ... v3 to v4").
 * A new mobile number starts unverified.
 */
export const updateContact = defineCommand({
  name: "identity.updateContact",
  roles: ["receptionist"],
  input: updateContactInput,
  async run(tx, input) {
    const patient = await tx.get("patients", input.patientId, {
      expectedVersion: input.expectedVersion,
    })
    if (patient.identityStatus === "merged") {
      tx.reject("PATIENT_MERGED", { uhid: patient.uhid })
    }
    const phoneValue = input.phone || undefined
    const attendant = phoneValue ? undefined : input.attendantPhone || undefined
    if (!phoneValue && !attendant) tx.reject("CONTACT_REQUIRED", {})
    const address = input.address || undefined
    const changed = [
      phoneValue !== patient.phone && "phone",
      attendant !== patient.attendantPhone && "attendantPhone",
      address !== patient.address && "address",
    ].filter((f): f is string => !!f)
    if (!changed.length) return { patientId: patient.id, version: patient.version, changed }

    const updated = await tx.update("patients", patient.id, {
      phone: phoneValue,
      phoneVerified: phoneValue === patient.phone ? patient.phoneVerified : false,
      attendantPhone: attendant,
      address,
    })
    tx.emit("PatientContactUpdated", {
      refs: { patientId: patient.id },
      params: {
        uhid: groupUhid(patient.uhid),
        from: patient.version,
        to: updated.version,
      },
    })
    return { patientId: patient.id, version: updated.version, changed }
  },
})
