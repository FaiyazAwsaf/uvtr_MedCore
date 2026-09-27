import { branches, companies } from "@/config/brand.config"
import { seedRow } from "@/core/db/base"
import type { MedcoreDb } from "@/core/db/database"
import type {
  BranchRow,
  CompanyRow,
  PersonaRow,
  StaffRow,
} from "@/core/db/schema"

import { PERSONAS } from "./content/personas"
import type { SeedOptions, SeedSummary } from "./types"

/**
 * Seeds the central database (plan §7). Phase 1 starting point: organisation,
 * staff and personas. WS-Seed extends this into the full dataset behind the
 * same signature.
 */
export async function seedDatabase(
  db: MedcoreDb,
  opts: SeedOptions
): Promise<SeedSummary> {
  const started = performance.now()
  const at = opts.now
  const counts: Record<string, number> = {}

  const companyRows = companies.map((c) =>
    seedRow<CompanyRow>(c.code, at, {
      code: c.code,
      name: c.name,
      tin: c.tin,
      invoicePrefix: c.invoicePrefix,
    })
  )
  const branchRows = branches.map((b) =>
    seedRow<BranchRow>(b.code, at, {
      code: b.code,
      companyId: b.company,
      name: b.name,
      kind: b.kind,
      services: b.services,
      address: b.address,
      phone: b.phone,
    })
  )
  const staffRows: StaffRow[] = []
  const personaRows: PersonaRow[] = []
  for (const p of PERSONAS) {
    if (p.staff) {
      staffRows.push(
        seedRow<StaffRow>(p.staff.id, at, {
          nameEn: p.staff.nameEn,
          nameBn: p.staff.nameBn,
          sex: p.staff.sex,
          role: p.role,
          branchId: p.branchId,
          designation: p.staff.designation,
          regNo: p.staff.regNo,
          regBody: p.staff.regBody,
          authorities: p.staff.authorities,
          avatarSeed: p.staff.id,
        })
      )
    }
    personaRows.push(
      seedRow<PersonaRow>(p.id, at, {
        staffId: p.staff?.id,
        patientId: p.patientId,
        role: p.role,
        branchId: p.branchId,
        isDefault: p.isDefault,
        blurb: p.blurb,
        order: p.order,
      })
    )
  }

  await db.transaction(
    "rw",
    [db.companies, db.branches, db.staff, db.personas],
    async () => {
      await db.companies.bulkPut(companyRows)
      await db.branches.bulkPut(branchRows)
      await db.staff.bulkPut(staffRows)
      await db.personas.bulkPut(personaRows)
    }
  )
  counts.companies = companyRows.length
  counts.branches = branchRows.length
  counts.staff = staffRows.length
  counts.personas = personaRows.length

  return { counts, durationMs: Math.round(performance.now() - started) }
}
