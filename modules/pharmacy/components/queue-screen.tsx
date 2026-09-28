"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { CalendarClock, CheckCircle2, Hourglass, Inbox, Pill, Wallet } from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { TableSearch } from "@/components/motion/data-table"
import { PatientAvatar } from "@/components/shared/avatars"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { nameIn } from "@/components/shared/person"
import { UhidText } from "@/components/shared/uhid-text"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { PatientRow, PharmacyQueueRow } from "@/core/db/schema"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { isFinalLine } from "../rules"
import {
  LiveChip,
  PageBody,
  PageHeader,
  QueueStatusPill,
  unique,
  usePharmacyContext,
} from "./shared"

type QueueItem = {
  entry: PharmacyQueueRow
  patient?: PatientRow
  doctor?: { nameEn: string; nameBn: string }
  signedAt: number
  paid: number
  total: number
  unpaidOpen: number
}

const OPEN: PharmacyQueueRow["status"][] = ["waiting", "in-progress", "partial"]

/** The branch's pharmacy queue with patients, doctors and paid-line counts, live. */
function useQueue(branch: string | null): QueueItem[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!branch) return []
    const entries = await db.pharmacyQueue.where("branchId").equals(branch).toArray()
    const rxIds = entries.map((e) => e.rxId)
    const [rxs, lines, patients] = await Promise.all([
      db.prescriptions.bulkGet(rxIds),
      db.rxLines.where("rxId").anyOf(rxIds).toArray(),
      db.patients.bulkGet(unique(entries.map((e) => e.patientId))),
    ])
    const doctors = await db.doctors.bulkGet(unique(rxs.map((rx) => rx?.doctorId)))
    const staff = await db.staff.bulkGet(unique(doctors.map((d) => d?.staffId)))
    const patientById = new Map(patients.filter(Boolean).map((p) => [p!.id, p!]))
    const staffByDoctor = new Map(
      doctors.filter(Boolean).map((d) => [d!.id, staff.find((s) => s?.id === d!.staffId)])
    )
    return entries.map((entry, index) => {
      const rx = rxs[index]
      const own = lines.filter((l) => l.rxId === entry.rxId)
      const doctor = rx ? staffByDoctor.get(rx.doctorId) : undefined
      return {
        entry,
        patient: patientById.get(entry.patientId),
        doctor: doctor ? { nameEn: doctor.nameEn, nameBn: doctor.nameBn } : undefined,
        signedAt: rx?.signedAt ?? entry.receivedAt,
        paid: own.filter((l) => l.paymentCleared).length,
        total: own.length,
        unpaidOpen: own.filter((l) => !l.paymentCleared && !isFinalLine(l)).length,
      }
    })
  }, [db, branch])
}

/**
 * Rows that arrived after the first render (a doctor signed in another
 * window): they flash turquoise for about 1.2 s and raise a toast.
 */
function useArrivals(items: QueueItem[] | undefined): Set<string> {
  const { t, locale } = useLocale()
  const known = React.useRef<Set<string> | null>(null)
  const [fresh, setFresh] = React.useState<Set<string>>(new Set())
  React.useEffect(() => {
    if (!items) return
    if (!known.current) {
      known.current = new Set(items.map((i) => i.entry.id))
      return
    }
    const arrived = items.filter((i) => !known.current!.has(i.entry.id))
    if (!arrived.length) return
    for (const item of arrived) {
      known.current.add(item.entry.id)
      toast(
        t("pharmacy.queue.newRx", {
          rxNo: item.entry.rxNo,
          name: item.patient ? nameIn(item.patient, locale) : "",
        }),
        { icon: <Pill className="size-4 text-primary" /> }
      )
    }
    const ids = arrived.map((i) => i.entry.id)
    const start = window.setTimeout(() => setFresh(new Set(ids)), 0)
    const stop = window.setTimeout(() => setFresh(new Set()), 1400)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(stop)
    }
  }, [items, t, locale])
  return fresh
}

export function PharmacyQueueScreen() {
  const { t, num, locale } = useLocale()
  const router = useRouter()
  const { branch, branchLabel } = usePharmacyContext()
  const items = useQueue(branch)
  const fresh = useArrivals(items)
  const today = dhakaDate(useNow(60_000) || now())
  const wide = useMediaQuery("(min-width: 1280px)")
  const [tab, setTab] = React.useState<"current" | "all">("current")
  const [query, setQuery] = React.useState("")

  const sorted = React.useMemo(
    () => [...(items ?? [])].sort((a, b) => b.signedAt - a.signedAt),
    [items]
  )
  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return sorted.filter((item) => {
      if (
        tab === "current" &&
        !OPEN.includes(item.entry.status) &&
        dhakaDate(item.entry.receivedAt) !== today
      ) {
        return false
      }
      if (!q) return true
      const p = item.patient
      return (
        item.entry.rxNo.toLowerCase().includes(q) ||
        (p?.nameEn.toLowerCase().includes(q) ?? false) ||
        (p?.nameBn.includes(query.trim()) ?? false) ||
        (p?.uhid.includes(q.replace(/\D/g, "") || "~") ?? false)
      )
    })
  }, [sorted, tab, query, today])

  const stats = React.useMemo(() => {
    const list = items ?? []
    return {
      waiting: list.filter((i) => i.entry.status === "waiting").length,
      partial: list.filter((i) => i.entry.status === "partial" || i.entry.status === "in-progress")
        .length,
      done: list.filter(
        (i) => i.entry.status === "done" && dhakaDate(i.entry.updatedAt) === today
      ).length,
      unpaid: list
        .filter((i) => OPEN.includes(i.entry.status))
        .reduce((sum, i) => sum + i.unpaidOpen, 0),
    }
  }, [items, today])

  const kpis = [
    { key: "waiting", icon: Hourglass, value: stats.waiting, variant: "cyan" as const },
    { key: "partial", icon: CalendarClock, value: stats.partial, variant: "yellow" as const },
    { key: "done", icon: CheckCircle2, value: stats.done, variant: "pink" as const },
    { key: "unpaid", icon: Wallet, value: stats.unpaid, variant: "purple" as const },
  ] as const

  return (
    <PageBody data-testid="pharmacy-queue">
      <PageHeader
        title={t("pharmacy.queue.title")}
        subtitle={t("pharmacy.queue.subtitle", { branch: branchLabel })}
        actions={<LiveChip />}
      />

      {wide ? (
        <KpiGrid>
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.key}
              variant={kpi.variant}
              icon={kpi.icon}
              title={t(`pharmacy.queue.kpi.${kpi.key}`)}
              value={num(kpi.value)}
              caption={t(`pharmacy.queue.kpi.${kpi.key}Hint`)}
            />
          ))}
        </KpiGrid>
      ) : (
        <div className="flex gap-2 overflow-x-auto">
          {kpis.map((kpi) => (
            <span
              key={kpi.key}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-card px-3.5 text-[0.8125rem]"
            >
              <kpi.icon className="size-4 text-link" />
              <span className="text-muted-foreground">{t(`pharmacy.queue.kpi.${kpi.key}`)}</span>
              <span className="nums font-semibold">{num(kpi.value)}</span>
            </span>
          ))}
        </div>
      )}

      <section className="@container/q surface-card flex min-w-0 flex-col gap-3 p-4 @min-[48rem]/q:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedPills
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: "current", label: t("pharmacy.queue.tabs.current") },
              { value: "all", label: t("pharmacy.queue.tabs.all") },
            ]}
          />
          <TableSearch
            value={query}
            onChange={setQuery}
            placeholder={t("pharmacy.queue.search")}
            className="ml-auto max-w-72"
          />
        </div>

        {items && visible.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t("pharmacy.queue.empty")}
            description={t("pharmacy.queue.emptyHint")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pharmacy.queue.col.rx")}</TableHead>
                <TableHead>{t("pharmacy.queue.col.patient")}</TableHead>
                <TableHead className="hidden @min-[46rem]/q:table-cell">
                  {t("pharmacy.queue.col.doctor")}
                </TableHead>
                <TableHead className="hidden @min-[36rem]/q:table-cell">
                  {t("pharmacy.queue.col.received")}
                </TableHead>
                <TableHead>{t("pharmacy.queue.col.paid")}</TableHead>
                <TableHead>{t("pharmacy.queue.col.status")}</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => {
                const href = `/pharmacy/dispense/${item.entry.rxId}`
                const open = OPEN.includes(item.entry.status)
                return (
                  <TableRow
                    key={item.entry.id}
                    data-testid="pharmacy-queue-row"
                    data-rx-id={item.entry.rxId}
                    data-status={item.entry.status}
                    onClick={() => router.push(href)}
                    className={cn("cursor-pointer", fresh.has(item.entry.id) && "flash-sync")}
                  >
                    <TableCell className="font-mono text-xs whitespace-nowrap" lang="en">
                      {item.entry.rxNo}
                    </TableCell>
                    <TableCell>
                      {item.patient ? (
                        <span className="flex min-w-0 items-center gap-2.5">
                          <PatientAvatar patient={item.patient} size={30} />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {nameIn(item.patient, locale)}
                            </span>
                            <UhidText
                              uhid={item.patient.uhid}
                              className="text-[0.6875rem] text-muted-foreground"
                            />
                          </span>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden @min-[46rem]/q:table-cell">
                      {item.doctor ? nameIn(item.doctor, locale) : ""}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground @min-[36rem]/q:table-cell">
                      <span className="flex flex-col">
                        <DateText value={item.signedAt} variant="time" />
                        <DateText
                          value={item.signedAt}
                          variant="relative"
                          className="text-[0.6875rem]"
                        />
                      </span>
                    </TableCell>
                    <TableCell>
                      <PaidMeter paid={item.paid} total={item.total} />
                    </TableCell>
                    <TableCell>
                      <QueueStatusPill status={item.entry.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={href}
                        onClick={(event) => event.stopPropagation()}
                        className="text-[0.8125rem] font-medium whitespace-nowrap text-link underline-offset-4 hover:underline"
                      >
                        {open ? t("pharmacy.queue.dispense") : t("pharmacy.queue.view")}
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </PageBody>
  )
}

function PaidMeter({ paid, total }: { paid: number; total: number }) {
  const { t, num } = useLocale()
  const pct = total ? (paid / total) * 100 : 0
  return (
    <span className="flex min-w-20 flex-col gap-1">
      <span
        className={cn(
          "nums text-[0.8125rem] font-medium whitespace-nowrap",
          paid === total && total > 0 ? "text-success" : paid === 0 ? "text-warning" : ""
        )}
      >
        {t("pharmacy.queue.paidOf", { paid: num(paid), total: num(total) })}
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-surface-raised">
        <span
          className={cn("block h-full rounded-full", paid === total ? "bg-success" : "bg-warning")}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  )
}
