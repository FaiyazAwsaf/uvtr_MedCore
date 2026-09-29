/**
 * PRD §22 "after" records to browse (plan §7.3):
 * - Dr. Kamal Hossain's fee-share month (last month): about 120 lines,
 *   including one refund reversal.
 * - A corrected lab report from 3 days ago (v1 superseded, v2 released).
 * - A cancelled paid order with its refund and credit note.
 * - A completed B3 to B1 stock transfer, plus one still in transit.
 * - Yesterday's closed cash shift at B1 with an approved variance.
 * - Yesterday's bKash settlement with 2 unmatched lines (and a Nagad file
 *   still to import).
 * - The B2 offline period 4 days ago: replayed, one identity conflict
 *   resolved through the review queue, and sync exceptions for visibility.
 * - A critical result call from 2 days ago, acknowledged in time.
 * - Yesterday's accounting exports.
 */

import { companies } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { counterKey, docNo } from "@/core/db/numbering"
import type {
  InvoiceRow,
  MfsSettlementRow,
  PatientRow,
  PaymentRow,
  Tender,
} from "@/core/db/schema"

import type { SeedCtx } from "../context"
import { HERO } from "../content/hero-ids"
import { SEED_REFS } from "../content/seed-refs"
import { ACTOR, BRANCH_ACTORS } from "../content/staff"
import {
  DAY,
  dhakaAt,
  HOUR,
  isoWeekday,
  MINUTE,
  previousMonthDays,
} from "../time"
import {
  consultLine,
  createPaidInvoice,
  pickTenders,
  refundInvoiceLines,
  type InvoiceOut,
} from "./billing"
import {
  createImagingOrder,
  createLabOrder,
  inboxItem,
  notify,
  reportHash,
} from "./clinical"
import type { DoctorInfo } from "./org"
import type { PatientPools } from "./patients"
import type { SchedulingOut } from "./scheduling"
import type { StockLedger } from "./stock"
import { reportReadySms } from "./today"

const RADIOLOGIST = "doc_enamul_kabir"

export function seedHistory(
  ctx: SeedCtx,
  sched: SchedulingOut,
  doctors: DoctorInfo[],
  pools: PatientPools,
  ledger: StockLedger
): void {
  const rng = ctx.rng("history")
  const doctorById = new Map(doctors.map((d) => [d.id, d]))
  const kamal = doctorById.get(HERO.doctor.kamal)!
  const b1Adults = pools.adults.filter((p) => p.registeredAtBranch === "B1")

  kamalFeeShareMonth()
  correctedReport()
  cancelledPaidOrder()
  transfers()
  const yesterdayPayments = yesterdayShift()
  mfsSettlements(yesterdayPayments)
  offlinePeriodB2()
  criticalCallHistory()
  imagingHistory()
  accountingExports()

  /* ---------------- Released imaging reports (simulated signed PDFs) ---------------- */
  function imagingHistory() {
    const plan: [number, string, string, string, string][] = [
      [
        -5,
        SEED_REFS.test.xrayChest,
        "Chest",
        "Cough for 3 weeks",
        "No active lung lesion. Heart size normal.",
      ],
      [
        -9,
        SEED_REFS.test.ecg,
        "Heart",
        "Palpitations",
        "Sinus rhythm, rate 84/min. No acute ST-T change.",
      ],
      [
        -12,
        SEED_REFS.test.usgWholeAbdomen,
        "Whole abdomen",
        "Right upper abdominal pain",
        "Fatty change of the liver (grade I). Gallbladder normal.",
      ],
    ]
    for (const [offset, testId, bodyPart, indication, summary] of plan) {
      const patient = pickFrom(b1Adults, (p) => pools.age(p) > 30)
      const out = createImagingOrder(ctx, {
        patient,
        branch: "B1",
        at: ctx.at(offset, "10:15"),
        testId,
        stage: "released",
        doctorId: kamal.id,
        indication,
        bodyPart,
        billing: { cashierId: ACTOR.rafiq },
        radiologistId:
          testId === SEED_REFS.test.ecg ? HERO.doctor.nazmul : RADIOLOGIST,
        summary,
      })
      inboxItem(ctx, {
        doctorId: kamal.id,
        patientId: patient.id,
        kind: "result",
        refs: { imagingOrderId: out.order.id },
        at: out.report!.releasedAt!,
        status: "read",
      })
      notify(
        ctx,
        patient.id,
        "reportReady",
        { imagingOrderId: out.order.id },
        out.report!.releasedAt!,
        true
      )
    }
  }

  /* ---------------- Dr. Kamal's fee-share month ---------------- */
  function kamalFeeShareMonth() {
    const days = previousMonthDays(ctx.today).filter((d) => isoWeekday(d) !== 5)
    const perDay = distribute(119, days.length)
    const outs: InvoiceOut[] = []
    days.forEach((date, di) => {
      let minute = 10 * 60 + rng.int(0, 10)
      for (let k = 0; k < perDay[di]; k++) {
        const patient = rng.pick(rng.bool(0.8) ? b1Adults : pools.adults)
        const followUp = rng.bool(0.3)
        const fee = (followUp ? kamal.followUpTaka : kamal.feeTaka) * 100
        minute += rng.int(8, 16)
        const at = dhakaAt(
          date,
          `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
        )
        outs.push(
          createPaidInvoice(ctx, {
            patientId: patient.id,
            branch: "B1",
            at,
            cashierId: rng.bool(0.7) ? ACTOR.rafiq : "stf_b1_taslima",
            lines: [consultLine(`apt_hist_${date}_${k}`, kamal, followUp, fee)],
            discountPct: rng.bool(0.1) ? rules.discountAuthority.cashier : 0,
            tenders: pickTenders(rng, fee),
          })
        )
      }
    })
    // One consultation refunded next day: the patient left before being seen.
    const target = outs[Math.floor(outs.length / 2)]
    const refundAt = target.invoice.createdAt + DAY - 2 * HOUR
    const approval = ctx.bag.put(
      "approvals",
      ctx.seq("apr"),
      refundAt - 5 * MINUTE,
      {
        kind: "refund",
        refs: { invoiceId: target.invoice.id },
        requestedBy: ACTOR.rafiq,
        approverId: ACTOR.nasrin,
        status: "approved",
        pinVerified: true,
        reason: "Patient left before the consultation; fee refunded",
        amountP: target.lines[0].netP,
        decidedAt: refundAt - 4 * MINUTE,
      }
    )
    refundInvoiceLines(
      ctx,
      target,
      [target.lines[0].id],
      refundAt,
      "Patient left before the consultation; fee refunded",
      {
        approvalId: approval.id,
      }
    )
  }

  /* ---------------- Corrected report (3 days ago) ---------------- */
  function correctedReport() {
    const patient = pickFrom(b1Adults, (p) => pools.age(p) > 40)
    const lab = createLabOrder(ctx, {
      patient,
      ageYears: pools.age(patient),
      branch: "B1",
      at: ctx.at(-3, "10:40"),
      testIds: [SEED_REFS.test.creatinine],
      stage: "released",
      source: "doctor",
      doctorId: kamal.id,
      billing: { cashierId: ACTOR.rafiq },
      values: { CREAT: 1.9 },
      labtechId: ACTOR.rubel,
    })
    const v1 = lab.report!
    const correctedAt = ctx.at(-3, "16:20")
    const result = lab.results.find((r) => r.analyteCode === "CREAT")!
    result.value = 1.1
    result.flag = "N"
    result.updatedAt = correctedAt - 10 * MINUTE
    v1.status = "superseded"
    v1.updatedAt = correctedAt
    const v2 = ctx.bag.put(
      "labReports",
      ctx.seq("rpt"),
      correctedAt - 5 * MINUTE,
      {
        reportNo: "",
        reportVersion: 2,
        patientId: patient.id,
        branchId: "B1",
        labOrderId: lab.order.id,
        itemIds: v1.itemIds,
        status: "released",
        signedBy: ACTOR.mizanur,
        signedAt: correctedAt - 2 * MINUTE,
        releasedAt: correctedAt,
        correctionReason: "Transcription error in the creatinine value",
        changeSummary:
          "Serum creatinine corrected from 1.9 to 1.1 mg/dL. Flag changed from High to Normal.",
        supersedesId: v1.id,
      }
    )
    ctx.numbers.afterAssigned(() => {
      v2.reportNo = v1.reportNo
      v2.hash = reportHash(v2, lab.results)
    })
    for (const item of lab.items) item.reportId = v2.id
    inboxItem(ctx, {
      doctorId: kamal.id,
      patientId: patient.id,
      kind: "result",
      refs: { reportId: v1.id, labOrderId: lab.order.id },
      at: v1.releasedAt!,
      status: "read",
    })
    inboxItem(ctx, {
      doctorId: kamal.id,
      patientId: patient.id,
      kind: "corrected",
      refs: { reportId: v2.id, labOrderId: lab.order.id },
      at: correctedAt,
      status: "acknowledged",
      ackAt: correctedAt + 50 * MINUTE,
    })
    notify(
      ctx,
      patient.id,
      "reportUpdated",
      { reportId: v2.id },
      correctedAt,
      false
    )
    reportReadySms(ctx, patient, correctedAt + MINUTE)
  }

  /* ---------------- Cancelled paid order with refund (6 days ago) ---------------- */
  function cancelledPaidOrder() {
    const patient = pickFrom(b1Adults, (p) => pools.age(p) > 30)
    const lab = createLabOrder(ctx, {
      patient,
      ageYears: pools.age(patient),
      branch: "B1",
      at: ctx.at(-6, "09:25"),
      testIds: [SEED_REFS.test.lipid, SEED_REFS.test.cbc],
      stage: "released",
      source: "counter",
      billing: { cashierId: ACTOR.rafiq, tenders: [{ tender: "cash" }] },
      labtechId: ACTOR.rubel,
      cancelTestIds: [SEED_REFS.test.lipid],
      cancelReason:
        "Patient had not fasted; cancelled before collection at the patient's request",
    })
    const lipidItem = lab.items.find((i) => i.testId === SEED_REFS.test.lipid)!
    const line = lab.invoice!.lines.find((l) => l.sourceId === lipidItem.id)!
    refundInvoiceLines(
      ctx,
      lab.invoice!,
      [line.id],
      ctx.at(-6, "09:48"),
      "Test cancelled before sample collection",
      {}
    )
  }

  /* ---------------- Stock transfers between branches ---------------- */
  function transfers() {
    // Completed: Cef-3 400 was out at B1; 30 capsules came from B3 five days ago.
    const cef = "brd_cef3_400mg"
    for (const l of ledger.levelsAt("B1", cef)) l.qty = 0
    let source = ledger.levelsAt("B3", cef).sort((a, b) => b.qty - a.qty)[0]
    if (!source) {
      const lot = ctx.bag.all("batches").find((b) => b.brandId === cef)!
      source = ledger.level("B3", cef, lot.id)
    }
    if (source.qty < 60) source.qty += 60
    const dispatchedAt = ctx.at(-5, "11:10")
    const receivedAt = ctx.at(-5, "16:35")
    const done = ctx.bag.put("transfers", ctx.seq("trf"), ctx.at(-5, "09:40"), {
      transferNo: "",
      fromBranchId: "B3",
      toBranchId: "B1",
      status: "received",
      requestedFrom: "pharmacy",
      requestedBy: ACTOR.shirin,
      dispatchedAt,
      receivedAt,
      note: "Out of stock at Dhanmondi; urgent for patients on a course",
    })
    ctx.numbers.request(counterKey.transfer(), done.createdAt, (n) => {
      done.transferNo = docNo.transfer(n)
    })
    done.updatedAt = receivedAt
    ctx.bag.put("transferLines", ctx.seq("trl"), done.createdAt, {
      transferId: done.id,
      brandId: cef,
      batchId: source.batchId,
      qtyRequested: 30,
      qtyDispatched: 30,
      qtyReceived: 30,
    })
    ledger.move("transfer-out", "B3", source.batchId, -30, dispatchedAt, {
      transferId: done.id,
    })
    ledger.move("transfer-in", "B1", source.batchId, 30, receivedAt, {
      transferId: done.id,
    })

    // In transit: Azithrocin 500 from B3 to B2, dispatched yesterday.
    const az = SEED_REFS.brand.azithrocin500
    let from = ledger.levelsAt("B3", az).sort((a, b) => b.qty - a.qty)[0]
    if (!from) {
      const lot = ctx.bag.all("batches").find((b) => b.brandId === az)!
      from = ledger.level("B3", az, lot.id)
    }
    if (from.qty < 60) from.qty += 60
    const sentAt = ctx.at(-1, "15:05")
    const transit = ctx.bag.put(
      "transfers",
      ctx.seq("trf"),
      ctx.at(-1, "11:30"),
      {
        transferNo: "",
        fromBranchId: "B3",
        toBranchId: "B2",
        status: "dispatched",
        requestedFrom: "store",
        requestedBy: "stf_b2_anisur",
        dispatchedAt: sentAt,
        note: "Stock balancing before the weekend",
      }
    )
    ctx.numbers.request(counterKey.transfer(), transit.createdAt, (n) => {
      transit.transferNo = docNo.transfer(n)
    })
    transit.updatedAt = sentAt
    ctx.bag.put("transferLines", ctx.seq("trl"), transit.createdAt, {
      transferId: transit.id,
      brandId: az,
      batchId: from.batchId,
      qtyRequested: 30,
      qtyDispatched: 30,
      qtyReceived: 0,
    })
    ledger.move("transfer-out", "B3", from.batchId, -30, sentAt, {
      transferId: transit.id,
    })
    from.inTransitOut += 30
    ledger.level("B2", az, from.batchId).inTransitIn += 30
    ctx.numbers.base(counterKey.transfer(), 180)
  }

  /* ---------------- Yesterday at B1: invoices and the variance shift ---------------- */
  function yesterdayShift(): PaymentRow[] {
    const openedAt = ctx.at(-1, "08:00")
    const closedAt = ctx.at(-1, "22:05")
    const shift = ctx.bag.put("shifts", "shf_B1_rafiq_yesterday", openedAt, {
      cashierId: ACTOR.rafiq,
      branchId: "B1",
      date: ctx.day(-1),
      openedAt,
      floatP: 5_000_00,
      status: "closed",
    })
    const outs: InvoiceOut[] = []
    // Forced tenders so the settlement files have enough lines to match.
    const forced: Tender[] = [
      "bkash",
      "bkash",
      "nagad",
      "bkash",
      "card",
      "nagad",
      "bkash",
      "bkash",
    ]
    sched.yesterdayB1Done.forEach((a, i) => {
      const doctor = doctorById.get(a.doctorId)!
      const followUp = a.visitType === "follow-up"
      const fee = (followUp ? doctor.followUpTaka : doctor.feeTaka) * 100
      const out = createPaidInvoice(ctx, {
        patientId: a.patientId,
        branch: "B1",
        at: (a.checkedInAt ?? dhakaAt(a.date, a.slotStart)) - 2 * MINUTE,
        cashierId: ACTOR.rafiq,
        shiftId: shift.id,
        lines: [consultLine(a.id, doctor, followUp, fee)],
        tenders:
          i < forced.length ? [{ tender: forced[i] }] : pickTenders(rng, fee),
      })
      a.feeBasketLineId = out.basketLines[0].id
      outs.push(out)
    })
    const labPatients = rng.pickMany(b1Adults, 6)
    labPatients.forEach((patient, i) => {
      const lab = createLabOrder(ctx, {
        patient,
        ageYears: pools.age(patient),
        branch: "B1",
        at: ctx.at(
          -1,
          `${String(9 + i).padStart(2, "0")}:${String(rng.int(0, 50)).padStart(2, "0")}`
        ),
        testIds: rng.pick([
          [SEED_REFS.test.cbc],
          [SEED_REFS.test.rbs, SEED_REFS.test.creatinine],
          [SEED_REFS.test.lipid],
          [SEED_REFS.test.tsh],
          [SEED_REFS.test.hba1c],
          [SEED_REFS.test.urineRe],
        ]),
        stage: "released",
        source: "counter",
        billing: {
          cashierId: ACTOR.rafiq,
          shiftId: shift.id,
          tenders: [
            {
              tender: (
                ["bkash", "nagad", "cash", "bkash", "cash", "nagad"] as Tender[]
              )[i],
            },
          ],
        },
        labtechId: ACTOR.rubel,
      })
      notify(
        ctx,
        patient.id,
        "reportReady",
        { reportId: lab.report!.id },
        lab.report!.releasedAt!,
        rng.bool(0.6)
      )
      outs.push(lab.invoice!)
    })

    // A walk-in's HBsAg and ESR (৳650) recorded as cash at 13:38. The bKash
    // settlement shows the same ৳650 arriving at 13:42 (BK7QM2K9TD): the
    // money came by bKash, so finance can match the line to this payment.
    // Chosen without the history rng so the rest of the history is unchanged.
    const used = new Set(labPatients.map((p) => p.id))
    const walkIn = b1Adults.find((p) => !pools.reserved.has(p.id) && !used.has(p.id))!
    const asCash = createLabOrder(ctx, {
      patient: walkIn,
      ageYears: pools.age(walkIn),
      branch: "B1",
      at: ctx.at(-1, "13:38"),
      testIds: ["lt_hbsag", SEED_REFS.test.esr],
      stage: "released",
      source: "counter",
      billing: {
        cashierId: ACTOR.rafiq,
        shiftId: shift.id,
        tenders: [{ tender: "cash" }],
      },
      labtechId: ACTOR.rubel,
    })
    outs.push(asCash.invoice!)

    const payments = outs.flatMap((o) => o.payments)
    const cash = payments
      .filter((p) => p.tender === "cash")
      .reduce((s, p) => s + p.amountP, 0)
    const expectedP = shift.floatP + cash
    const varianceP = -72_000 // ৳720 short: above the ৳500 threshold
    const countedP = expectedP + varianceP
    const approval = ctx.bag.put(
      "approvals",
      ctx.seq("apr"),
      closedAt + 3 * MINUTE,
      {
        kind: "variance",
        refs: { shiftId: shift.id },
        requestedBy: ACTOR.rafiq,
        approverId: ACTOR.nasrin,
        status: "approved",
        pinVerified: true,
        reason:
          "Short by 720 taka after the evening rush; counted twice, change given in error",
        amountP: Math.abs(varianceP),
        decidedAt: closedAt + 5 * MINUTE,
      }
    )
    Object.assign(shift, {
      closedAt,
      countedP,
      denominations: denominations(countedP),
      expectedP,
      varianceP,
      status: "closed",
      varianceApprovalId: approval.id,
      updatedAt: closedAt + 5 * MINUTE,
    })
    return payments
  }

  /* ---------------- MFS settlement files for yesterday ---------------- */
  function mfsSettlements(payments: PaymentRow[]) {
    const importedAt = Math.min(ctx.at(0, "09:30"), ctx.now - 20 * MINUTE)
    const bkash = payments.filter((p) => p.tender === "bkash")
    const lines: MfsSettlementRow["lines"] = bkash.map((p) => ({
      ref: p.ref!,
      amountP: p.amountP,
      at: p.confirmedAt!,
      matchedPaymentId: p.id,
    }))
    // Two lines with no matching payment: money received by bKash that the
    // counter recorded as cash, and a transfer with no invoice at all.
    lines.push(
      { ref: "BK7QM2K9TD", amountP: 650_00, at: ctx.at(-1, "13:42") },
      { ref: "BK3XH8PLZW", amountP: 1_200_00, at: ctx.at(-1, "18:17") }
    )
    ctx.bag.put("mfsSettlements", "mfs_bkash_yesterday", importedAt, {
      provider: "bkash",
      date: ctx.day(-1),
      lines: lines.sort((a, b) => a.at - b.at),
      status: "imported",
      importedAt,
    })
    const nagad = payments.filter((p) => p.tender === "nagad")
    ctx.bag.put(
      "mfsSettlements",
      "mfs_nagad_yesterday",
      ctx.now - 30 * MINUTE,
      {
        provider: "nagad",
        date: ctx.day(-1),
        lines: nagad.map((p) => ({
          ref: p.ref!,
          amountP: p.amountP,
          at: p.confirmedAt!,
        })),
        status: "pending-import",
      }
    )
  }

  /* ---------------- The B2 offline period (4 days ago) ---------------- */
  function offlinePeriodB2() {
    const replayAt = ctx.at(-4, "12:22")
    const central = pools.byId.get("pat_off_parul_central")!
    const edge = pools.byId.get("pat_off_parul_edge")!
    const resolvedAt = replayAt + 2 * HOUR
    const review = ctx.bag.put(
      "reviewQueue",
      "rev_b2_offline_parul",
      replayAt,
      {
        kind: "sync-duplicate",
        branchId: "B2",
        patientIds: [central.id, edge.id],
        status: "resolved",
        resolution: "same",
        reason:
          "Same person: date of birth, father's name and address confirmed by phone",
        resolvedBy: ACTOR.mahmudul,
        resolvedAt,
        detail:
          "B2 was offline from 11:05 to 12:20. 37 queued events replayed in order; 1 identity conflict sent for review.",
      }
    )
    review.updatedAt = resolvedAt
    ctx.bag.put("duplicateDecisions", ctx.seq("dup"), resolvedAt, {
      candidateIds: [central.id, edge.id],
      newPatientId: edge.id,
      score: 0.91,
      decision: "same",
      reason:
        "Same person registered at Uttara while offline; merged into the existing record",
      decidedBy: ACTOR.mahmudul,
      decidedAt: resolvedAt,
    })
    ctx.bag.put("approvals", ctx.seq("apr"), resolvedAt - 3 * MINUTE, {
      kind: "merge",
      refs: { patientId: central.id, reviewId: review.id },
      requestedBy: "stf_b2_rumana",
      approverId: ACTOR.mahmudul,
      status: "approved",
      pinVerified: true,
      reason: "Two-person merge after phone confirmation",
      decidedAt: resolvedAt,
    })
    const napaB2 = ctx.bag
      .all("stockLevels")
      .find((l) => l.branchId === "B2" && l.brandId === SEED_REFS.brand.napa500)
    ctx.bag.put("syncExceptions", ctx.seq("sx"), replayAt, {
      kind: "stock-negative",
      branchId: "B2",
      table: "stockLevels",
      rowId: napaB2?.id ?? "",
      detail:
        "Offline dispense of 20 tablets replayed after central sold from the same batch; the level went 4 below zero and was corrected at the next stock count.",
      status: "acknowledged",
    })
    const sajib = pools.byId.get("pat_off_sajib")!
    ctx.bag.put("syncExceptions", ctx.seq("sx"), replayAt, {
      kind: "version-conflict",
      branchId: "B2",
      table: "patients",
      rowId: sajib.id,
      detail:
        "Contact phone edited at B2 while offline and at the call centre; the later edit by origin time was kept and both are in the audit log.",
      status: "acknowledged",
    })

    // Registration card fees billed with offline invoice numbers.
    for (const [i, id] of ["pat_off_moriom", "pat_off_sajib"].entries()) {
      const p = pools.byId.get(id)!
      createPaidInvoice(ctx, {
        patientId: p.id,
        branch: "B2",
        at: p.createdAt + 4 * MINUTE + i * MINUTE,
        cashierId: BRANCH_ACTORS.B2.cashier,
        lines: [
          {
            sourceType: "other",
            sourceId: p.id,
            serviceType: "other",
            description: "Registration card",
            descriptionBn: "রেজিস্ট্রেশন কার্ড",
            qty: 1,
            unitPriceP: 100_00,
          },
        ],
        offline: true,
      })
    }
  }

  /* ---------------- A critical value called in time (2 days ago) ---------------- */
  function criticalCallHistory() {
    const patient =
      b1Adults.find((p) =>
        p.problems.some((pr) => pr.icd10.startsWith("N18"))
      ) ?? pickFrom(b1Adults, (p) => pools.age(p) > 55)
    const doctor = kamal
    const lab = createLabOrder(ctx, {
      patient,
      ageYears: pools.age(patient),
      branch: "B1",
      at: ctx.at(-2, "09:10"),
      testIds: [SEED_REFS.test.electrolytes],
      stage: "released",
      source: "doctor",
      doctorId: doctor.id,
      priority: "urgent",
      billing: { cashierId: ACTOR.rafiq },
      values: { NA: 136, K: 6.4, CL: 102, HCO3: 19 },
      labtechId: ACTOR.rubel,
    })
    const k = lab.results.find((r) => r.analyteCode === "K")!
    const calledAt = ctx.at(-2, "11:05")
    ctx.bag.put("criticalCalls", ctx.seq("cc"), calledAt, {
      resultId: k.id,
      labOrderItemId: k.labOrderItemId,
      patientId: patient.id,
      branchId: "B1",
      valueText: "Potassium 6.4 mmol/L",
      calledPerson: doctor.nameEn,
      calledRole: "ordering-doctor",
      calledAt,
      readBack: true,
      readBackText: "Potassium six point four, repeat sample and review today",
      status: "acknowledged",
      ackAt: calledAt + 12 * MINUTE,
      loggedBy: ACTOR.mizanur,
    })
    inboxItem(ctx, {
      doctorId: doctor.id,
      patientId: patient.id,
      kind: "critical",
      refs: { resultId: k.id, reportId: lab.report!.id },
      at: calledAt,
      status: "acknowledged",
      ackAt: calledAt + 12 * MINUTE,
    })
  }

  /* ---------------- Yesterday's accounting exports (simulated) ---------------- */
  function accountingExports() {
    const date = ctx.day(-1)
    const invoices = ctx.bag.all("invoices").filter((i) => i.date === date)
    for (const c of companies) {
      const mine = invoices.filter((i: InvoiceRow) => i.companyId === c.code)
      const total = mine.reduce((s, i) => s + i.totalP, 0)
      ctx.bag.put(
        "accountingExports",
        `acx_${c.code}_${date}`,
        ctx.at(0, "07:30") < ctx.now
          ? ctx.at(0, "07:30")
          : ctx.now - 10 * MINUTE,
        {
          date,
          companyId: c.code,
          rows: mine.length * 2 + 2,
          totalDebitP: total,
          totalCreditP: total,
          fileName: `${c.code}-journal-${date}.csv`,
          exportedBy: ACTOR.imran,
        }
      )
    }
  }

  function pickFrom(
    list: PatientRow[],
    pred: (p: PatientRow) => boolean
  ): PatientRow {
    const matches = list.filter(pred)
    return rng.pick(matches.length ? matches : list)
  }
}

/** Split `total` over `n` buckets as evenly as possible (deterministic). */
function distribute(total: number, n: number): number[] {
  const base = Math.floor(total / n)
  const out = new Array<number>(n).fill(base)
  for (let i = 0; i < total - base * n; i++) out[(i * 7) % n]++
  return out
}

/** A plausible note and coin breakdown of a cash amount (poisha). */
function denominations(amountP: number): Record<string, number> {
  const out: Record<string, number> = {}
  let left = Math.round(amountP / 100)
  for (const d of [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]) {
    const n = Math.floor(left / d)
    if (n > 0) out[String(d)] = n
    left -= n * d
  }
  return out
}
