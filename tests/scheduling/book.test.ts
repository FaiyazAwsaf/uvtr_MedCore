import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate, HOUR } from "@/core/clock/dates"
import { baseFields, seedRow } from "@/core/db/base"
import { MedcoreDb } from "@/core/db/database"
import type { BrandRow, DoctorRow, PatientRow, SessionRow, StaffRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { RuleViolation } from "@/core/engine/errors"
import type { Actor } from "@/core/engine/types"
import { requestTransfer } from "@/modules/inventory/commands"
import { bookAppointment } from "@/modules/scheduling/commands"

const reception: Actor = {
  staffId: "stf_farhana_akter",
  personaId: "per_reception_farhana",
  role: "receptionist",
  branchId: "B1",
  name: "Farhana Akter",
  authorities: [],
}

let db: MedcoreDb
let n = 0
let today: string

function patient(id: string): PatientRow {
  return {
    ...baseFields(id, 1),
    uhid: `U-${id}`,
    aliases: [],
    identityStatus: "active",
    nameEn: `Patient ${id}`,
    nameBn: `রোগী ${id}`,
    nameSearchKeys: [id],
    dob: "1970-01-01",
    sex: "M",
    phone: "01711-523418",
    phoneVerified: true,
    allergies: [],
    currentMeds: [],
    problems: [],
    photoSeed: id,
    consents: [{ purpose: "sms", granted: true, at: 1 }],
    registeredAtBranch: "B1",
  }
}

beforeEach(async () => {
  // Pin the demo clock to 09:00 Dhaka today so every slot of a 10:00 session is in the future.
  const realToday = dhakaDate(Date.now())
  applyClockOffset(atDhaka(realToday, "09:00") - Date.now())
  today = dhakaDate(now())
  db = new MedcoreDb(`book-test-${++n}`)
  await db.staff.add(
    seedRow<StaffRow>("stf_kamal_hossain", 1, {
      nameEn: "Dr. Kamal Hossain",
      nameBn: "ডা. কামাল হোসেন",
      sex: "M",
      role: "doctor",
      branchId: "B1",
      designation: { en: "Consultant, Medicine", bn: "কনসালট্যান্ট, মেডিসিন" },
      authorities: [],
      avatarSeed: "k",
    })
  )
  await db.doctors.add(
    seedRow<DoctorRow>("doc_kamal_hossain", 1, {
      staffId: "stf_kamal_hossain",
      specialtyId: "spec_medicine",
      kind: "consultant",
      bmdcNo: "A-45127",
      bmdcVerified: true,
      qualifications: "MBBS, FCPS (Medicine)",
      experienceYears: 14,
      languages: ["en", "bn"],
      consultFeeP: 100_000,
      followUpFeeP: 50_000,
      branchIds: ["B1"],
      bio: { en: "", bn: "" },
      isDutyDoctor: false,
    })
  )
  await db.sessions.add(
    seedRow<SessionRow>("ses_1", 1, {
      doctorId: "doc_kamal_hossain",
      branchId: "B1",
      roomId: "room_b1_3",
      date: today,
      start: "10:00",
      end: "10:30",
      slotMin: 10,
      capacity: 3,
      walkInQuota: 1,
      visitTypes: ["first", "follow-up"],
      feeP: 100_000,
      followUpFeeP: 50_000,
      status: "open",
      delayMin: 0,
      tokenPrefix: "M",
    })
  )
  await db.patients.bulkAdd(["p1", "p2", "p3", "p4"].map(patient))
})
afterEach(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("scheduling.book", () => {
  it("books the first free slot, bills the fee and queues the confirmation SMS", async () => {
    const { result } = await commit(
      bookAppointment,
      { sessionId: "ses_1", patientId: "p1", source: "counter" },
      { db, actor: reception }
    )
    expect(result).toMatchObject({ slotStart: "10:00", feeP: 100_000 })
    const appointment = await db.appointments.get(result.appointmentId)
    expect(appointment).toMatchObject({ status: "booked", source: "counter", date: today, bookedBy: "stf_farhana_akter" })
    const line = await db.basketLines.get(appointment!.feeBasketLineId!)
    expect(line).toMatchObject({ sourceType: "consult", unitPriceP: 100_000, status: "open", payerType: "self" })
    const sms = await db.sms.toArray()
    expect(sms).toHaveLength(1)
    expect(sms[0].text).toContain("ডা. কামাল হোসেন")
    expect((await db.events.toArray()).map((e) => e.type)).toEqual(["AppointmentBooked"])
  })

  it("keeps capacity for walk-ins and refuses double booking", async () => {
    await commit(bookAppointment, { sessionId: "ses_1", patientId: "p1", source: "app" }, { db, actor: reception })
    await expect(
      commit(bookAppointment, { sessionId: "ses_1", patientId: "p1", source: "call" }, { db, actor: reception })
    ).rejects.toMatchObject({ code: "ALREADY_BOOKED" })
    await commit(bookAppointment, { sessionId: "ses_1", patientId: "p2", source: "call", slotStart: "10:20" }, { db, actor: reception })
    // Capacity 3 with 1 walk-in place: two booked slots are the limit.
    await expect(
      commit(bookAppointment, { sessionId: "ses_1", patientId: "p3", source: "counter" }, { db, actor: reception })
    ).rejects.toBeInstanceOf(RuleViolation)
    const walkIn = await commit(bookAppointment, { sessionId: "ses_1", patientId: "p3", source: "walk-in" }, { db, actor: reception })
    expect(walkIn.result.slotStart).toBe("09:00")
    await expect(
      commit(bookAppointment, { sessionId: "ses_1", patientId: "p4", source: "walk-in" }, { db, actor: reception })
    ).rejects.toMatchObject({ code: "WALK_IN_QUOTA_FULL" })
  })

  it("refuses a slot that is already taken", async () => {
    await commit(bookAppointment, { sessionId: "ses_1", patientId: "p1", source: "counter", slotStart: "10:10" }, { db, actor: reception })
    await expect(
      commit(bookAppointment, { sessionId: "ses_1", patientId: "p2", source: "counter", slotStart: "10:10" }, { db, actor: reception })
    ).rejects.toMatchObject({ code: "SLOT_TAKEN" })
    expect(now() + HOUR).toBeGreaterThan(atDhaka(today, "09:00"))
  })
})

describe("inventory.requestTransfer", () => {
  it("creates a numbered request with its lines", async () => {
    await db.brands.add(
      seedRow<BrandRow>("brand_zimax500", 1, {
        name: "Zimax",
        genericId: "gen_azithromycin",
        companyId: "co_square",
        strength: "500 mg",
        form: "tablet",
        darNo: "DAR-X",
        packSizes: [{ label: "3 x 1", units: 3 }],
        unitPriceP: 3_500,
        mrpP: 3_500,
        category: "rx",
        isAntibiotic: true,
        searchKeys: ["zimax"],
        unitLabel: { en: "tablet", bn: "ট্যাবলেট" },
      })
    )
    const doctor: Actor = { ...reception, role: "doctor", staffId: "stf_kamal_hossain", name: "Dr. Kamal Hossain" }
    const { result } = await commit(
      requestTransfer,
      { fromBranchId: "B3", toBranchId: "B1", lines: [{ brandId: "brand_zimax500", qty: 30 }], requestedFrom: "doctor-prompt" },
      { db, actor: doctor }
    )
    expect(result.transferNo).toBe("TR-0001")
    expect((await db.transfers.get(result.transferId))?.status).toBe("requested")
    expect(await db.transferLines.where("transferId").equals(result.transferId).count()).toBe(1)
    await expect(
      commit(
        requestTransfer,
        { fromBranchId: "B1", toBranchId: "B1", lines: [{ brandId: "brand_zimax500", qty: 1 }], requestedFrom: "pharmacy" },
        { db, actor: doctor }
      )
    ).rejects.toMatchObject({ code: "TRANSFER_SAME_BRANCH" })
  })
})
