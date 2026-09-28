"use client"

import * as React from "react"
import Link from "next/link"
import { Activity, FlaskConical, PencilLine, Radio } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ageOn, dhakaDate } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import type { LabOrderItemRow, LabTestRow } from "@/core/db/schema"
import { rangeFor } from "@/core/seed/content/analyser-scripts"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import {
  enterManualResults,
  importAnalyserResults,
  TEXT_ANALYTE,
} from "../commands"
import { formatRange, toLatinDigits } from "../logic"
import { useLabCommand } from "./lab-feedback"
import {
  ContainerChip,
  FlagSummary,
  LabPage,
  PatientCell,
  TestChips,
} from "./lab-ui"
import {
  useBranch,
  useItems,
  useLabTests,
  useSpecimens,
  type SpecimenView,
} from "./use-lab-data"

/**
 * "/lab/analyser": pull results from the (simulated) analyser for received
 * specimens, or type them in by hand, which marks them "manual" for a second
 * check at validation (plan §6 `lab.importAnalyser`).
 */
export function AnalyserScreen() {
  const { t } = useLocale()
  const branch = useBranch()
  const tests = useLabTests()
  const received = useSpecimens(branch, ["received"], {
    sortField: "receivedAt",
  })
  const queue = received?.filter((v) =>
    v.items.some((i) => i.status === "received")
  )
  const [manual, setManual] = React.useState<SpecimenView | null>(null)

  return (
    <LabPage
      branch={branch}
      title={t("lab.analyser.title")}
      subtitle={t("lab.analyser.subtitle")}
      testId="lab-analyser"
      actions={
        <span className="flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-medium">
          <Radio className="size-3.5 text-success" />
          {t("lab.analyser.link")}
          <SimulatedBadge className="h-5" />
        </span>
      }
    >
      <SectionCard
        size="sm"
        icon={FlaskConical}
        title={t("lab.analyser.queueTitle")}
      >
        {queue && !queue.length ? (
          <EmptyState
            size="sm"
            icon={FlaskConical}
            title={t("lab.analyser.queueEmpty")}
          />
        ) : (
          <div className="@container/table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("lab.common.patient")}</TableHead>
                  <TableHead>{t("lab.common.tests")}</TableHead>
                  <TableHead className="hidden @min-[44rem]/table:table-cell">
                    {t("lab.common.accession")}
                  </TableHead>
                  <TableHead className="hidden @min-[36rem]/table:table-cell">
                    {t("lab.common.received")}
                  </TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(queue ?? []).map((view) => (
                  <AnalyserRow
                    key={view.specimen.id}
                    view={view}
                    tests={tests}
                    onManual={() => setManual(view)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <AwaitingValidation branch={branch} tests={tests} />

      <Dialog
        open={!!manual}
        onOpenChange={(next) => (!next ? setManual(null) : undefined)}
      >
        <DialogContent className="sm:max-w-xl" data-testid="manual-dialog">
          {manual ? (
            <ManualBody
              key={manual.specimen.id}
              view={manual}
              tests={tests}
              onClose={() => setManual(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </LabPage>
  )
}

function AnalyserRow({
  view,
  tests,
  onManual,
}: {
  view: SpecimenView
  tests: Map<string, LabTestRow> | undefined
  onManual: () => void
}) {
  const { t, num } = useLocale()
  const run = useLabCommand(importAnalyserResults)
  const flash = useFlashOnChange(view.specimen.version)
  const pending = view.items.filter((i) => i.status === "received")
  const runnable = pending.some(
    (i) => (tests?.get(i.testId)?.analytes.length ?? 0) > 0
  )
  return (
    <TableRow
      data-testid="analyser-row"
      data-specimen-id={view.specimen.id}
      className={flash}
    >
      <TableCell className="max-w-[15rem]">
        <PatientCell patient={view.patient} />
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-col gap-1">
          <TestChips testIds={pending.map((i) => i.testId)} tests={tests} />
          <ContainerChip
            container={view.specimen.container}
            short
            className="text-xs text-muted-foreground"
          />
        </div>
      </TableCell>
      <TableCell
        className="hidden font-mono text-xs @min-[44rem]/table:table-cell"
        lang="en"
      >
        {view.specimen.accessionNo}
      </TableCell>
      <TableCell className="hidden text-muted-foreground @min-[36rem]/table:table-cell">
        {view.specimen.receivedAt ? (
          <DateText value={view.specimen.receivedAt} variant="relative" />
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            variant="neutral"
            size="sm"
            data-testid="manual-open"
            onClick={onManual}
          >
            <PencilLine />
            <span className="hidden @min-[40rem]/table:inline">
              {t("lab.analyser.manual")}
            </span>
          </Button>
          <Button
            size="sm"
            data-testid="analyser-run"
            data-specimen-id={view.specimen.id}
            disabled={!runnable || run.pending}
            title={!runnable ? t("lab.analyser.needsManual") : undefined}
            onClick={async () => {
              const done = await run.run({
                specimenId: view.specimen.id,
                expectedVersion: view.specimen.version,
              })
              if (done) {
                toast.success(
                  t("lab.analyser.receivedToast", {
                    accessionNo: view.specimen.accessionNo,
                    count: num(done.resultIds.length),
                  }),
                  {
                    description: t("lab.analyser.summary", {
                      abnormal: num(done.abnormal),
                      critical: num(done.critical),
                    }),
                  }
                )
              }
            }}
          >
            <Activity />
            {t("lab.analyser.run")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Results in and waiting for technical validation, with their flags. */
function AwaitingValidation({
  branch,
  tests,
}: {
  branch: ReturnType<typeof useBranch>
  tests: Map<string, LabTestRow> | undefined
}) {
  const { t, locale } = useLocale()
  const items = useItems(branch, "resulted")
  return (
    <SectionCard
      size="sm"
      title={t("lab.analyser.recentTitle")}
      action={
        <Link
          href="/lab/validation"
          className={buttonVariants({ variant: "link", size: "sm" })}
        >
          {t("lab.analyser.openValidation")}
        </Link>
      }
    >
      {items && !items.length ? (
        <p className="py-3 text-center text-[0.8125rem] text-muted-foreground">
          {t("lab.analyser.recentEmpty")}
        </p>
      ) : (
        <div className="@container">
          <ul className="grid gap-x-6 @min-[40rem]:grid-cols-2">
            {(items ?? []).map((view) => {
              const test = tests?.get(view.item.testId)
              return (
                <li
                  key={view.item.id}
                  className="flex items-center gap-3 border-b border-hairline py-2"
                  data-testid="resulted-item"
                  data-item-id={view.item.id}
                >
                  <span
                    className="w-14 shrink-0 font-mono text-xs font-semibold"
                    lang="en"
                  >
                    {test?.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                    {view.patient
                      ? locale === "bn"
                        ? view.patient.nameBn
                        : view.patient.nameEn
                      : "-"}
                  </span>
                  {view.results.some((r) => r.source === "manual") ? (
                    <span className="text-[0.6875rem] text-info">
                      {t("lab.common.manual")}
                    </span>
                  ) : null}
                  <FlagSummary results={view.results} />
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}

/** Manual entry for one received test of the specimen. */
function ManualBody({
  view,
  tests,
  onClose,
}: {
  view: SpecimenView
  tests: Map<string, LabTestRow> | undefined
  onClose: () => void
}) {
  const { t } = useLocale()
  const save = useLabCommand(enterManualResults)
  const pending = view.items.filter((i) => i.status === "received")
  const [itemId, setItemId] = React.useState<string | undefined>(pending[0]?.id)
  const item = pending.find((i) => i.id === itemId) ?? pending[0]
  const test = item ? tests?.get(item.testId) : undefined

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("lab.analyser.manualDialog.title")}</DialogTitle>
        <DialogDescription>
          {t("lab.analyser.manualDialog.hint")}
        </DialogDescription>
      </DialogHeader>
      <IdentityBanner patientId={view.specimen.patientId} compact />
      {pending.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="tablist">
          {pending.map((i) => {
            const active = i.id === item?.id
            return (
              <button
                key={i.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setItemId(i.id)}
                className={cn(
                  "h-8 rounded-full px-3 font-mono text-xs font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-raised"
                )}
              >
                {tests?.get(i.testId)?.code ?? i.testId}
              </button>
            )
          })}
        </div>
      ) : null}
      {item && test ? (
        <ManualForm
          key={item.id}
          item={item}
          test={test}
          patientSexDob={
            view.patient
              ? { sex: view.patient.sex, dob: view.patient.dob }
              : undefined
          }
          pending={save.pending}
          onCancel={onClose}
          onSave={async (values) => {
            const done = await save.run({
              itemId: item.id,
              expectedVersion: item.version,
              values,
            })
            if (done) {
              toast.success(
                t("lab.analyser.manualDialog.saved", { test: test.code })
              )
              onClose()
            }
          }}
        />
      ) : null}
    </>
  )
}

type ManualValue = { analyteCode: string; value?: number; text?: string }

function ManualForm({
  item,
  test,
  patientSexDob,
  pending,
  onCancel,
  onSave,
}: {
  item: LabOrderItemRow
  test: LabTestRow
  patientSexDob?: { sex: "M" | "F"; dob: string }
  pending: boolean
  onCancel: () => void
  onSave: (values: ManualValue[]) => void
}) {
  const { t } = useLocale()
  const [values, setValues] = React.useState<Record<string, string>>({})
  const age = patientSexDob ? ageOn(patientSexDob.dob, dhakaDate(now())) : 40
  const sex = patientSexDob?.sex ?? "M"
  const template = test.analytes.length === 0

  const parsed: ManualValue[] = template
    ? [{ analyteCode: TEXT_ANALYTE, text: values[TEXT_ANALYTE]?.trim() }]
    : test.analytes.map((a) => {
        const raw = toLatinDigits(values[a.code] ?? "").trim()
        if (a.qualitative)
          return { analyteCode: a.code, text: raw || undefined }
        const n = Number(raw)
        return {
          analyteCode: a.code,
          value: raw && Number.isFinite(n) ? n : undefined,
        }
      })
  const complete = parsed.every((p) => p.value !== undefined || !!p.text)

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="manual-form"
      data-item-id={item.id}
      onSubmit={(event) => {
        event.preventDefault()
        if (complete) onSave(parsed)
      }}
    >
      <p className="text-sm font-medium">
        {test.name}{" "}
        <span className="font-mono text-xs text-muted-foreground" lang="en">
          {test.code}
        </span>
      </p>
      {template ? (
        <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium">
          {t("lab.analyser.manualDialog.reportText")}
          <Textarea
            data-testid="manual-value"
            data-analyte={TEXT_ANALYTE}
            placeholder={t("lab.analyser.manualDialog.reportPlaceholder")}
            value={values[TEXT_ANALYTE] ?? ""}
            onChange={(event) =>
              setValues((v) => ({ ...v, [TEXT_ANALYTE]: event.target.value }))
            }
          />
        </label>
      ) : (
        <div className="grid max-h-[40svh] gap-x-4 gap-y-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {test.analytes.map((a) => {
            const range = rangeFor(a, sex, age)
            return (
              <label
                key={a.code}
                className="flex flex-col gap-1 text-[0.8125rem]"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{a.name}</span>
                  <span
                    className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground"
                    lang="en"
                  >
                    {formatRange(range, a.decimals)} {a.units ?? ""}
                  </span>
                </span>
                <Input
                  className="h-8"
                  data-testid="manual-value"
                  data-analyte={a.code}
                  inputMode={a.qualitative ? "text" : "decimal"}
                  placeholder={a.qualitative ? (range?.text ?? "") : ""}
                  value={values[a.code] ?? ""}
                  onChange={(event) =>
                    setValues((v) => ({ ...v, [a.code]: event.target.value }))
                  }
                />
              </label>
            )
          })}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          data-testid="manual-save"
          disabled={!complete || pending}
          title={!complete ? t("lab.analyser.manualDialog.missing") : undefined}
        >
          {t("lab.analyser.manualDialog.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}
