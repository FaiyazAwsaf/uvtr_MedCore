"use client"

import { useLiveQuery } from "dexie-react-hooks"

import type { BranchCode } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type {
  BasketLineRow,
  BatchRow,
  BrandRow,
  DispenseRow,
  GenericRow,
  PatientRow,
  PharmacyQueueRow,
  PrescriptionRow,
  RxLineRow,
  StaffRow,
  StockLevelRow,
  SubstitutionRequestRow,
  TransferRow,
} from "@/core/db/schema"

import { paidUnitsOf, unpaidBilledLines } from "../../rules"
import { unique } from "../shared"

export type LineData = {
  line: RxLineRow
  brand?: BrandRow
  generic?: GenericRow
  /** Every branch's stock levels of this brand */
  levels: StockLevelRow[]
  /** The line's open billing line if there is one, else its billed one */
  basket?: BasketLineRow
  /** Units of the line the patient has paid for (a later balance is paid first) */
  paidUnits: number
  /** Units on the patient's bill for this line, paid or not */
  billedUnits: number
  pendingSub?: SubstitutionRequestRow
  proposedBrand?: BrandRow
  /** Open transfers bringing this brand to the pharmacist's branch */
  transfers: TransferRow[]
}

export type DispenseData = {
  rx: PrescriptionRow
  patient?: PatientRow
  doctor?: StaffRow
  lines: LineData[]
  batches: Map<string, BatchRow>
  dispenses: DispenseRow[]
  staff: Map<string, StaffRow>
  queue?: PharmacyQueueRow
  /** The version or new Rx that took over, when this one was superseded or replaced */
  current?: PrescriptionRow
}

/** Follows v1 to v2 (and a replacing Rx) to the prescription in force now. */
function currentVersionOf(
  rx: PrescriptionRow,
  all: PrescriptionRow[]
): PrescriptionRow | undefined {
  let latest = rx
  for (let hop = 0; hop < 10; hop++) {
    const next = all.find((o) => o.supersedesId === latest.id || o.replacesId === latest.id)
    if (!next) break
    latest = next
  }
  return latest.id === rx.id ? undefined : latest
}

/** Everything the dispense screen shows for one prescription, live. */
export function useDispenseData(
  rxId: string,
  branch: BranchCode | null
): DispenseData | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const rx = await db.prescriptions.get(rxId)
    if (!rx) return null
    const [patient, lines, dispenses, queue, subs, doctorRow] = await Promise.all([
      db.patients.get(rx.patientId),
      db.rxLines
        .where("rxId")
        .equals(rx.id)
        .sortBy("lineNo")
        .then((rows) => rows.filter((l) => l.status !== "cancelled")),
      db.dispenses.where("rxId").equals(rx.id).toArray(),
      db.pharmacyQueue.where("rxId").equals(rx.id).first(),
      db.substitutionRequests.where("rxId").equals(rx.id).toArray(),
      db.doctors.get(rx.doctorId),
    ])
    const brandIds = unique(lines.map((l) => l.brandId))
    const proposedIds = unique(subs.map((s) => s.proposedBrandId))
    const brands = await db.brands.bulkGet(unique([...brandIds, ...proposedIds]))
    const brandById = new Map(brands.filter(Boolean).map((b) => [b!.id, b!]))
    const generics = await db.generics.bulkGet(unique(brands.map((b) => b?.genericId)))
    const genericById = new Map(generics.filter(Boolean).map((g) => [g!.id, g!]))
    const levels = brandIds.length
      ? await db.stockLevels.where("brandId").anyOf(brandIds).toArray()
      : []
    const batchRows = await db.batches.bulkGet(unique(levels.map((l) => l.batchId)))
    const baskets = (
      await db.basketLines.where("sourceId").anyOf(lines.map((l) => l.id)).toArray()
    ).filter((b) => b.sourceType === "rx-line" && b.status !== "removed")
    const invoiced = baskets.filter((b) => b.status === "invoiced")
    const invoiceLines = invoiced.length
      ? await db.invoiceLines.where("basketLineId").anyOf(invoiced.map((b) => b.id)).toArray()
      : []
    const invoices = await db.invoices.bulkGet(unique(invoiceLines.map((l) => l.invoiceId)))
    const invoiceStatus = new Map(invoices.filter(Boolean).map((i) => [i!.id, i!.status]))
    const unpaid = unpaidBilledLines(invoiced, invoiceLines, (id) => invoiceStatus.get(id))
    const staffIds = unique([doctorRow?.staffId, ...dispenses.map((d) => d.pharmacistId)])
    const staffRows = await db.staff.bulkGet(staffIds)
    const incoming = branch
      ? (await db.transfers.where("toBranchId").equals(branch).toArray()).filter(
          (t) => t.status === "requested" || t.status === "approved" || t.status === "dispatched"
        )
      : []
    const current =
      rx.status === "superseded" || rx.status === "replaced"
        ? currentVersionOf(
            rx,
            await db.prescriptions.where("patientId").equals(rx.patientId).toArray()
          )
        : undefined
    const incomingLines = incoming.length
      ? await db.transferLines.where("transferId").anyOf(incoming.map((t) => t.id)).toArray()
      : []

    return {
      rx,
      patient,
      doctor: staffRows.find((s) => s?.id === doctorRow?.staffId) ?? undefined,
      lines: lines.map((line) => {
        const pendingSub = subs.find((s) => s.rxLineId === line.id && s.status === "pending")
        return {
          line,
          brand: line.brandId ? brandById.get(line.brandId) : undefined,
          generic: line.genericId ? genericById.get(line.genericId) : undefined,
          levels: levels.filter((l) => l.brandId === line.brandId),
          basket:
            baskets.find((b) => b.sourceId === line.id && b.status === "open") ??
            baskets.find((b) => b.sourceId === line.id),
          paidUnits: paidUnitsOf(line, baskets, unpaid),
          billedUnits: baskets
            .filter((b) => b.sourceId === line.id)
            .reduce((sum, b) => sum + b.qty, 0),
          pendingSub,
          proposedBrand: pendingSub ? brandById.get(pendingSub.proposedBrandId) : undefined,
          transfers: incoming.filter((t) =>
            incomingLines.some((tl) => tl.transferId === t.id && tl.brandId === line.brandId)
          ),
        }
      }),
      batches: new Map(batchRows.filter(Boolean).map((b) => [b!.id, b!])),
      dispenses,
      staff: new Map(staffRows.filter(Boolean).map((s) => [s!.id, s!])),
      queue,
      current,
    }
  }, [db, rxId, branch])
}
