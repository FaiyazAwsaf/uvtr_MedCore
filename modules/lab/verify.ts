import type { BranchCode } from "@/config/brand.config"
import type { MedcoreDb } from "@/core/db/database"
import type {
  ImagingOrderRow,
  ImagingReportRow,
  LabReportRow,
  LabTestRow,
  StaffRow,
} from "@/core/db/schema"

import { initialsOf } from "./logic"

/**
 * What the public QR verification page shows for a report id (plan T2.7,
 * HAZ-03): genuine or not found, the patient's initials only, the test
 * names, the version asked for and the current one, and the signed hash.
 */
export type Verification =
  | { state: "not-found" }
  | {
      state: "genuine"
      kind: "lab"
      report: LabReportRow
      current: LabReportRow
      /** Every version of the report number, oldest first */
      versions: LabReportRow[]
      initials: string
      tests: Pick<LabTestRow, "id" | "code" | "name">[]
      signer?: Pick<StaffRow, "nameEn" | "nameBn" | "designation" | "regNo">
      branchId: BranchCode
    }
  | {
      state: "genuine"
      kind: "imaging"
      report: ImagingReportRow
      current: ImagingReportRow
      versions: ImagingReportRow[]
      order: ImagingOrderRow
      initials: string
      tests: Pick<LabTestRow, "id" | "code" | "name">[]
      signer?: Pick<StaffRow, "nameEn" | "nameBn" | "designation" | "regNo">
      branchId: BranchCode
    }

function pickTest(test: LabTestRow | undefined) {
  return test ? { id: test.id, code: test.code, name: test.name } : undefined
}

/** The current version: the highest version that is not superseded. */
function currentOf<R extends { status: string; reportVersion: number }>(versions: R[]): R {
  const live = versions.filter((v) => v.status !== "superseded")
  const pool = live.length ? live : versions
  return pool.reduce((best, v) => (v.reportVersion > best.reportVersion ? v : best))
}

export async function loadVerification(
  db: MedcoreDb,
  reportId: string
): Promise<Verification> {
  const lab = await db.labReports.get(reportId)
  if (lab && lab.status !== "draft") {
    const versions = (await db.labReports.where("reportNo").equals(lab.reportNo).toArray())
      .filter((v) => v.branchId === lab.branchId && v.status !== "draft")
      .sort((a, b) => a.reportVersion - b.reportVersion)
    const current = currentOf(versions)
    const patient = await db.patients.get(lab.patientId)
    const items = (await db.labOrderItems.bulkGet(current.itemIds)).filter((i) => !!i)
    const testIds = [...new Set(items.map((i) => i!.testId))]
    const tests = (await db.labTests.bulkGet(testIds)).map(pickTest).filter((t) => !!t)
    const signer = current.signedBy ? await db.staff.get(current.signedBy) : undefined
    return {
      state: "genuine",
      kind: "lab",
      report: lab,
      current,
      versions,
      initials: patient ? initialsOf(patient.nameEn) : "",
      tests: tests as Pick<LabTestRow, "id" | "code" | "name">[],
      signer: signer
        ? {
            nameEn: signer.nameEn,
            nameBn: signer.nameBn,
            designation: signer.designation,
            regNo: signer.regNo,
          }
        : undefined,
      branchId: lab.branchId,
    }
  }

  const imaging = await db.imagingReports.get(reportId)
  if (imaging) {
    const order = await db.imagingOrders.get(imaging.imagingOrderId)
    if (!order) return { state: "not-found" }
    const versions = (
      await db.imagingReports.where("imagingOrderId").equals(order.id).toArray()
    ).sort((a, b) => a.reportVersion - b.reportVersion)
    const patient = await db.patients.get(imaging.patientId)
    const test = pickTest(await db.labTests.get(order.testId))
    const doctor = await db.doctors.get(imaging.radiologistId)
    const signer = doctor ? await db.staff.get(doctor.staffId) : undefined
    return {
      state: "genuine",
      kind: "imaging",
      report: imaging,
      current: currentOf(versions),
      versions,
      order,
      initials: patient ? initialsOf(patient.nameEn) : "",
      tests: test ? [test] : [],
      signer: signer
        ? {
            nameEn: signer.nameEn,
            nameBn: signer.nameBn,
            designation: signer.designation,
            regNo: signer.regNo,
          }
        : undefined,
      branchId: order.branchId,
    }
  }
  return { state: "not-found" }
}
