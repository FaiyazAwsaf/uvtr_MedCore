"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowRight,
  BadgeCheck,
  CircleHelp,
  FileWarning,
  Languages,
  LoaderCircle,
  ShieldX,
} from "lucide-react"

import { HospitalLogo } from "@/components/shared/hospital-brand"
import { branches, hospital } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { loadVerification, type Verification } from "../verify"

/**
 * The verification page is always light and in the hospital's brand
 * (docs/ui_guidelines.md §6), whatever the window's theme: the tokens are
 * pinned here rather than read from the theme.
 */
const LIGHT = {
  "--background": "#f5f4f7",
  "--foreground": "#1f1d22",
  "--card": "#ffffff",
  "--muted-foreground": "#6d6873",
  "--border": "#dcd8e0",
  "--hairline": "#e7e4eb",
  "--surface-raised": "#f0eef3",
  "--primary": hospital.colors.primary,
  "--primary-foreground": hospital.colors.primaryForeground,
  colorScheme: "light",
} as React.CSSProperties

const OK = "#1f9d57"
const BAD = "#e0474d"
const WARN = "#9a7b00"

type Genuine = Extract<Verification, { state: "genuine" }>

/**
 * "/verify/[reportId]": public QR verification (plan T2.7, HAZ-03). Genuine
 * or not found, the patient's initials only, the tests, the version asked for
 * and the current one, a "Corrected" notice with a link to the current
 * version, and the signed content hash printed on the report.
 */
export function VerifyScreen({ reportId }: { reportId: string }) {
  const { t, locale, setLocale } = useLocale()
  const db = useDb()
  const data = useLiveQuery(
    () => loadVerification(db, reportId),
    [db, reportId]
  )

  const state = !data
    ? "checking"
    : data.state === "not-found"
      ? "not-found"
      : data.report.id !== data.current.id
        ? "superseded"
        : "genuine"

  return (
    <div
      style={LIGHT}
      className="flex min-h-svh flex-col bg-[var(--background)] text-[var(--foreground)]"
      data-testid="verify-page"
    >
      <header className="border-b border-[var(--hairline)] bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <HospitalLogo size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.9375rem] leading-tight font-semibold">
              {hospital.name[locale]}
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">
              {t("lab.verify.title")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLocale(locale === "en" ? "bn" : "en")}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] px-3 text-[0.8125rem]"
            data-testid="verify-language"
          >
            <Languages className="size-3.5" />
            {t("lab.verify.language")}
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
        <StatusCard data={data} state={state} />
        {data?.state === "genuine" ? <Details data={data} /> : null}
        <p className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]">
          <CircleHelp className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {data?.state === "genuine" ? `${t("lab.verify.privacy")} ` : ""}
            {t("lab.verify.help", { helpline: hospital.helpline })}
          </span>
        </p>
      </main>
      <footer className="border-t border-[var(--hairline)] py-3 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
        {hospital.website} · {t("common.demoData")}
      </footer>
    </div>
  )
}

function StatusCard({
  data,
  state,
}: {
  data: Verification | undefined
  state: string
}) {
  const { t, dmy, num, locale } = useLocale()
  const color =
    state === "genuine"
      ? OK
      : state === "superseded"
        ? WARN
        : state === "not-found"
          ? BAD
          : "#6d6873"
  const Icon =
    state === "checking"
      ? LoaderCircle
      : state === "genuine"
        ? BadgeCheck
        : state === "superseded"
          ? FileWarning
          : ShieldX
  let title = t("lab.verify.checking")
  let body: React.ReactNode = null
  if (data?.state === "not-found") {
    title = t("lab.verify.notFound")
    body = t("lab.verify.notFoundBody", { helpline: hospital.helpline })
  } else if (data?.state === "genuine" && state === "superseded") {
    title = t("lab.verify.superseded")
    const when =
      data.kind === "lab"
        ? (data.current.signedAt ?? data.current.createdAt)
        : (data.current.releasedAt ?? data.current.createdAt)
    body = t("lab.verify.supersededBody", {
      version: num(data.current.reportVersion),
      date: when ? dmy(when) : "-",
    })
  } else if (data?.state === "genuine") {
    title = t("lab.verify.genuine")
    body = t("lab.verify.genuineBody", { hospital: hospital.name[locale] })
  }

  return (
    <section
      data-testid="verify-status"
      data-state={state}
      className="flex items-start gap-4 rounded-[14px] bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <span
        className="flex size-12 shrink-0 items-center justify-center rounded-full"
        style={{
          backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
          color,
        }}
      >
        <Icon
          className={cn("size-6", state === "checking" && "animate-spin")}
        />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-lg leading-tight font-semibold" style={{ color }}>
          {title}
        </h1>
        {body ? <p className="mt-1 text-sm leading-relaxed">{body}</p> : null}
        {data?.state === "genuine" && state === "superseded" ? (
          <Link
            href={`/verify/${data.current.id}`}
            data-testid="verify-current-link"
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-sm font-semibold text-[var(--primary-foreground)]"
            style={{ backgroundColor: hospital.colors.primary }}
          >
            {t("lab.verify.viewCurrent")}
            <ArrowRight className="size-4" />
          </Link>
        ) : null}
      </div>
    </section>
  )
}

function Row({
  label,
  children,
  testId,
}: {
  label: string
  children: React.ReactNode
  testId?: string
}) {
  return (
    <div
      className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 border-b border-[var(--hairline)] py-2.5 last:border-0"
      data-testid={testId}
    >
      <dt className="text-[0.8125rem] text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

function Details({ data }: { data: Genuine }) {
  const { t, locale, dmy, time, num } = useLocale()
  const report = data.report
  const current = data.current
  const branch = branches.find((b) => b.code === data.branchId)
  const when = (ms?: number) => (ms ? `${dmy(ms)}, ${time(ms)}` : "-")
  const isCurrent = report.id === current.id
  const reportNo =
    data.kind === "lab" ? data.report.reportNo : data.order.orderNo
  const signedAt =
    data.kind === "lab" ? data.report.signedAt : data.report.createdAt
  const correctedCurrent = isCurrent && report.reportVersion > 1

  return (
    <section className="rounded-[14px] bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
      {correctedCurrent ? (
        <p
          className="mb-3 rounded-md px-3 py-2 text-[0.8125rem] font-semibold"
          style={{
            backgroundColor: `color-mix(in oklch, ${WARN} 14%, transparent)`,
            color: WARN,
          }}
          data-testid="verify-corrected"
        >
          {t("lab.verify.correctedNotice", {
            from: num(report.reportVersion - 1),
          })}
          {data.kind === "lab" && data.report.changeSummary ? (
            <span className="mt-1 block font-normal text-[var(--foreground)]">
              {data.report.changeSummary}
            </span>
          ) : null}
        </p>
      ) : null}
      <dl>
        <Row label={t("lab.verify.reportNo")}>
          <span className="font-mono" lang="en">
            {reportNo}
          </span>
        </Row>
        <Row label={t("lab.verify.version")} testId="verify-version">
          <span
            data-version={report.reportVersion}
            data-current={isCurrent ? "true" : "false"}
          >
            {isCurrent
              ? t("lab.verify.currentVersion", {
                  version: num(report.reportVersion),
                })
              : t("lab.verify.oldVersion", {
                  version: num(report.reportVersion),
                })}
          </span>
        </Row>
        <Row label={t("lab.verify.patient")}>
          <span className="font-semibold" data-testid="verify-initials">
            {data.initials || "-"}
          </span>
        </Row>
        <Row
          label={
            data.kind === "lab" ? t("lab.verify.tests") : t("lab.verify.study")
          }
        >
          <ul className="flex flex-col gap-0.5" lang="en">
            {data.tests.map((test) => (
              <li key={test.id}>{test.name}</li>
            ))}
          </ul>
        </Row>
        <Row label={t("lab.verify.issuedBy")}>
          {hospital.name[locale]}
          {branch ? `, ${branch.name[locale]}` : ""}
        </Row>
        <Row label={t("lab.verify.signedBy")}>
          {data.signer
            ? locale === "bn"
              ? data.signer.nameBn
              : data.signer.nameEn
            : "-"}
          {data.signer?.designation ? (
            <span className="block text-xs text-[var(--muted-foreground)]">
              {data.signer.designation[locale]}
            </span>
          ) : null}
        </Row>
        <Row label={t("lab.verify.signedAt")}>{when(signedAt)}</Row>
        <Row label={t("lab.verify.releasedAt")}>
          {report.releasedAt
            ? when(report.releasedAt)
            : t("lab.verify.notReleased")}
        </Row>
        {data.kind === "imaging" ? (
          <Row label={t("lab.verify.imagingPdf")}>
            <span className="font-mono text-xs break-all" lang="en">
              {data.report.pdfName}
            </span>
          </Row>
        ) : null}
      </dl>
      <div className="mt-4 rounded-md bg-[var(--surface-raised)] px-3 py-2.5">
        <div className="text-[0.6875rem] text-[var(--muted-foreground)]">
          {t("lab.verify.hash")}
        </div>
        <div
          className="font-mono text-xs break-all"
          lang="en"
          data-testid="verify-hash"
        >
          {data.kind === "lab"
            ? (data.report.hash ?? "-")
            : data.report.pdfHash}
        </div>
      </div>
    </section>
  )
}
