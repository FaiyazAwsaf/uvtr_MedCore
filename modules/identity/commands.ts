import { z } from "zod"

import { ageOn } from "@/core/clock/dates"
import { newId } from "@/core/db/ids"
import { groupUhid } from "@/core/db/numbering"
import type { Consent, PatientRow, Relation } from "@/core/db/schema"
import { defineCommand } from "@/core/engine/defineCommand"
import { nextUhid } from "@/core/engine/docNumbers"
import { findLikelyDuplicates, nameKeys } from "@/core/search/fuzzy"

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
