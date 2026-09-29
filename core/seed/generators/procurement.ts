/**
 * Vendors and procurement history (plan §7.1, §7.3): six purchase orders
 * PO-1036 to PO-1041 in different states (closed, received, received with a
 * three-way price mismatch in the finance worklist, partially received with a
 * quarantined short-expiry lot, cancelled, issued), their purchase requests,
 * goods receipts, vendor invoices, matches and payables. The counter makes
 * the next order PO-1042 (scenario S12). Two requests wait in approval (one
 * for the procurement head, one above ৳5,00,000 for the CFO) and one is a draft.
 */

import type { BranchCode } from "@/config/brand.config"
import { counterKey, docNo } from "@/core/db/numbering"
import type {
  Id,
  Ms,
  PoLineRow,
  PurchaseOrderRow,
  PurchaseRequestRow,
} from "@/core/db/schema"

import { approvalTierFor } from "@/core/procurement/rules"

import type { SeedCtx } from "../context"
import { VENDORS } from "../content/partners"
import { PERSONAS } from "../content/personas"
import { SEED_REFS } from "../content/seed-refs"
import { ACTOR, STAFF } from "../content/staff"
import { DAY, HOUR, isoAddDays, MINUTE } from "../time"
import type { StockLedger } from "./stock"

type Item = { brandId: Id; qty: number }

type PoPlan = {
  branch: BranchCode
  vendorId: Id
  issuedDaysAgo: number
  items: Item[]
  outcome:
    "closed" | "received" | "mismatch" | "partial" | "cancelled" | "issued"
  requestedBy: Id
}

const B = SEED_REFS.brand

const PLANS: PoPlan[] = [
  {
    branch: "B1",
    vendorId: "ven_square",
    issuedDaysAgo: 32,
    outcome: "closed",
    requestedBy: ACTOR.habibur,
    items: [
      { brandId: B.ace500, qty: 1000 },
      { brandId: B.alatrol10, qty: 500 },
      { brandId: B.camlodin5, qty: 600 },
      { brandId: B.comet500, qty: 1000 },
    ],
  },
  {
    branch: "B3",
    vendorId: "ven_beximco",
    issuedDaysAgo: 25,
    outcome: "received",
    requestedBy: "stf_b3_sujon",
    items: [
      { brandId: B.napa500, qty: 2000 },
      { brandId: B.azithrocin500, qty: 120 },
      { brandId: "brd_atova_10mg", qty: 300 },
    ],
  },
  {
    branch: "B1",
    vendorId: "ven_incepta",
    issuedDaysAgo: 18,
    outcome: "mismatch",
    requestedBy: ACTOR.habibur,
    items: [
      { brandId: B.montair10, qty: 300 },
      { brandId: "brd_pantonix_20mg", qty: 500 },
      { brandId: "brd_esonix_20mg", qty: 500 },
    ],
  },
  {
    branch: "B2",
    vendorId: "ven_acme",
    issuedDaysAgo: 12,
    outcome: "partial",
    requestedBy: "stf_b2_anisur",
    items: [
      { brandId: "brd_tenoren_50mg", qty: 1000 },
      { brandId: "brd_ecosprin_75mg", qty: 500 },
    ],
  },
  {
    branch: "B5",
    vendorId: "ven_renata",
    issuedDaysAgo: 6,
    outcome: "cancelled",
    requestedBy: "stf_b5_absar",
    items: [
      { brandId: "brd_maxpro_20mg", qty: 1000 },
      { brandId: "brd_rolac_10mg", qty: 200 },
    ],
  },
  {
    branch: "B1",
    vendorId: "ven_healthcare",
    issuedDaysAgo: 2,
    outcome: "issued",
    requestedBy: ACTOR.habibur,
    items: [
      { brandId: "brd_sergel_20mg", qty: 1000 },
      { brandId: "brd_secrin_2mg", qty: 300 },
    ],
  },
]

/** Authorities of a seeded staff member (persona staff included). */
function authoritiesOf(staffId: Id): readonly string[] {
  return (
    STAFF.find((s) => s.id === staffId)?.authorities ??
    PERSONAS.find((p) => p.staff?.id === staffId)?.staff?.authorities ??
    []
  )
}

const APPROVER: Record<PurchaseRequestRow["approvalTier"], Id> = {
  "store-manager": ACTOR.habibur,
  "procurement-head": ACTOR.tariq,
  cfo: ACTOR.sabrina,
}

export function seedProcurement(ctx: SeedCtx, ledger: StockLedger): void {
  const { bag } = ctx
  const rng = ctx.rng("procurement")
  const founded = ctx.now - 4 * 365 * DAY

  for (const v of VENDORS) {
    bag.put("vendors", v.id, founded, {
      code: v.code,
      name: v.name,
      phone: v.phone,
      kind: v.kind,
      paymentTermsDays: v.paymentTermsDays,
    })
  }

  const costOf = (brandId: Id) => Math.round(ledger.brand(brandId).mrpP * 0.76)

  const newPr = (
    branch: BranchCode,
    requestedBy: Id,
    at: Ms,
    items: Item[],
    status: PurchaseRequestRow["status"],
    note?: string
  ): PurchaseRequestRow => {
    const totalP = items.reduce((s, i) => s + i.qty * costOf(i.brandId), 0)
    // Same rule as procurement.submitPr: by value, never the requester's own approval.
    const tier = approvalTierFor(totalP, authoritiesOf(requestedBy))
    const pr = bag.put("purchaseRequests", ctx.seq("pr"), at, {
      prNo: "",
      branchId: branch,
      requestedBy,
      status,
      totalP,
      approvalTier: tier,
      submittedAt: status === "draft" ? undefined : at + 10 * MINUTE,
      note,
    })
    ctx.numbers.request(counterKey.purchaseRequest(), at, (n) => {
      pr.prNo = docNo.purchaseRequest(n)
    })
    for (const i of items) {
      bag.put("prLines", ctx.seq("prl"), at, {
        prId: pr.id,
        brandId: i.brandId,
        qty: i.qty,
        estUnitCostP: costOf(i.brandId),
        lineTotalP: i.qty * costOf(i.brandId),
      })
    }
    if (status === "approved" || status === "ordered") {
      const approval = bag.put("approvals", ctx.seq("apr"), at + 3 * HOUR, {
        kind: "pr",
        refs: { prId: pr.id },
        requestedBy,
        approverId: APPROVER[tier],
        status: "approved",
        pinVerified: false,
        reason: "Within budget and reorder plan",
        amountP: totalP,
        decidedAt: at + 3 * HOUR,
      })
      pr.approvalId = approval.id
      pr.updatedAt = at + 3 * HOUR
    }
    return pr
  }

  for (const plan of PLANS) {
    const issuedAt = ctx.at(-plan.issuedDaysAgo, "11:30")
    const pr = newPr(
      plan.branch,
      plan.requestedBy,
      issuedAt - 2 * DAY,
      plan.items,
      "ordered"
    )
    const lines: PoLineRow[] = []
    const po = bag.put("purchaseOrders", ctx.seq("po"), issuedAt, {
      poNo: "",
      prId: pr.id,
      vendorId: plan.vendorId,
      branchId: plan.branch,
      status: plan.outcome === "mismatch" ? "received" : plan.outcome,
      issuedAt,
      expectedAt: issuedAt + 3 * DAY,
      totalP: 0,
    })
    ctx.numbers.request(counterKey.purchaseOrder(), issuedAt, (n) => {
      po.poNo = docNo.purchaseOrder(n)
    })
    for (const i of plan.items) {
      lines.push(
        bag.put("poLines", ctx.seq("pol"), issuedAt, {
          poId: po.id,
          brandId: i.brandId,
          qtyOrdered: i.qty,
          unitCostP: costOf(i.brandId),
          qtyReceived: 0,
          qtyRejected: 0,
        })
      )
    }
    po.totalP = lines.reduce((s, l) => s + l.qtyOrdered * l.unitCostP, 0)

    if (plan.outcome === "cancelled") {
      po.updatedAt = issuedAt + DAY
      continue
    }
    if (plan.outcome === "issued") continue

    /* Goods receipt */
    const receivedAt = issuedAt + 2 * DAY + 3 * HOUR
    const receiver = plan.branch === "B1" ? ACTOR.habibur : plan.requestedBy
    const partial = plan.outcome === "partial"
    const grn = bag.put("grns", ctx.seq("grn"), receivedAt, {
      grnNo: "",
      poId: po.id,
      branchId: plan.branch,
      receivedBy: receiver,
      receivedAt,
      status: partial ? "partial" : "complete",
      note: partial
        ? "Part delivery; the rest is back-ordered by the depot"
        : undefined,
    })
    ctx.numbers.request(counterKey.grn(), receivedAt, (n) => {
      grn.grnNo = docNo.grn(n)
    })
    lines.forEach((line, idx) => {
      const brand = ledger.brand(line.brandId)
      const received =
        partial && idx === 0
          ? Math.round(line.qtyOrdered * 0.6)
          : line.qtyOrdered
      const rejected =
        partial && idx === 1 ? Math.round(line.qtyOrdered * 0.1) : 0
      const accepted = received - rejected
      const lotSuffix = `${po.id.slice(3)}_${idx + 1}`
      const batch = bag.put("batches", `bat_grn_${lotSuffix}`, receivedAt, {
        brandId: brand.id,
        batchNo: `G${String(rng.int(10000, 99999))}`,
        expiry: isoAddDays(ctx.today, rng.int(480, 720)),
        costP: line.unitCostP,
        mrpP: brand.mrpP,
        status: "ok",
        vendorId: plan.vendorId,
      })
      bag.put("grnLines", ctx.seq("grl"), receivedAt, {
        grnId: grn.id,
        poLineId: line.id,
        brandId: brand.id,
        batchNo: batch.batchNo,
        expiry: batch.expiry,
        qtyReceived: received,
        qtyAccepted: accepted,
        qtyRejected: rejected,
        rejectReason: rejected ? "short-expiry" : undefined,
        quarantine: rejected > 0,
        batchId: batch.id,
      })
      ledger.move("grn", plan.branch, batch.id, accepted, receivedAt, {
        poId: po.id,
        grnId: grn.id,
      })
      if (rejected) {
        // The short-dated part of the delivery is its own lot, held in quarantine.
        const shortLot = bag.put(
          "batches",
          `bat_grn_${lotSuffix}_q`,
          receivedAt,
          {
            brandId: brand.id,
            batchNo: `G${String(rng.int(10000, 99999))}`,
            expiry: isoAddDays(ctx.today, 40),
            costP: line.unitCostP,
            mrpP: brand.mrpP,
            status: "quarantine",
            vendorId: plan.vendorId,
          }
        )
        ledger.move("grn", plan.branch, shortLot.id, rejected, receivedAt, {
          poId: po.id,
          grnId: grn.id,
        })
        ledger.move(
          "quarantine",
          plan.branch,
          shortLot.id,
          -rejected,
          receivedAt + 5 * MINUTE,
          { poId: po.id, grnId: grn.id },
          "Short expiry on delivery"
        )
      }
      line.qtyReceived = received
      line.qtyRejected = rejected
      line.updatedAt = receivedAt
    })
    po.updatedAt = receivedAt
    if (partial) continue

    /* Vendor invoice, three-way match and payable */
    const invoiceAt = receivedAt + DAY
    const mismatch = plan.outcome === "mismatch"
    const invLines = lines.map((l, idx) => ({
      poLineId: l.id,
      qty: l.qtyReceived,
      // PO-1038: the depot billed one line 6% above the PO price (tolerance is 2%).
      unitCostP:
        mismatch && idx === 1 ? Math.round(l.unitCostP * 1.06) : l.unitCostP,
    }))
    const vendorInvoice = bag.put("vendorInvoices", ctx.seq("vi"), invoiceAt, {
      vendorInvoiceNo: "",
      vendorId: plan.vendorId,
      poId: po.id,
      amountP: invLines.reduce((s, l) => s + l.qty * l.unitCostP, 0),
      lines: invLines,
      receivedAt: invoiceAt,
      status: mismatch ? "mismatch" : "matched",
    })
    ctx.numbers.request(counterKey.vendorInvoice(), invoiceAt, (n) => {
      vendorInvoice.vendorInvoiceNo = docNo.vendorInvoice(n)
    })
    bag.put("threeWayMatches", ctx.seq("twm"), invoiceAt + HOUR, {
      poId: po.id,
      grnIds: [grn.id],
      vendorInvoiceId: vendorInvoice.id,
      status: mismatch ? "mismatch" : "matched",
      diffs: mismatch
        ? [
            {
              poLineId: lines[1].id,
              field: "price",
              po: lines[1].unitCostP,
              grn: lines[1].unitCostP,
              invoice: invLines[1].unitCostP,
            },
          ]
        : [],
      note: mismatch
        ? "Invoice price 6% above the PO price on one line"
        : undefined,
    })
    if (mismatch) continue
    const vendor = VENDORS.find((v) => v.id === plan.vendorId)!
    const payable = bag.put("payables", ctx.seq("pyb"), invoiceAt + HOUR, {
      vendorId: plan.vendorId,
      vendorInvoiceId: vendorInvoice.id,
      poId: po.id,
      amountP: vendorInvoice.amountP,
      dueDate: isoAddDays(
        ctx.day(-plan.issuedDaysAgo + 3),
        vendor.paymentTermsDays
      ),
      status: plan.outcome === "closed" ? "paid" : "open",
    })
    if (plan.outcome === "closed") {
      vendorInvoice.status = "payable"
      payable.updatedAt = invoiceAt + 5 * DAY
      po.updatedAt = invoiceAt + 5 * DAY
    }
  }

  // Requests still in the approval flow.
  newPr(
    "B1",
    ACTOR.habibur,
    ctx.now - 26 * HOUR,
    [
      { brandId: "brd_ceftron_1g_injection", qty: 300 },
      { brandId: "brd_bexitrolf_25mcg250mcgpuff_inhaler", qty: 100 },
      { brandId: "brd_sergel_40mg_injection", qty: 150 },
    ],
    "submitted",
    "Monthly injectables and inhalers"
  )
  newPr(
    "B2",
    "stf_b2_anisur",
    ctx.now - 5 * HOUR,
    [{ brandId: "brd_fexo_120mg", qty: 400 }],
    "draft"
  )
  // Above ৳5,00,000: waits in the CFO's approvals inbox (/finance/approvals).
  newPr(
    "B2",
    "stf_b2_anisur",
    ctx.now - 3 * HOUR,
    [
      { brandId: "brd_ceftron_2g_injection", qty: 1200 },
      { brandId: "brd_traxon_1g_injection", qty: 600 },
      { brandId: "brd_pantonix_40mg_injection", qty: 500 },
    ],
    "submitted",
    "Quarterly injectables for the Uttara wards"
  )

  ctx.numbers.base(counterKey.purchaseOrder(), 1035)
  ctx.numbers.base(counterKey.purchaseRequest(), 2300)
  ctx.numbers.base(counterKey.grn(), 870)
  ctx.numbers.base(counterKey.vendorInvoice(), 3300)
}

/** Sanity check used by tests: the last seeded PO number. */
export function lastPoNo(ctx: SeedCtx): string {
  const pos = ctx.bag.all("purchaseOrders") as PurchaseOrderRow[]
  return (
    pos
      .map((p) => p.poNo)
      .sort()
      .at(-1) ?? ""
  )
}
