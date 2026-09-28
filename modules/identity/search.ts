import type { MedcoreDb } from "@/core/db/database"
import type { HouseholdRow, ISODate, PatientRow } from "@/core/db/schema"
import { nameKeyFor } from "@/core/search/fuzzy"

import { normalizePhone } from "./registration"

/**
 * Front desk search (plan §9 `/reception`): one box for a UHID (with or
 * without dashes, provisional P-B1-... and former UHIDs kept as aliases), a
 * phone number, NID, BRN, or a name in English or Bangla, plus an optional
 * date-of-birth filter. A complete phone number returns the whole household
 * so staff pick the right person (HAZ-01). Merged records never show.
 */

export type DeskQuery =
  | { kind: "empty" }
  | { kind: "short" }
  | { kind: "provisional"; value: string }
  /** A complete mobile number, in the stored 01XXX-XXXXXX form */
  | { kind: "phone"; phone: string }
  /** UHID, NID, BRN or the start of a phone number */
  | { kind: "digits"; digits: string }
  /** Normalised name keys (see core/search/fuzzy.ts) */
  | { kind: "name"; keys: string[] }

const WORD_SPLIT = /[\s.\-,'`"()_/]+/

export function classifyQuery(raw: string): DeskQuery {
  const query = raw.trim()
  if (!query) return { kind: "empty" }
  if (/^p-?b\d/i.test(query)) {
    return { kind: "provisional", value: query.toUpperCase().replace(/\s+/g, "") }
  }
  const compact = query.replace(/[\s\-+().]/g, "")
  if (/^\d+$/.test(compact)) {
    const phone = normalizePhone(compact)
    if (phone) return { kind: "phone", phone }
    if (compact.length < 3) return { kind: "short" }
    return { kind: "digits", digits: compact }
  }
  const keys = query
    .split(WORD_SPLIT)
    .map(nameKeyFor)
    .filter((key) => key.length > 0)
  if (!keys.length || Math.max(...keys.map((k) => k.length)) < 2) return { kind: "short" }
  return { kind: "name", keys }
}

export type DeskSearchResult =
  | { kind: "idle" }
  | { kind: "short" }
  | {
      kind: "household"
      phone: string
      household?: HouseholdRow
      /** Head first, then the household's order, then others sharing the number */
      members: PatientRow[]
    }
  | { kind: "list"; patients: PatientRow[]; more: boolean }

const LIMIT = 25

function unique(rows: (PatientRow | undefined)[]): PatientRow[] {
  const seen = new Set<string>()
  const out: PatientRow[] = []
  for (const row of rows) {
    if (row && !seen.has(row.id) && row.identityStatus !== "merged") {
      seen.add(row.id)
      out.push(row)
    }
  }
  return out
}

function byName(a: PatientRow, b: PatientRow) {
  return a.nameEn.localeCompare(b.nameEn)
}

export async function searchFrontDesk(
  db: MedcoreDb,
  raw: string,
  opts: { dob?: ISODate; limit?: number } = {}
): Promise<DeskSearchResult> {
  const limit = opts.limit ?? LIMIT
  const dob = opts.dob || undefined
  const withDob = (rows: PatientRow[]) => (dob ? rows.filter((p) => p.dob === dob) : rows)
  const list = (rows: PatientRow[]): DeskSearchResult => {
    const filtered = withDob(rows)
    return { kind: "list", patients: filtered.slice(0, limit), more: filtered.length > limit }
  }
  const query = classifyQuery(raw)

  switch (query.kind) {
    case "empty": {
      if (!dob) return { kind: "idle" }
      const rows = await db.patients
        .filter((p) => p.dob === dob && p.identityStatus !== "merged")
        .limit(limit + 1)
        .toArray()
      return list(rows.sort(byName))
    }
    case "short":
      return { kind: "short" }
    case "provisional": {
      const rows = await Promise.all([
        db.patients.where("provisionalUhid").startsWith(query.value).limit(limit).toArray(),
        db.patients.where("aliases").startsWith(query.value).limit(limit).toArray(),
        db.patients.where("uhid").startsWith(query.value).limit(limit).toArray(),
      ])
      return list(unique(rows.flat()))
    }
    case "phone": {
      const household = await db.households.where("phone").equals(query.phone).first()
      const members = household
        ? await db.patients.bulkGet(
            [household.headPatientId, ...household.memberIds].filter(
              (id, i, all) => all.indexOf(id) === i
            )
          )
        : []
      const sharing = await db.patients.where("phone").equals(query.phone).toArray()
      const rows = unique([...members, ...sharing.sort(byName)])
      return { kind: "household", phone: query.phone, household, members: withDob(rows) }
    }
    case "digits": {
      const { digits } = query
      const dashedPhone =
        digits.startsWith("01") && digits.length > 5
          ? `${digits.slice(0, 5)}-${digits.slice(5)}`
          : digits
      const rows = await Promise.all([
        db.patients.where("uhid").equals(digits).toArray(),
        db.patients.where("uhid").startsWith(digits).limit(limit).toArray(),
        db.patients.where("aliases").startsWith(digits).limit(limit).toArray(),
        db.patients.where("nid").startsWith(digits).limit(limit).toArray(),
        db.patients.where("brn").startsWith(digits).limit(limit).toArray(),
        digits.startsWith("01")
          ? db.patients.where("phone").startsWith(dashedPhone).limit(limit).toArray()
          : Promise.resolve([] as PatientRow[]),
      ])
      // An exact UHID first, then everything else by name.
      const [exact, ...rest] = rows
      const first = unique(exact)
      const exactIds = new Set(first.map((p) => p.id))
      const others = unique(rest.flat())
        .filter((p) => !exactIds.has(p.id))
        .sort(byName)
      return list([...first, ...others])
    }
    case "name": {
      // The longest key narrows best through the multi-entry index; every
      // other key must prefix-match one of the patient's keys.
      const [lead, ...rest] = [...query.keys].sort((a, b) => b.length - a.length)
      const candidates = await db.patients
        .where("nameSearchKeys")
        .startsWith(lead)
        .limit(400)
        .toArray()
      const matches = unique(candidates).filter((p) =>
        rest.every((key) => p.nameSearchKeys.some((k) => k.startsWith(key)))
      )
      return list(matches.sort(byName))
    }
  }
}
