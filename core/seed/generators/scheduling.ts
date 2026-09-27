/**
 * Sessions, appointments and queue tokens (plan §7.1, §7.2, §10). Sessions
 * run from today minus 30 to today plus 14 days. Today looks alive: Dr. Kamal
 * Hossain's 10:00 to 13:00 session at B1 Room 3 has 12 appointments, two
 * already seen and four waiting with tokens in the 2 booked : 1 walk-in
 * order; Dr. Arif Rahman has 8 bookings later today (S11). Abdul Karim has no
 * appointment today (the presenter books it live).
 */

import type { BranchCode } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import type {
  AppointmentRow,
  HHMM,
  ISODate,
  Ms,
  PatientRow,
  QueueTokenRow,
  SessionRow,
  VisitType,
} from "@/core/db/schema"
import type { Rng } from "@/lib/mock/rng"

import type { SeedCtx } from "../context"
import { consultRoomId, CONSULT_ROOMS } from "../content/org"
import { HERO } from "../content/hero-ids"
import { SEED_REFS } from "../content/seed-refs"
import { SPECIALTIES } from "../content/specialties"
import { BRANCH_ACTORS } from "../content/staff"
import { DAY, dhakaAt, hhmmToMin, isoWeekday, minToHHMM, MINUTE } from "../time"
import type { DoctorInfo } from "./org"
import type { PatientPools } from "./patients"

type Band = "AM" | "PM" | "EVE"

type Schedule = {
  doctor: DoctorInfo
  branch: BranchCode
  room: number
  band: Band
  start: HHMM
  end: HHMM
  slotMin: number
  weekdays: number[]
  tokenPrefix: string
}

const BAND_TIMES: Record<Band, [HHMM, HHMM][]> = {
  AM: [
    ["09:00", "12:00"],
    ["10:00", "13:00"],
  ],
  PM: [
    ["14:30", "17:30"],
    ["15:00", "18:00"],
  ],
  EVE: [
    ["18:00", "21:00"],
    ["18:30", "21:30"],
  ],
}

const WORKDAYS = [6, 0, 1, 2, 3, 4] // Saturday to Thursday; Friday is the weekend

export type SchedulingOut = {
  sessions: SessionRow[]
  kamalToday: { session: SessionRow; appointments: AppointmentRow[] }
  arifToday: { session: SessionRow; appointments: AppointmentRow[] }
  todayAppointments: AppointmentRow[]
  yesterdayB1Done: AppointmentRow[]
  abdulHistory: { session: SessionRow; appointment: AppointmentRow }
  tokens: QueueTokenRow[]
}

export function slotGrid(start: HHMM, end: HHMM, slotMin: number): HHMM[] {
  const out: HHMM[] = []
  for (let m = hhmmToMin(start); m + slotMin <= hhmmToMin(end); m += slotMin)
    out.push(minToHHMM(m))
  return out
}

/** Queue order for tokens in issue order: 2 booked, then 1 walk-in (PRD §10.2). */
export function interleavePositions(kinds: QueueTokenRow["kind"][]): number[] {
  const booked: number[] = []
  const walkIn: number[] = []
  kinds.forEach((k, i) => (k === "booked" ? booked : walkIn).push(i))
  const order: number[] = []
  const { booked: nb, walkIn: nw } = rules.walkInInterleave
  while (booked.length || walkIn.length) {
    for (let i = 0; i < nb && booked.length; i++) order.push(booked.shift()!)
    for (let i = 0; i < nw && walkIn.length; i++) order.push(walkIn.shift()!)
  }
  const positions = new Array<number>(kinds.length)
  order.forEach((tokenIndex, pos) => (positions[tokenIndex] = pos + 1))
  return positions
}

function buildSchedules(doctors: DoctorInfo[], rng: Rng): Schedule[] {
  // A room is booked per branch, band and weekday, so rooms are shared across days.
  const used = new Set<string>()
  const prefixUse = new Map<string, number>()
  const take = (
    branch: BranchCode,
    band: Band,
    room: number,
    days: number[]
  ) => {
    for (const d of days) used.add(`${branch}:${band}:${room}:${d}`)
  }
  const free = (
    branch: BranchCode,
    band: Band,
    days: number[]
  ): number | undefined => {
    const count = CONSULT_ROOMS[branch]?.count ?? 0
    for (const n of rng.shuffle(
      Array.from({ length: count }, (_, i) => i + 1)
    )) {
      if (days.every((d) => !used.has(`${branch}:${band}:${n}:${d}`))) return n
    }
    return undefined
  }
  /** Board prefix, unique per branch so a day never shows two "P-3": P, P2, P3 ... */
  const prefix = (spec: string, branch: BranchCode) => {
    const base = SPECIALTIES.find((s) => s.code === spec)?.tokenPrefix ?? "T"
    const key = `${branch}:${base}`
    const n = (prefixUse.get(key) ?? 0) + 1
    prefixUse.set(key, n)
    return n === 1 ? base : `${base}${n}`
  }
  const schedules: Schedule[] = []
  const add = (
    doctor: DoctorInfo,
    branch: BranchCode,
    band: Band,
    room: number,
    times: [HHMM, HHMM],
    slotMin: number,
    weekdays: number[]
  ) => {
    take(branch, band, room, weekdays)
    schedules.push({
      doctor,
      branch,
      room,
      band,
      start: times[0],
      end: times[1],
      slotMin,
      weekdays,
      tokenPrefix: prefix(doctor.specialty, branch),
    })
  }
  /** First band (preferred first) with a room free on all the days. */
  const place = (
    doctor: DoctorInfo,
    branch: BranchCode,
    bands: Band[],
    days: number[],
    slotMin: number
  ) => {
    for (const band of bands) {
      const room = free(branch, band, days)
      if (room !== undefined) {
        add(
          doctor,
          branch,
          band,
          room,
          rng.pick(BAND_TIMES[band]),
          slotMin,
          days
        )
        return
      }
    }
    throw new Error(`seed: no free room for ${doctor.id} at ${branch}`)
  }

  const byId = new Map(doctors.map((d) => [d.id, d]))
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
  // Persona doctors first so they get the unsuffixed token prefixes. Their
  // rooms are held on every weekday because their sessions are forced today.
  add(
    byId.get(HERO.doctor.kamal)!,
    "B1",
    "AM",
    3,
    ["10:00", "13:00"],
    10,
    [6, 0, 1, 2, 3, 4]
  )
  take("B1", "AM", 3, ALL_DAYS)
  // Arif's evening session overlaps the PM and EVE bands: hold Room 5 in both.
  take("B1", "PM", 5, ALL_DAYS)
  add(
    byId.get(HERO.doctor.arif)!,
    "B1",
    "EVE",
    5,
    ["17:00", "20:00"],
    15,
    [0, 2, 4, 6]
  )
  take("B1", "EVE", 5, ALL_DAYS)
  add(
    byId.get(HERO.doctor.nazmul)!,
    "B3",
    "EVE",
    2,
    ["18:00", "21:00"],
    15,
    [0, 1, 3, 6]
  )
  take("B3", "EVE", 2, ALL_DAYS)
  place(byId.get(HERO.doctor.nazmul)!, "B1", ["AM"], [2], 15)

  for (const d of doctors) {
    if (d.persona || d.kind !== "consultant") continue
    const [primary, secondary] = d.branches
    const band = rng.weighted<Band>([
      ["AM", 40],
      ["PM", 25],
      ["EVE", 35],
    ])
    const days = rng.pickMany(WORKDAYS, rng.int(2, 3))
    if (rng.bool(0.1)) days.push(5) // a few Friday chambers
    const slotMin = d.feeTaka >= 1200 ? 15 : 10
    const bands: Band[] = [
      band,
      ...(["AM", "PM", "EVE"] as Band[]).filter((b) => b !== band),
    ]
    place(d, primary, bands, days, slotMin)
    if (secondary) {
      const other = WORKDAYS.filter((w) => !days.includes(w))
      place(
        d,
        secondary,
        ["EVE", "PM"],
        rng.pickMany(other, rng.int(1, 2)),
        slotMin
      )
    }
  }
  return schedules
}

export function seedScheduling(
  ctx: SeedCtx,
  doctors: DoctorInfo[],
  pools: PatientPools
): SchedulingOut {
  const { bag } = ctx
  const rng = ctx.rng("scheduling")
  const schedules = buildSchedules(doctors, rng)

  /* Patient pools per branch and kind */
  const adultsAt = new Map<BranchCode, PatientRow[]>()
  const minorsAt = new Map<BranchCode, PatientRow[]>()
  for (const p of pools.adults)
    adultsAt.set(p.registeredAtBranch, [
      ...(adultsAt.get(p.registeredAtBranch) ?? []),
      p,
    ])
  for (const p of pools.minors)
    minorsAt.set(p.registeredAtBranch, [
      ...(minorsAt.get(p.registeredAtBranch) ?? []),
      p,
    ])
  const usedOn = new Map<ISODate, Set<string>>()
  const pickPatient = (
    branch: BranchCode,
    specialty: string,
    date: ISODate
  ): PatientRow | undefined => {
    const used = usedOn.get(date) ?? new Set<string>()
    usedOn.set(date, used)
    let pool: PatientRow[]
    if (specialty === "PAED")
      pool = rng.bool(0.8)
        ? (minorsAt.get(branch) ?? pools.minors)
        : pools.minors
    else {
      pool = rng.bool(0.75)
        ? (adultsAt.get(branch) ?? pools.adults)
        : pools.adults
      if (specialty === "GYN") pool = pool.filter((p) => p.sex === "F")
    }
    for (let i = 0; i < 12; i++) {
      const p = rng.pick(pool)
      if (p && !used.has(p.id)) {
        used.add(p.id)
        return p
      }
    }
    return undefined
  }
  const bookerFor = (
    p: PatientRow,
    source: AppointmentRow["source"],
    branch: BranchCode
  ) =>
    source === "app"
      ? (p.guardianPatientId ?? p.id)
      : BRANCH_ACTORS[branch].reception
  const pickSource = (): AppointmentRow["source"] =>
    rng.weighted<AppointmentRow["source"]>([
      ["app", 25],
      ["call", 20],
      ["counter", 40],
      ["walk-in", 15],
    ])
  const pickVisit = (): VisitType =>
    rng.weighted<VisitType>([
      ["first", 60],
      ["follow-up", 35],
      ["report", 5],
    ])

  const sessions: SessionRow[] = []
  const todayAppointments: AppointmentRow[] = []
  const yesterdayB1Done: AppointmentRow[] = []
  const tokens: QueueTokenRow[] = []
  const blockedBudget = { n: 2 }
  let kamalToday: SchedulingOut["kamalToday"] | undefined
  let arifToday: SchedulingOut["arifToday"] | undefined
  let abdulHistory: SchedulingOut["abdulHistory"] | undefined

  // Abdul Karim's previous visit with Dr. Kamal about three weeks ago.
  let abdulDay = -21
  while (isoWeekday(ctx.day(abdulDay)) === 5) abdulDay -= 1

  const specialSessionId = (s: Schedule, date: ISODate): string | undefined => {
    if (date !== ctx.today) return undefined
    if (s.doctor.id === HERO.doctor.kamal) return SEED_REFS.session.kamalToday
    if (s.doctor.id === HERO.doctor.arif) return SEED_REFS.session.arifToday
    if (s.doctor.id === HERO.doctor.nazmul && s.branch === "B3")
      return SEED_REFS.session.nazmulToday
    return undefined
  }
  const forcedToday = (s: Schedule) =>
    s.doctor.id === HERO.doctor.kamal ||
    s.doctor.id === HERO.doctor.arif ||
    (s.doctor.id === HERO.doctor.nazmul && s.branch === "B3")

  const newAppointment = (
    session: SessionRow,
    s: Schedule,
    patient: PatientRow,
    slotStart: HHMM,
    source: AppointmentRow["source"],
    status: AppointmentRow["status"],
    bookedAt: Ms,
    extra: Partial<AppointmentRow> = {}
  ): AppointmentRow => {
    const id = `apt_${session.id.slice(4)}_${slotStart.replace(":", "")}${source === "walk-in" ? "w" : ""}`
    const row = bag.put("appointments", id, bookedAt, {
      sessionId: session.id,
      patientId: patient.id,
      doctorId: s.doctor.id,
      branchId: s.branch,
      date: session.date,
      slotStart,
      source,
      visitType: pickVisit(),
      status,
      bookedBy: bookerFor(patient, source, s.branch),
      qrCode: `MC|APT|${id}`,
      ...extra,
    })
    return row
  }

  for (let offset = -30; offset <= 14; offset++) {
    const date = ctx.day(offset)
    const weekday = isoWeekday(date)
    for (const s of schedules) {
      const runs =
        s.weekdays.includes(weekday) || (offset === 0 && forcedToday(s))
      if (!runs) continue
      const startMs = dhakaAt(date, s.start)
      const grid = slotGrid(s.start, s.end, s.slotMin)
      const capacity = grid.length
      const special = specialSessionId(s, date)
      const isPersona = Boolean(s.doctor.persona)
      const blocked =
        offset > 1 && !isPersona && blockedBudget.n > 0 && rng.bool(0.01)
      if (blocked) blockedBudget.n--
      const session = bag.put(
        "sessions",
        special ?? `ses_${s.doctor.id.slice(4)}_${s.branch}_${date}`,
        Math.min(startMs - 20 * DAY, ctx.now - DAY),
        {
          doctorId: s.doctor.id,
          branchId: s.branch,
          roomId: consultRoomId(s.branch, s.room),
          date,
          start: s.start,
          end: s.end,
          slotMin: s.slotMin,
          capacity,
          walkInQuota: Math.max(2, Math.round(capacity * 0.25)),
          visitTypes: ["first", "follow-up", "report"],
          feeP: s.doctor.feeTaka * 100,
          followUpFeeP: s.doctor.followUpTaka * 100,
          status: blocked ? "blocked" : offset < 0 ? "closed" : "open",
          delayMin: 0,
          delayReason: blocked ? "Doctor on leave" : undefined,
          tokenPrefix: s.tokenPrefix,
        }
      )
      sessions.push(session)
      if (blocked) continue

      /* ---- Hero sessions today ---- */
      if (special === SEED_REFS.session.kamalToday) {
        kamalToday = { session, appointments: seedKamalToday(session, s) }
        continue
      }
      if (special === SEED_REFS.session.arifToday) {
        const slots = [
          "17:00",
          "17:15",
          "17:30",
          "17:45",
          "18:15",
          "18:30",
          "19:00",
          "19:30",
        ]
        const appts = slots.map((slot, i) => {
          const p = pickPatient("B1", "PAED", date)!
          const source: AppointmentRow["source"] =
            i % 3 === 0 ? "app" : i % 3 === 1 ? "call" : "counter"
          return newAppointment(
            session,
            s,
            p,
            slot,
            source,
            "booked",
            ctx.now - rng.int(2, 72) * 60 * MINUTE
          )
        })
        arifToday = { session, appointments: appts }
        todayAppointments.push(...appts)
        continue
      }

      /* ---- Past sessions: mostly seen ---- */
      if (offset < 0) {
        const n = Math.min(capacity, rng.int(3, 7))
        const slots = rng.pickMany(grid, n).sort()
        const isAbdulDay =
          s.doctor.id === HERO.doctor.kamal && offset === abdulDay
        if (isAbdulDay) {
          const abdul = pools.byId.get(HERO.patient.abdulKarim)!
          const slot = "10:30"
          const appt = newAppointment(
            session,
            s,
            abdul,
            slot,
            "app",
            "done",
            startMs - 2 * DAY,
            {
              bookedBy: HERO.patient.tanvirKarim,
              visitType: "follow-up",
              checkedInAt: dhakaAt(date, "10:18"),
            }
          )
          appt.updatedAt = dhakaAt(date, "10:52")
          abdulHistory = { session, appointment: appt }
          const idx = slots.indexOf(slot)
          if (idx >= 0) slots.splice(idx, 1)
        }
        for (const slot of slots) {
          const p = pickPatient(s.branch, s.doctor.specialty, date)
          if (!p) continue
          const source = pickSource()
          const status = rng.weighted<AppointmentRow["status"]>([
            ["done", 80],
            ["no-show", 13],
            ["cancelled", 7],
          ])
          const slotMs = dhakaAt(date, slot)
          const appt = newAppointment(
            session,
            s,
            p,
            slot,
            source,
            status,
            source === "walk-in"
              ? slotMs - 25 * MINUTE
              : slotMs - rng.int(2, 150) * 60 * MINUTE,
            {
              checkedInAt:
                status === "done"
                  ? slotMs - rng.int(5, 25) * MINUTE
                  : undefined,
            }
          )
          appt.updatedAt = slotMs + rng.int(10, 40) * MINUTE
          if (offset === -1 && s.branch === "B1" && status === "done")
            yesterdayB1Done.push(appt)
        }
        continue
      }

      /* ---- Future sessions: a few bookings, fewer further out ---- */
      if (offset > 0) {
        const n = Math.max(0, Math.round(rng.int(1, 5) * (1 - offset / 20)))
        const slots = rng.pickMany(grid, Math.min(n, capacity)).sort()
        for (const slot of slots) {
          const p = pickPatient(s.branch, s.doctor.specialty, date)
          if (!p) continue
          const source = rng.weighted<AppointmentRow["source"]>([
            ["app", 40],
            ["call", 30],
            ["counter", 30],
          ])
          const status: AppointmentRow["status"] = rng.bool(0.05)
            ? "cancelled"
            : "booked"
          newAppointment(
            session,
            s,
            p,
            slot,
            source,
            status,
            ctx.now - rng.int(1, 240) * 60 * MINUTE
          )
        }
        continue
      }

      /* ---- Other sessions today ---- */
      const n = Math.min(capacity, rng.int(4, 9))
      const slots = rng.pickMany(grid, n).sort()
      const started = startMs - 45 * MINUTE <= ctx.now
      const checkIns = started ? Math.min(slots.length, rng.int(2, 4)) : 0
      const todays: AppointmentRow[] = []
      slots.forEach((slot, i) => {
        const p = pickPatient(s.branch, s.doctor.specialty, date)
        if (!p) return
        const walkIn = i < checkIns && rng.bool(0.25)
        const source = walkIn
          ? "walk-in"
          : rng.pick<AppointmentRow["source"]>(["app", "call", "counter"])
        const checkedIn = i < checkIns
        const checkedInAt = checkedIn
          ? ctx.now - (checkIns - i) * rng.int(6, 12) * MINUTE
          : undefined
        const appt = newAppointment(
          session,
          s,
          p,
          slot,
          source,
          checkedIn ? "checked-in" : "booked",
          walkIn && checkedInAt
            ? checkedInAt - 2 * MINUTE
            : ctx.now - rng.int(3, 96) * 60 * MINUTE,
          { checkedInAt }
        )
        todays.push(appt)
      })
      todayAppointments.push(...todays)
      issueTokens(
        session,
        todays.filter((a) => a.status === "checked-in")
      )
    }
  }

  function issueTokens(
    session: SessionRow,
    checkedIn: AppointmentRow[],
    statuses: QueueTokenRow["status"][] = []
  ) {
    const ordered = [...checkedIn].sort(
      (a, b) => (a.checkedInAt ?? 0) - (b.checkedInAt ?? 0)
    )
    const kinds = ordered.map(
      (a) =>
        (a.source === "walk-in" ? "walk-in" : "booked") as QueueTokenRow["kind"]
    )
    const positions = interleavePositions(kinds)
    ordered.forEach((a, i) => {
      const number = i + 1
      const token = bag.put(
        "queueTokens",
        `tok_${session.id.slice(4)}_${number}`,
        a.checkedInAt ?? ctx.now,
        {
          sessionId: session.id,
          appointmentId: a.id,
          patientId: a.patientId,
          branchId: session.branchId,
          roomId: session.roomId,
          number,
          label: `${session.tokenPrefix}-${number}`,
          kind: kinds[i],
          status: statuses[i] ?? "waiting",
          issuedAt: a.checkedInAt ?? ctx.now,
          position: positions[i],
        }
      )
      a.tokenId = token.id
      tokens.push(token)
    })
  }

  /** Dr. Kamal today: 11 booked plus 1 walk-in; 2 seen, 4 waiting, 6 still to arrive. */
  function seedKamalToday(session: SessionRow, s: Schedule): AppointmentRow[] {
    const date = session.date
    const bookedSlots = [
      "10:00",
      "10:10",
      "10:20",
      "10:30",
      "10:50",
      "11:00",
      "11:20",
      "11:30",
      "11:40",
      "12:10",
      "12:30",
    ]
    const sources: AppointmentRow["source"][] = [
      "app",
      "counter",
      "call",
      "app",
      "counter",
      "call",
      "app",
      "counter",
      "counter",
      "call",
      "app",
    ]
    const appts: AppointmentRow[] = []
    bookedSlots.forEach((slot, i) => {
      const p = pickPatient("B1", "MED", date)!
      appts.push(
        newAppointment(
          session,
          s,
          p,
          slot,
          sources[i],
          "booked",
          ctx.now - (26 - i) * 60 * MINUTE
        )
      )
    })
    // Arrival order: seen, seen, walk-in, waiting x3.
    const arrive = (
      a: AppointmentRow,
      minutesAgo: number,
      status: AppointmentRow["status"]
    ) => {
      a.status = status
      a.checkedInAt = ctx.now - minutesAgo * MINUTE
      a.updatedAt = a.checkedInAt
    }
    arrive(appts[0], 75, "done")
    arrive(appts[1], 68, "done")
    const walkInPatient = pickPatient("B1", "MED", date)!
    const walkIn = newAppointment(
      session,
      s,
      walkInPatient,
      "12:50",
      "walk-in",
      "checked-in",
      ctx.now - 41 * MINUTE,
      {
        checkedInAt: ctx.now - 40 * MINUTE,
        visitType: "first",
      }
    )
    arrive(appts[2], 32, "checked-in")
    arrive(appts[3], 20, "checked-in")
    arrive(appts[4], 9, "checked-in")
    appts[0].updatedAt = ctx.now - 45 * MINUTE
    appts[1].updatedAt = ctx.now - 30 * MINUTE
    const arrived = [appts[0], appts[1], walkIn, appts[2], appts[3], appts[4]]
    issueTokens(session, arrived, [
      "done",
      "done",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ])
    const calledAt = [ctx.now - 58 * MINUTE, ctx.now - 43 * MINUTE]
    arrived.slice(0, 2).forEach((a, i) => {
      const token = bag.get("queueTokens", a.tokenId!)
      token.calledAt = calledAt[i]
      token.updatedAt = calledAt[i] + 12 * MINUTE
    })
    const all = [...appts, walkIn].sort((a, b) =>
      a.slotStart.localeCompare(b.slotStart)
    )
    todayAppointments.push(...all)
    return all
  }

  if (!kamalToday || !arifToday || !abdulHistory)
    throw new Error("seed: hero sessions missing")
  return {
    sessions,
    kamalToday,
    arifToday,
    todayAppointments,
    yesterdayB1Done,
    abdulHistory,
    tokens,
  }
}
