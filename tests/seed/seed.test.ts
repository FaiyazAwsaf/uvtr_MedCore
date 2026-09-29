import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { MedcoreDb } from "@/core/db/database"
import { interimBill } from "@/core/inpatient/interim"
import { isValidUhid } from "@/core/db/numbering"
import type { PatientRow } from "@/core/db/schema"
import { TABLE_NAMES } from "@/core/db/tables"
import { buildSeed, seedDatabase } from "@/core/seed"
import { HERO } from "@/core/seed/content/hero-ids"
import { GENERICS } from "@/core/seed/content/medicines/generics"
import { BRANDS } from "@/core/seed/content/medicines/brands"
import { ICD10 } from "@/core/seed/content/icd10"
import { SCRIBE_SCRIPTS } from "@/core/seed/content/scribe-scripts"
import { SEED_REFS } from "@/core/seed/content/seed-refs"
import { nameKeyFor } from "@/core/seed/generators/search-keys"
import { interleavePositions } from "@/core/seed/generators/scheduling"
import type { SeedSummary } from "@/core/seed/types"

/** 28-09-2026, 11:30 in Dhaka (UTC+6). */
const NOW = Date.UTC(2026, 8, 28, 5, 30)
const TODAY = "2026-09-28"
const OPTS = { now: NOW, today: TODAY }
const YESTERDAY = "2026-09-27"
const EM_DASH = String.fromCharCode(0x2014)

let db: MedcoreDb
let summary: SeedSummary

beforeAll(async () => {
  db = new MedcoreDb("seed-test")
  summary = await seedDatabase(db, OPTS)
  console.log(
    `seed: ${summary.durationMs} ms, ${Object.values(summary.counts).reduce((s, n) => s + n, 0)} rows`
  )
  console.log(JSON.stringify(summary.counts))
}, 60_000)

afterAll(async () => {
  await db?.delete()
})

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

describe("seed: counts (plan §7.1)", () => {
  it("writes the organisation", async () => {
    expect(await db.companies.count()).toBe(3)
    expect(await db.branches.count()).toBe(5)
    expect(await db.departments.count()).toBeGreaterThan(30)
    expect(await db.rooms.count()).toBeGreaterThan(50)
    const b1Wards = await db.wards.where("branchId").equals("B1").toArray()
    expect(b1Wards).toHaveLength(3)
    for (const w of b1Wards)
      expect(await db.beds.where("wardId").equals(w.id).count()).toBe(12)
    expect(
      await db.wards.where("branchId").anyOf("B2", "B5").count()
    ).toBeGreaterThan(0)
    expect(await db.personas.count()).toBe(20)
  })

  it("has about 40 non-persona, non-doctor staff", async () => {
    const staff = await db.staff.toArray()
    const personaStaff = new Set(
      (await db.personas.toArray()).map((p) => p.staffId).filter(Boolean)
    )
    const doctorStaff = new Set(
      (await db.doctors.toArray()).map((d) => d.staffId)
    )
    const others = staff.filter(
      (s) => !personaStaff.has(s.id) && !doctorStaff.has(s.id)
    )
    expect(others.length).toBeGreaterThanOrEqual(38)
    expect(others.length).toBeLessThanOrEqual(45)
  })

  it("has 60 clinical doctors plus 2 pathologists and 1 radiologist", async () => {
    const doctors = await db.doctors.toArray()
    expect(
      doctors.filter(
        (d) => d.kind === "consultant" || d.kind === "medical-officer"
      )
    ).toHaveLength(60)
    expect(doctors.filter((d) => d.kind === "pathologist")).toHaveLength(2)
    expect(doctors.filter((d) => d.kind === "radiologist")).toHaveLength(1)
    for (const id of Object.values(HERO.doctor))
      expect(doctors.some((d) => d.id === id)).toBe(true)
    expect(new Set(doctors.map((d) => d.bmdcNo)).size).toBe(doctors.length)
    for (const d of doctors) expect(d.bmdcNo).toMatch(/^A-\d{5}$/)
    const clinical = doctors.filter((d) => d.kind === "consultant")
    for (const d of clinical) {
      expect(d.consultFeeP).toBeGreaterThanOrEqual(500_00)
      expect(d.consultFeeP).toBeLessThanOrEqual(1500_00)
    }
  })

  it("has 500 patients, about 120 households and about 90 minors", async () => {
    expect(await db.patients.count()).toBe(500)
    const households = await db.households.toArray()
    expect(households.length).toBeGreaterThanOrEqual(110)
    expect(households.length).toBeLessThanOrEqual(130)
    for (const h of households)
      expect(h.memberIds.length).toBeGreaterThanOrEqual(2)
    const minors = (await db.patients.toArray()).filter((p) => age(p) < 18)
    expect(minors.length).toBeGreaterThanOrEqual(85)
    expect(minors.length).toBeLessThanOrEqual(95)
  })

  it("has the catalogues", async () => {
    const tests = await db.labTests.toArray()
    expect(tests.filter((t) => t.kind === "lab").length).toBeGreaterThanOrEqual(
      140
    )
    const imaging = tests.filter((t) => t.kind === "imaging")
    for (const m of ["xray", "usg", "ecg", "echo"])
      expect(imaging.some((t) => t.modality === m)).toBe(true)
    expect(tests.some((t) => t.template === "micro")).toBe(true)
    expect(tests.some((t) => t.template === "histo")).toBe(true)
    expect(await db.brands.count()).toBe(200)
    const generics = await db.generics.count()
    expect(generics).toBeGreaterThanOrEqual(65)
    expect(generics).toBeLessThanOrEqual(80)
    expect(await db.pharmaCompanies.count()).toBeGreaterThanOrEqual(20)
    expect(await db.vendors.count()).toBe(12)
    expect(await db.corporateClients.count()).toBe(3)
    expect(await db.corporateContracts.count()).toBe(3)
    expect(await db.corporateEmployees.count()).toBeGreaterThan(30)
    expect(ICD10.length).toBeGreaterThanOrEqual(140)
  })

  it("writes no events or audit rows", async () => {
    expect(await db.events.count()).toBe(0)
    expect(await db.audit.count()).toBe(0)
  })

  it("builds every row with base fields (version 1, central)", async () => {
    for (const name of TABLE_NAMES) {
      const rows = await db.table(name).toArray()
      for (const r of rows) {
        expect(r.version).toBe(1)
        expect(r.origin).toBe("central")
        expect(r.createdBy).toBe("system")
        expect(r.updatedBy).toBe("system")
        expect(r.createdAt).toBeLessThanOrEqual(r.updatedAt)
        expect(r.createdAt).toBeLessThanOrEqual(NOW)
      }
    }
  })
})

describe("seed: owner rules", () => {
  it("makes every doctor male", async () => {
    const doctors = await db.doctors.toArray()
    const staff = await db.staff.bulkGet(doctors.map((d) => d.staffId))
    expect(staff.every((s) => s?.sex === "M")).toBe(true)
    const doctorRoleStaff = await db.staff
      .where("role")
      .anyOf("doctor", "pathologist")
      .toArray()
    expect(doctorRoleStaff.every((s) => s.sex === "M")).toBe(true)
  })

  it("never prices a medicine above its MRP", async () => {
    for (const b of await db.brands.toArray()) {
      expect(b.unitPriceP).toBeGreaterThan(0)
      expect(b.unitPriceP).toBeLessThanOrEqual(b.mrpP)
    }
    const brands = new Map((await db.brands.toArray()).map((b) => [b.id, b]))
    for (const l of await db.basketLines.toArray()) {
      if (l.mrpP !== undefined) expect(l.unitPriceP).toBeLessThanOrEqual(l.mrpP)
    }
    for (const d of await db.dispenses.toArray())
      expect(d.unitPriceP).toBeLessThanOrEqual(brands.get(d.brandId)!.mrpP)
    for (const b of await db.batches.toArray())
      expect(b.costP).toBeLessThanOrEqual(b.mrpP)
  })

  it("flags antibiotics, controlled drugs and OTC items", async () => {
    const brands = await db.brands.toArray()
    const share = brands.filter((b) => b.isAntibiotic).length / brands.length
    expect(share).toBeGreaterThan(0.15)
    expect(share).toBeLessThan(0.27)
    const generics = await db.generics.toArray()
    expect(
      generics.filter((g) => g.controlledClass).length
    ).toBeGreaterThanOrEqual(4)
    expect(
      brands.filter((b) => b.category === "controlled").length
    ).toBeGreaterThanOrEqual(4)
    const napa = brands.find((b) => b.id === SEED_REFS.brand.napa500)!
    expect(napa.category).toBe("otc")
    expect(generics.find((g) => g.id === "gen_amoxicillin")?.allergyClass).toBe(
      "penicillins"
    )
    for (const g of generics)
      expect(g.interactionsNote).toContain("licensed content, Release 2")
    // Typeahead keys: brand, generic, company and class.
    for (const q of ["napa", "paracetamol", "beximco", "ppi"]) {
      expect(
        await db.brands.where("searchKeys").startsWith(q).count()
      ).toBeGreaterThan(0)
    }
  })

  it("contains no em dashes anywhere", async () => {
    for (const name of TABLE_NAMES) {
      const json = JSON.stringify(await db.table(name).toArray())
      expect(json.includes(EM_DASH), name).toBe(false)
    }
    const content = JSON.stringify([
      GENERICS,
      BRANDS,
      ICD10,
      SCRIBE_SCRIPTS,
      SEED_REFS,
    ])
    expect(content.includes(EM_DASH)).toBe(false)
  })
})

describe("seed: patients and identity", () => {
  it("issues unique, valid UHIDs and continues the counter", async () => {
    const patients = await db.patients.toArray()
    expect(new Set(patients.map((p) => p.uhid)).size).toBe(patients.length)
    const permanent = patients.filter((p) => !p.uhid.startsWith("P-"))
    for (const p of permanent) expect(isValidUhid(p.uhid), p.uhid).toBe(true)
    const maxSerial = Math.max(
      ...permanent.map((p) => Number(p.uhid.slice(0, 10)) - 1_000_000_000)
    )
    expect((await db.counters.get("uhid"))?.value).toBe(maxSerial)
    // Only the merged offline record keeps a provisional number as its UHID.
    const provisional = patients.filter((p) => p.uhid.startsWith("P-"))
    expect(provisional).toHaveLength(1)
    expect(provisional[0].identityStatus).toBe("merged")
    expect((await db.counters.get("uhid-off:B2"))?.value).toBe(3)
  })

  it("gives every minor a guardian and a guardian's treatment consent", async () => {
    const patients = await db.patients.toArray()
    const byId = new Map(patients.map((p) => [p.id, p]))
    for (const p of patients.filter((x) => age(x) < 18)) {
      expect(p.guardianPatientId, p.id).toBeTruthy()
      const g = byId.get(p.guardianPatientId!)
      expect(g, p.id).toBeTruthy()
      expect(age(g!)).toBeGreaterThanOrEqual(18)
      const consent = p.consents.find((c) => c.purpose === "treatment")
      expect(consent?.granted).toBe(true)
      expect(consent?.byPatientId).toBe(g!.id)
    }
  })

  it("keeps active NIDs unique and plants the NID collisions", async () => {
    const active = (await db.patients.toArray()).filter(
      (p) => p.identityStatus === "active" && p.nid
    )
    expect(new Set(active.map((p) => p.nid)).size).toBe(active.length)
    for (const c of SEED_REFS.nidCollisions) {
      const hits = await db.patients.where("nid").equals(c.nid).toArray()
      expect(hits.map((h) => h.id)).toEqual([c.patientId])
    }
    const rafiqul = await db.patients.get(SEED_REFS.patient.rafiqul)
    expect(rafiqul?.nameEn).toBe("Md. Rafiqul Islam")
    expect(rafiqul?.dob).toBe("1978-03-12")
  })

  it("plants 8 fuzzy duplicates that share search keys and DOB", async () => {
    for (const [a, b] of SEED_REFS.fuzzyDuplicates) {
      const [pa, pb] = await db.patients.bulkGet([a, b])
      expect(pa && pb).toBeTruthy()
      expect(pa!.nameEn).not.toBe(pb!.nameEn)
      expect(pa!.dob).toBe(pb!.dob)
      expect(pa!.sex).toBe(pb!.sex)
      const latin = (p: PatientRow) =>
        p.nameSearchKeys.filter((k) => /^[a-z]/.test(k)).sort()
      expect(latin(pa!)).toEqual(latin(pb!))
      expect(pa!.identityStatus).toBe("active")
      expect(pb!.identityStatus).toBe("active")
    }
    expect(nameKeyFor("Md.")).toBe(nameKeyFor("Mohammad"))
    expect(nameKeyFor("Begom")).toBe(nameKeyFor("Begum"))
    expect(nameKeyFor("মোহাম্মদ")).toBe(nameKeyFor("মো."))
    expect(
      await db.patients.where("nameSearchKeys").equals("karim").count()
    ).toBeGreaterThanOrEqual(3)
  })

  it("has allergies and chronic problems", async () => {
    const patients = await db.patients.toArray()
    const classes = new Set(
      patients.flatMap((p) => p.allergies.map((a) => a.allergyClass))
    )
    for (const c of ["penicillins", "sulfonamides", "nsaids"])
      expect(classes.has(c)).toBe(true)
    const codes = new Set(
      patients.flatMap((p) => p.problems.map((x) => x.icd10))
    )
    for (const c of ["E11.9", "I10", "J45.9"]) expect(codes.has(c)).toBe(true)
    expect([...codes].some((c) => c.startsWith("N18"))).toBe(true)
    expect(patients.every((p) => p.photoSeed.length > 0)).toBe(true)
  })
})

describe("seed: hero data (plan §7.2)", () => {
  it("builds the Karim household", async () => {
    const hh = await db.households.get(HERO.household.karim)
    expect(hh?.phone).toBe(HERO.karimPhone)
    expect(hh?.memberIds.sort()).toEqual(Object.values(HERO.patient).sort())
    expect(hh?.headPatientId).toBe(HERO.patient.abdulKarim)
    const [abdul, rokeya, tanvir, nusrat] = await db.patients.bulkGet([
      HERO.patient.abdulKarim,
      HERO.patient.rokeyaBegum,
      HERO.patient.tanvirKarim,
      HERO.patient.nusratKarim,
    ])
    expect([age(abdul!), age(rokeya!), age(tanvir!), age(nusrat!)]).toEqual([
      62, 55, 34, 8,
    ])
    expect([abdul!.sex, rokeya!.sex, tanvir!.sex, nusrat!.sex]).toEqual([
      "M",
      "F",
      "M",
      "F",
    ])
    for (const p of [abdul, rokeya, tanvir, nusrat])
      expect(p!.phone).toBe(HERO.karimPhone)
    expect(abdul!.allergies.some((a) => a.allergyClass === "penicillins")).toBe(
      true
    )
    expect(abdul!.problems.map((p) => p.icd10).sort()).toEqual(["E11.9", "I10"])
    expect(abdul!.currentMeds.map((m) => m.brandId).sort()).toEqual(
      [SEED_REFS.brand.camlodin5, SEED_REFS.brand.comet500].sort()
    )
    expect(nusrat!.guardianPatientId).toBe(HERO.patient.tanvirKarim)
  })

  it("links Tanvir to Nusrat (guardian) and Abdul (proxy), not Rokeya", async () => {
    const links = await db.familyLinks
      .where("ownerPatientId")
      .equals(HERO.patient.tanvirKarim)
      .toArray()
    const byMember = new Map(links.map((l) => [l.memberPatientId, l]))
    expect(byMember.get(HERO.patient.nusratKarim)).toMatchObject({
      kind: "guardian",
      status: "granted",
    })
    expect(byMember.get(HERO.patient.abdulKarim)).toMatchObject({
      kind: "proxy",
      status: "granted",
    })
    expect(byMember.has(HERO.patient.rokeyaBegum)).toBe(false)
  })

  it("gives Dr. Kamal a live session today and leaves Abdul unbooked", async () => {
    const session = await db.sessions.get(SEED_REFS.session.kamalToday)
    expect(session).toMatchObject({
      doctorId: HERO.doctor.kamal,
      branchId: "B1",
      date: TODAY,
      start: "10:00",
      end: "13:00",
      roomId: SEED_REFS.room.kamal,
    })
    const appts = await db.appointments
      .where("sessionId")
      .equals(session!.id)
      .toArray()
    expect(appts.length).toBeGreaterThanOrEqual(10)
    expect(appts.length).toBeLessThanOrEqual(14)
    expect(appts.some((a) => a.status === "checked-in")).toBe(true)
    expect(appts.some((a) => a.status === "booked")).toBe(true)
    expect(appts.length).toBeLessThan(session!.capacity)
    const tokens = await db.queueTokens
      .where("sessionId")
      .equals(session!.id)
      .toArray()
    expect(
      tokens.filter((t) => t.status === "waiting").length
    ).toBeGreaterThanOrEqual(3)
    expect(tokens.some((t) => t.kind === "walk-in")).toBe(true)
    const ordered = [...tokens].sort((a, b) => a.number - b.number)
    expect(ordered.map((t) => t.position)).toEqual(
      interleavePositions(ordered.map((t) => t.kind))
    )
    for (const t of tokens) expect(t.label).toMatch(/^M-\d+$/)
    const today = await db.appointments
      .where("[branchId+date]")
      .equals(["B1", TODAY])
      .toArray()
    expect(today.some((a) => a.patientId === HERO.patient.abdulKarim)).toBe(
      false
    )
    expect(
      (
        await db.appointments
          .where("patientId")
          .equals(HERO.patient.abdulKarim)
          .toArray()
      ).every((a) => a.date < TODAY)
    ).toBe(true)
  })

  it("has Dr. Arif's session later today with 8 bookings", async () => {
    const session = await db.sessions.get(SEED_REFS.session.arifToday)
    expect(session).toMatchObject({
      doctorId: HERO.doctor.arif,
      date: TODAY,
      branchId: "B1",
    })
    const appts = await db.appointments
      .where("sessionId")
      .equals(session!.id)
      .toArray()
    expect(appts).toHaveLength(8)
    expect(appts.every((a) => a.status === "booked")).toBe(true)
  })

  it("keeps sessions within today minus 30 to today plus 14", async () => {
    const sessions = await db.sessions.toArray()
    const dates = sessions.map((s) => s.date).sort()
    expect(dates[0] >= "2026-08-29").toBe(true)
    expect(dates[dates.length - 1] <= "2026-10-12").toBe(true)
  })

  it("has scenario master data", async () => {
    const [jahanara, shahidul, nasima, kamrul] = await db.patients.bulkGet([
      SEED_REFS.patient.jahanara,
      SEED_REFS.patient.shahidul,
      SEED_REFS.patient.nasima,
      SEED_REFS.patient.kamrul,
    ])
    expect(age(jahanara!)).toBe(67)
    expect(jahanara!.problems.some((p) => p.icd10.startsWith("N18"))).toBe(true)
    expect(shahidul!.nameEn).toBe("Shahidul Alam")
    expect(nasima!.nameEn).toBe("Nasima Khatun")
    expect(kamrul!.nameEn).toBe("Kamrul Hasan")
  })
})

describe("seed: planted stock (plan §7.1)", () => {
  const onHand = async (branch: string, brandId: string) =>
    sum(
      (
        await db.stockLevels
          .where("[branchId+brandId]")
          .equals([branch, brandId])
          .toArray()
      ).map((l) => l.qty)
    )
  const reorder = async (branch: string, brandId: string) =>
    (await db.reorderLevels
      .where("[branchId+brandId]")
      .equals([branch, brandId])
      .first())!.reorderLevel

  it("holds every planted state", async () => {
    const B = SEED_REFS.brand
    expect(await onHand("B1", B.napa500)).toBeLessThan(
      await reorder("B1", B.napa500)
    )
    expect(await onHand("B1", B.napa500)).toBeGreaterThan(0)
    expect(await onHand("B1", B.zimax500)).toBe(0)
    expect(await onHand("B3", B.zimax500)).toBeGreaterThan(0)
    expect(await onHand("B1", B.monas10)).toBe(0)
    expect(await onHand("B1", B.montair10)).toBeGreaterThan(0)
    expect(await onHand("B1", B.seclo20)).toBe(14)
  })

  it("has two near-expiry batches and one expired batch at B1", async () => {
    const soon = "2026-11-27"
    const b1 = await db.stockLevels.where("branchId").equals("B1").toArray()
    const batches = new Map((await db.batches.toArray()).map((b) => [b.id, b]))
    const held = b1.filter((l) => l.qty > 0).map((l) => batches.get(l.batchId)!)
    const nearExpiry = held.filter(
      (b) => b.status === "ok" && b.expiry > TODAY && b.expiry <= soon
    )
    expect(nearExpiry.map((b) => b.id).sort()).toEqual(
      [
        SEED_REFS.batch.nearExpiryAlatrol10,
        SEED_REFS.batch.nearExpiryFexo120,
      ].sort()
    )
    const expired = held.filter((b) => b.expiry <= TODAY)
    expect(expired.map((b) => b.id)).toEqual([SEED_REFS.batch.expiredAce500])
    expect(expired[0].status).toBe("expired")
  })

  it("reconciles every stock level with its movements", async () => {
    const moves = await db.stockMovements.toArray()
    const byLevel = new Map<string, number>()
    for (const m of moves)
      byLevel.set(
        `${m.branchId}:${m.batchId}`,
        (byLevel.get(`${m.branchId}:${m.batchId}`) ?? 0) + m.qty
      )
    for (const l of await db.stockLevels.toArray()) {
      expect(l.qty).toBeGreaterThanOrEqual(0)
      expect(byLevel.get(`${l.branchId}:${l.batchId}`) ?? 0, l.id).toBe(l.qty)
    }
    expect(await db.reorderLevels.count()).toBeGreaterThan(500)
  })
})

describe("seed: history (plan §7.3, §7.4)", () => {
  it("continues purchase order numbering at PO-1042", async () => {
    const pos = await db.purchaseOrders.toArray()
    expect(pos).toHaveLength(6)
    expect(pos.map((p) => p.poNo).sort()).toEqual([
      "PO-1036",
      "PO-1037",
      "PO-1038",
      "PO-1039",
      "PO-1040",
      "PO-1041",
    ])
    expect((await db.counters.get("po"))?.value).toBe(1041)
    expect(new Set(pos.map((p) => p.status)).size).toBeGreaterThanOrEqual(4)
    const matches = await db.threeWayMatches.toArray()
    expect(matches.filter((m) => m.status === "mismatch")).toHaveLength(1)
  })

  it("balances every invoice (INV-03)", async () => {
    const lines = await db.invoiceLines.toArray()
    const payments = await db.payments.toArray()
    for (const inv of await db.invoices.toArray()) {
      const mine = lines.filter((l) => l.invoiceId === inv.id)
      expect(sum(mine.map((l) => l.amountP)) - inv.discountP + inv.taxP).toBe(
        inv.totalP
      )
      expect(sum(mine.map((l) => l.netP))).toBe(inv.totalP)
      const confirmed = sum(
        payments
          .filter((p) => p.invoiceId === inv.id && p.status === "confirmed")
          .map((p) => p.amountP)
      )
      if (inv.status === "paid") expect(confirmed).toBe(inv.totalP)
    }
    const numbers = (await db.invoices.toArray()).map((i) => i.invoiceNo)
    expect(numbers.every((n) => /^C\d-B\d-\d{4}-(OFF-)?\d+$/.test(n))).toBe(
      true
    )
  })

  it("has Dr. Kamal's fee-share month with one reversal", async () => {
    const accruals = await db.feeShareAccruals
      .where("[doctorId+month]")
      .equals([HERO.doctor.kamal, "2026-08"])
      .toArray()
    expect(accruals.length).toBeGreaterThanOrEqual(110)
    expect(accruals.length).toBeLessThanOrEqual(130)
    const reversals = accruals.filter((a) => a.reversalOfId)
    expect(reversals).toHaveLength(1)
    expect(reversals[0].shareP).toBeLessThan(0)
    expect(
      accruals.every((a) => a.patientUhid && isValidUhid(a.patientUhid))
    ).toBe(true)
  })

  it("has a corrected report, a cancelled paid order and transfers", async () => {
    const reports = await db.labReports.toArray()
    const v2 = reports.find((r) => r.reportVersion === 2)!
    const v1 = reports.find((r) => r.id === v2.supersedesId)!
    expect(v1.status).toBe("superseded")
    expect(v2.status).toBe("released")
    expect(v2.reportNo).toBe(v1.reportNo)
    expect(v1.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(v2.hash).not.toBe(v1.hash)
    expect(await db.refunds.count()).toBeGreaterThanOrEqual(2)
    expect(await db.creditNotes.count()).toBeGreaterThanOrEqual(2)
    expect(
      (await db.labOrderItems.where("status").equals("cancelled").toArray())
        .length
    ).toBeGreaterThanOrEqual(1)
    const transfers = await db.transfers.toArray()
    expect(
      transfers.some(
        (t) =>
          t.fromBranchId === "B3" &&
          t.toBranchId === "B1" &&
          t.status === "received"
      )
    ).toBe(true)
  })

  it("has yesterday's variance shift and bKash settlement", async () => {
    const shift = (await db.shifts.where("date").equals(YESTERDAY).toArray())[0]
    expect(shift.status).toBe("closed")
    expect(Math.abs(shift.varianceP!)).toBeGreaterThan(500_00)
    expect(shift.varianceApprovalId).toBeTruthy()
    expect((await db.approvals.get(shift.varianceApprovalId!))?.status).toBe(
      "approved"
    )
    const bkash = (
      await db.mfsSettlements.where("provider").equals("bkash").toArray()
    )[0]
    expect(bkash.date).toBe(YESTERDAY)
    expect(bkash.lines.filter((l) => !l.matchedPaymentId)).toHaveLength(2)
    expect(
      bkash.lines.filter((l) => l.matchedPaymentId).length
    ).toBeGreaterThan(0)
  })

  it("records the B2 offline period", async () => {
    const review = await db.reviewQueue.toArray()
    expect(
      review.some((r) => r.branchId === "B2" && r.status === "resolved")
    ).toBe(true)
    expect(
      await db.syncExceptions.where("branchId").equals("B2").count()
    ).toBeGreaterThan(0)
    const offline = (await db.invoices.toArray()).filter((i) => i.offline)
    expect(offline.length).toBeGreaterThan(0)
  })

  it("has 90 days of dashboard history with the planted stories", async () => {
    const all = await db.dailyStats.toArray()
    const stats = all.filter((s) => s.date !== TODAY)
    expect(new Set(stats.map((s) => s.date)).size).toBe(90)
    expect(stats.every((s) => s.asAt === undefined)).toBe(true)
    const b3 = stats.filter((s) => s.branchId === "B3" && s.dept === "lab")
    const y = b3.find((s) => s.date === YESTERDAY)!
    const others = b3
      .filter((s) => s.date !== YESTERDAY)
      .map((s) => s.labTatMin)
    expect(y.labTatMin).toBeGreaterThan(Math.max(...others))
    const billed = sum(stats.map((s) => s.billedP))
    const collected = sum(stats.map((s) => s.collectedP))
    expect(collected / billed).toBeGreaterThan(0.8)
    expect(collected / billed).toBeLessThan(0.9)
  })

  it("splits every day by service exactly, and has today's baseline up to the seed moment", async () => {
    const all = await db.dailyStats.toArray()
    for (const row of all) {
      expect(row.services?.length, row.id).toBeGreaterThan(0)
      expect(sum(row.services!.map((x) => x.visits)), row.id).toBe(row.visits)
      expect(sum(row.services!.map((x) => x.billedP)), row.id).toBe(row.billedP)
    }
    const today = all.filter((s) => s.date === TODAY)
    const yesterday = all.filter((s) => s.date === YESTERDAY)
    expect(today.map((s) => `${s.branchId}:${s.dept}`).sort()).toEqual(
      yesterday.map((s) => `${s.branchId}:${s.dept}`).sort()
    )
    for (const row of today) {
      expect(row.asAt).toBe(NOW)
      expect(row.outstandingP).toBe(row.billedP - row.collectedP)
    }
    // 11:30 is early in the day: today so far is well below a full day.
    const opd = (rows: typeof all) =>
      sum(rows.filter((r) => r.dept === "opd").map((r) => r.visits))
    expect(opd(today)).toBeLessThan(opd(yesterday) * 0.5)
    expect(opd(today)).toBeGreaterThan(0)
  })

  it("routes seeded purchase requests by value, never to the requester", async () => {
    const prs = await db.purchaseRequests.toArray()
    const submitted = prs.filter((p) => p.status === "submitted")
    expect(submitted.map((p) => p.approvalTier).sort()).toEqual([
      "cfo",
      "procurement-head",
    ])
    const cfo = submitted.find((p) => p.approvalTier === "cfo")!
    expect(cfo.totalP).toBeGreaterThan(5_00_000_00)
    for (const pr of prs.filter((p) => p.approvalId)) {
      const approval = (await db.approvals.get(pr.approvalId!))!
      expect(approval.approverId).not.toBe(pr.requestedBy)
    }
  })
})

describe("seed: inpatient deposits (plan §5.8)", () => {
  it("keeps every stay above the deposit alert except the one planted cabin stay", async () => {
    const admitted = await db.admissions.where("status").equals("admitted").toArray()
    expect(admitted.length).toBeGreaterThan(10)
    const low: string[] = []
    for (const a of admitted) {
      const bed = (await db.beds.get(a.bedId))!
      const ward = (await db.wards.get(bed.wardId))!
      const consultant = (await db.doctors.get(a.consultantId))!
      const deposits = await db.deposits.where("admissionId").equals(a.id).toArray()
      for (const d of deposits) expect(d.branchId).toBe(a.branchId)
      const bill = interimBill({
        admittedAt: a.admittedAt,
        at: NOW,
        ward,
        consultantRoundP: consultant.followUpFeeP,
        depositsP: sum(deposits.map((d) => d.amountP)),
      })
      if (bill.low) {
        low.push(ward.kind)
        expect(a.depositAlertAt).toBeDefined()
        expect(bill.balanceP).toBeGreaterThan(0)
      } else {
        expect(a.depositAlertAt).toBeUndefined()
        // A day of fast-forward still leaves the deposit above the alert.
        const tomorrow = interimBill({
          admittedAt: a.admittedAt,
          at: NOW + 24 * 60 * 60 * 1000,
          ward,
          consultantRoundP: consultant.followUpFeeP,
          depositsP: bill.depositsP,
        })
        expect(tomorrow.low, a.id).toBe(false)
      }
    }
    expect(low).toEqual(["cabin"])
  })
})

describe("seed: runtime content", () => {
  it("links every scribe draft line to transcript lines and never drafts medicines or diagnoses", () => {
    expect(SCRIBE_SCRIPTS).toHaveLength(3)
    const hero = SCRIBE_SCRIPTS[0]
    expect(hero.patientId).toBe(HERO.patient.abdulKarim)
    expect(hero.transcript.length).toBeGreaterThanOrEqual(16)
    const medicineWords = [
      ...BRANDS.map((b) => b[0].toLowerCase()),
      ...GENERICS.flatMap((g) =>
        g.name
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter((w) => w.length > 5)
      ),
    ]
    // Symptom (R) and health-service (Z) codes describe complaints, not diagnoses.
    const diagnosisWords = ICD10.filter((e) => !/^[RZ]/.test(e.code)).map((e) =>
      e.label.toLowerCase()
    )
    for (const script of SCRIBE_SCRIPTS) {
      const ids = new Set(script.transcript.map((l) => l.id))
      expect(script.draft.some((d) => d.section === "assessment")).toBe(false)
      for (const section of script.draft) {
        for (const line of section.lines) {
          expect(line.transcriptLineIds.length).toBeGreaterThan(0)
          for (const id of line.transcriptLineIds)
            expect(ids.has(id)).toBe(true)
          const text = line.text.toLowerCase()
          const words = new Set(text.split(/[^a-z0-9-]+/))
          for (const w of medicineWords)
            expect(words.has(w), `${script.id}: ${w}`).toBe(false)
          for (const d of diagnosisWords)
            expect(text.includes(d), `${script.id}: ${d}`).toBe(false)
        }
      }
    }
  })
})

describe("seed: determinism and robustness", () => {
  it("produces identical patients on a second run", async () => {
    const other = new MedcoreDb("seed-test-2")
    try {
      await seedDatabase(other, OPTS)
      const a = await db.patients.orderBy("id").toArray()
      const b = await other.patients.orderBy("id").toArray()
      expect(b).toEqual(a)
      expect(await other.sessions.count()).toBe(await db.sessions.count())
      expect(await other.counters.toArray()).toEqual(
        await db.counters.toArray()
      )
    } finally {
      await other.delete()
    }
  }, 60_000)

  it("builds for other anchor days (Friday, early morning, fiscal year start, late evening)", () => {
    const anchors: [string, number][] = [
      ["2026-10-02", Date.UTC(2026, 9, 1, 20, 30)], // Friday 02:30 Dhaka
      ["2026-07-01", Date.UTC(2026, 6, 1, 3, 0)], // first day of FY 2026-27, 09:00
      ["2027-01-15", Date.UTC(2027, 0, 15, 16, 45)], // 22:45
    ]
    for (const [today, now] of anchors) {
      const { bag, counters } = buildSeed({ now, today })
      expect(bag.count("patients")).toBe(500)
      expect(counters.find((c) => c.id === "po")?.value).toBe(1041)
      const levels = bag.all("stockLevels")
      expect(levels.every((l) => l.qty >= 0)).toBe(true)
      expect(bag.find("sessions", SEED_REFS.session.kamalToday)?.date).toBe(
        today
      )
    }
  })
})

function age(p: PatientRow): number {
  const [by, bm, bd] = p.dob.split("-").map(Number)
  const [y, m, d] = TODAY.split("-").map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}
