import { z } from "zod"

import { canonicalJson, sha256Hex } from "@/core/audit/chain"
import { notifyPatient, queueSms } from "@/core/comms/sms"
import { defineCommand } from "@/core/engine/defineCommand"

/**
 * Minimal imaging (plan D18, PRD §10.7): a paid study is marked done, the
 * radiologist's signed PDF is "uploaded" (simulated: a file name and its
 * hash), then released behind the same payment gate as lab reports, to the
 * doctor inbox, the patient app and a verified phone.
 */

export const markImagingDone = defineCommand({
  name: "imaging.markDone",
  roles: ["labtech"],
  input: z.object({
    imagingOrderId: z.string(),
    expectedVersion: z.number().int().optional(),
  }),
  async run(tx, input) {
    const order = await tx.get("imagingOrders", input.imagingOrderId, {
      expectedVersion: input.expectedVersion,
    })
    if (!order.paymentCleared) tx.reject("LAB_IMAGING_NOT_PAID", { orderNo: order.orderNo })
    if (order.status !== "paid" && order.status !== "ordered") {
      tx.reject("LAB_IMAGING_STATE", { orderNo: order.orderNo, status: order.status })
    }
    await tx.update("imagingOrders", order.id, { status: "done" })
    const test = await tx.get("labTests", order.testId)
    tx.emit("ImagingStudyCompleted", {
      branchId: order.branchId,
      refs: { patientId: order.patientId, imagingOrderId: order.id },
      params: { orderNo: order.orderNo, study: test.code },
    })
    return { imagingOrderId: order.id }
  },
})

/**
 * "Upload signed report PDF" (simulated): records the file name, the
 * reporting radiologist and the SHA-256 of the file, as version 1 (or the
 * next version when a report already exists).
 */
export const uploadImagingReport = defineCommand({
  name: "imaging.uploadReport",
  roles: ["labtech"],
  input: z.object({
    imagingOrderId: z.string(),
    pdfName: z
      .string()
      .trim()
      .min(5)
      .max(120)
      .regex(/\.pdf$/i),
    radiologistId: z.string(),
    summary: z.string().trim().max(500).optional(),
  }),
  async run(tx, input) {
    const order = await tx.get("imagingOrders", input.imagingOrderId)
    if (order.status !== "done") {
      tx.reject("LAB_IMAGING_STATE", { orderNo: order.orderNo, status: order.status })
    }
    const radiologist = await tx.get("doctors", input.radiologistId)
    const previous = (await tx.list("imagingReports", "imagingOrderId", order.id)).sort(
      (a, b) => b.reportVersion - a.reportVersion
    )[0]
    const reportVersion = (previous?.reportVersion ?? 0) + 1
    // Simulated file: the hash stands in for the digest of the uploaded PDF.
    const pdfHash = sha256Hex(
      canonicalJson({
        pdfName: input.pdfName,
        orderNo: order.orderNo,
        radiologistId: radiologist.id,
        reportVersion,
        uploadedAt: tx.now(),
        summary: input.summary ?? null,
      })
    )
    const report = tx.insert("imagingReports", {
      imagingOrderId: order.id,
      patientId: order.patientId,
      reportVersion,
      status: "uploaded",
      pdfName: input.pdfName,
      pdfHash,
      radiologistId: radiologist.id,
      summary: input.summary || undefined,
      supersedesId: previous?.id,
    })
    if (previous && previous.status !== "superseded") {
      await tx.update("imagingReports", previous.id, { status: "superseded" })
    }
    await tx.update("imagingOrders", order.id, { status: "reported", reportId: report.id })
    tx.emit("ImagingReportUploaded", {
      branchId: order.branchId,
      refs: { patientId: order.patientId, imagingOrderId: order.id },
      params: { orderNo: order.orderNo, pdfName: input.pdfName },
    })
    return { reportId: report.id, pdfHash }
  },
})

/** Release an uploaded imaging report (payment gate, then inbox, app and SMS). */
export const releaseImagingReport = defineCommand({
  name: "imaging.releaseReport",
  roles: ["labtech"],
  input: z.object({
    imagingOrderId: z.string(),
    expectedVersion: z.number().int().optional(),
    smsLang: z.enum(["en", "bn"]).default("bn"),
  }),
  async run(tx, input) {
    const order = await tx.get("imagingOrders", input.imagingOrderId, {
      expectedVersion: input.expectedVersion,
    })
    if (order.status !== "reported" || !order.reportId) {
      tx.reject("LAB_IMAGING_STATE", { orderNo: order.orderNo, status: order.status })
    }
    if (!order.paymentCleared) tx.reject("PAYMENT_GATE", { step: "release", rule: "INV-10" })
    const report = await tx.get("imagingReports", order.reportId!)
    if (report.status !== "uploaded") {
      tx.reject("LAB_IMAGING_STATE", { orderNo: order.orderNo, status: report.status })
    }
    await tx.update("imagingReports", report.id, { status: "released", releasedAt: tx.now() })
    await tx.update("imagingOrders", order.id, { status: "released" })

    const test = await tx.get("labTests", order.testId)
    const refs = { patientId: order.patientId, imagingOrderId: order.id }
    if (order.doctorId) {
      tx.insert("inboxItems", {
        doctorId: order.doctorId,
        patientId: order.patientId,
        kind: "result",
        refs,
        titleKey: "consultation.inbox.kind.result",
        params: { orderNo: order.orderNo, tests: test.code },
        status: "unread",
      })
    }
    notifyPatient(tx, {
      patientId: order.patientId,
      kind: "reportReady",
      titleKey: "patientApp.notifications.reportReady",
      refs,
    })
    const patient = await tx.get("patients", order.patientId)
    const smsConsent = patient.consents.find((c) => c.purpose === "sms")?.granted !== false
    if (patient.phone && patient.phoneVerified && smsConsent) {
      queueSms(tx, {
        to: patient.phone,
        patientId: patient.id,
        lang: input.smsLang,
        templateId: "report-ready",
      })
    }
    tx.emit("ImagingReportReleased", {
      branchId: order.branchId,
      refs,
      params: { orderNo: order.orderNo, study: test.code },
    })
    return { imagingOrderId: order.id, reportId: report.id }
  },
})
