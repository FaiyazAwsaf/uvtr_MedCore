import { ageOn } from "@/core/clock/dates"
import type { FamilyLinkRow, ISODate, Id, PatientRow } from "@/core/db/schema"

/**
 * Whose records the app account may show (HAZ-14: proxy and guardian
 * checks). Only the account holder and members with a GRANTED family link
 * owned by the account appear. Guardian access ends when the child turns 18;
 * merged records never appear (the surviving record carries the history).
 */

export type MemberKind = "self" | "guardian" | "proxy"

export type FamilyMember = {
  patient: PatientRow
  kind: MemberKind
  /** The consent link (absent for the account holder) */
  link?: FamilyLinkRow
}

/** Age at which guardian access ends (the adult must grant proxy access instead). */
export const GUARDIAN_AGE_LIMIT = 18

/** Whether a family link currently lets the owner see the member's records. */
export function linkAllows(
  link: FamilyLinkRow,
  ownerId: Id,
  member: PatientRow | undefined,
  today: ISODate
): member is PatientRow {
  if (!member || link.ownerPatientId !== ownerId || link.status !== "granted")
    return false
  if (link.memberPatientId !== member.id || member.id === ownerId) return false
  if (member.identityStatus === "merged") return false
  if (
    link.kind === "guardian" &&
    ageOn(member.dob, today) >= GUARDIAN_AGE_LIMIT
  )
    return false
  return true
}

/** The account holder first, then consented members by name. */
export function familyMembers(
  account: PatientRow,
  links: FamilyLinkRow[],
  patients: PatientRow[],
  today: ISODate
): FamilyMember[] {
  const byId = new Map(patients.map((p) => [p.id, p]))
  const seen = new Set<Id>([account.id])
  const members: FamilyMember[] = []
  for (const link of links) {
    const member = byId.get(link.memberPatientId)
    if (
      seen.has(link.memberPatientId) ||
      !linkAllows(link, account.id, member, today)
    )
      continue
    seen.add(member.id)
    members.push({ patient: member, kind: link.kind, link })
  }
  members.sort((a, b) => a.patient.nameEn.localeCompare(b.patient.nameEn))
  return [{ patient: account, kind: "self" }, ...members]
}

/** The selected member if still allowed, otherwise the account holder. */
export function resolveMember(
  members: FamilyMember[],
  selectedId: Id | null | undefined
): FamilyMember | undefined {
  return members.find((m) => m.patient.id === selectedId) ?? members[0]
}
