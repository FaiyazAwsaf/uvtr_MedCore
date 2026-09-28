import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { MedcoreDb } from "@/core/db/database"
import { groupUhid } from "@/core/db/numbering"
import { seedDatabase } from "@/core/seed"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { classifyQuery, searchFrontDesk } from "@/modules/identity/search"

let db: MedcoreDb

beforeAll(async () => {
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "11:30") - Date.now())
  db = new MedcoreDb("identity-search-test")
  await seedDatabase(db, { now: now(), today: dhakaDate(now()) })
})
afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("classifyQuery", () => {
  it("tells phones, UHIDs, provisional numbers and names apart", () => {
    expect(classifyQuery("01711-523418")).toEqual({ kind: "phone", phone: "01711-523418" })
    expect(classifyQuery("+880 1711 523418")).toEqual({ kind: "phone", phone: "01711-523418" })
    expect(classifyQuery("1000-1842-75-5")).toEqual({ kind: "digits", digits: "10001842755" })
    expect(classifyQuery("p-b2-000001")).toEqual({ kind: "provisional", value: "P-B2-000001" })
    expect(classifyQuery("Md. Rafiqul")).toEqual({ kind: "name", keys: ["md", "rafikul"] })
    expect(classifyQuery("মোঃ রফিকুল")).toEqual({ kind: "name", keys: ["মো", "রফিকুল"] })
    expect(classifyQuery("12")).toEqual({ kind: "short" })
    expect(classifyQuery("a")).toEqual({ kind: "short" })
    expect(classifyQuery("  ")).toEqual({ kind: "empty" })
  })
})

describe("searchFrontDesk", () => {
  it("lists the whole household for a shared phone, head first", async () => {
    for (const query of [HERO.karimPhone, "01711523418"]) {
      const result = await searchFrontDesk(db, query)
      expect(result.kind).toBe("household")
      if (result.kind !== "household") continue
      expect(result.household?.id).toBe(HERO.household.karim)
      expect(result.members.map((p) => p.id)).toEqual([
        HERO.patient.abdulKarim,
        HERO.patient.rokeyaBegum,
        HERO.patient.tanvirKarim,
        HERO.patient.nusratKarim,
      ])
    }
  })

  it("finds a UHID with or without dashes, exact match first", async () => {
    const abdul = await db.patients.get(HERO.patient.abdulKarim)
    for (const query of [abdul!.uhid, groupUhid(abdul!.uhid)]) {
      const result = await searchFrontDesk(db, query)
      expect(result.kind).toBe("list")
      if (result.kind === "list") expect(result.patients[0]?.id).toBe(HERO.patient.abdulKarim)
    }
  })

  it("finds names in English spelling variants and in Bangla", async () => {
    const english = await searchFrontDesk(db, "Mohammad Rafiqul")
    const bangla = await searchFrontDesk(db, "আব্দুল করিম")
    expect(english.kind === "list" && english.patients.map((p) => p.id)).toContain(
      SEED_REFS.patient.rafiqul
    )
    expect(bangla.kind === "list" && bangla.patients.map((p) => p.id)).toContain(
      HERO.patient.abdulKarim
    )
  })

  it("narrows by date of birth, and searches a date of birth alone", async () => {
    const abdul = await db.patients.get(HERO.patient.abdulKarim)
    const narrowed = await searchFrontDesk(db, "Karim", { dob: abdul!.dob })
    expect(narrowed.kind === "list" && narrowed.patients.map((p) => p.id)).toEqual([
      HERO.patient.abdulKarim,
    ])
    const byDob = await searchFrontDesk(db, "", { dob: abdul!.dob })
    expect(byDob.kind === "list" && byDob.patients.map((p) => p.id)).toContain(
      HERO.patient.abdulKarim
    )
  })

  it("finds NIDs and former UHIDs, and never shows merged records", async () => {
    const byNid = await searchFrontDesk(db, SEED_REFS.nidCollisions[0].nid)
    expect(byNid.kind === "list" && byNid.patients[0]?.id).toBe(SEED_REFS.patient.rafiqul)

    const merged = await db.patients.get("pat_off_parul_edge")
    expect(merged?.identityStatus).toBe("merged")
    const byAlias = await searchFrontDesk(db, merged!.uhid)
    expect(byAlias.kind === "list" && byAlias.patients.map((p) => p.id)).toEqual([
      "pat_off_parul_central",
    ])
  })

  it("asks for more before searching", async () => {
    expect((await searchFrontDesk(db, "7")).kind).toBe("short")
    expect((await searchFrontDesk(db, "")).kind).toBe("idle")
  })
})
