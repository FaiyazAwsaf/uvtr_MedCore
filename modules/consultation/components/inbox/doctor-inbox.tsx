"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowRightLeft,
  BellRing,
  Check,
  ChevronDown,
  FileWarning,
  FlaskConical,
  Inbox,
  Info,
  PlusCircle,
  Siren,
  Truck,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { nameIn } from "@/components/shared/person"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, StatusText, type Tone } from "@/components/shared/status"
import { UhidText } from "@/components/shared/uhid-text"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDb, useDbInfo } from "@/core/db/DbProvider"
import type {
  BrandRow,
  InboxItemRow,
  LabTestRow,
  PatientRow,
  ResultRow,
  RxLineRow,
  SubstitutionRequestRow,
  TransferRow,
} from "@/core/db/schema"
import { stockByBranch } from "@/core/stock/availability"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { decideSubstitution } from "@/modules/prescribing/commands"
import { branchName } from "@/modules/prescribing/components/stock"

import { acknowledgeInboxItem, readInboxItem } from "../../commands"
import { useDoctor, useLabCatalog } from "../data"
import { analyteName, FLAG_TONE } from "../encounter/patient-summary"
import { useClinicalCommand } from "../use-clinical-command"

type Filter =
  | "all"
  | "unread"
  | "results"
  | "critical"
  | "corrected"
  | "substitution"
  | "transfers"
const RESULT_KINDS: InboxItemRow["kind"][] = [
  "result",
  "abnormal",
  "critical",
  "corrected",
  "add-on",
]

const KIND_META: Record<
  InboxItemRow["kind"],
  { icon: LucideIcon; tone: Tone }
> = {
  result: { icon: FlaskConical, tone: "muted" },
  abnormal: { icon: FileWarning, tone: "warning" },
  critical: { icon: Siren, tone: "destructive" },
  corrected: { icon: BellRing, tone: "info" },
  substitution: { icon: ArrowRightLeft, tone: "primary" },
  transfer: { icon: Truck, tone: "info" },
  "add-on": { icon: PlusCircle, tone: "info" },
  info: { icon: Info, tone: "muted" },
}

const STATUS_TONE: Record<InboxItemRow["status"], Tone> = {
  unread: "primary",
  read: "muted",
  acknowledged: "success",
  actioned: "success",
}

export const kindKey = (kind: InboxItemRow["kind"]) =>
  `consultation.inbox.kind.${kind === "add-on" ? "addOn" : kind}`

/**
 * The doctor's inbox (plan §9 `/doctor/inbox`): results (unread, abnormal,
 * critical, corrected) with acknowledgement, the pharmacy's substitution
 * requests to approve or reject, and updates on stock transfers the doctor
 * asked for. Everything arrives live from the other windows.
 */
export function DoctorInbox() {
  const { t, num } = useLocale()
  const db = useDb()
  const { doctor, staffId } = useDoctor()
  const labs = useLabCatalog()
  const [filter, setFilter] = React.useState<Filter>("all")

  const data = useLiveQuery(async () => {
    if (!doctor) return null
    const items = (
      await db.inboxItems.where("doctorId").equals(doctor.id).toArray()
    ).sort((a, b) => b.createdAt - a.createdAt)
    const patientIds = [
      ...new Set(items.map((i) => i.patientId).filter(Boolean) as string[]),
    ]
    const patients = new Map(
      (await db.patients.bulkGet(patientIds))
        .filter(Boolean)
        .map((p) => [p!.id, p!])
    )
    const transfers = staffId
      ? (await db.transfers.toArray())
          .filter(
            (tr) =>
              tr.requestedBy === staffId && tr.requestedFrom === "doctor-prompt"
          )
          .sort((a, b) => b.createdAt - a.createdAt)
      : []
    return { items, patients, transfers }
  }, [db, doctor?.id, staffId])

  if (!data) {
    return <EmptyState icon={Inbox} title={t("common.loading")} />
  }

  const items = data.items
  const count = (f: Filter) => items.filter((i) => matches(i, f)).length
  const shown = items.filter((i) => matches(i, filter))
  const options: { value: Filter; label: string; count?: string }[] = (
    [
      "all",
      "unread",
      "results",
      "critical",
      "corrected",
      "substitution",
      "transfers",
    ] as Filter[]
  ).map((value) => ({
    value,
    label: t(`consultation.inbox.filters.${value}`),
    count: value === "all" ? undefined : num(count(value)),
  }))

  return (
    <div className="flex flex-col gap-5" data-testid="doctor-inbox">
      <header>
        <h1 className="text-[1.375rem] leading-tight font-semibold">
          {t("consultation.inbox.title")}
        </h1>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">
          {t("consultation.inbox.subtitle")}
        </p>
      </header>

      <SegmentedPills
        size="sm"
        value={filter}
        onChange={setFilter}
        options={options}
        className="flex-wrap"
      />

      <div className="@container/inbox">
        <div className="grid items-start gap-5 @min-[74rem]/inbox:grid-cols-[minmax(0,1fr)_20rem]">
          <SectionCard
            size="sm"
            icon={Inbox}
            title={t(`consultation.inbox.filters.${filter}`)}
          >
            {shown.length ? (
              <ul className="flex flex-col" data-testid="inbox-list">
                {shown.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    patient={
                      item.patientId
                        ? data.patients.get(item.patientId)
                        : undefined
                    }
                    tests={labs?.byId}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                size="sm"
                icon={Inbox}
                title={t("consultation.inbox.empty")}
                description={t("consultation.inbox.emptyHint")}
              />
            )}
          </SectionCard>
          <TransferUpdates transfers={data.transfers} />
        </div>
      </div>
    </div>
  )
}

function matches(item: InboxItemRow, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true
    case "unread":
      return item.status === "unread"
    case "results":
      return RESULT_KINDS.includes(item.kind)
    case "critical":
      return item.kind === "critical"
    case "corrected":
      return item.kind === "corrected"
    case "substitution":
      return item.kind === "substitution"
    case "transfers":
      return item.kind === "transfer"
  }
}

function InboxRow({
  item,
  patient,
  tests,
}: {
  item: InboxItemRow
  patient?: PatientRow
  tests?: Map<string, LabTestRow>
}) {
  const { t, tk, locale, time } = useLocale()
  const [open, setOpen] = React.useState(
    item.kind === "substitution" && item.status !== "actioned"
  )
  const read = useClinicalCommand(readInboxItem)
  const ack = useClinicalCommand(acknowledgeInboxItem)
  const flash = useFlashOnChange(item.version)
  const meta = KIND_META[item.kind]
  const Icon = meta.icon
  const title = tk(item.titleKey, item.params)
  const label = title === item.titleKey ? tk(kindKey(item.kind)) : title
  const isResult = RESULT_KINDS.includes(item.kind)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && item.status === "unread")
      void read.run({ inboxItemId: item.id }, { quiet: true })
  }
  const onAck = async () => {
    const out = await ack.run({ inboxItemId: item.id })
    if (out.ok) toast.success(t("consultation.inbox.ackedToast"))
  }

  return (
    <li
      className={cn("border-b border-hairline py-3 last:border-0", flash)}
      data-testid="inbox-item"
      data-kind={item.kind}
      data-status={item.status}
      data-inbox-id={item.id}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            meta.tone === "destructive"
              ? "bg-[color-mix(in_oklch,var(--destructive)_16%,transparent)] text-destructive"
              : meta.tone === "warning"
                ? "bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] text-warning"
                : "icon-well text-link"
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "text-[0.875rem]",
                item.status === "unread" ? "font-bold" : "font-semibold"
              )}
            >
              {label}
            </span>
            <StatusText tone={STATUS_TONE[item.status]} dot className="text-xs">
              {tk(`consultation.inbox.status.${item.status}`)}
            </StatusText>
          </div>
          {patient ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/85">
                {nameIn(patient, locale)}
              </span>
              <UhidText uhid={patient.uhid} className="text-[0.6875rem]" />
            </div>
          ) : null}
          <div className="mt-0.5 text-xs text-muted-foreground">
            <DateText value={item.createdAt} variant="relative" />
            {item.ackAt
              ? ` · ${t("consultation.inbox.acked", { time: time(item.ackAt) })}`
              : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isResult &&
          item.status !== "acknowledged" &&
          item.status !== "actioned" ? (
            <Button
              size="xs"
              onClick={onAck}
              disabled={ack.pending}
              data-testid="inbox-ack"
            >
              <Check />
              {t("consultation.inbox.ack")}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            onClick={toggle}
            aria-expanded={open}
            data-testid="inbox-toggle"
          >
            {open
              ? t("consultation.inbox.close")
              : t("consultation.inbox.open")}
            <ChevronDown
              className={cn("transition-transform", open && "rotate-180")}
            />
          </Button>
        </div>
      </div>
      {open ? (
        <div className="mt-3 pl-12">
          {item.kind === "substitution" ? (
            <SubstitutionCard item={item} />
          ) : isResult ? (
            <ResultDetails item={item} tests={tests} />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function ResultDetails({
  item,
  tests,
}: {
  item: InboxItemRow
  tests?: Map<string, LabTestRow>
}) {
  const { t, tk } = useLocale()
  const db = useDb()
  const data = useLiveQuery(async () => {
    const report = item.refs.reportId
      ? await db.labReports.get(item.refs.reportId)
      : undefined
    let results: ResultRow[] = []
    if (report) {
      results = await db.results
        .where("labOrderItemId")
        .anyOf(report.itemIds)
        .toArray()
    } else if (item.refs.resultId) {
      const r = await db.results.get(item.refs.resultId)
      results = r ? [r] : []
    }
    const imaging = item.refs.imagingOrderId
      ? await db.imagingOrders.get(item.refs.imagingOrderId)
      : undefined
    const imagingReport = imaging?.reportId
      ? await db.imagingReports.get(imaging.reportId)
      : undefined
    return { report, results, imaging, imagingReport }
  }, [
    db,
    item.id,
    item.refs.reportId,
    item.refs.resultId,
    item.refs.imagingOrderId,
  ])

  if (!data) return null
  const { report, results, imaging, imagingReport } = data
  if (!report && !results.length && !imaging) {
    return (
      <p className="text-[0.8125rem] text-muted-foreground">
        {t("consultation.inbox.noReport")}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2" data-testid="inbox-result">
      {report ? (
        <div className="text-xs text-muted-foreground">
          <span className="font-mono" lang="en">
            {t("consultation.inbox.report", {
              reportNo: report.reportNo,
              version: report.reportVersion,
            })}
          </span>
          {report.supersedesId || report.reportVersion > 1 ? (
            <div className="mt-1 rounded-md bg-[color-mix(in_oklch,var(--info)_14%,transparent)] px-2.5 py-1.5 text-info">
              {t("consultation.inbox.reportCorrected", {
                version: report.reportVersion,
              })}
              {report.correctionReason ? (
                <div>
                  {t("consultation.inbox.correctionReason", {
                    reason: report.correctionReason,
                  })}
                </div>
              ) : null}
              {report.changeSummary ? (
                <div>
                  {t("consultation.inbox.changeSummary", {
                    summary: report.changeSummary,
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {results.length ? (
        <table className="w-full text-[0.8125rem]">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">
                {t("consultation.inbox.analyte")}
              </th>
              <th className="py-1 font-medium">
                {t("consultation.inbox.value")}
              </th>
              <th className="py-1 font-medium">
                {t("consultation.inbox.flag")}
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.id}
                className={cn(
                  "border-t border-hairline",
                  r.critical && "text-destructive"
                )}
              >
                <td className="py-1" lang="en">
                  {analyteName(tests?.get(r.testId), r.analyteCode)}
                </td>
                <td className="nums py-1 font-medium" lang="en">
                  {r.value ?? r.text} {r.unit}
                </td>
                <td className="py-1">
                  {r.flag !== "N" ? (
                    <StatusPill
                      tone={FLAG_TONE[r.flag]}
                      className="h-5 px-2 text-[0.6875rem]"
                    >
                      {tk(`consultation.summary.flags.${r.flag}`)}
                    </StatusPill>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {tk("consultation.summary.flags.N")}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {imaging ? (
        <p className="text-[0.8125rem]">
          {t("consultation.inbox.imagingReport", {
            name: tests?.get(imaging.testId)?.name ?? imaging.orderNo,
          })}
          {imagingReport?.summary ? (
            <span className="text-muted-foreground">
              {" "}
              · {imagingReport.summary}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

type SubData = {
  sub: SubstitutionRequestRow
  line?: RxLineRow
  from?: BrandRow
  to?: BrandRow
  rxNo?: string
  requester?: string
  onHand: number
}

function SubstitutionCard({ item }: { item: InboxItemRow }) {
  const { t, tk, num, locale } = useLocale()
  const db = useDb()
  const { isEdge } = useDbInfo()
  const decide = useClinicalCommand(decideSubstitution)
  const [note, setNote] = React.useState("")

  const data = useLiveQuery(async (): Promise<SubData | null> => {
    const id = item.refs.substitutionId
    const sub = id ? await db.substitutionRequests.get(id) : undefined
    if (!sub) return null
    const [line, to, rx, staff] = await Promise.all([
      db.rxLines.get(sub.rxLineId),
      db.brands.get(sub.proposedBrandId),
      db.prescriptions.get(sub.rxId),
      db.staff.get(sub.requestedBy),
    ])
    const from = line?.brandId ? await db.brands.get(line.brandId) : undefined
    const [levels, reorder] = await Promise.all([
      db.stockLevels.where("brandId").equals(sub.proposedBrandId).toArray(),
      db.reorderLevels.where("brandId").equals(sub.proposedBrandId).toArray(),
    ])
    const onHand = stockByBranch(sub.proposedBrandId, levels, reorder)[
      sub.branchId
    ].onHand
    return {
      sub,
      line,
      from,
      to,
      rxNo: rx?.rxNo,
      requester: staff
        ? locale === "bn"
          ? staff.nameBn
          : staff.nameEn
        : undefined,
      onHand,
    }
  }, [db, item.refs.substitutionId, locale])

  if (!data)
    return (
      <p className="text-[0.8125rem] text-muted-foreground">
        {t("consultation.inbox.noReport")}
      </p>
    )
  const { sub, line, from, to } = data
  const pending = sub.status === "pending"

  const run = async (decision: "approve" | "reject") => {
    const text =
      note.trim() ||
      (decision === "reject"
        ? t("consultation.inbox.substitution.defaultReject")
        : undefined)
    const out = await decide.run({
      substitutionId: sub.id,
      decision,
      note: text,
    })
    if (out.ok) {
      if (out.result.decision === "approved") {
        toast.success(
          t("consultation.inbox.substitution.approved", {
            rxNo: out.result.rxNo,
            version:
              out.result.decision === "approved" ? out.result.rxVersion : 1,
          })
        )
      } else {
        toast(t("consultation.inbox.substitution.rejected"))
      }
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border/70 p-3"
      data-testid="substitution-card"
    >
      <div className="text-[0.8125rem] font-semibold">
        {t("consultation.inbox.substitution.title")}
      </div>
      <div className="grid gap-2 @min-[34rem]/inbox:grid-cols-2">
        <div className="rounded-md bg-surface-raised px-3 py-2">
          <div className="text-xs text-muted-foreground">
            {t("consultation.inbox.substitution.prescribed")}
          </div>
          <div className="text-[0.8125rem] font-semibold" lang="en">
            {from
              ? `${from.name} ${from.strength}`
              : (line?.nonDictionaryName ?? "")}
          </div>
          {line ? (
            <div className="text-xs" lang="bn">
              {line.instructionsBn}
            </div>
          ) : null}
          {data.rxNo ? (
            <div
              className="font-mono text-[0.6875rem] text-muted-foreground"
              lang="en"
            >
              {data.rxNo}
            </div>
          ) : null}
        </div>
        <div className="rounded-md bg-primary-soft px-3 py-2">
          <div className="text-xs text-muted-foreground">
            {t("consultation.inbox.substitution.proposed")}
          </div>
          <div className="text-[0.8125rem] font-semibold" lang="en">
            {to ? `${to.name} ${to.strength}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("consultation.inbox.substitution.stock", {
              branch: branchName(sub.branchId, locale),
            })}
            : {isEdge ? "-" : num(data.onHand)}
          </div>
        </div>
      </div>
      <div className="text-[0.8125rem]">
        <span className="text-muted-foreground">
          {t("consultation.inbox.substitution.reason")}:{" "}
        </span>
        {sub.reason}
      </div>
      {data.requester ? (
        <div className="text-xs text-muted-foreground">
          {t("consultation.inbox.substitution.requestedBy", {
            name: data.requester,
            branch: `${branchName(sub.branchId, locale)} (${sub.branchId})`,
          })}
        </div>
      ) : null}
      {pending ? (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("consultation.inbox.substitution.note")}
            </span>
            <Textarea
              value={note}
              className="min-h-12 text-[0.8125rem]"
              placeholder={t("consultation.inbox.substitution.notePlaceholder")}
              data-testid="substitution-note"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <p className="text-[0.6875rem] text-muted-foreground">
            {t("consultation.inbox.substitution.onlyDoctor")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="destructive-outline"
              onClick={() => run("reject")}
              disabled={decide.pending}
              data-testid="substitution-reject"
            >
              {t("consultation.inbox.substitution.reject")}
            </Button>
            <Button
              size="sm"
              onClick={() => run("approve")}
              disabled={decide.pending}
              data-testid="substitution-approve"
            >
              <Check />
              {t("consultation.inbox.substitution.approve")}
            </Button>
          </div>
        </>
      ) : (
        <div
          className="text-[0.8125rem]"
          data-testid="substitution-decision"
          data-status={sub.status}
        >
          {t("consultation.inbox.substitution.decided", {
            decision: tk(
              `consultation.inbox.substitution.decisions.${sub.status}`
            ),
          })}
          {sub.decisionNote ? (
            <span className="text-muted-foreground"> · {sub.decisionNote}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

function TransferUpdates({ transfers }: { transfers: TransferRow[] }) {
  const { t, tk, num, locale } = useLocale()
  const db = useDb()
  const lines = useLiveQuery(async () => {
    const ids = transfers.map((tr) => tr.id)
    const rows = ids.length
      ? await db.transferLines.where("transferId").anyOf(ids).toArray()
      : []
    const brands = new Map(
      (await db.brands.bulkGet([...new Set(rows.map((r) => r.brandId))]))
        .filter(Boolean)
        .map((b) => [b!.id, b!])
    )
    return rows.map((r) => ({ ...r, brand: brands.get(r.brandId) }))
  }, [db, transfers.map((tr) => `${tr.id}:${tr.version}`).join(",")])

  return (
    <SectionCard
      size="sm"
      icon={Truck}
      title={t("consultation.inbox.transfers.title")}
      subtitle={t("consultation.inbox.transfers.subtitle")}
    >
      {transfers.length ? (
        <ul className="flex flex-col" data-testid="transfer-updates">
          {transfers.map((tr) => (
            <li
              key={tr.id}
              className="border-b border-hairline py-2 last:border-0"
              data-testid="transfer-update"
              data-status={tr.status}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="font-mono text-[0.8125rem] font-semibold"
                  lang="en"
                >
                  {tr.transferNo}
                </span>
                <StatusText
                  tone={
                    tr.status === "received"
                      ? "success"
                      : tr.status === "cancelled"
                        ? "muted"
                        : "info"
                  }
                  dot
                  className="text-xs"
                >
                  {tk(`consultation.inbox.transfers.status.${tr.status}`)}
                </StatusText>
              </div>
              <div className="text-xs text-muted-foreground">
                {t("consultation.inbox.transfers.route", {
                  from: `${branchName(tr.fromBranchId, locale)} (${tr.fromBranchId})`,
                  to: `${branchName(tr.toBranchId, locale)} (${tr.toBranchId})`,
                })}
              </div>
              {(lines ?? [])
                .filter((l) => l.transferId === tr.id)
                .map((l) => (
                  <div key={l.id} className="text-xs" lang="en">
                    {t("consultation.inbox.transfers.line", {
                      qty: num(l.qtyRequested),
                      item: l.brand
                        ? `${l.brand.name} ${l.brand.strength}`
                        : l.brandId,
                    })}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t("consultation.inbox.transfers.empty")}
        </p>
      )}
    </SectionCard>
  )
}
