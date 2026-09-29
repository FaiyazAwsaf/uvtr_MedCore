import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MedcoreDb } from "@/core/db/database"
import { commit } from "@/core/engine/commit"
import { HERO, SEED_REFS } from "@/core/seed/content"
import {
  markImagingDone,
  releaseImagingReport,
  uploadImagingReport,
} from "@/modules/imaging/commands"
import { loadVerification } from "@/modules/lab/verify"

import { labtech, placeImagingOrder, releaseClock, seededDb } from "./fixtures"

let db: MedcoreDb

beforeAll(async () => {
  db = await seededDb("lab-imaging-test")
}, 60_000)

afterAll(async () => {
  releaseClock()
  await db?.delete()
})

const RADIOLOGIST = "doc_enamul_kabir"

describe("imaging: done, signed PDF upload, release", () => {
  it("takes a paid chest X-ray from done to released, to the doctor and the patient", async () => {
    const { result: order } = await commit(
      placeImagingOrder,
      {
        patientId: HERO.patient.abdulKarim,
        doctorId: HERO.doctor.kamal,
        testId: SEED_REFS.test.xrayChest,
      },
      { db, actor: labtech }
    )
    await expect(
      commit(
        releaseImagingReport,
        { imagingOrderId: order.imagingOrderId },
        { db, actor: labtech }
      )
    ).rejects.toMatchObject({ code: "LAB_IMAGING_STATE" })

    await commit(
      markImagingDone,
      { imagingOrderId: order.imagingOrderId },
      { db, actor: labtech }
    )
    expect((await db.imagingOrders.get(order.imagingOrderId))?.status).toBe(
      "done"
    )

    const { result: upload } = await commit(
      uploadImagingReport,
      {
        imagingOrderId: order.imagingOrderId,
        pdfName: `XR-CHEST-${order.orderNo}-signed.pdf`,
        radiologistId: RADIOLOGIST,
        summary: "No active lung lesion.",
      },
      { db, actor: labtech }
    )
    expect(upload.pdfHash).toMatch(/^[0-9a-f]{64}$/)
    const report = (await db.imagingReports.get(upload.reportId))!
    expect(report).toMatchObject({
      status: "uploaded",
      reportVersion: 1,
      radiologistId: RADIOLOGIST,
    })
    expect(await db.imagingOrders.get(order.imagingOrderId)).toMatchObject({
      status: "reported",
      reportId: upload.reportId,
    })

    await commit(
      releaseImagingReport,
      { imagingOrderId: order.imagingOrderId },
      { db, actor: labtech }
    )
    expect((await db.imagingReports.get(upload.reportId))?.status).toBe(
      "released"
    )
    expect((await db.imagingOrders.get(order.imagingOrderId))?.status).toBe(
      "released"
    )

    const inbox = await db.inboxItems
      .where("doctorId")
      .equals(HERO.doctor.kamal)
      .toArray()
    expect(
      inbox.find((i) => i.refs.imagingOrderId === order.imagingOrderId)
    ).toMatchObject({
      kind: "result",
      titleKey: "consultation.inbox.kind.result",
    })
    const notes = await db.notifications
      .where("patientId")
      .equals(HERO.patient.abdulKarim)
      .toArray()
    expect(
      notes.find((n) => n.refs.imagingOrderId === order.imagingOrderId)?.kind
    ).toBe("reportReady")
    const types = (
      await db.events.orderBy("seq").reverse().limit(3).toArray()
    ).map((e) => e.type)
    expect(types).toEqual([
      "ImagingReportReleased",
      "ImagingReportUploaded",
      "ImagingStudyCompleted",
    ])

    const verification = await loadVerification(db, upload.reportId)
    expect(verification).toMatchObject({ state: "genuine", kind: "imaging" })
  })

  it("refuses an unpaid study and a file that is not a PDF", async () => {
    const { result: unpaid } = await commit(
      placeImagingOrder,
      {
        patientId: HERO.patient.tanvirKarim,
        testId: SEED_REFS.test.ecg,
        paid: false,
      },
      { db, actor: labtech }
    )
    await expect(
      commit(
        markImagingDone,
        { imagingOrderId: unpaid.imagingOrderId },
        { db, actor: labtech }
      )
    ).rejects.toMatchObject({ code: "LAB_IMAGING_NOT_PAID" })

    const seeded = await db.imagingOrders
      .where("status")
      .equals("paid")
      .filter((o) => o.branchId === "B1")
      .first()
    expect(seeded).toBeDefined()
    await commit(
      markImagingDone,
      { imagingOrderId: seeded!.id },
      { db, actor: labtech }
    )
    await expect(
      commit(
        uploadImagingReport,
        {
          imagingOrderId: seeded!.id,
          pdfName: "report.docx",
          radiologistId: RADIOLOGIST,
        },
        { db, actor: labtech }
      )
    ).rejects.toMatchObject({ kind: "validation" })
  })
})
