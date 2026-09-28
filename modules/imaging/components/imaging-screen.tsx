"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { CheckCheck, FileImage, FileUp, Send, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText, type Tone } from "@/components/shared/status"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import type { BranchCode } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type {
  ImagingOrderRow,
  ImagingReportRow,
  LabTestRow,
  PatientRow,
  StaffRow,
} from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { useLabCommand } from "@/modules/lab/components/lab-feedback"
import {
  branchLabel,
  LabPage,
  PatientCell,
} from "@/modules/lab/components/lab-ui"
import {
  useBranch,
  useLabTests,
  useTodayStart,
} from "@/modules/lab/components/use-lab-data"

import {
  markImagingDone,
  releaseImagingReport,
  uploadImagingReport,
} from "../commands"

type ImagingView = {
  order: ImagingOrderRow
  patient?: PatientRow
  report?: ImagingReportRow
}

const ACTIVE: ImagingOrderRow["status"][] = ["paid", "done", "reported"]

function useImaging(branch: BranchCode, since: number) {
  const db = useDb()
  return useLiveQuery(async () => {
    const orders = (
      await db.imagingOrders.where("branchId").equals(branch).toArray()
    )
      .filter(
        (o) =>
          o.paymentCleared &&
          (ACTIVE.includes(o.status) ||
            (o.status === "released" && o.updatedAt >= since))
      )
      .sort((a, b) => a.createdAt - b.createdAt)
    const patients = await db.patients.bulkGet(orders.map((o) => o.patientId))
    const reports = await db.imagingReports.bulkGet(
      orders.map((o) => o.reportId ?? "")
    )
    return orders.map((order, i): ImagingView => ({
      order,
      patient: patients[i] ?? undefined,
      report: order.reportId ? (reports[i] ?? undefined) : undefined,
    }))
  }, [db, branch, since])
}

/** Reporting doctors: radiologists, plus cardiologists for ECG and echo. */
function useReporters() {
  const db = useDb()
  return useLiveQuery(async () => {
    const doctors = await db.doctors.toArray()
    const pick = doctors.filter(
      (d) => d.kind === "radiologist" || d.specialtyId === "spc_card"
    )
    const staff = await db.staff.bulkGet(pick.map((d) => d.staffId))
    return pick
      .map((doctor, i) => ({ doctor, staff: staff[i] }))
      .filter(
        (r): r is { doctor: (typeof pick)[number]; staff: StaffRow } =>
          !!r.staff
      )
  }, [db])
}

const STATUS_TONE: Record<string, Tone> = {
  paid: "info",
  done: "warning",
  reported: "primary",
  released: "success",
}

/**
 * "/lab/imaging": minimal imaging (plan D18): paid studies are marked done,
 * the radiologist's signed PDF is uploaded (simulated: a file name and a
 * SHA-256 hash), then released behind the payment gate to the doctor inbox
 * and the patient app.
 */
export function ImagingScreen() {
  const { t, locale } = useLocale()
  const branch = useBranch()
  const tests = useLabTests()
  const since = useTodayStart()
  const rows = useImaging(branch, since)
  const [uploading, setUploading] = React.useState<ImagingView | null>(null)

  return (
    <LabPage
      branch={branch}
      strip={false}
      title={t("imaging.worklist.title")}
      subtitle={t("imaging.worklist.subtitle", {
        branch: branchLabel(branch, locale),
      })}
      testId="lab-imaging"
    >
      <SectionCard
        size="sm"
        icon={FileImage}
        title={t("imaging.worklist.listTitle")}
      >
        {rows && !rows.length ? (
          <EmptyState
            size="sm"
            icon={FileImage}
            title={t("imaging.worklist.empty")}
          />
        ) : (
          <div className="@container/table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("lab.common.patient")}</TableHead>
                  <TableHead>{t("imaging.worklist.study")}</TableHead>
                  <TableHead className="hidden @min-[48rem]/table:table-cell">
                    {t("imaging.worklist.indication")}
                  </TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows ?? []).map((view) => (
                  <ImagingRow
                    key={view.order.id}
                    view={view}
                    test={tests?.get(view.order.testId)}
                    onUpload={() => setUploading(view)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
      <Dialog
        open={!!uploading}
        onOpenChange={(next) => (!next ? setUploading(null) : undefined)}
      >
        <DialogContent
          className="sm:max-w-lg"
          data-testid="imaging-upload-dialog"
        >
          {uploading ? (
            <UploadBody
              key={uploading.order.id}
              view={uploading}
              test={tests?.get(uploading.order.testId)}
              onClose={() => setUploading(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </LabPage>
  )
}

function ImagingRow({
  view,
  test,
  onUpload,
}: {
  view: ImagingView
  test: LabTestRow | undefined
  onUpload: () => void
}) {
  const { t, tk, locale, time } = useLocale()
  const done = useLabCommand(markImagingDone)
  const release = useLabCommand(releaseImagingReport)
  const flash = useFlashOnChange(view.order.version)
  const { order, report } = view
  return (
    <TableRow
      data-testid="imaging-row"
      data-order-id={order.id}
      data-status={order.status}
      className={flash}
    >
      <TableCell className="max-w-[14rem]">
        <PatientCell patient={view.patient} />
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="block text-[0.8125rem] font-medium">
          {test?.name ?? tk(`imaging.modalities.${order.modality}`)}
        </span>
        <span className="block text-xs text-muted-foreground">
          {tk(`imaging.modalities.${order.modality}`)} · {order.bodyPart} ·{" "}
          <span className="font-mono" lang="en">
            {order.orderNo}
          </span>
        </span>
      </TableCell>
      <TableCell className="hidden max-w-[14rem] truncate text-xs text-muted-foreground @min-[48rem]/table:table-cell">
        {order.indication}
      </TableCell>
      <TableCell className="text-xs whitespace-normal">
        <StatusText tone={STATUS_TONE[order.status] ?? "muted"} dot>
          {tk(`imaging.status.${order.status}`)}
        </StatusText>
        {report && order.status !== "done" ? (
          <span
            className="block max-w-[14rem] truncate pl-3 font-mono text-[0.6875rem] text-muted-foreground"
            lang="en"
            title={report.pdfHash}
          >
            {report.pdfName}
          </span>
        ) : null}
        {order.status === "released" && report?.releasedAt ? (
          <span className="block pl-3 text-[0.6875rem] text-muted-foreground">
            {t("imaging.worklist.releasedAt", {
              time: time(report.releasedAt),
            })}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        {order.status === "paid" ? (
          <Button
            size="sm"
            variant="neutral"
            data-testid="imaging-done"
            disabled={done.pending}
            onClick={async () => {
              const ok = await done.run({
                imagingOrderId: order.id,
                expectedVersion: order.version,
              })
              if (ok)
                toast.success(
                  t("imaging.worklist.doneToast", {
                    study: test?.code ?? order.orderNo,
                  })
                )
            }}
          >
            <CheckCheck />
            {t("imaging.worklist.markDone")}
          </Button>
        ) : order.status === "done" ? (
          <Button
            size="sm"
            variant="outline"
            data-testid="imaging-upload"
            onClick={onUpload}
          >
            <FileUp />
            <span className="hidden @min-[40rem]/table:inline">
              {t("imaging.worklist.upload")}
            </span>
          </Button>
        ) : order.status === "reported" ? (
          <Button
            size="sm"
            data-testid="imaging-release"
            disabled={release.pending}
            onClick={async () => {
              const ok = await release.run({
                imagingOrderId: order.id,
                expectedVersion: order.version,
                smsLang: locale,
              })
              if (ok)
                toast.success(
                  t("imaging.worklist.releasedToast", {
                    orderNo: order.orderNo,
                  })
                )
            }}
          >
            <Send />
            {t("imaging.worklist.release")}
          </Button>
        ) : report ? (
          <Link
            href={`/verify/${report.id}`}
            target="_blank"
            data-testid="imaging-verify"
            aria-label={t("lab.reports.verify")}
            title={t("lab.reports.verify")}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ShieldCheck />
          </Link>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function UploadBody({
  view,
  test,
  onClose,
}: {
  view: ImagingView
  test: LabTestRow | undefined
  onClose: () => void
}) {
  const { t, locale } = useLocale()
  const upload = useLabCommand(uploadImagingReport)
  const reporters = useReporters()
  const cardiac =
    view.order.modality === "ecg" || view.order.modality === "echo"
  const suited = (reporters ?? []).filter((r) =>
    cardiac
      ? r.doctor.specialtyId === "spc_card"
      : r.doctor.kind === "radiologist"
  )
  const options = (suited.length ? suited : (reporters ?? [])).filter(
    (r) =>
      !r.doctor.branchIds.length ||
      r.doctor.branchIds.includes(view.order.branchId)
  )
  const [pdfName, setPdfName] = React.useState(
    `${test?.code ?? "IMG"}-${view.order.orderNo}-signed.pdf`
  )
  const [pick, setPick] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState("")
  const chosen = options.find((r) => r.doctor.id === pick) ?? options[0]
  const valid =
    /\.pdf$/i.test(pdfName.trim()) && pdfName.trim().length >= 5 && !!chosen

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || !chosen) return
    const done = await upload.run({
      imagingOrderId: view.order.id,
      pdfName: pdfName.trim(),
      radiologistId: chosen.doctor.id,
      summary: summary.trim() || undefined,
    })
    if (done) {
      toast.success(
        t("imaging.worklist.uploadedToast", { orderNo: view.order.orderNo }),
        {
          description: t("imaging.worklist.hash", {
            hash: done.pdfHash.slice(0, 16),
          }),
        }
      )
      onClose()
    }
  }

  return (
    <form onSubmit={confirm} className="contents">
      <DialogHeader>
        <DialogTitle>{t("imaging.upload.title")}</DialogTitle>
        <DialogDescription>
          {test?.name} ·{" "}
          <span className="font-mono" lang="en">
            {view.order.orderNo}
          </span>
        </DialogDescription>
      </DialogHeader>
      <IdentityBanner patientId={view.order.patientId} compact />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="imaging-file">{t("imaging.upload.file")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="imaging-file"
            data-testid="imaging-file"
            className="font-mono text-[0.8125rem]"
            value={pdfName}
            onChange={(event) => setPdfName(event.target.value)}
          />
          <SimulatedBadge />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("imaging.upload.fileHint")}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("imaging.upload.radiologist")}</Label>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={t("imaging.upload.radiologist")}
        >
          {options.map((r) => (
            <button
              key={r.doctor.id}
              type="button"
              role="radio"
              aria-checked={r.doctor.id === chosen?.doctor.id}
              onClick={() => setPick(r.doctor.id)}
              className={cn(
                "h-8 rounded-full border px-3 text-[0.8125rem]",
                r.doctor.id === chosen?.doctor.id
                  ? "border-primary bg-primary-soft text-link"
                  : "border-border hover:bg-surface-raised"
              )}
            >
              {locale === "bn" ? r.staff.nameBn : r.staff.nameEn}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="imaging-summary">{t("imaging.upload.summary")}</Label>
        <Textarea
          id="imaging-summary"
          className="min-h-14"
          maxLength={500}
          value={summary}
          placeholder={t("imaging.upload.summaryPlaceholder")}
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          data-testid="imaging-upload-confirm"
          disabled={!valid || upload.pending}
        >
          <FileUp />
          {t("imaging.upload.confirm")}
        </Button>
      </DialogFooter>
    </form>
  )
}
