import type { AppointmentRow, EncounterRow, Id } from "@/core/db/schema"
import { RuleViolation } from "@/core/engine/errors"
import {
  openLines,
  orderImaging,
  orderTests,
  payLines,
  signedRx,
} from "@/core/scenarios/fixtures"
import type { ScenarioDef, ScenarioKit } from "@/core/scenarios/types"
import { HERO, SEED_REFS } from "@/core/seed/content"
import {
  acceptScribe,
  completeScribe,
  finishConsultation,
  signNote,
  startConsultation,
  startScribe,
} from "@/modules/consultation/commands"
import { callToken, checkIn } from "@/modules/queue/commands"
import { bookAppointment } from "@/modules/scheduling/commands"

/**
 * Main-journey jump launchers J1 to J6 (plan §10): if a step goes wrong on
 * stage, the presenter jumps ahead and the hero's visit is brought forward to
 * that point with the real commands (the same booking, check-in, consult,
 * orders, Rx and payment the screens would make). Steps Abdul has already
 * passed are left as they are, so a jump never undoes live work.
 */

const ABDUL = HERO.patient.abdulKarim
const KAMAL_SESSION = SEED_REFS.session.kamalToday
const DESK = "per_reception_farhana"
const DOCTOR = "per_doctor_kamal"
const CASHIER = "per_cashier_rafiq"
const LAB = "per_labtech_rubel"
const PHARMACIST = "per_pharmacist_shirin"

const LIVE: AppointmentRow["status"][] = [
  "booked",
  "checked-in",
  "in-consult",
  "done",
]

type HeroVisit = { appointment?: AppointmentRow; encounter?: EncounterRow }

/** Abdul's visit with Dr. Kamal today, as it stands. */
async function heroVisit(kit: ScenarioKit): Promise<HeroVisit> {
  const db = await kit.db(DESK)
  const appointment = (
    await db.appointments.where("sessionId").equals(KAMAL_SESSION).toArray()
  )
    .filter((a) => a.patientId === ABDUL && LIVE.includes(a.status))
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  const encounter = appointment
    ? (
        await db.encounters
          .where("appointmentId")
          .equals(appointment.id)
          .toArray()
      ).sort((a, b) => b.startedAt - a.startedAt)[0]
    : undefined
  return { appointment, encounter }
}

/** Booked and checked in with Dr. Kamal (a walk-in when his bookable places are gone). */
async function ensureCheckedIn(kit: ScenarioKit): Promise<AppointmentRow> {
  let { appointment } = await heroVisit(kit)
  if (!appointment) {
    let appointmentId: Id
    try {
      appointmentId = (
        await kit.run(
          bookAppointment,
          { sessionId: KAMAL_SESSION, patientId: ABDUL, source: "counter" },
          DESK
        )
      ).appointmentId
    } catch (error) {
      if (!(error instanceof RuleViolation)) throw error
      appointmentId = (
        await kit.run(
          bookAppointment,
          { sessionId: KAMAL_SESSION, patientId: ABDUL, source: "walk-in" },
          DESK
        )
      ).appointmentId
    }
    appointment = (await (await kit.db(DESK)).appointments.get(appointmentId))!
  }
  if (appointment.status === "booked") {
    await kit.run(
      checkIn,
      { appointmentId: appointment.id, method: "desk" },
      DESK
    )
    appointment = (await (await kit.db(DESK)).appointments.get(appointment.id))!
  }
  return appointment
}

/** Called and in consultation with Dr. Kamal; returns the open encounter. */
async function ensureInConsult(kit: ScenarioKit): Promise<Id> {
  const appointment = await ensureCheckedIn(kit)
  const { encounter } = await heroVisit(kit)
  if (encounter && encounter.status !== "closed") return encounter.id
  const db = await kit.db(DOCTOR)
  const token = appointment.tokenId
    ? await db.queueTokens.get(appointment.tokenId)
    : undefined
  if (token && (token.status === "waiting" || token.status === "recalled")) {
    await kit.run(callToken, { tokenId: token.id }, DOCTOR)
  }
  return (
    await kit.run(startConsultation, { appointmentId: appointment.id }, DOCTOR)
  ).encounterId
}

/**
 * The hero consult as the story tells it: the scribe draft accepted and the
 * note signed, CBC, CRP and a chest X-ray ordered, Azithrocin 500 and Ace 500
 * prescribed and signed, the consult finished. Returns the signed Rx.
 */
async function ensureConsultDone(kit: ScenarioKit): Promise<Id> {
  const visit = await heroVisit(kit)
  const db = await kit.db(DOCTOR)
  if (visit.encounter) {
    const signed = (
      await db.prescriptions
        .where("encounterId")
        .equals(visit.encounter.id)
        .toArray()
    ).find((rx) => rx.status === "signed")
    if (signed && visit.encounter.status === "closed") return signed.id
  }
  const encounterId = await ensureInConsult(kit)

  const notes = await db.notes
    .where("encounterId")
    .equals(encounterId)
    .toArray()
  if (!notes.some((n) => n.status === "signed")) {
    const { draftId } = await kit.run(startScribe, { encounterId }, DOCTOR)
    await kit.run(completeScribe, { draftId }, DOCTOR)
    await kit.run(acceptScribe, { draftId, lang: "en" }, DOCTOR)
    const draft = (
      await db.notes.where("encounterId").equals(encounterId).toArray()
    ).find((n) => n.status === "draft")!
    await kit.run(
      signNote,
      {
        encounterId,
        sections: draft.sections,
        diagnoses: draft.diagnoses,
        templateId: draft.templateId,
        lang: draft.lang,
      },
      DOCTOR
    )
  }

  if (!(await db.labOrders.where("encounterId").equals(encounterId).count())) {
    await orderTests(kit, {
      patientId: ABDUL,
      encounterId,
      testIds: [SEED_REFS.test.cbc, SEED_REFS.test.crp],
    })
  }
  if (
    !(await db.imagingOrders.where("encounterId").equals(encounterId).count())
  ) {
    await orderImaging(kit, {
      patientId: ABDUL,
      encounterId,
      testId: SEED_REFS.test.xrayChest,
      indication: "Fever and cough for 5 days",
    })
  }

  let rxId = (
    await db.prescriptions.where("encounterId").equals(encounterId).toArray()
  ).find((rx) => rx.status === "signed")?.id
  if (!rxId) {
    rxId = (
      await signedRx(kit, {
        encounterId,
        lines: [
          {
            brandId: SEED_REFS.brand.azithrocin500,
            dosePattern: "1+0+0",
            mealTiming: "after",
            durationDays: 5,
          },
          {
            brandId: SEED_REFS.brand.ace500,
            dosePattern: "1+0+1",
            mealTiming: "after",
            durationDays: 5,
          },
        ],
      })
    ).rxId
  }
  await kit.run(finishConsultation, { encounterId }, DOCTOR)
  return rxId
}

/** Everything from today's consult paid at Rafiq's counter: bKash approved. */
async function ensurePaid(kit: ScenarioKit): Promise<Id> {
  const rxId = await ensureConsultDone(kit)
  const db = await kit.db(CASHIER)
  const today = kit.today()
  const lines = []
  for (const line of await openLines(kit, { patientId: ABDUL })) {
    // A fee booked for a later visit (a follow-up) is paid on that day.
    if (line.sourceType === "consult") {
      const appointment = await db.appointments.get(line.sourceId)
      if (appointment && appointment.date > today) continue
    }
    lines.push(line.id)
  }
  if (lines.length) {
    await payLines(kit, {
      patientId: ABDUL,
      basketLineIds: lines,
      tender: "bkash",
      cashierPersona: CASHIER,
    })
  }
  return rxId
}

const cue = (id: string, count: number) =>
  Array.from({ length: count }, (_, i) => `demo.journey.${id}.cue.${i + 1}`)

export const journeyScenarios: ScenarioDef[] = [
  {
    id: "J1",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J1.title",
    persona: DESK,
    route: () => "/reception",
    cueKeys: cue("J1", 3),
  },
  {
    id: "J2",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J2.title",
    persona: DESK,
    route: () => `/reception/book?patient=${ABDUL}&doctor=${HERO.doctor.kamal}`,
    cueKeys: cue("J2", 3),
  },
  {
    id: "J3",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J3.title",
    persona: DOCTOR,
    async setup(kit) {
      await ensureCheckedIn(kit)
      const { encounter } = await heroVisit(kit)
      return {
        refs: {
          patientId: ABDUL,
          encounterId: encounter?.status === "open" ? encounter.id : undefined,
        },
      }
    },
    route: ({ refs }) =>
      refs?.encounterId ? `/doctor/encounter/${refs.encounterId}` : "/doctor",
    cueKeys: cue("J3", 4),
  },
  {
    id: "J4",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J4.title",
    persona: CASHIER,
    async setup(kit) {
      const rxId = await ensureConsultDone(kit)
      return { refs: { patientId: ABDUL, rxId } }
    },
    route: () => `/cashier?patient=${ABDUL}`,
    cueKeys: cue("J4", 3),
  },
  {
    id: "J5",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J5.title",
    persona: LAB,
    async setup(kit) {
      const rxId = await ensurePaid(kit)
      return { refs: { patientId: ABDUL, rxId } }
    },
    route: () => "/lab",
    cueKeys: cue("J5", 4),
  },
  {
    id: "J6",
    kind: "jump",
    module: "demo",
    titleKey: "demo.journey.J6.title",
    persona: PHARMACIST,
    async setup(kit) {
      const rxId = await ensurePaid(kit)
      return { refs: { patientId: ABDUL, rxId } }
    },
    route: ({ refs }) => `/pharmacy/dispense/${refs?.rxId}`,
    cueKeys: cue("J6", 3),
  },
]
