"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowRight, CircleAlert, FileWarning, PackageCheck, Tags } from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { ReportSafetyConcernButton } from "@/components/shared/report-safety-concern"
import { Skeleton } from "@/components/ui/skeleton"
import { Button, buttonVariants } from "@/components/ui/button"
import type { BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import type { DispenseRow } from "@/core/db/schema"
import { useMediaQuery } from "@/hooks/use-media-query"
import type { Locale } from "@/lib/i18n/config"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { requestTransfer } from "@/modules/inventory/commands"

import { dispense, sendToCashier } from "../../commands"
import type { LabelInput } from "../../label"
import { shownQueueStatus, type IdentityMatch } from "../../rules"
import {
  branchName,
  PageBody,
  PageHeader,
  QueueStatusPill,
  useActionKey,
  useModuleCommand,
  usePharmacyContext,
} from "../shared"
import { IdentityCheck } from "./identity-check"
import { DispenseLabel } from "./label-preview"
import { BoughtElsewhereDialog, SubstitutionDialog } from "./line-dialogs"
import { defaultChoice, LineCard, lineFacts, type LineChoice } from "./line-card"
import { useDispenseData, type DispenseData, type LineData } from "./use-dispense-data"

export function DispenseScreen() {
  const params = useParams<{ rxId: string }>()
  const rxId = decodeURIComponent(params.rxId ?? "")
  const { t, locale } = useLocale()
  const { branch, isEdge } = usePharmacyContext()
  const data = useDispenseData(rxId, branch)

  if (!branch) {
    return (
      <PageBody>
        <EmptyState icon={CircleAlert} title={t("pharmacy.common.noBranch")} />
      </PageBody>
    )
  }
  if (data === undefined) {
    return (
      <PageBody>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </PageBody>
    )
  }
  if (data === null) {
    return (
      <PageBody>
        <PageHeader
          title={t("pharmacy.dispense.notFound")}
          back={{ href: "/pharmacy", label: t("pharmacy.dispense.back") }}
        />
        <EmptyState
          icon={FileWarning}
          title={t("pharmacy.dispense.notFound")}
          description={t("pharmacy.dispense.notFoundHint")}
          action={{ label: t("pharmacy.dispense.back"), href: "/pharmacy" }}
        />
      </PageBody>
    )
  }
  return (
    <DispenseView key={data.rx.id} data={data} branch={branch} locale={locale} isEdge={isEdge} />
  )
}

type LabelGroup = { key: string; input: LabelInput; ids: string[] }

/** One label per line per dispense commit (rows of one commit share `createdAt`). */
function labelGroups(data: DispenseData): LabelGroup[] {
  const groups = new Map<string, DispenseRow[]>()
  for (const row of data.dispenses) {
    const key = `${row.rxLineId}:${row.createdAt}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const out: LabelGroup[] = []
  for (const [key, rows] of groups) {
    const lineData = data.lines.find((l) => l.line.id === rows[0].rxLineId)
    if (!lineData?.brand || !data.patient) continue
    const pharmacist = data.staff.get(rows[0].pharmacistId)
    const outstanding = rows[0].outstandingQty
    out.push({
      key,
      ids: rows.map((r) => r.id),
      input: {
        rxNo: data.rx.rxNo,
        patient: data.patient,
        brand: lineData.brand,
        genericName: lineData.generic?.name ?? "",
        dosePattern: lineData.line.dosePattern,
        mealTiming: lineData.line.mealTiming,
        durationDays: lineData.line.durationDays,
        dispensedQty: rows.reduce((sum, r) => sum + r.qty, 0),
        outstandingQty: outstanding,
        balanceUntil: outstanding > 0 ? lineData.line.balanceUntil : undefined,
        batches: rows.map((r) => {
          const batch = data.batches.get(r.batchId)
          return { batchNo: batch?.batchNo ?? r.batchId, expiry: batch?.expiry ?? "" }
        }),
        pharmacist: {
          nameEn: pharmacist?.nameEn ?? "",
          nameBn: pharmacist?.nameBn ?? "",
          councilNo: rows[0].pharmacyCouncilNo,
        },
        at: rows[0].at,
      },
    })
  }
  const lineNo = (group: LabelGroup) =>
    data.lines.find((l) => l.line.id === group.key.split(":")[0])?.line.lineNo ?? 0
  return out.sort((a, b) => b.input.at - a.input.at || lineNo(a) - lineNo(b))
}

function DispenseView({
  data,
  branch,
  locale,
  isEdge,
}: {
  data: DispenseData
  branch: BranchCode
  locale: Locale
  isEdge: boolean
}) {
  const { t, num } = useLocale()
  const nowMs = useNow(30_000) || now()
  const today = dhakaDate(nowMs)
  const wide = useMediaQuery("(min-width: 1280px)")
  const [verified, setVerified] = React.useState<IdentityMatch>(null)
  const [choices, setChoices] = React.useState<Record<string, LineChoice>>({})
  const [boughtFor, setBoughtFor] = React.useState<LineData | null>(null)
  const [subFor, setSubFor] = React.useState<LineData | null>(null)
  const [labelLang, setLabelLang] = React.useState<Locale>("bn")
  const [freshIds, setFreshIds] = React.useState<Set<string>>(new Set())
  const [key, renewKey] = useActionKey()
  const dispenseCommand = useModuleCommand(dispense)
  const transferCommand = useModuleCommand(requestTransfer)
  const cashierCommand = useModuleCommand(sendToCashier)
  const { rx, patient } = data
  const doctorName = data.doctor ? nameIn(data.doctor, locale) : ""

  const rows = data.lines.map((lineData) => {
    const facts = lineFacts(lineData, branch, data.batches, today, nowMs)
    const choice = choices[lineData.line.id] ?? defaultChoice(facts)
    const qty = Math.min(choice.qty, facts.max)
    const taking = !facts.block && choice.selected && qty > 0
    const price = lineData.basket?.unitPriceP ?? lineData.brand?.unitPriceP ?? 0
    return { lineData, facts, choice, qty, taking, price }
  })
  const chosen = rows.filter((r) => r.taking)
  const units = chosen.reduce((sum, r) => sum + r.qty, 0)
  const amountP = chosen.reduce((sum, r) => sum + r.qty * r.price, 0)
  const signed = rx.status === "signed"
  const settled = data.lines.length > 0 && rows.every((r) => r.facts.block === "final")
  const canDispense = signed && !!verified && chosen.length > 0 && !dispenseCommand.pending
  const labels = labelGroups(data)
  // A superseded or replaced Rx is read-only: nothing to hand over, labels only if some were printed.
  const showLabels = signed || labels.length > 0

  const confirm = async () => {
    if (!verified) return
    const result = await dispenseCommand.run({
      rxId: rx.id,
      lines: chosen.map((r) => ({ rxLineId: r.lineData.line.id, qty: r.qty })),
      verifiedBy: verified,
      idempotencyKey: key,
    })
    if (!result) return
    renewKey()
    setChoices({})
    setFreshIds(new Set(result.lines.flatMap((l) => l.dispenseIds)))
    toast.success(t("pharmacy.dispense.summary.done", { units: num(units), rxNo: rx.rxNo }))
  }

  const requestFrom = async (lineData: LineData, from: BranchCode, qty: number) => {
    if (!lineData.brand) return
    const result = await transferCommand.run({
      fromBranchId: from,
      toBranchId: branch,
      lines: [{ brandId: lineData.brand.id, qty }],
      requestedFrom: "pharmacy",
      note: rx.rxNo,
    })
    if (result) {
      toast.success(
        t("pharmacy.dispense.transfer.done", {
          transferNo: result.transferNo,
          branch: branchName(from, locale),
        })
      )
    }
  }

  const toCashier = async (lineData: LineData) => {
    const result = await cashierCommand.run({ rxLineId: lineData.line.id })
    if (result) {
      toast.success(
        t("pharmacy.dispense.line.sentToCashier", {
          qty: num(result.qty),
          brand: lineData.brand ? `${lineData.brand.name} ${lineData.brand.strength}` : "",
        })
      )
    }
  }

  const summary = (
    <SummaryPanel
      compact={!wide}
      lines={chosen.length}
      units={units}
      amountP={amountP}
      verified={!!verified}
      settled={settled}
      canDispense={canDispense}
      onConfirm={confirm}
      pending={dispenseCommand.pending}
    />
  )

  const labelPanel = (
    <section className="surface-card flex flex-col gap-3 p-4" data-testid="dispense-labels">
      <header className="flex flex-wrap items-center gap-2">
        <Tags className="size-4 text-link" />
        <h2 className="text-[0.9375rem] font-semibold">{t("pharmacy.dispense.labels.title")}</h2>
        <SegmentedPills
          size="sm"
          className="ml-auto"
          value={labelLang}
          onChange={setLabelLang}
          options={[
            { value: "bn", label: "বাংলা" },
            { value: "en", label: "English" },
          ]}
        />
      </header>
      <p className="text-xs text-muted-foreground">{t("pharmacy.dispense.labels.hint")}</p>
      {labels.length ? (
        <div className="flex flex-col gap-5">
          {labels.slice(0, 8).map((group) => (
            <DispenseLabel
              key={group.key}
              input={group.input}
              lang={labelLang}
              branch={branch}
              fresh={group.ids.some((id) => freshIds.has(id))}
            />
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-[0.8125rem] text-muted-foreground">
          {t("pharmacy.dispense.labels.none")}
        </p>
      )}
    </section>
  )

  return (
    <PageBody
      data-testid="dispense-screen"
      data-rx-id={rx.id}
      data-rx-no={rx.rxNo}
      data-rx-version={rx.rxVersion}
      data-rx-status={rx.status}
    >
      <PageHeader
        back={{ href: "/pharmacy", label: t("pharmacy.dispense.back") }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t("pharmacy.dispense.title", { rxNo: rx.rxNo })}
            <span className="text-sm font-normal text-muted-foreground">
              {t("pharmacy.dispense.version", { version: num(rx.rxVersion) })}
            </span>
          </span>
        }
        subtitle={
          rx.signedAt ? (
            <>
              {t("pharmacy.dispense.signedBy", { doctor: doctorName })}
              {" · "}
              <DateText value={rx.signedAt} variant="dmyTime" />
            </>
          ) : (
            doctorName
          )
        }
        actions={
          <>
            {data.queue ? <QueueStatusPill status={shownQueueStatus(data.queue.status, data.lines.map((l) => l.line))} /> : null}
            <ReportSafetyConcernButton context={rx.rxNo} />
          </>
        }
      />

      {patient ? <IdentityBanner patient={patient} /> : null}

      {!signed ? <SupersededNotice data={data} /> : null}
      {rx.branchId !== branch ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t("pharmacy.dispense.otherBranch", { branch: branchName(rx.branchId, locale) })}
        </p>
      ) : null}

      <div className={cn("grid items-start gap-4", wide && "grid-cols-[minmax(0,1fr)_22rem]")}>
        <div className="flex min-w-0 flex-col gap-4">
          {patient && signed && !settled ? (
            <IdentityCheck patient={patient} onChange={setVerified} />
          ) : null}
          {rows.map((row) => (
            <LineCard
              key={row.lineData.line.id}
              data={row.lineData}
              branch={branch}
              batches={data.batches}
              today={today}
              nowMs={nowMs}
              choice={row.choice}
              onChoice={(choice) =>
                setChoices((prev) => ({ ...prev, [row.lineData.line.id]: choice }))
              }
              onBoughtElsewhere={() => setBoughtFor(row.lineData)}
              onSubstitute={() => setSubFor(row.lineData)}
              onRequestTransfer={(from, qty) => void requestFrom(row.lineData, from, qty)}
              transferPending={transferCommand.pending}
              onSendToCashier={() => void toCashier(row.lineData)}
              cashierPending={cashierCommand.pending}
              offline={isEdge}
            />
          ))}
          {!wide && signed ? summary : null}
          {!wide && showLabels ? labelPanel : null}
        </div>
        {wide ? (
          <aside className="flex flex-col gap-4 self-stretch">
            {signed ? <div className="sticky top-2 z-30">{summary}</div> : null}
            {showLabels ? labelPanel : null}
          </aside>
        ) : null}
      </div>

      <BoughtElsewhereDialog data={boughtFor} onClose={() => setBoughtFor(null)} />
      <SubstitutionDialog
        data={subFor}
        branch={branch}
        doctorName={doctorName}
        onClose={() => setSubFor(null)}
      />
    </PageBody>
  )
}

/**
 * A superseded or replaced Rx is read-only here. When the doctor changed it
 * (a substitution approved in the inbox, a revision), the version now in
 * force is one click away: it arrives live while this screen is open.
 */
function SupersededNotice({ data }: { data: DispenseData }) {
  const { t, num } = useLocale()
  const { rx, current } = data
  const revised = current && current.rxNo === rx.rxNo
  return (
    <div
      data-testid="dispense-superseded"
      data-status={rx.status}
      className="flash-sync flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-surface-raised px-3 py-2 text-[0.8125rem]"
    >
      <span className="flex min-w-0 flex-1 items-start gap-2 text-warning">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          {!current
            ? t("pharmacy.dispense.superseded")
            : revised
              ? t("pharmacy.dispense.revisedTo", { version: num(current.rxVersion) })
              : t("pharmacy.dispense.replacedBy", { rxNo: current.rxNo })}
        </span>
      </span>
      {current ? (
        <Link
          href={`/pharmacy/dispense/${current.id}`}
          data-testid="dispense-open-current"
          data-rx-id={current.id}
          className={buttonVariants({ size: "sm" })}
        >
          {revised
            ? t("pharmacy.dispense.openVersion", { version: num(current.rxVersion) })
            : t("pharmacy.dispense.openRx", { rxNo: current.rxNo })}
          <ArrowRight />
        </Link>
      ) : null}
    </div>
  )
}

function SummaryPanel({
  compact,
  lines,
  units,
  amountP,
  verified,
  settled,
  canDispense,
  pending,
  onConfirm,
}: {
  compact: boolean
  lines: number
  units: number
  amountP: number
  verified: boolean
  settled: boolean
  canDispense: boolean
  pending: boolean
  onConfirm: () => void
}) {
  const { t, num } = useLocale()
  const hint = settled
    ? t("pharmacy.dispense.summary.allSettled")
    : !verified
      ? t("pharmacy.dispense.verify.required")
      : lines === 0
        ? t("pharmacy.dispense.summary.nothing")
        : null
  return (
    <section
      className={cn(
        "flex flex-col gap-3",
        compact
          ? "sticky bottom-0 z-20 rounded-lg bg-popover/95 p-3 shadow-2xl ring-1 ring-foreground/5 backdrop-blur"
          : "surface-card p-4"
      )}
    >
      <div className={cn("flex items-center gap-4", compact ? "flex-wrap" : "flex-col items-stretch")}>
        {!compact ? (
          <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
            <PackageCheck className="size-4 text-link" />
            {t("pharmacy.dispense.summary.title")}
          </h2>
        ) : null}
        <dl className={cn("flex gap-5 text-[0.8125rem]", !compact && "justify-between")}>
          <div>
            <dt className="text-xs text-muted-foreground">{t("pharmacy.dispense.summary.lines")}</dt>
            <dd className="nums font-semibold">{num(lines)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("pharmacy.dispense.summary.units")}</dt>
            <dd className="nums font-semibold">{num(units)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("pharmacy.dispense.summary.amount")}</dt>
            <dd className="font-semibold">
              <MoneyText poisha={amountP} />
            </dd>
          </div>
        </dl>
        <Button
          data-testid="dispense-confirm"
          size={compact ? "default" : "lg"}
          className={cn(compact ? "ml-auto" : "w-full")}
          disabled={!canDispense || pending}
          onClick={onConfirm}
        >
          <PackageCheck />
          {t("pharmacy.dispense.summary.confirm")}
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </section>
  )
}
