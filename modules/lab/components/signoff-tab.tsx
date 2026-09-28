"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { BadgeCheck, Lock, Microscope, Send, Siren } from "lucide-react"
import { labToast as toast } from "./lab-toast"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusPill } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import type { BranchCode } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type {
  LabOrderItemRow,
  LabTestRow,
  PatientRow,
  ResultRow,
} from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { releaseReport, signAndRelease } from "../commands"
import { useLabCommand } from "./lab-feedback"
import { FlagSummary, ResultsTable, TestChips } from "./lab-ui"
import {
  loadReportViews,
  staffName,
  useDoctorStaff,
  useItems,
  useLabTests,
  usePatientHistory,
  type ItemView,
  type ReportView,
} from "./use-lab-data"

type Entry =
  | {
      kind: "ready"
      key: string
      orderId: string
      patient?: PatientRow
      views: ItemView[]
      at: number
    }
  | {
      kind: "held"
      key: string
      orderId: string
      patient?: PatientRow
      held: ReportView
      results: ResultRow[]
      at: number
    }

/** Signed reports at the branch that are not released (held for payment). */
function useHeld(branch: BranchCode) {
  const db = useDb()
  return useLiveQuery(async () => {
    const signed = (
      await db.labReports.where("status").equals("signed").toArray()
    ).filter((r) => r.branchId === branch)
    const views = await loadReportViews(db, signed)
    const ids = views.flatMap((v) => v.report.itemIds)
    const results = ids.length
      ? await db.results.where("labOrderItemId").anyOf(ids).toArray()
      : []
    return views.map((view) => ({
      view,
      results: results.filter((r) =>
        view.report.itemIds.includes(r.labOrderItemId)
      ),
    }))
  }, [db, branch])
}

/**
 * The pathologist's sign-off queue by order: validated results ready to sign
 * (signed and released in one step when paid), and signed reports held for
 * payment, released once every test is paid.
 */
export function SignoffTab({ branch }: { branch: BranchCode }) {
  const { t } = useLocale()
  const tests = useLabTests()
  const validated = useItems(branch, "validated")
  const held = useHeld(branch)
  const [selectedOrder, setSelectedOrder] = React.useState<string | null>(null)

  const ready: Entry[] = React.useMemo(() => {
    const byOrder = new Map<string, ItemView[]>()
    for (const view of validated ?? []) {
      const list = byOrder.get(view.item.labOrderId) ?? []
      list.push(view)
      byOrder.set(view.item.labOrderId, list)
    }
    return [...byOrder.entries()].map(([orderId, views]) => ({
      kind: "ready" as const,
      key: `ready:${orderId}`,
      orderId,
      patient: views[0]?.patient,
      views,
      at: Math.min(...views.map((v) => v.item.updatedAt)),
    }))
  }, [validated])
  const heldEntries: Entry[] = React.useMemo(
    () =>
      (held ?? []).map(({ view, results }) => ({
        kind: "held" as const,
        key: `held:${view.report.id}`,
        orderId: view.report.labOrderId,
        patient: view.patient,
        held: view,
        results,
        at: view.report.signedAt ?? view.report.createdAt,
      })),
    [held]
  )

  const all = [...ready, ...heldEntries]
  const selected =
    ready.find((e) => e.orderId === selectedOrder) ??
    heldEntries.find((e) => e.orderId === selectedOrder) ??
    all[0]
  const loading = validated === undefined || held === undefined

  if (!loading && !all.length) {
    return (
      <SectionCard size="sm" title={t("lab.signoff.queueTitle")}>
        <EmptyState
          size="sm"
          icon={Microscope}
          title={t("lab.signoff.queueEmpty")}
        />
      </SectionCard>
    )
  }

  return (
    <div className="@container">
      <div className="grid gap-4 @min-[50rem]:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4 self-start">
          <SectionCard
            size="sm"
            title={t("lab.signoff.queueTitle")}
            bodyClassName="-mx-2"
          >
            {ready.length ? (
              <ul className="flex flex-col gap-0.5 @max-[50rem]:max-h-44 @max-[50rem]:overflow-y-auto">
                {ready.map((entry) => (
                  <EntryRow
                    key={entry.key}
                    entry={entry}
                    tests={tests}
                    selected={selected?.key === entry.key}
                    onSelect={() => setSelectedOrder(entry.orderId)}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-2 py-2 text-[0.8125rem] text-muted-foreground">
                {t("lab.signoff.queueEmpty")}
              </p>
            )}
          </SectionCard>
          {heldEntries.length ? (
            <SectionCard
              size="sm"
              title={t("lab.signoff.heldTitle")}
              bodyClassName="-mx-2"
            >
              <ul className="flex flex-col gap-0.5">
                {heldEntries.map((entry) => (
                  <EntryRow
                    key={entry.key}
                    entry={entry}
                    tests={tests}
                    selected={selected?.key === entry.key}
                    onSelect={() => setSelectedOrder(entry.orderId)}
                  />
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>
        {selected ? (
          selected.kind === "ready" ? (
            <ReadyDetail key={selected.key} entry={selected} tests={tests} />
          ) : (
            <HeldDetail key={selected.key} entry={selected} tests={tests} />
          )
        ) : (
          <SectionCard size="sm" title={t("lab.signoff.selectHint")} />
        )}
      </div>
    </div>
  )
}

function EntryRow({
  entry,
  tests,
  selected,
  onSelect,
}: {
  entry: Entry
  tests: Map<string, LabTestRow> | undefined
  selected: boolean
  onSelect: () => void
}) {
  const { t, locale } = useLocale()
  const results =
    entry.kind === "ready"
      ? entry.views.flatMap((v) => v.results)
      : entry.results
  const testIds =
    entry.kind === "ready"
      ? entry.views.map((v) => v.item.testId)
      : entry.held.items.map((i) => i.testId)
  const flash = useFlashOnChange(entry.at)
  return (
    <li>
      <button
        type="button"
        data-testid="signoff-row"
        data-order-id={entry.orderId}
        data-report-id={
          entry.kind === "held" ? entry.held.report.id : undefined
        }
        data-kind={entry.kind}
        aria-current={selected || undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
          selected ? "bg-primary-soft" : "hover:bg-surface-raised",
          flash
        )}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
            {entry.patient
              ? locale === "bn"
                ? entry.patient.nameBn
                : entry.patient.nameEn
              : "-"}
          </span>
          <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
            <DateText value={entry.at} variant="relative" />
          </span>
        </span>
        <TestChips testIds={testIds} tests={tests} />
        {entry.kind === "held" ? (
          <span className="flex items-center gap-1 text-[0.6875rem] font-medium text-warning">
            <Lock className="size-3" />
            {t("lab.signoff.held")}
          </span>
        ) : (
          <FlagSummary results={results} />
        )}
      </button>
    </li>
  )
}

/** Header lines shared by the ready and held details. */
function OrderMeta({
  orderNo,
  doctorId,
  urgent,
}: {
  orderNo?: string
  doctorId?: string
  urgent?: boolean
}) {
  const { t, locale } = useLocale()
  const doctors = useDoctorStaff()
  const doctor = doctorId ? staffName(doctors, doctorId, locale) : undefined
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        {t("lab.common.orderNo")}{" "}
        <span className="font-mono" lang="en">
          {orderNo ?? "-"}
        </span>
      </span>
      <span aria-hidden>·</span>
      <span>
        {doctor
          ? t("lab.common.orderedBy", { doctor })
          : t("lab.common.walkIn")}
      </span>
      {urgent ? (
        <StatusPill tone="destructive" className="h-5 px-2 text-[0.6875rem]">
          {t("lab.common.urgent")}
        </StatusPill>
      ) : null}
    </span>
  )
}

function TestBlocks({
  items,
  results,
  tests,
  patient,
}: {
  items: LabOrderItemRow[]
  results: ResultRow[]
  tests: Map<string, LabTestRow> | undefined
  patient?: PatientRow
}) {
  const history = usePatientHistory(patient?.id)
  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => {
        const test = tests?.get(item.testId)
        if (!test) return null
        return (
          <div
            key={item.id}
            className="flex flex-col gap-1.5"
            data-item-id={item.id}
          >
            <p className="flex items-baseline gap-2 text-[0.875rem] font-semibold">
              {test.name}
              <span
                className="font-mono text-xs font-normal text-muted-foreground"
                lang="en"
              >
                {test.code}
              </span>
            </p>
            <ResultsTable
              test={test}
              results={results.filter((r) => r.labOrderItemId === item.id)}
              patient={patient}
              history={history}
              showPrevious
            />
          </div>
        )
      })}
    </div>
  )
}

function ReadyDetail({
  entry,
  tests,
}: {
  entry: Extract<Entry, { kind: "ready" }>
  tests: Map<string, LabTestRow> | undefined
}) {
  const { t, locale, num } = useLocale()
  const db = useDb()
  const sign = useLabCommand(signAndRelease)
  const order = entry.views[0]?.order
  const onOrder = useLiveQuery(
    () => db.labOrderItems.where("labOrderId").equals(entry.orderId).toArray(),
    [db, entry.orderId]
  )
  const readyIds = new Set(entry.views.map((v) => v.item.id))
  const pending = (onOrder ?? []).filter(
    (i) =>
      !readyIds.has(i.id) &&
      ["paid", "collected", "received", "resulted", "ordered"].includes(
        i.status
      )
  )
  const results = entry.views.flatMap((v) => v.results)
  const critical = results.some((r) => r.critical)

  const confirm = async () => {
    const done = await sign.run({
      labOrderId: entry.orderId,
      itemIds: entry.views.map((v) => v.item.id),
      smsLang: locale,
    })
    if (!done) return
    if (done.released)
      toast.success(t("lab.signoff.signedToast", { reportNo: done.reportNo }))
    else toast.warning(t("lab.signoff.heldToast", { reportNo: done.reportNo }))
  }

  return (
    <SectionCard
      size="sm"
      title={
        <OrderMeta
          orderNo={order?.orderNo}
          doctorId={order?.doctorId}
          urgent={order?.priority === "urgent"}
        />
      }
      className="min-w-0"
    >
      <div
        className="flex flex-col gap-3"
        data-testid="signoff-detail"
        data-order-id={entry.orderId}
      >
        <IdentityBanner patientId={entry.views[0]?.item.patientId} compact />
        {critical ? (
          <p className="flex items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] px-3 py-2 text-[0.8125rem] text-destructive">
            <Siren className="size-4 shrink-0" />
            {t("lab.validation.criticalNotice")}
          </p>
        ) : null}
        <TestBlocks
          items={entry.views.map((v) => v.item)}
          results={results}
          tests={tests}
          patient={entry.patient}
        />
        {pending.length ? (
          <p className="text-xs text-muted-foreground">
            {t("lab.signoff.pendingItems", { count: num(pending.length) })}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
          <p className="flex max-w-[48ch] items-start gap-2 text-xs text-muted-foreground">
            <Send className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("lab.signoff.delivery")}{" "}
              <SimulatedBadge className="ml-1 h-5 align-middle" />
            </span>
          </p>
          <Button
            data-testid="signoff-sign"
            disabled={sign.pending}
            onClick={confirm}
          >
            <BadgeCheck />
            {t("lab.signoff.sign")}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

function HeldDetail({
  entry,
  tests,
}: {
  entry: Extract<Entry, { kind: "held" }>
  tests: Map<string, LabTestRow> | undefined
}) {
  const { t, locale } = useLocale()
  const release = useLabCommand(releaseReport)
  const { report, items, order } = entry.held
  const unpaid = items.filter((i) => !i.paymentCleared)
  const unpaidCodes = unpaid
    .map((i) => tests?.get(i.testId)?.code ?? i.testId)
    .join(", ")

  const confirm = async () => {
    const done = await release.run({
      reportId: report.id,
      expectedVersion: report.version,
      smsLang: locale,
    })
    if (done)
      toast.success(
        t("lab.signoff.releasedToast", { reportNo: report.reportNo })
      )
  }

  return (
    <SectionCard
      size="sm"
      title={<OrderMeta orderNo={order?.orderNo} doctorId={order?.doctorId} />}
      className="min-w-0"
    >
      <div
        className="flex flex-col gap-3"
        data-testid="signoff-detail"
        data-order-id={entry.orderId}
        data-report-id={report.id}
      >
        <IdentityBanner patientId={report.patientId} compact />
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm" lang="en">
            {report.reportNo}
          </span>
          <StatusPill tone="warning" data-testid="report-held">
            <Lock />
            {t("lab.signoff.held")}
          </StatusPill>
          {unpaid.length ? (
            <span className="text-xs text-muted-foreground">
              {t("lab.signoff.unpaid", { tests: unpaidCodes })}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("lab.signoff.heldHint")}
        </p>
        <TestBlocks
          items={items}
          results={entry.results}
          tests={tests}
          patient={entry.patient}
        />
        <div className="flex justify-end border-t border-hairline pt-3">
          <Button
            data-testid="signoff-release"
            disabled={release.pending}
            onClick={confirm}
          >
            <Send />
            {t("lab.signoff.release")}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}
