"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { BedDouble, BellRing, Banknote, Inbox, ReceiptText, Wallet } from "lucide-react"
import { toast } from "sonner"

import { TableSearch } from "@/components/motion/data-table"
import { PatientAvatar } from "@/components/shared/avatars"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { StatusPill } from "@/components/shared/status"
import { UhidText } from "@/components/shared/uhid-text"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { rules } from "@/config/rules.config"
import type { BranchCode } from "@/config/brand.config"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import type { InterimBill } from "@/core/inpatient/interim"
import { openShiftFor } from "@/modules/billing/queries"
import { LiveChip, PageBody, PageHeader } from "@/modules/pharmacy/components/shared"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { billOf, depositsOn, staysAt, type StayView } from "../queries"
import { DepositDialog } from "./deposit-dialog"
import { InterimBillDialog } from "./interim-bill"
import {
  BalanceText,
  KpiRow,
  NotClinicalNote,
  useDemoNow,
  useInpatientContext,
  useWardText,
} from "./shared"

type Row = { stay: StayView; bill: InterimBill }

/**
 * `/cashier/deposits` (plan §9): the admitted stays at the cashier's branch
 * with days, charges to date, deposits and the deposit left, low-deposit
 * stays first. Live: a new admission at reception appears at once, and the
 * figures move when the demo clock moves. Deposits are taken on the
 * cashier's open shift; the interim bill is viewed and printed here.
 */
export function DepositsScreen() {
  const { branch, staffId } = useInpatientContext()
  const { t } = useLocale()
  if (!branch || !staffId) return <EmptyState icon={Wallet} title={t("inpatient.common.noBranch")} />
  return <DepositDesk branch={branch} cashierId={staffId} />
}

/** Stays that arrive after the first render flash and raise a toast (proof of live sync). */
function useArrivals(rows: Row[] | undefined): Set<Id> {
  const { t, locale } = useLocale()
  const known = React.useRef<Set<Id> | null>(null)
  const [fresh, setFresh] = React.useState<Set<Id>>(new Set())
  React.useEffect(() => {
    if (!rows) return
    if (!known.current) {
      known.current = new Set(rows.map((r) => r.stay.admission.id))
      return
    }
    const arrived = rows.filter((r) => !known.current!.has(r.stay.admission.id))
    if (!arrived.length) return
    for (const row of arrived) {
      known.current.add(row.stay.admission.id)
      toast(
        t("inpatient.deposits.newStay", {
          patient: row.stay.patient ? nameIn(row.stay.patient, locale) : "",
          bed: row.stay.bed?.code ?? "",
        }),
        { icon: <BedDouble className="size-4 text-primary" /> }
      )
    }
    const ids = arrived.map((r) => r.stay.admission.id)
    const start = window.setTimeout(() => setFresh(new Set(ids)), 0)
    const stop = window.setTimeout(() => setFresh(new Set()), 1400)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(stop)
    }
  }, [rows, t, locale])
  return fresh
}

function DepositDesk({ branch, cashierId }: { branch: BranchCode; cashierId: Id }) {
  const db = useDb()
  const { t, num, money, time, locale } = useLocale()
  const { branchText } = useInpatientContext()
  const wardText = useWardText()
  const nowMs = useDemoNow()
  const today = dhakaDate(nowMs)
  const stays = useLiveQuery(() => staysAt(db, branch), [db, branch])
  const todays = useLiveQuery(() => depositsOn(db, branch, today), [db, branch, today])
  const shift = useLiveQuery(
    async () => (await openShiftFor(db, cashierId, branch)) ?? null,
    [db, cashierId, branch]
  )
  const [query, setQuery] = React.useState("")
  const [depositFor, setDepositFor] = React.useState<Id | null>(null)
  const [interim, setInterim] = React.useState<Id | null>(null)

  const rows = React.useMemo<Row[] | undefined>(() => {
    if (!stays) return undefined
    return stays
      .map((stay) => ({ stay, bill: billOf(stay, nowMs) }))
      .filter((row): row is Row => !!row.bill)
      .sort(
        (a, b) =>
          Number(b.bill.low) - Number(a.bill.low) ||
          a.bill.balanceP - b.bill.balanceP ||
          a.stay.admission.admissionNo.localeCompare(b.stay.admission.admissionNo)
      )
  }, [stays, nowMs])
  const fresh = useArrivals(rows)

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows ?? []
    const digitsOnly = q.replace(/\D/g, "")
    return (rows ?? []).filter(({ stay }) => {
      const p = stay.patient
      return (
        stay.admission.admissionNo.toLowerCase().includes(q) ||
        (p?.nameEn.toLowerCase().includes(q) ?? false) ||
        (p?.nameBn.includes(query.trim()) ?? false) ||
        (!!digitsOnly && (p?.uhid.includes(digitsOnly) ?? false)) ||
        (stay.bed?.code.toLowerCase().includes(q) ?? false)
      )
    })
  }, [rows, query])

  const lowCount = (rows ?? []).filter((r) => r.bill.low).length
  const chargesP = (rows ?? []).reduce((sum, r) => sum + r.bill.chargesP, 0)

  return (
    <PageBody data-testid="deposit-desk">
      <PageHeader
        title={t("inpatient.deposits.title")}
        subtitle={t("inpatient.deposits.subtitle", { branch: branchText })}
        actions={
          <>
            {shift ? (
              <StatusPill tone="success" dot data-testid="deposit-shift" data-shift-id={shift.id}>
                {t("inpatient.deposits.shift.open", { time: time(shift.openedAt) })}
              </StatusPill>
            ) : shift === null ? (
              <Link
                href="/cashier/shift"
                data-testid="deposit-shift"
                className="text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
              >
                {t("inpatient.deposits.shift.openLink")}
              </Link>
            ) : null}
            <LiveChip />
          </>
        }
      />
      <NotClinicalNote className="-mt-2" />
      {shift === null ? (
        <p className="rounded-md bg-[color-mix(in_oklch,var(--warning)_15%,transparent)] px-4 py-2.5 text-[0.8125rem]">
          {t("inpatient.deposits.shift.none")}
        </p>
      ) : null}

      <KpiRow
        label={t("inpatient.deposits.title")}
        items={[
          {
            key: "stays",
            icon: BedDouble,
            variant: "cyan",
            title: t("inpatient.deposits.kpi.stays"),
            value: num(rows?.length ?? 0),
            caption: t("inpatient.deposits.kpi.staysHint"),
          },
          {
            key: "low",
            icon: BellRing,
            variant: "yellow",
            title: t("inpatient.deposits.kpi.low"),
            value: num(lowCount),
            caption: t("inpatient.deposits.kpi.lowHint", { amount: money(rules.depositThresholdP) }),
          },
          {
            key: "today",
            icon: Banknote,
            variant: "pink",
            title: t("inpatient.deposits.kpi.today"),
            value: money(todays?.amountP ?? 0),
            caption: t("inpatient.deposits.kpi.todayHint", { count: num(todays?.count ?? 0) }),
          },
          {
            key: "charges",
            icon: ReceiptText,
            variant: "purple",
            title: t("inpatient.deposits.kpi.charges"),
            value: money(chargesP),
            caption: t("inpatient.deposits.kpi.chargesHint"),
          },
        ]}
      />

      <section className="@container/dep surface-card flex min-w-0 flex-col gap-3 p-4 @min-[48rem]/dep:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TableSearch
            value={query}
            onChange={setQuery}
            placeholder={t("inpatient.deposits.search")}
            className="max-w-80"
          />
        </div>
        {rows === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t("inpatient.deposits.empty")}
            description={t("inpatient.deposits.emptyHint")}
          />
        ) : visible.length === 0 ? (
          <EmptyState size="sm" icon={Inbox} title={t("inpatient.deposits.noMatch")} />
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("inpatient.deposits.col.patient")}</TableHead>
                <TableHead className="hidden @min-[34rem]/dep:table-cell">
                  {t("inpatient.deposits.col.stay")}
                </TableHead>
                <TableHead className="hidden text-right @min-[62rem]/dep:table-cell">
                  {t("inpatient.deposits.col.days")}
                </TableHead>
                <TableHead className="hidden text-right @min-[48rem]/dep:table-cell">
                  {t("inpatient.deposits.col.charges")}
                </TableHead>
                <TableHead className="hidden text-right @min-[56rem]/dep:table-cell">
                  {t("inpatient.deposits.col.deposits")}
                </TableHead>
                <TableHead className="text-right">{t("inpatient.deposits.col.left")}</TableHead>
                <TableHead className="w-0 text-right">
                  <span className="sr-only">{t("inpatient.deposits.col.action")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(({ stay, bill }) => {
                const alert = stay.admission.depositAlertAt
                return (
                  <TableRow
                    key={stay.admission.id}
                    data-testid="deposit-row"
                    data-admission-id={stay.admission.id}
                    data-admission-no={stay.admission.admissionNo}
                    data-low={String(bill.low)}
                    data-balance={bill.balanceP}
                    data-days={bill.days}
                    className={cn(fresh.has(stay.admission.id) && "flash-sync")}
                  >
                    <TableCell>
                      {stay.patient ? (
                        <span className="flex min-w-0 items-center gap-2.5">
                          <PatientAvatar patient={stay.patient} size={30} />
                          <span className="flex min-w-0 flex-col">
                            <span className="max-w-44 truncate font-medium">{nameIn(stay.patient, locale)}</span>
                            <UhidText uhid={stay.patient.uhid} className="text-[0.6875rem] text-muted-foreground" />
                          </span>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden @min-[34rem]/dep:table-cell">
                      <span className="flex flex-col">
                        <span lang="en" className="font-mono text-xs">
                          {stay.admission.admissionNo}
                        </span>
                        <span className="text-[0.6875rem] text-muted-foreground">
                          {stay.ward && stay.bed
                            ? t("inpatient.common.wardBed", { ward: wardText(stay.ward).kind, bed: stay.bed.code })
                            : ""}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="nums hidden text-right @min-[62rem]/dep:table-cell">
                      {num(bill.days)}
                    </TableCell>
                    <TableCell className="hidden text-right @min-[48rem]/dep:table-cell">
                      <MoneyText poisha={bill.chargesP} />
                    </TableCell>
                    <TableCell className="hidden text-right @min-[56rem]/dep:table-cell">
                      <MoneyText poisha={bill.depositsP} />
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="flex flex-col items-end gap-0.5">
                        <BalanceText balanceP={bill.balanceP} low={bill.low} />
                        {alert !== undefined ? (
                          <StatusPill
                            tone="destructive"
                            data-testid="deposit-alert"
                            title={t("inpatient.common.alertRaised", { time: time(alert) })}
                            className="h-5 px-2 text-[0.6875rem]"
                          >
                            <BellRing />
                            {t("inpatient.common.lowDeposit")}
                          </StatusPill>
                        ) : (
                          <span className="nums text-[0.6875rem] text-muted-foreground @min-[62rem]/dep:hidden">
                            {t("inpatient.common.day", { count: num(bill.days) })}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant={bill.low ? "default" : "outline"}
                          data-testid="deposit-open"
                          aria-label={t("inpatient.deposits.take")}
                          onClick={() => setDepositFor(stay.admission.id)}
                        >
                          <Wallet />
                          <span className="hidden @min-[40rem]/dep:inline">{t("inpatient.deposits.take")}</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          data-testid="interim-open"
                          aria-label={t("inpatient.deposits.interim")}
                          onClick={() => setInterim(stay.admission.id)}
                        >
                          <ReceiptText />
                          <span className="hidden @min-[72rem]/dep:inline">{t("inpatient.deposits.interim")}</span>
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <DepositDialog
        admissionId={depositFor}
        branch={branch}
        cashierId={cashierId}
        onOpenChange={(open) => !open && setDepositFor(null)}
      />
      <InterimBillDialog admissionId={interim} onOpenChange={(open) => !open && setInterim(null)} />
    </PageBody>
  )
}
