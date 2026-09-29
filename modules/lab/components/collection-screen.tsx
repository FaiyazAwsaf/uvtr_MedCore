"use client"

import * as React from "react"
import { Printer, ShieldCheck, ShieldX, TestTube } from "lucide-react"
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
import type { LabTestRow } from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { collectSpecimen, printSpecimenLabel } from "../commands"
import { useLabCommand } from "./lab-feedback"
import {
  branchLabel,
  ContainerChip,
  LabPage,
  PatientCell,
  TestChips,
} from "./lab-ui"
import { TubeLabel } from "./tube-label"
import {
  staffName,
  useBranch,
  useLabTests,
  useSpecimens,
  useStaff,
  useTodayStart,
  type SpecimenView,
} from "./use-lab-data"

/**
 * "/lab": the collection worklist (plan §9). Paid specimens awaiting
 * collection at this branch, a second-identifier check before collecting
 * (HAZ-01), and the tube label on the simulated label printer.
 */
export function CollectionScreen() {
  const { t, locale, num } = useLocale()
  const branch = useBranch()
  const tests = useLabTests()
  const waiting = useSpecimens(branch, ["awaiting-collection"])
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [snapshot, setSnapshot] = React.useState<SpecimenView | null>(null)

  const open = (view: SpecimenView) => {
    setSnapshot(view)
    setOpenId(view.specimen.id)
  }
  const live = waiting?.find((v) => v.specimen.id === openId)

  return (
    <LabPage
      branch={branch}
      title={t("lab.collection.title")}
      subtitle={t("lab.collection.subtitle", {
        branch: branchLabel(branch, locale),
      })}
      testId="lab-collection"
    >
      <div className="@container">
        <div className="grid gap-4 @min-[68rem]:grid-cols-[minmax(0,1fr)_19rem]">
          <SectionCard
            size="sm"
            className="self-start"
            icon={TestTube}
            title={t("lab.collection.listTitle")}
            action={
              waiting?.length ? (
                <span className="nums text-sm text-muted-foreground">
                  {num(waiting.length)}
                </span>
              ) : null
            }
          >
            {waiting && !waiting.length ? (
              <EmptyState
                size="sm"
                icon={TestTube}
                title={t("lab.collection.empty")}
                description={t("lab.collection.emptyHint")}
              />
            ) : (
              <div className="@container/table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("lab.common.patient")}</TableHead>
                      <TableHead>{t("lab.common.tests")}</TableHead>
                      <TableHead className="hidden @min-[36rem]/table:table-cell">
                        {t("lab.common.container")}
                      </TableHead>
                      <TableHead className="hidden @min-[46rem]/table:table-cell">
                        {t("lab.common.accession")}
                      </TableHead>
                      <TableHead className="hidden @min-[30rem]/table:table-cell">
                        {t("lab.common.waiting")}
                      </TableHead>
                      <TableHead className="w-0" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(waiting ?? []).map((view) => (
                      <CollectRow
                        key={view.specimen.id}
                        view={view}
                        tests={tests}
                        onCollect={() => open(view)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
          <CollectedToday branch={branch} tests={tests} />
        </div>
      </div>

      <CollectDialog
        view={live ?? snapshot}
        open={!!openId}
        tests={tests}
        onClose={() => setOpenId(null)}
      />
    </LabPage>
  )
}

function CollectRow({
  view,
  tests,
  onCollect,
}: {
  view: SpecimenView
  tests: Map<string, LabTestRow> | undefined
  onCollect: () => void
}) {
  const { t } = useLocale()
  const flash = useFlashOnChange(view.specimen.version)
  return (
    <TableRow
      data-testid="collect-row"
      data-specimen-id={view.specimen.id}
      data-accession={view.specimen.accessionNo}
      className={cn("cursor-pointer", flash)}
      onClick={onCollect}
    >
      <TableCell className="max-w-[16rem]">
        <PatientCell patient={view.patient} />
      </TableCell>
      <TableCell className="whitespace-normal">
        <TestChips testIds={view.items.map((i) => i.testId)} tests={tests} />
        {view.items.some((i) => i.isFreeRecollection) ? (
          <span className="mt-1 block text-[0.6875rem] text-info">
            {t("lab.common.recollection")} · {t("lab.common.free")}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="hidden @min-[36rem]/table:table-cell">
        <ContainerChip container={view.specimen.container} short />
      </TableCell>
      <TableCell
        className="hidden font-mono text-xs @min-[46rem]/table:table-cell"
        lang="en"
      >
        {view.specimen.accessionNo}
      </TableCell>
      <TableCell className="hidden text-muted-foreground @min-[30rem]/table:table-cell">
        <DateText value={view.specimen.createdAt} variant="relative" />
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          data-testid="collect-open"
          onClick={(event) => {
            event.stopPropagation()
            onCollect()
          }}
        >
          {t("lab.collection.collect")}
        </Button>
      </TableCell>
    </TableRow>
  )
}

/** Right rail: what this branch collected today, with a label reprint. */
function CollectedToday({
  branch,
  tests,
}: {
  branch: ReturnType<typeof useBranch>
  tests: Map<string, LabTestRow> | undefined
}) {
  const { t, locale } = useLocale()
  const since = useTodayStart()
  const staff = useStaff()
  const collected = useSpecimens(branch, ["collected", "received"], {
    since,
    sortField: "collectedAt",
    newestFirst: true,
  })
  const print = useLabCommand(printSpecimenLabel)
  return (
    <SectionCard
      size="sm"
      title={t("lab.collection.recentTitle")}
      className="self-start"
    >
      {collected && !collected.length ? (
        <p className="py-4 text-center text-[0.8125rem] text-muted-foreground">
          {t("lab.collection.recentEmpty")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {(collected ?? []).slice(0, 8).map((view) => (
            <li
              key={view.specimen.id}
              className="flex items-center gap-2 border-b border-hairline py-2 last:border-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-medium">
                  {view.patient
                    ? locale === "bn"
                      ? view.patient.nameBn
                      : view.patient.nameEn
                    : "-"}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-mono" lang="en">
                    {view.specimen.accessionNo}
                  </span>
                  <span aria-hidden>·</span>
                  {view.specimen.collectedAt ? (
                    <DateText
                      value={view.specimen.collectedAt}
                      variant="time"
                    />
                  ) : null}
                  <span className="truncate">
                    {staffName(staff, view.specimen.collectedBy, locale)}
                  </span>
                </span>
                <TestChips
                  className="mt-1"
                  testIds={view.items.map((i) => i.testId)}
                  tests={tests}
                />
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("lab.collection.reprint")}
                aria-label={t("lab.collection.reprint")}
                data-testid="label-reprint"
                disabled={print.pending}
                onClick={async () => {
                  const done = await print.run({ specimenId: view.specimen.id })
                  if (done)
                    toast.success(t("lab.collection.dialog.printed"), {
                      description: done.accessionNo,
                    })
                }}
              >
                <Printer />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

/** Collect dialog: identity, tube and tests, second identifier, label, confirm. */
function CollectDialog({
  view,
  open,
  tests,
  onClose,
}: {
  view: SpecimenView | null | undefined
  open: boolean
  tests: Map<string, LabTestRow> | undefined
  onClose: () => void
}) {
  return (
    <Dialog
      open={open && !!view}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <DialogContent className="sm:max-w-2xl" data-testid="collect-dialog">
        {view ? (
          <CollectBody
            key={view.specimen.id}
            view={view}
            tests={tests}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function CollectBody({
  view,
  tests,
  onClose,
}: {
  view: SpecimenView
  tests: Map<string, LabTestRow> | undefined
  onClose: () => void
}) {
  const { t, num } = useLocale()
  const collect = useLabCommand(collectSpecimen)
  const print = useLabCommand(printSpecimenLabel)
  const [secondId, setSecondId] = React.useState("")
  const [mismatch, setMismatch] = React.useState(false)
  const [printed, setPrinted] = React.useState(false)
  const specimen = view.specimen
  const specimenTests = view.items
    .map((i) => tests?.get(i.testId))
    .filter(Boolean) as LabTestRow[]
  const volume = specimenTests.reduce((sum, test) => sum + test.volumeMl, 0)

  const confirm = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!secondId.trim()) return
    setMismatch(false)
    const done = await collect.run(
      { specimenId: specimen.id, secondIdentifier: secondId },
      {
        onRule: (error) => {
          if (error.code !== "LAB_SECOND_ID_MISMATCH") return false
          setMismatch(true)
          return true
        },
      }
    )
    if (done) {
      toast.success(
        t("lab.collection.collectedToast", { accessionNo: done.accessionNo })
      )
      onClose()
    }
  }

  const printLabel = async () => {
    const done = await print.run({ specimenId: specimen.id })
    if (done) setPrinted(true)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("lab.collection.dialog.title")}</DialogTitle>
        <DialogDescription>
          {t("lab.common.accession")}{" "}
          <span className="font-mono text-foreground" lang="en">
            {specimen.accessionNo}
          </span>
        </DialogDescription>
      </DialogHeader>

      <IdentityBanner patientId={specimen.patientId} compact />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">
              {t("lab.collection.dialog.tubes")}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <ContainerChip container={specimen.container} />
              <span className="nums text-xs text-muted-foreground">
                {t("lab.common.volume", { ml: num(volume) })}
              </span>
            </div>
            <ul className="mt-2 flex flex-col gap-0.5 text-[0.8125rem]">
              {specimenTests.map((test) => (
                <li key={test.id} className="flex gap-2">
                  <span
                    className="w-14 shrink-0 font-mono text-xs text-muted-foreground"
                    lang="en"
                  >
                    {test.code}
                  </span>
                  <span className="min-w-0 truncate">{test.name}</span>
                </li>
              ))}
            </ul>
          </div>

          <form onSubmit={confirm} className="flex flex-col gap-1.5">
            <Label htmlFor="collect-second-id">
              {t("lab.collection.dialog.secondId")}
            </Label>
            <Input
              id="collect-second-id"
              data-testid="collect-verify"
              autoComplete="off"
              inputMode="numeric"
              value={secondId}
              aria-invalid={mismatch || undefined}
              placeholder={t("lab.collection.dialog.secondIdPlaceholder")}
              onChange={(event) => {
                setSecondId(event.target.value)
                setMismatch(false)
              }}
            />
            {mismatch ? (
              <p
                role="alert"
                data-testid="collect-mismatch"
                className="flex items-start gap-1.5 text-[0.8125rem] text-destructive"
              >
                <ShieldX className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t("lab.collection.dialog.mismatch")}{" "}
                  <span className="text-muted-foreground">
                    {t("lab.collection.dialog.mismatchAudited")}
                  </span>
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                {t("lab.collection.dialog.secondIdHint")}
              </p>
            )}
          </form>
        </div>

        <div className="flex flex-col items-center gap-2">
          <p className="self-start text-xs text-muted-foreground">
            {t("lab.collection.dialog.label")}
          </p>
          <div className="origin-top scale-90">
            <TubeLabel
              specimen={specimen}
              patient={view.patient}
              tests={specimenTests}
            />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="label-print"
              disabled={print.pending}
              onClick={printLabel}
            >
              <Printer />
              {t("lab.collection.dialog.printLabel")}
            </Button>
            <SimulatedBadge />
          </div>
          <p
            className={cn(
              "max-w-[17rem] text-center text-xs",
              printed ? "font-medium text-success" : "text-muted-foreground"
            )}
            data-testid={printed ? "label-printed" : undefined}
            role={printed ? "status" : undefined}
          >
            {printed
              ? t("lab.collection.dialog.printed")
              : t("lab.collection.dialog.notPrinted")}
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          data-testid="collect-confirm"
          disabled={!secondId.trim() || collect.pending}
          onClick={() => confirm()}
        >
          <TestTube />
          {t("lab.collection.dialog.confirm")}
        </Button>
      </DialogFooter>
    </>
  )
}
