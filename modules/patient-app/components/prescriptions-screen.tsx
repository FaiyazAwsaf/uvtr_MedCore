"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CalendarClock,
  FlaskConical,
  MapPin,
  MessageSquareQuote,
  Pill,
  RefreshCw,
} from "lucide-react"

import { StatusPill, type Tone } from "@/components/shared/status"
import { atDhaka } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type {
  BrandRow,
  GenericRow,
  PrescriptionRow,
  RxLineRow,
} from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import {
  lineFulfilment,
  newerPrescription,
  rxSummary,
  visiblePrescriptions,
  type RxSummary,
} from "../lib/rx"
import {
  AppCard,
  AppLoading,
  DoctorAvatar,
  ScreenTitle,
  useFocusId,
  useFocusRing,
} from "./bits"
import { branchName, useDoctorInfo, useMember } from "./data"
import { RecordsSwitch } from "./reports-screen"

export const RX_SUMMARY_TONE: Record<RxSummary, Tone> = {
  all: "success",
  balance: "warning",
  expired: "destructive",
  none: "muted",
}

const LINE_TONE: Record<RxLineRow["status"], Tone> = {
  open: "muted",
  partial: "warning",
  dispensed: "success",
  "bought-elsewhere": "info",
  "awaiting-prescriber": "warning",
  cancelled: "destructive",
}

/** Prescriptions of the member on screen (live, never drafts). */
export function useMemberPrescriptions(): PrescriptionRow[] | undefined {
  const db = useDb()
  const member = useMember()
  const rows = useLiveQuery(
    () => db.prescriptions.where("patientId").equals(member.id).toArray(),
    [db, member.id]
  )
  return React.useMemo(
    () => (rows ? visiblePrescriptions(rows) : undefined),
    [rows]
  )
}

type LineData = {
  lines: RxLineRow[]
  brands: Map<string, BrandRow>
  generics: Map<string, GenericRow>
}

/** An Rx's lines with their brand and generic rows (live). */
export function useRxLines(rxId: string): LineData | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const lines = (await db.rxLines.where("rxId").equals(rxId).toArray()).sort(
      (a, b) => a.lineNo - b.lineNo
    )
    const brands = (
      await db.brands.bulkGet(lines.map((l) => l.brandId ?? ""))
    ).filter((b): b is BrandRow => !!b)
    const generics = (
      await db.generics.bulkGet(lines.map((l) => l.genericId ?? ""))
    ).filter((g): g is GenericRow => !!g)
    return {
      lines,
      brands: new Map(brands.map((b) => [b.id, b])),
      generics: new Map(generics.map((g) => [g.id, g])),
    }
  }, [db, rxId])
}

export function PrescriptionsScreen() {
  const { t } = useLocale()
  const rxs = useMemberPrescriptions()
  const focusId = useFocusId()
  return (
    <>
      <RecordsSwitch />
      <ScreenTitle title={t("patientApp.prescriptions.title")} />
      {!rxs ? (
        <AppLoading />
      ) : rxs.length ? (
        <div className="flex flex-col gap-3">
          {rxs.map((rx) => (
            <RxCard key={rx.id} rx={rx} all={rxs} focused={focusId === rx.id} />
          ))}
        </div>
      ) : (
        <AppCard className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-raised text-muted-foreground">
            <Pill className="size-5" />
          </span>
          <p className="text-[0.9375rem] font-semibold">
            {t("patientApp.prescriptions.empty")}
          </p>
          <p className="max-w-[30ch] text-[0.8125rem] text-muted-foreground">
            {t("patientApp.prescriptions.emptyHint")}
          </p>
        </AppCard>
      )}
    </>
  )
}

function Qty({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: string
}) {
  return (
    <span className="flex flex-col rounded-xl bg-surface-raised px-2.5 py-1.5">
      <span className="text-[0.6875rem] text-muted-foreground">{label}</span>
      <span className={cn("text-[0.9375rem] font-semibold tabular-nums", tone)}>
        {value}
      </span>
    </span>
  )
}

function RxLine({ line, data }: { line: RxLineRow; data: LineData }) {
  const { t, locale, num, dmy } = useLocale()
  const nowMs = useNow(60_000)
  const brand = line.brandId ? data.brands.get(line.brandId) : undefined
  const generic = line.genericId ? data.generics.get(line.genericId) : undefined
  const f = lineFulfilment(line, nowMs)
  const name = brand
    ? `${brand.name} ${line.strength}`
    : (line.nonDictionaryName ?? line.strength)
  return (
    <li
      data-testid="app-rx-line"
      data-line-status={line.status}
      data-outstanding={f.outstanding}
      className="py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-semibold" lang="en">
            {name}
            {brand ? (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {brand.unitLabel[locale]}
              </span>
            ) : null}
          </p>
          {generic ? (
            <p className="truncate text-xs text-muted-foreground" lang="en">
              {generic.name}
            </p>
          ) : null}
        </div>
        <StatusPill tone={LINE_TONE[line.status]}>
          {t(`patientApp.prescriptions.line.${line.status}`)}
        </StatusPill>
      </div>

      <div className="mt-2 rounded-xl border border-hairline p-2.5">
        <p className="flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground">
          {t("patientApp.prescriptions.dose")}
          <span
            lang="en"
            className="rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-[0.75rem] text-foreground"
          >
            {line.dosePattern}
          </span>
          <span>
            {t("patientApp.prescriptions.days", {
              count: num(line.durationDays),
            })}
          </span>
        </p>
        <p
          lang="bn"
          data-testid="app-rx-dose-bn"
          className="mt-1 text-[0.9375rem] leading-snug font-medium"
        >
          {line.instructionsBn}
        </p>
        {locale === "en" && line.instructionsEn ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {line.instructionsEn}
          </p>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <Qty
          label={t("patientApp.prescriptions.prescribed")}
          value={num(f.prescribed)}
        />
        <Qty
          label={t("patientApp.prescriptions.collected")}
          value={num(f.dispensed)}
        />
        <Qty
          label={t("patientApp.prescriptions.outstanding")}
          value={num(f.outstanding)}
          tone={
            f.outstanding > 0
              ? "text-[color-mix(in_oklch,var(--warning),var(--foreground)_40%)] dark:text-warning"
              : undefined
          }
        />
      </div>
      {f.deadline !== undefined && f.outstanding > 0 ? (
        <p
          data-testid="app-rx-balance"
          data-expired={f.expired}
          className={cn(
            "mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-xs font-medium",
            f.expired
              ? "bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] text-destructive"
              : "bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] text-[color-mix(in_oklch,var(--warning),var(--foreground)_40%)] dark:text-warning"
          )}
        >
          <CalendarClock className="size-4 shrink-0" />
          {f.expired
            ? t("patientApp.prescriptions.balanceExpired", {
                date: dmy(f.deadline),
              })
            : t("patientApp.prescriptions.balanceBy", {
                count: num(f.outstanding),
                date: dmy(f.deadline),
              })}
        </p>
      ) : null}
    </li>
  )
}

function RxCard({
  rx,
  all,
  focused,
}: {
  rx: PrescriptionRow
  all: PrescriptionRow[]
  focused: boolean
}) {
  const { t, locale, num, dmy } = useLocale()
  const nowMs = useNow(60_000)
  const data = useRxLines(rx.id)
  const doctorInfo = useDoctorInfo()
  const info = doctorInfo(rx.doctorId)
  const newer = newerPrescription(rx, all)
  const summary = data ? rxSummary(data.lines, nowMs) : null
  const { ref, flash } = useFocusRing(focused)

  return (
    <AppCard
      ref={ref}
      flash={flash}
      data-testid="app-rx"
      data-rx-id={rx.id}
      data-rx-no={rx.rxNo}
      data-status={rx.status}
      data-summary={summary ?? undefined}
      className={cn("scroll-mt-20", newer && "opacity-90")}
    >
      <div className="flex items-start gap-3">
        <DoctorAvatar staff={info?.staff} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold">
            {info?.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {info?.specialtyName}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span lang="en" className="font-mono">
              {rx.rxNo}
            </span>
            {rx.rxVersion > 1 ? ` · v${rx.rxVersion}` : ""}
            {" · "}
            {t("patientApp.prescriptions.signed", { date: dmy(rx.signedAt!) })}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5" />
            {branchName(rx.branchId, locale)}
          </p>
          {summary && !newer ? (
            <StatusPill tone={RX_SUMMARY_TONE[summary]} dot className="mt-2">
              {t(`patientApp.prescriptions.summary.${summary}`)}
            </StatusPill>
          ) : null}
        </div>
      </div>

      {newer ? (
        <div
          className="mt-3 rounded-xl bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] p-3"
          data-testid="app-rx-replaced"
        >
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold">
            <RefreshCw className="size-4" />
            {t("patientApp.prescriptions.replacedTitle")}
          </p>
          <p className="mt-1 text-xs">
            {t("patientApp.prescriptions.replacedBody")}
          </p>
          <Link
            href={`/app/prescriptions?focus=${newer.id}`}
            className="mt-1.5 inline-flex min-h-10 items-center text-[0.8125rem] font-semibold text-link"
          >
            {t("patientApp.prescriptions.seeNewer")}
          </Link>
        </div>
      ) : null}

      {!data ? (
        <AppLoading />
      ) : (
        <>
          <p className="mt-3 text-xs font-medium text-muted-foreground">
            {t("patientApp.prescriptions.medicines", {
              count: num(data.lines.length),
            })}
          </p>
          <ul className="divide-y divide-hairline">
            {data.lines.map((line) => (
              <RxLine key={line.id} line={line} data={data} />
            ))}
          </ul>
        </>
      )}

      {rx.advice ? (
        <div className="mt-1 rounded-xl bg-surface-raised p-3 text-[0.8125rem]">
          <p className="flex items-center gap-1.5 font-semibold">
            <MessageSquareQuote className="size-4 text-link" />
            {t("patientApp.prescriptions.advice")}
          </p>
          <p className="mt-1 leading-relaxed" lang="en">
            {rx.advice}
          </p>
        </div>
      ) : null}
      {rx.tests.length ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <FlaskConical className="mt-px size-3.5 shrink-0" />
          {t("patientApp.prescriptions.tests")}:{" "}
          <span lang="en">{rx.tests.join(", ")}</span>
        </p>
      ) : null}
      {rx.followUpDate ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
          <CalendarClock className="size-3.5 text-link" />
          {t("patientApp.prescriptions.followUp", {
            date: dmy(atDhaka(rx.followUpDate, "12:00")),
          })}
        </p>
      ) : null}
    </AppCard>
  )
}
