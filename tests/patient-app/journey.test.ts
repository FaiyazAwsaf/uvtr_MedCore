import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { applyClockOffset, now } from "@/core/clock/clock"
import { atDhaka, dhakaDate } from "@/core/clock/dates"
import { seedRow } from "@/core/db/base"
import { MedcoreDb } from "@/core/db/database"
import type { NotificationRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import type { Actor } from "@/core/engine/types"
import { seedDatabase } from "@/core/seed"
import { HERO, SEED_REFS } from "@/core/seed/content"
import { confirmMfs, payOnline } from "@/modules/billing/commands"
import { markNotificationsRead } from "@/modules/patient-app/commands"
import {
  checkInState,
  nextAppointment,
} from "@/modules/patient-app/lib/appointments"
import {
  invoiceDue,
  openChargesByBranch,
  pendingOnlinePayments,
} from "@/modules/patient-app/lib/bills"
import { familyMembers } from "@/modules/patient-app/lib/family"
import { notificationTitleKey } from "@/modules/patient-app/lib/notifications"
import { myQueue, nowServing } from "@/modules/patient-app/lib/queue"
import {
  groupLabReports,
  replacementOf,
} from "@/modules/patient-app/lib/reports"
import { rxSummary, visiblePrescriptions } from "@/modules/patient-app/lib/rx"
import { sessionAvailability } from "@/modules/patient-app/lib/slots"
import { callToken, checkIn } from "@/modules/queue/commands"
import { bookAppointment } from "@/modules/scheduling/commands"

/** The patient-app persona commits as Tanvir Karim (core/session/persona.ts). */
const tanvir: Actor = {
  staffId: HERO.patient.tanvirKarim,
  personaId: "per_patient_tanvir",
  role: "patient",
  branchId: null,
  name: "Tanvir Karim",
  authorities: [],
}
const doctor: Actor = {
  staffId: "stf_kamal_hossain",
  personaId: "per_doctor_kamal",
  role: "doctor",
  branchId: "B1",
  name: "Dr. Kamal Hossain",
  authorities: [],
}

const SESSION = SEED_REFS.session.kamalToday
let db: MedcoreDb
let today: string
let appointmentId: string
let tokenId: string

beforeAll(async () => {
  // 09:30 in Dhaka today, before seeding, so Dr. Kamal's 10:00 to 13:00 session has free slots.
  applyClockOffset(atDhaka(dhakaDate(Date.now()), "09:30") - Date.now())
  today = dhakaDate(now())
  db = new MedcoreDb("patient-app-journey")
  await seedDatabase(db, { now: now(), today })
})
afterAll(async () => {
  applyClockOffset(0)
  await db.delete()
})

describe("the Karim family in the patient app", () => {
  it("lets Tanvir see himself, Nusrat (guardian) and Abdul (proxy), never Rokeya", async () => {
    const account = (await db.patients.get(HERO.patient.tanvirKarim))!
    const links = await db.familyLinks
      .where("ownerPatientId")
      .equals(account.id)
      .toArray()
    const patients = await db.patients.bulkGet(
      links.map((l) => l.memberPatientId)
    )
    const members = familyMembers(
      account,
      links,
      patients.filter((p) => !!p),
      today
    )
    expect(members.map((m) => [m.patient.id, m.kind])).toEqual([
      [HERO.patient.tanvirKarim, "self"],
      [HERO.patient.abdulKarim, "proxy"],
      [HERO.patient.nusratKarim, "guardian"],
    ])
    expect(members.some((m) => m.patient.id === HERO.patient.rokeyaBegum)).toBe(
      false
    )
  })

  it("offers Dr. Kamal's free slots and books Abdul from the app", async () => {
    const session = (await db.sessions.get(SESSION))!
    const before = await db.appointments
      .where("sessionId")
      .equals(SESSION)
      .toArray()
    const { free } = sessionAvailability(session, before, now())
    expect(free.length).toBeGreaterThan(0)
    const slot = free[0]

    const { result } = await commit(
      bookAppointment,
      {
        sessionId: SESSION,
        patientId: HERO.patient.abdulKarim,
        source: "app",
        slotStart: slot,
      },
      { db, actor: tanvir }
    )
    appointmentId = result.appointmentId
    const booked = (await db.appointments.get(appointmentId))!
    expect(booked).toMatchObject({
      source: "app",
      status: "booked",
      slotStart: slot,
      bookedBy: tanvir.staffId,
    })

    const after = await db.appointments
      .where("sessionId")
      .equals(SESSION)
      .toArray()
    expect(sessionAvailability(session, after, now()).free).not.toContain(slot)
    const abdul = await db.appointments
      .where("patientId")
      .equals(HERO.patient.abdulKarim)
      .toArray()
    expect(nextAppointment(abdul, today)?.id).toBe(appointmentId)

    const basket = await db.basketLines
      .where("patientId")
      .equals(HERO.patient.abdulKarim)
      .toArray()
    const b1 = openChargesByBranch(basket).find((g) => g.branchId === "B1")
    expect(
      b1?.lines.some(
        (l) => l.sourceId === appointmentId && l.unitPriceP === session.feeP
      )
    ).toBe(true)
  })

  it("checks Abdul in with I'm here, then shows his token and how many are ahead", async () => {
    const appointment = (await db.appointments.get(appointmentId))!
    const session = (await db.sessions.get(SESSION))!
    expect(checkInState(appointment, session, today, false)).toBe("ready")

    const { result } = await commit(
      checkIn,
      { appointmentId },
      { db, actor: tanvir }
    )
    tokenId = result.tokenId
    const tokens = await db.queueTokens
      .where("sessionId")
      .equals(SESSION)
      .toArray()
    const waitingBefore = tokens.filter(
      (t) =>
        t.id !== tokenId &&
        t.status === "waiting" &&
        t.position < result.position
    ).length
    expect(myQueue(tokens, tokenId)).toMatchObject({
      state: "waiting",
      ahead: waitingBefore,
      token: { label: result.label },
    })
    expect(waitingBefore).toBeGreaterThan(0)
    // Nobody is with the doctor yet: the board still shows the last token called.
    expect(nowServing(tokens)?.state).toBe("last-called")

    const first = tokens
      .filter((t) => t.status === "waiting" && t.id !== tokenId)
      .sort((a, b) => a.position - b.position)[0]
    await commit(callToken, { tokenId: first.id }, { db, actor: doctor })
    const live = await db.queueTokens
      .where("sessionId")
      .equals(SESSION)
      .toArray()
    expect(nowServing(live)).toMatchObject({
      state: "serving",
      token: { id: first.id },
    })
    expect(myQueue(live, tokenId)).toMatchObject({ ahead: waitingBefore - 1 })
  })

  it("pays Abdul's consultation fee from the app with bKash, then approves the push", async () => {
    const abdul = HERO.patient.abdulKarim
    const open = await db.basketLines
      .where("[patientId+status]")
      .equals([abdul, "open"])
      .toArray()
    const fee = open.find((l) => l.sourceId === appointmentId)!
    expect(fee).toBeDefined()

    const { result } = await commit(
      payOnline,
      {
        patientId: abdul,
        basketLineIds: [fee.id],
        tender: "bkash",
        idempotencyKey: "test-app-pay-1",
      },
      { db, actor: tanvir }
    )
    expect(result.paymentId).toBeDefined()
    const payments = await db.payments
      .where("patientId")
      .equals(abdul)
      .toArray()
    expect(pendingOnlinePayments(payments).map((p) => p.id)).toContain(
      result.paymentId
    )
    expect(invoiceDue((await db.invoices.get(result.invoiceId))!)).toBe(
      fee.unitPriceP
    )

    const paymentId = result.paymentId!
    const { result: approved } = await commit(
      confirmMfs,
      { paymentId, idempotencyKey: "mfs-confirm:" + paymentId },
      { db, actor: tanvir }
    )
    expect(approved.invoiceStatus).toBe("paid")
    const invoice = (await db.invoices.get(result.invoiceId))!
    expect(invoiceDue(invoice)).toBe(0)
    const receipt = (
      await db.notifications.where("patientId").equals(abdul).toArray()
    ).find((n) => n.kind === "paymentReceived")!
    expect(notificationTitleKey(receipt)).toBe(
      "patientApp.notifications.paymentReceived"
    )
    expect(receipt.params).toMatchObject({ invoiceNo: invoice.invoiceNo })

    // Rokeya is not linked to Tanvir's account, so he may not pay for her.
    await expect(
      commit(
        payOnline,
        {
          patientId: HERO.patient.rokeyaBegum,
          invoiceId: invoice.id,
          tender: "bkash",
          idempotencyKey: "test-app-pay-2",
        },
        { db, actor: tanvir }
      )
    ).rejects.toMatchObject({ code: "NOT_YOUR_PATIENT" })
  })

  it("lists Abdul's released reports and his prescription with what he collected", async () => {
    const reports = await db.labReports
      .where("patientId")
      .equals(HERO.patient.abdulKarim)
      .toArray()
    const groups = groupLabReports(reports)
    expect(groups.length).toBeGreaterThan(0)
    expect(groups.every((g) => g.current.status === "released")).toBe(true)

    const rxs = visiblePrescriptions(
      await db.prescriptions
        .where("patientId")
        .equals(HERO.patient.abdulKarim)
        .toArray()
    )
    expect(rxs.length).toBeGreaterThan(0)
    const lines = await db.rxLines.where("rxId").equals(rxs[0].id).toArray()
    expect(rxSummary(lines, now())).toBe("all")
    expect(lines.every((l) => l.instructionsBn.length > 0)).toBe(true)
  })

  it("keeps a corrected report's first version, pointing to the current one", async () => {
    const superseded = (
      await db.labReports.where("status").equals("superseded").toArray()
    )[0]
    expect(superseded).toBeDefined()
    const reports = await db.labReports
      .where("patientId")
      .equals(superseded.patientId)
      .toArray()
    const group = groupLabReports(reports).find(
      (g) => g.key === superseded.reportNo
    )!
    expect(group.current.reportVersion).toBe(2)
    expect(group.earlier.map((r) => r.id)).toEqual([superseded.id])
    expect(replacementOf(superseded, group).id).toBe(group.current.id)
  })

  it("marks a family member's notifications read but refuses a relative without a link", async () => {
    const note = (id: string, patientId: string) =>
      seedRow<NotificationRow>(id, now(), {
        patientId,
        kind: "reportReady",
        titleKey: "patientApp.notifications.reportReady",
        refs: {},
        read: false,
        at: now(),
      })
    await db.notifications.bulkAdd([
      note("ntf_test_abdul", HERO.patient.abdulKarim),
      note("ntf_test_rokeya", HERO.patient.rokeyaBegum),
    ])

    const { result } = await commit(
      markNotificationsRead,
      { patientId: HERO.patient.abdulKarim },
      { db, actor: tanvir }
    )
    expect(result.count).toBeGreaterThanOrEqual(1)
    expect((await db.notifications.get("ntf_test_abdul"))?.read).toBe(true)
    const abdulNotes = await db.notifications
      .where("patientId")
      .equals(HERO.patient.abdulKarim)
      .toArray()
    expect(abdulNotes.every((n) => n.read)).toBe(true)

    await expect(
      commit(
        markNotificationsRead,
        { patientId: HERO.patient.rokeyaBegum },
        { db, actor: tanvir }
      )
    ).rejects.toMatchObject({ code: "FAMILY_ACCESS_DENIED" })
    expect((await db.notifications.get("ntf_test_rokeya"))?.read).toBe(false)
  })
})
