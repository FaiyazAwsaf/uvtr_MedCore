"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Ban, Inbox, ScanLine, Send } from "lucide-react"
import { labToast as toast } from "./lab-toast"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import type { LabTestRow, SpecimenRow } from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import {
  receiveSpecimen,
  rejectSpecimen,
  REJECT_REASONS,
  type RejectReason,
} from "../commands"
import { useLabCommand } from "./lab-feedback"
import { ContainerChip, LabPage, PatientCell, TestChips } from "./lab-ui"
import {
  loadSpecimenViews,
  staffName,
  useBranch,
  useLabTests,
  useSpecimens,
  useStaff,
  useTodayStart,
  type SpecimenView,
} from "./use-lab-data"

/**
 * "/lab/reception": specimen intake (plan §9). Receive collected specimens
 * at the bench, or reject one with a reason, which orders a free recollection
 * (scenario S5).
 */
export function ReceptionScreen() {
  const { t } = useLocale()
  const branch = useBranch()
  const tests = useLabTests()
  const inTransit = useSpecimens(branch, ["collected"], {
    sortField: "collectedAt",
  })
  const receivedAll = useSpecimens(branch, ["received"], {
    sortField: "receivedAt",
    newestFirst: true,
  })
  const received = receivedAll?.filter((v) =>
    v.items.some((i) => i.status === "received")
  )
  const [rejecting, setRejecting] = React.useState<SpecimenView | null>(null)

  return (
    <LabPage
      branch={branch}
      title={t("lab.reception.title")}
      subtitle={t("lab.reception.subtitle")}
      testId="lab-reception"
    >
      <div className="@container">
        <div className="grid gap-4 @min-[68rem]:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <SectionCard
              size="sm"
              icon={Send}
              title={t("lab.reception.inTransit")}
            >
              {inTransit && !inTransit.length ? (
                <EmptyState
                  size="sm"
                  icon={Send}
                  title={t("lab.reception.inTransitEmpty")}
                />
              ) : (
                <SpecimenTable
                  rows={inTransit ?? []}
                  tests={tests}
                  mode="transit"
                  onReject={setRejecting}
                />
              )}
            </SectionCard>
            <SectionCard
              size="sm"
              icon={Inbox}
              title={t("lab.reception.received")}
            >
              {received && !received.length ? (
                <EmptyState
                  size="sm"
                  icon={Inbox}
                  title={t("lab.reception.receivedEmpty")}
                />
              ) : (
                <SpecimenTable
                  rows={received ?? []}
                  tests={tests}
                  mode="received"
                  onReject={setRejecting}
                />
              )}
            </SectionCard>
          </div>
          <RejectedToday branch={branch} tests={tests} />
        </div>
      </div>

      <Dialog
        open={!!rejecting}
        onOpenChange={(next) => (!next ? setRejecting(null) : undefined)}
      >
        <DialogContent
          className="gap-4 sm:max-w-lg"
          data-testid="reject-dialog"
        >
          {rejecting ? (
            <RejectBody
              key={rejecting.specimen.id}
              view={rejecting}
              tests={tests}
              onClose={() => setRejecting(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </LabPage>
  )
}

function SpecimenTable({
  rows,
  tests,
  mode,
  onReject,
}: {
  rows: SpecimenView[]
  tests: Map<string, LabTestRow> | undefined
  mode: "transit" | "received"
  onReject: (view: SpecimenView) => void
}) {
  const { t } = useLocale()
  return (
    <div className="@container/table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("lab.common.patient")}</TableHead>
            <TableHead>{t("lab.common.tests")}</TableHead>
            <TableHead className="hidden @min-[52rem]/table:table-cell">
              {t("lab.common.accession")}
            </TableHead>
            <TableHead className="hidden @min-[32rem]/table:table-cell">
              {mode === "transit"
                ? t("lab.common.collected")
                : t("lab.common.received")}
            </TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((view) => (
            <SpecimenRowView
              key={view.specimen.id}
              view={view}
              tests={tests}
              mode={mode}
              onReject={() => onReject(view)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SpecimenRowView({
  view,
  tests,
  mode,
  onReject,
}: {
  view: SpecimenView
  tests: Map<string, LabTestRow> | undefined
  mode: "transit" | "received"
  onReject: () => void
}) {
  const { t, locale } = useLocale()
  const staff = useStaff()
  const receive = useLabCommand(receiveSpecimen)
  const flash = useFlashOnChange(view.specimen.version)
  const at =
    mode === "transit" ? view.specimen.collectedAt : view.specimen.receivedAt
  const by =
    mode === "transit" ? view.specimen.collectedBy : view.specimen.receivedBy
  return (
    <TableRow
      data-testid={mode === "transit" ? "receive-row" : "received-row"}
      data-specimen-id={view.specimen.id}
      data-accession={view.specimen.accessionNo}
      className={flash}
    >
      <TableCell className="max-w-[15rem]">
        <PatientCell patient={view.patient} />
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-col gap-1">
          <TestChips testIds={view.items.map((i) => i.testId)} tests={tests} />
          <ContainerChip
            container={view.specimen.container}
            short
            className="text-xs text-muted-foreground"
          />
        </div>
      </TableCell>
      <TableCell
        className="hidden font-mono text-xs @min-[52rem]/table:table-cell"
        lang="en"
      >
        {view.specimen.accessionNo}
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground @min-[32rem]/table:table-cell">
        {at ? <DateText value={at} variant="time" /> : "-"}
        <span className="block truncate">{staffName(staff, by, locale)}</span>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            variant="destructive-outline"
            size="sm"
            data-testid="reject-open"
            onClick={onReject}
          >
            <Ban />
            <span className="hidden @min-[56rem]/table:inline">
              {t("lab.reception.reject")}
            </span>
          </Button>
          {mode === "transit" ? (
            <Button
              size="sm"
              data-testid="receive-confirm"
              disabled={receive.pending}
              onClick={async () => {
                const done = await receive.run({
                  specimenId: view.specimen.id,
                  expectedVersion: view.specimen.version,
                })
                if (done) {
                  toast.success(
                    t("lab.reception.receivedToast", {
                      accessionNo: view.specimen.accessionNo,
                    })
                  )
                }
              }}
            >
              <ScanLine />
              {t("lab.reception.receive")}
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Reason, optional note, what happens next, then reject and order recollection. */
function RejectBody({
  view,
  tests,
  onClose,
}: {
  view: SpecimenView
  tests: Map<string, LabTestRow> | undefined
  onClose: () => void
}) {
  const { t, tk, locale } = useLocale()
  const reject = useLabCommand(rejectSpecimen)
  const [reason, setReason] = React.useState<RejectReason | null>(null)
  const [note, setNote] = React.useState("")

  const confirm = async () => {
    if (!reason) return
    const done = await reject.run({
      specimenId: view.specimen.id,
      reason,
      note: note.trim() || undefined,
      expectedVersion: view.specimen.version,
      smsLang: locale,
    })
    if (done) {
      toast.success(
        t("lab.reception.rejectDialog.done", {
          accessionNo: done.accessionNos.join(", "),
        })
      )
      onClose()
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("lab.reception.rejectDialog.title")}</DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {t("lab.common.accession")}{" "}
            <span className="font-mono text-foreground" lang="en">
              {view.specimen.accessionNo}
            </span>
          </span>
          <ContainerChip container={view.specimen.container} short />
          <TestChips testIds={view.items.map((i) => i.testId)} tests={tests} />
        </DialogDescription>
      </DialogHeader>
      <IdentityBanner patientId={view.specimen.patientId} compact />
      <div className="flex flex-col gap-2">
        <Label id="reject-reason-label">
          {t("lab.reception.rejectDialog.reason")}
        </Label>
        <div
          role="radiogroup"
          aria-labelledby="reject-reason-label"
          data-testid="reject-reason"
          data-value={reason ?? ""}
          className="flex flex-wrap gap-2"
        >
          {REJECT_REASONS.map((code) => {
            const checked = reason === code
            return (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={checked}
                data-reason={code}
                onClick={() => setReason(code)}
                className={cn(
                  "h-8 rounded-full border px-3 text-[0.8125rem] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
                  checked
                    ? "border-destructive bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] text-destructive"
                    : "border-border text-foreground hover:bg-surface-raised"
                )}
              >
                {tk(`lab.rejectReasons.${code}`)}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reject-note">
          {t("lab.reception.rejectDialog.note")}
        </Label>
        <Textarea
          id="reject-note"
          data-testid="reject-note"
          className="min-h-11"
          value={note}
          maxLength={300}
          placeholder={t("lab.reception.rejectDialog.notePlaceholder")}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <p className="flex items-start gap-2 rounded-md bg-surface-raised px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <span className="flex-1">
          {t("lab.reception.rejectDialog.effects")}
        </span>
        <SimulatedBadge />
      </p>
      <DialogFooter>
        <Button variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          data-testid="reject-confirm"
          disabled={!reason || reject.pending}
          title={
            !reason ? t("lab.reception.rejectDialog.pickReason") : undefined
          }
          onClick={confirm}
        >
          <Ban />
          {t("lab.reception.rejectDialog.confirm")}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Today's rejections with the recollection tube each one created. */
function RejectedToday({
  branch,
  tests,
}: {
  branch: BranchCode
  tests: Map<string, LabTestRow> | undefined
}) {
  const { t, tk, locale } = useLocale()
  const db = useDb()
  const since = useTodayStart()
  const rows = useLiveQuery(async () => {
    const rejected = (
      await db.specimens
        .where("[branchId+status]")
        .equals([branch, "rejected"])
        .toArray()
    )
      .filter((s) => s.updatedAt >= since)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const views = await loadSpecimenViews(db, rejected)
    const withRecollection: {
      view: SpecimenView
      recollection?: SpecimenRow
    }[] = []
    for (const view of views) {
      const patientItems = await db.labOrderItems
        .where("patientId")
        .equals(view.specimen.patientId)
        .toArray()
      const fresh = patientItems.find(
        (i) =>
          i.recollectionOfItemId &&
          view.specimen.itemIds.includes(i.recollectionOfItemId)
      )
      const recollection = fresh?.specimenId
        ? await db.specimens.get(fresh.specimenId)
        : undefined
      withRecollection.push({ view, recollection })
    }
    return withRecollection
  }, [db, branch, since])

  return (
    <SectionCard
      size="sm"
      title={t("lab.reception.rejectedToday")}
      className="self-start"
    >
      {rows && !rows.length ? (
        <p className="py-4 text-center text-[0.8125rem] text-muted-foreground">
          {t("lab.reception.rejectedEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col" data-testid="rejected-list">
          {(rows ?? []).map(({ view, recollection }) => (
            <li
              key={view.specimen.id}
              className="border-b border-hairline py-2 last:border-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[0.8125rem] font-medium">
                  {view.patient
                    ? locale === "bn"
                      ? view.patient.nameBn
                      : view.patient.nameEn
                    : "-"}
                </span>
                <span className="shrink-0 text-xs font-medium text-destructive">
                  {view.specimen.rejectReason
                    ? tk(`lab.rejectReasons.${view.specimen.rejectReason}`)
                    : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono line-through" lang="en">
                  {view.specimen.accessionNo}
                </span>
                <TestChips
                  testIds={view.allItems.map((i) => i.testId)}
                  tests={tests}
                />
              </div>
              {recollection ? (
                <div className="mt-0.5 text-xs text-info">
                  {t("lab.reception.recollectionAs", {
                    accessionNo: recollection.accessionNo,
                  })}{" "}
                  · {tk(`lab.status.${recollection.status}`)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
