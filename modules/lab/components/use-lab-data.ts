"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"

import type { BranchCode } from "@/config/brand.config"
import { dhakaDate, startOfDhakaDay } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import type {
  LabOrderItemRow,
  LabOrderRow,
  LabReportRow,
  LabTestRow,
  PatientRow,
  ResultRow,
  SpecimenRow,
  StaffRow,
} from "@/core/db/schema"
import { usePersona } from "@/core/session/persona"
import type { Locale } from "@/lib/i18n/config"

/** This window's branch (lab personas always have one). */
export function useBranch(): BranchCode {
  return usePersona()?.branchId ?? "B1"
}

/** Start of today (Dhaka) on the demo clock, re-evaluated as the clock moves. */
export function useTodayStart(): number {
  const tick = useNow(60_000)
  return startOfDhakaDay(dhakaDate(tick || now()))
}

const unique = <T>(values: T[]) => [...new Set(values)]

/** The whole test catalogue (about 170 rows), by id. */
export function useLabTests(): Map<string, LabTestRow> | undefined {
  const db = useDb()
  const rows = useLiveQuery(() => db.labTests.toArray(), [db])
  return React.useMemo(
    () => (rows ? new Map(rows.map((t) => [t.id, t])) : undefined),
    [rows]
  )
}

/** Staff by id, for "collected by", "signed by" and doctor names. */
export function useStaff(): Map<string, StaffRow> | undefined {
  const db = useDb()
  const rows = useLiveQuery(() => db.staff.toArray(), [db])
  return React.useMemo(
    () => (rows ? new Map(rows.map((s) => [s.id, s])) : undefined),
    [rows]
  )
}

/** Doctor id to the doctor's staff row (the ordering doctor on an order). */
export function useDoctorStaff(): Map<string, StaffRow> | undefined {
  const db = useDb()
  const data = useLiveQuery(async () => {
    const doctors = await db.doctors.toArray()
    const staff = await db.staff.bulkGet(doctors.map((d) => d.staffId))
    const map = new Map<string, StaffRow>()
    doctors.forEach((d, i) => {
      const row = staff[i]
      if (row) map.set(d.id, row)
    })
    return map
  }, [db])
  return data
}

export function staffName(
  staff: Map<string, StaffRow> | undefined,
  id: string | undefined,
  locale: Locale
): string | undefined {
  if (!id) return undefined
  const row = staff?.get(id)
  if (!row) return undefined
  return locale === "bn" ? row.nameBn : row.nameEn
}

/* ---------------- Specimens ---------------- */

export type SpecimenView = {
  specimen: SpecimenRow
  patient?: PatientRow
  order?: LabOrderRow
  /** The specimen's items that still count (not cancelled or rejected) */
  items: LabOrderItemRow[]
  allItems: LabOrderItemRow[]
}

export async function loadSpecimenViews(
  db: MedcoreDb,
  specimens: SpecimenRow[]
): Promise<SpecimenView[]> {
  const patients = await db.patients.bulkGet(
    unique(specimens.map((s) => s.patientId))
  )
  const orders = await db.labOrders.bulkGet(
    unique(specimens.map((s) => s.labOrderId))
  )
  const items = await db.labOrderItems.bulkGet(
    unique(specimens.flatMap((s) => s.itemIds))
  )
  const patientById = new Map(patients.filter(Boolean).map((p) => [p!.id, p!]))
  const orderById = new Map(orders.filter(Boolean).map((o) => [o!.id, o!]))
  const itemById = new Map(items.filter(Boolean).map((i) => [i!.id, i!]))
  return specimens.map((specimen) => {
    const allItems = specimen.itemIds
      .map((id) => itemById.get(id))
      .filter(Boolean) as LabOrderItemRow[]
    return {
      specimen,
      patient: patientById.get(specimen.patientId),
      order: orderById.get(specimen.labOrderId),
      allItems,
      items: allItems.filter(
        (i) => i.status !== "cancelled" && i.status !== "rejected"
      ),
    }
  })
}

/** Specimens at a branch in some statuses, oldest first (by `sortField`). */
export function useSpecimens(
  branch: BranchCode,
  statuses: SpecimenRow["status"][],
  opts: {
    since?: number
    sortField?: "createdAt" | "collectedAt" | "receivedAt" | "updatedAt"
    newestFirst?: boolean
  } = {}
): SpecimenView[] | undefined {
  const db = useDb()
  const key = statuses.join(",")
  const { since, sortField = "createdAt", newestFirst = false } = opts
  return useLiveQuery(async () => {
    const rows: SpecimenRow[] = []
    for (const status of key.split(",") as SpecimenRow["status"][]) {
      rows.push(
        ...(await db.specimens
          .where("[branchId+status]")
          .equals([branch, status])
          .toArray())
      )
    }
    const filtered =
      since === undefined
        ? rows
        : rows.filter((s) => (s[sortField] ?? s.updatedAt) >= since)
    filtered.sort((a, b) => {
      const d = (a[sortField] ?? a.updatedAt) - (b[sortField] ?? b.updatedAt)
      return newestFirst ? -d : d
    })
    return loadSpecimenViews(db, filtered)
  }, [db, branch, key, since, sortField, newestFirst])
}

/* ---------------- Items with results ---------------- */

export type ItemView = {
  item: LabOrderItemRow
  patient?: PatientRow
  order?: LabOrderRow
  specimen?: SpecimenRow
  results: ResultRow[]
}

export async function loadItemViews(
  db: MedcoreDb,
  items: LabOrderItemRow[]
): Promise<ItemView[]> {
  const patients = await db.patients.bulkGet(
    unique(items.map((i) => i.patientId))
  )
  const orders = await db.labOrders.bulkGet(
    unique(items.map((i) => i.labOrderId))
  )
  const specimenIds = unique(
    items.map((i) => i.specimenId).filter(Boolean) as string[]
  )
  const specimens = await db.specimens.bulkGet(specimenIds)
  const results = items.length
    ? await db.results
        .where("labOrderItemId")
        .anyOf(items.map((i) => i.id))
        .toArray()
    : []
  const patientById = new Map(patients.filter(Boolean).map((p) => [p!.id, p!]))
  const orderById = new Map(orders.filter(Boolean).map((o) => [o!.id, o!]))
  const specimenById = new Map(
    specimens.filter(Boolean).map((s) => [s!.id, s!])
  )
  return items.map((item) => ({
    item,
    patient: patientById.get(item.patientId),
    order: orderById.get(item.labOrderId),
    specimen: item.specimenId ? specimenById.get(item.specimenId) : undefined,
    results: results.filter((r) => r.labOrderItemId === item.id),
  }))
}

/** Items at a branch in one status, oldest first. */
export function useItems(
  branch: BranchCode,
  status: LabOrderItemRow["status"]
): ItemView[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const items = await db.labOrderItems
      .where("[branchId+status]")
      .equals([branch, status])
      .toArray()
    items.sort((a, b) => a.updatedAt - b.updatedAt)
    return loadItemViews(db, items)
  }, [db, branch, status])
}

/** The patient's validated results, for the previous-value and delta columns. */
export function usePatientHistory(
  patientId: string | undefined
): ResultRow[] | undefined {
  const db = useDb()
  return useLiveQuery(
    async () =>
      patientId
        ? db.results.where("patientId").equals(patientId).toArray()
        : [],
    [db, patientId]
  )
}

/* ---------------- Reports ---------------- */

export type ReportView = {
  report: LabReportRow
  patient?: PatientRow
  order?: LabOrderRow
  items: LabOrderItemRow[]
}

export async function loadReportViews(
  db: MedcoreDb,
  reports: LabReportRow[]
): Promise<ReportView[]> {
  const patients = await db.patients.bulkGet(
    unique(reports.map((r) => r.patientId))
  )
  const orders = await db.labOrders.bulkGet(
    unique(reports.map((r) => r.labOrderId))
  )
  const items = await db.labOrderItems.bulkGet(
    unique(reports.flatMap((r) => r.itemIds))
  )
  const patientById = new Map(patients.filter(Boolean).map((p) => [p!.id, p!]))
  const orderById = new Map(orders.filter(Boolean).map((o) => [o!.id, o!]))
  const itemById = new Map(items.filter(Boolean).map((i) => [i!.id, i!]))
  return reports.map((report) => ({
    report,
    patient: patientById.get(report.patientId),
    order: orderById.get(report.labOrderId),
    items: report.itemIds
      .map((id) => itemById.get(id))
      .filter(Boolean) as LabOrderItemRow[],
  }))
}

/* ---------------- Stage counts ---------------- */

export type StageCounts = {
  collect: number
  transit: number
  results: number
  validate: number
  sign: number
}

/** Live counts for the specimen-flow strip at a branch. */
export function useStageCounts(branch: BranchCode): StageCounts | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const specimens = (status: SpecimenRow["status"]) =>
      db.specimens.where("[branchId+status]").equals([branch, status]).count()
    const items = (status: LabOrderItemRow["status"]) =>
      db.labOrderItems.where("[branchId+status]").equals([branch, status])
    const validated = await items("validated").toArray()
    return {
      collect: await specimens("awaiting-collection"),
      transit: await specimens("collected"),
      results: await items("received").count(),
      validate: await items("resulted").count(),
      sign: new Set(validated.map((i) => i.labOrderId)).size,
    }
  }, [db, branch])
}
