import { describe, expect, it } from "vitest"

import { atDhaka } from "@/core/clock/dates"
import { seedRow } from "@/core/db/base"
import type {
  AppointmentRow,
  BasketLineRow,
  FamilyLinkRow,
  InvoiceRow,
  LabReportRow,
  NotificationRow,
  PatientRow,
  PrescriptionRow,
  QueueTokenRow,
  RxLineRow,
  SessionRow,
} from "@/core/db/schema"
import { checkInState, nextAppointment, splitAppointments } from "@/modules/patient-app/lib/appointments"
import { invoiceDue, openChargesByBranch } from "@/modules/patient-app/lib/bills"
import { familyMembers, resolveMember } from "@/modules/patient-app/lib/family"
import {
  notificationHref,
  notificationTitleKey,
  unseenNotifications,
} from "@/modules/patient-app/lib/notifications"
import { isBdMobile, localMobile, samePhone } from "@/modules/patient-app/lib/phone"
import { myQueue, nowServing, waitingCount } from "@/modules/patient-app/lib/queue"
import { groupLabReports, replacementOf } from "@/modules/patient-app/lib/reports"
import { lineFulfilment, newerPrescription, rxSummary } from "@/modules/patient-app/lib/rx"
import { hasActiveBooking, sessionAvailability, slotTimes } from "@/modules/patient-app/lib/slots"

const DAY = "2026-09-28"
const at = (time: string) => atDhaka(DAY, time)

function session(patch: Partial<SessionRow> = {}): SessionRow {
  return seedRow<SessionRow>("ses_1", 0, {
    doctorId: "doc_1",
    branchId: "B1",
    roomId: "rm_1",
    date: DAY,
    start: "10:00",
    end: "11:00",
    slotMin: 15,
    capacity: 4,
    walkInQuota: 1,
    visitTypes: ["first", "follow-up"],
    feeP: 100_000,
    followUpFeeP: 50_000,
    status: "open",
    delayMin: 0,
    tokenPrefix: "M",
    ...patch,
  })
}

let aptSeq = 0
function appointment(patch: Partial<AppointmentRow> = {}): AppointmentRow {
  const id = `apt_${++aptSeq}`
  return seedRow<AppointmentRow>(id, 0, {
    sessionId: "ses_1",
    patientId: "pat_x",
    doctorId: "doc_1",
    branchId: "B1",
    date: DAY,
    slotStart: "10:00",
    source: "app",
    visitType: "first",
    status: "booked",
    bookedBy: "pat_x",
    qrCode: `MEDCORE:APT:${id}`,
    ...patch,
  })
}

function token(n: number, patch: Partial<QueueTokenRow> = {}): QueueTokenRow {
  return seedRow<QueueTokenRow>(`tok_${n}`, 0, {
    sessionId: "ses_1",
    appointmentId: `apt_t${n}`,
    patientId: `pat_${n}`,
    branchId: "B1",
    roomId: "rm_1",
    number: n,
    label: `M-${n}`,
    kind: "booked",
    status: "waiting",
    issuedAt: n,
    position: n,
    ...patch,
  })
}

function patient(id: string, dob: string, patch: Partial<PatientRow> = {}): PatientRow {
  return seedRow<PatientRow>(id, 0, {
    uhid: id,
    aliases: [],
    identityStatus: "active",
    nameEn: id,
    nameBn: id,
    nameSearchKeys: [],
    dob,
    sex: "M",
    phoneVerified: true,
    allergies: [],
    currentMeds: [],
    problems: [],
    photoSeed: id,
    consents: [],
    registeredAtBranch: "B1",
    ...patch,
  })
}

function link(id: string, member: string, patch: Partial<FamilyLinkRow> = {}): FamilyLinkRow {
  return seedRow<FamilyLinkRow>(id, 0, {
    ownerPatientId: "pat_owner",
    memberPatientId: member,
    kind: "proxy",
    status: "granted",
    ...patch,
  })
}

describe("slot picker rules", () => {
  it("lists every slot start of a session", () => {
    expect(slotTimes("10:00", "11:00", 15)).toEqual(["10:00", "10:15", "10:30", "10:45"])
    expect(slotTimes("10:00", "10:25", 10)).toEqual(["10:00", "10:10"])
  })

  it("frees slots that nobody holds and that have not ended, ignoring walk-ins and cancellations", () => {
    const appts = [
      appointment({ slotStart: "10:15" }),
      appointment({ slotStart: "10:30", source: "walk-in", status: "checked-in" }),
      appointment({ slotStart: "10:45", status: "cancelled" }),
    ]
    const early = sessionAvailability(session(), appts, at("09:30"))
    expect(early.free).toEqual(["10:00", "10:30", "10:45"])
    expect(early.slots.find((s) => s.time === "10:15")?.state).toBe("taken")
    // At 10:20 the 10:00 slot has ended; the running 10:15 slot is still held.
    const later = sessionAvailability(session(), appts, at("10:20"))
    expect(later.slots.find((s) => s.time === "10:00")?.state).toBe("past")
    expect(later.free).toEqual(["10:30", "10:45"])
  })

  it("closes a session that is full, blocked or over", () => {
    const three = ["10:00", "10:15", "10:30"].map((slotStart) => appointment({ slotStart }))
    expect(sessionAvailability(session(), three, at("09:00"))).toMatchObject({
      closedReason: "full",
      free: [],
    })
    expect(sessionAvailability(session({ status: "blocked" }), [], at("09:00")).closedReason).toBe(
      "blocked"
    )
    expect(sessionAvailability(session(), [], at("11:30")).closedReason).toBe("ended")
  })

  it("knows when the patient already holds a place in the session", () => {
    const appts = [appointment({ patientId: "pat_a" }), appointment({ patientId: "pat_b", status: "cancelled" })]
    expect(hasActiveBooking(appts, "ses_1", "pat_a")).toBe(true)
    expect(hasActiveBooking(appts, "ses_1", "pat_b")).toBe(false)
  })
})

describe("live queue", () => {
  const tokens = [
    token(1, { status: "done", calledAt: 1 }),
    token(2, { status: "done", calledAt: 2 }),
    token(3, { kind: "walk-in" }),
    token(4),
    token(5, { status: "skipped", calledAt: 3 }),
    token(6, { status: "recalled", calledAt: 3 }),
    token(7),
  ]

  it("shows the last called token until someone else is called", () => {
    expect(nowServing(tokens)).toMatchObject({ state: "last-called", token: { label: "M-2" } })
    const called = tokens.map((t) => (t.number === 3 ? { ...t, status: "called" as const, calledAt: 9 } : t))
    expect(nowServing(called)).toMatchObject({ state: "serving", token: { label: "M-3" } })
    expect(nowServing([token(1)])).toBeNull()
  })

  it("counts waiting and recalled tokens with an earlier position as ahead", () => {
    expect(waitingCount(tokens)).toBe(4)
    expect(myQueue(tokens, "tok_7")).toMatchObject({ state: "waiting", ahead: 3 })
    expect(myQueue(tokens, "tok_3")).toMatchObject({ state: "waiting", ahead: 0 })
    expect(myQueue(tokens, "tok_5")?.state).toBe("skipped")
    expect(myQueue(tokens, "tok_1")?.state).toBe("done")
    expect(myQueue(tokens, undefined)).toBeNull()
  })
})

describe("family access (HAZ-14)", () => {
  const today = "2026-09-28"
  const owner = patient("pat_owner", "1992-01-01")
  const child = patient("pat_child", "2018-05-01")
  const father = patient("pat_father", "1964-03-01")
  const adultChild = patient("pat_adult_child", "2000-01-01")
  const merged = patient("pat_merged", "1970-01-01", { identityStatus: "merged" })
  const stranger = patient("pat_stranger", "1970-01-01")
  const all = [owner, child, father, adultChild, merged, stranger]

  it("shows the account holder and only members with a granted, valid link", () => {
    const links = [
      link("fl_1", "pat_child", { kind: "guardian" }),
      link("fl_2", "pat_father"),
      link("fl_3", "pat_adult_child", { kind: "guardian" }),
      link("fl_4", "pat_merged"),
      link("fl_5", "pat_stranger", { status: "requested" }),
      link("fl_6", "pat_stranger", { status: "revoked" }),
      link("fl_7", "pat_stranger", { ownerPatientId: "pat_someone_else" }),
    ]
    const members = familyMembers(owner, links, all, today)
    expect(members.map((m) => [m.patient.id, m.kind])).toEqual([
      ["pat_owner", "self"],
      ["pat_child", "guardian"],
      ["pat_father", "proxy"],
    ])
    expect(resolveMember(members, "pat_father")?.patient.id).toBe("pat_father")
    expect(resolveMember(members, "pat_stranger")?.patient.id).toBe("pat_owner")
  })
})

describe("appointments", () => {
  it("splits upcoming from past and finds the next one", () => {
    const soon = appointment({ date: "2026-09-29", slotStart: "10:00" })
    const today = appointment({ date: DAY, slotStart: "12:00", status: "checked-in" })
    const done = appointment({ date: DAY, slotStart: "09:00", status: "done" })
    const old = appointment({ date: "2026-09-01" })
    const { upcoming, past } = splitAppointments([soon, today, done, old], DAY)
    expect(upcoming.map((a) => a.id)).toEqual([today.id, soon.id])
    expect(past.map((a) => a.id)).toEqual([done.id, old.id])
    expect(nextAppointment([soon, today, done], DAY)?.id).toBe(today.id)
  })

  it("allows self check-in only for a booked appointment today at an online branch", () => {
    const booked = appointment()
    expect(checkInState(booked, session(), DAY, false)).toBe("ready")
    expect(checkInState(booked, session(), "2026-09-27", false)).toBe("not-today")
    expect(checkInState(booked, session({ status: "blocked" }), DAY, false)).toBe("closed")
    expect(checkInState(booked, session(), DAY, true)).toBe("offline")
    expect(checkInState({ ...booked, status: "checked-in" }, session(), DAY, false)).toBe("checked-in")
  })
})

describe("reports", () => {
  const report = (id: string, patch: Partial<LabReportRow>) =>
    seedRow<LabReportRow>(id, 0, {
      reportNo: "RPT-B1-000001",
      reportVersion: 1,
      patientId: "pat_x",
      branchId: "B1",
      labOrderId: "lo_1",
      itemIds: [],
      status: "released",
      releasedAt: 10,
      ...patch,
    })

  it("shows released versions only, groups corrections and keeps the newest first", () => {
    const v1 = report("rpt_v1", { status: "superseded", releasedAt: 10 })
    const v2 = report("rpt_v2", { reportVersion: 2, supersedesId: "rpt_v1", releasedAt: 20 })
    const other = report("rpt_other", { reportNo: "RPT-B1-000002", releasedAt: 30 })
    const draft = report("rpt_draft", { reportNo: "RPT-B1-000003", status: "draft", releasedAt: undefined })
    const held = report("rpt_held", { reportNo: "RPT-B1-000004", status: "signed", releasedAt: undefined })
    const groups = groupLabReports([v1, v2, other, draft, held])
    expect(groups.map((g) => g.current.id)).toEqual(["rpt_other", "rpt_v2"])
    expect(groups[1].earlier.map((r) => r.id)).toEqual(["rpt_v1"])
    expect(replacementOf(v1, groups[1]).id).toBe("rpt_v2")
  })
})

describe("prescriptions (HAZ-06)", () => {
  const line = (patch: Partial<RxLineRow>) =>
    seedRow<RxLineRow>("rxl_1", 0, {
      rxId: "rx_1",
      patientId: "pat_x",
      branchId: "B1",
      lineNo: 1,
      strength: "20 mg",
      form: "capsule",
      dosePattern: "1+0+1",
      mealTiming: "before",
      durationDays: 14,
      qtyPrescribed: 28,
      instructionsEn: "",
      instructionsBn: "",
      isAntibiotic: false,
      isControlled: false,
      paymentCleared: true,
      dispensedQty: 0,
      status: "open",
      ...patch,
    })

  it("reports collected and outstanding quantities and the balance deadline", () => {
    const partial = line({ status: "partial", dispensedQty: 14, balanceUntil: 1_000 })
    expect(lineFulfilment(partial, 500)).toEqual({
      prescribed: 28,
      dispensed: 14,
      outstanding: 14,
      deadline: 1_000,
      expired: false,
    })
    expect(lineFulfilment(partial, 2_000).expired).toBe(true)
    expect(lineFulfilment(line({ status: "dispensed", dispensedQty: 28 }), 0).outstanding).toBe(0)
    expect(lineFulfilment(line({ status: "bought-elsewhere" }), 0).outstanding).toBe(0)
  })

  it("summarises a whole prescription", () => {
    const dispensed = line({ status: "dispensed", dispensedQty: 28 })
    expect(rxSummary([dispensed], 0)).toBe("all")
    expect(rxSummary([line({})], 0)).toBe("none")
    expect(rxSummary([dispensed, line({ id: "rxl_2" })], 0)).toBe("balance")
    const partial = line({ status: "partial", dispensedQty: 14, balanceUntil: 1_000 })
    expect(rxSummary([partial], 500)).toBe("balance")
    expect(rxSummary([partial], 2_000)).toBe("expired")
  })

  it("points an earlier version at the one that replaced it", () => {
    const rx = (id: string, patch: Partial<PrescriptionRow>) =>
      seedRow<PrescriptionRow>(id, 0, {
        rxNo: "RX-B1-000001",
        rxVersion: 1,
        patientId: "pat_x",
        doctorId: "doc_1",
        branchId: "B1",
        status: "signed",
        mode: "in-person",
        advice: "",
        tests: [],
        signedAt: 1,
        ...patch,
      })
    const v1 = rx("rx_1", { status: "superseded" })
    const v2 = rx("rx_2", { rxVersion: 2, supersedesId: "rx_1" })
    expect(newerPrescription(v1, [v1, v2])?.id).toBe("rx_2")
    expect(newerPrescription(v2, [v1, v2])).toBeUndefined()
  })
})

describe("bills", () => {
  it("groups open charges by branch and works out what is due", () => {
    const basket = (id: string, patch: Partial<BasketLineRow>) =>
      seedRow<BasketLineRow>(id, 0, {
        patientId: "pat_x",
        branchId: "B1",
        sourceType: "consult",
        sourceId: "apt_1",
        serviceType: "consultation",
        description: "Consultation",
        qty: 1,
        unitPriceP: 100_000,
        status: "open",
        payerType: "self",
        ...patch,
      })
    const groups = openChargesByBranch([
      basket("bl_1", {}),
      basket("bl_2", { qty: 2, unitPriceP: 1_250 }),
      basket("bl_3", { branchId: "B3" }),
      basket("bl_4", { status: "invoiced" }),
    ])
    expect(groups.map((g) => [g.branchId, g.totalP])).toEqual([
      ["B1", 102_500],
      ["B3", 100_000],
    ])
    const invoice = seedRow<InvoiceRow>("inv_1", 0, {
      invoiceNo: "C1-B1-2627-000001",
      companyId: "C1",
      branchId: "B1",
      patientId: "pat_x",
      date: DAY,
      payerType: "self",
      subtotalP: 150_000,
      discountP: 0,
      discountPct: 0,
      taxP: 0,
      totalP: 150_000,
      paidP: 50_000,
      refundedP: 0,
      status: "partial",
      cashierId: "stf_x",
    })
    expect(invoiceDue(invoice)).toBe(100_000)
    expect(invoiceDue({ ...invoice, status: "paid", paidP: 150_000 })).toBe(0)
  })
})

describe("notifications", () => {
  const notification = (id: string, patch: Partial<NotificationRow>) =>
    seedRow<NotificationRow>(id, 0, {
      patientId: "pat_x",
      kind: "reportReady",
      titleKey: "patientApp.notifications.reportReady",
      refs: {},
      read: false,
      at: 1,
      ...patch,
    })

  it("titles known kinds only and opens the matching screen", () => {
    expect(notificationTitleKey(notification("n1", {}))).toBe("patientApp.notifications.reportReady")
    expect(
      notificationTitleKey(notification("n2", { kind: "sampleRejected", titleKey: "lab.sms.x" }))
    ).toBeNull()
    expect(notificationHref(notification("n3", { refs: { reportId: "rpt_1" } }))).toBe(
      "/app/reports?focus=rpt_1"
    )
    expect(notificationHref(notification("n4", { refs: { rxId: "rx_1" } }))).toBe(
      "/app/prescriptions?focus=rx_1"
    )
    expect(notificationHref(notification("n5", {}))).toBe("/app/notifications")
  })

  it("finds notifications that arrived since the last look, skipping held ones", () => {
    const rows = [
      notification("n1", { at: 1 }),
      notification("n2", { at: 3 }),
      notification("n3", { at: 2, held: true }),
    ]
    expect(unseenNotifications(new Set(["n1"]), rows).map((n) => n.id)).toEqual(["n2"])
  })
})

describe("mobile numbers", () => {
  it("accepts local and +88 forms and compares them", () => {
    expect(localMobile("+880 1711-523418")).toBe("01711523418")
    expect(isBdMobile("01711-523418")).toBe(true)
    expect(isBdMobile("0171152341")).toBe(false)
    expect(samePhone("8801711523418", "01711-523418")).toBe(true)
    expect(samePhone("01811-523418", "01711-523418")).toBe(false)
  })
})
