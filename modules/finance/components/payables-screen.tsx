"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  HandCoins,
  Landmark,
  LoaderCircle,
  Send,
  Timer,
} from "lucide-react"

import { SegmentedPills } from "@/components/motion/segmented"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText } from "@/components/shared/status"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useDb } from "@/core/db/DbProvider"
import { useLocale } from "@/lib/i18n/provider"
import { NativeSelect } from "@/modules/identity/components/desk-ui"

import { payPayable, schedulePayable } from "../commands"
import { payablesView, type PayableView } from "../queries"
import { AGING_BUCKETS, nextPaymentRun, type AgingBucket } from "../rules"
import {
  BranchFilter,
  branchOrNull,
  DocNo,
  FinanceKpis,
  LiveChip,
  PageBody,
  PageHeader,
  useActionKey,
  useBranchFilter,
  useDayOptions,
  useFinanceCommand,
  useToday,
} from "./shared"

type Filter = "open" | "paid" | "all"

const AGING_ICON: Record<AgingBucket, typeof Timer> = {
  "not-due": CalendarDays,
  "d1-30": Timer,
  "d31-60": AlarmClock,
  d60plus: AlarmClock,
}
const AGING_VARIANT = { "not-due": "cyan", "d1-30": "yellow", "d31-60": "pink", d60plus: "purple" } as const

/**
 * `/finance/payables`: what the network owes vendors, aged by due date, with
 * totals by vendor. A payable is put on a payment run, then paid by a
 * simulated bank transfer. Purchase orders stay with procurement.
 */
export function PayablesScreen() {
  const db = useDb()
  const { t, tk, money, num } = useLocale()
  const today = useToday()
  const [branch, setBranch] = useBranchFilter()
  const [filter, setFilter] = React.useState<Filter>("open")
  const data = useLiveQuery(
    () => (today ? payablesView(db, today, branchOrNull(branch)) : undefined),
    [db, today, branch]
  )
  const [scheduling, setScheduling] = React.useState<string | null>(null)
  const [paying, setPaying] = React.useState<string | null>(null)
  const rows = (data?.rows ?? []).filter((r) =>
    filter === "all" ? true : filter === "paid" ? r.payable.status === "paid" : r.payable.status !== "paid"
  )
  const counts = {
    open: data?.rows.filter((r) => r.payable.status !== "paid").length ?? 0,
    paid: data?.rows.filter((r) => r.payable.status === "paid").length ?? 0,
    all: data?.rows.length ?? 0,
  }

  return (
    <PageBody className="@container/page" data-testid="payables-screen">
      <PageHeader title={t("finance.payables.title")} subtitle={t("finance.payables.subtitle")} actions={<LiveChip />} />
      <BranchFilter value={branch} onChange={setBranch} />

      <FinanceKpis
        label={t("finance.payables.title")}
        items={AGING_BUCKETS.map((bucket) => ({
          key: bucket,
          variant: AGING_VARIANT[bucket],
          icon: AGING_ICON[bucket],
          title: tk(`finance.payables.aging.${bucket}`),
          value: money(data?.aging[bucket].amountP ?? 0),
          caption: t("finance.payables.aging.caption", { count: num(data?.aging[bucket].count ?? 0) }),
          testId: `payables-aging-${bucket}`,
        }))}
      />

      <div className="grid items-start gap-4 @min-[80rem]/page:grid-cols-[minmax(0,1fr)_22rem]">
        <SectionCard
          title={t("finance.payables.title")}
          icon={HandCoins}
          size="sm"
          action={
            <SegmentedPills<Filter>
              size="sm"
              value={filter}
              onChange={setFilter}
              options={(["open", "paid", "all"] as const).map((value) => ({
                value,
                label: tk(`finance.payables.filter.${value}`),
                count: num(counts[value]),
              }))}
            />
          }
        >
          {!data ? (
            <Skeleton className="h-32 w-full" />
          ) : rows.length === 0 ? (
            <EmptyState size="sm" icon={HandCoins} title={t("finance.payables.empty")} />
          ) : (
            <div className="@container/pay">
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("finance.payables.col.vendor")}</TableHead>
                    <TableHead className="hidden @min-[40rem]/pay:table-cell">{t("finance.payables.col.po")}</TableHead>
                    <TableHead className="hidden @min-[50rem]/pay:table-cell">{t("finance.payables.col.invoice")}</TableHead>
                    <TableHead className="text-right">{t("finance.payables.col.amount")}</TableHead>
                    <TableHead>{t("finance.payables.col.due")}</TableHead>
                    <TableHead className="hidden @min-[32rem]/pay:table-cell">{t("finance.payables.col.status")}</TableHead>
                    <TableHead className="text-right">{t("finance.payables.col.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <PayableRowView
                      key={row.payable.id}
                      row={row}
                      onSchedule={() => setScheduling(row.payable.id)}
                      onPay={() => setPaying(row.payable.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        <SectionCard title={t("finance.payables.byVendor")} icon={Landmark} size="sm">
          {!data ? (
            <Skeleton className="h-24 w-full" />
          ) : data.byVendor.length === 0 ? (
            <EmptyState size="sm" icon={Landmark} title={t("finance.payables.empty")} />
          ) : (
            <ul className="flex flex-col" data-testid="payables-by-vendor">
              {data.byVendor.map((vendor) => (
                <li
                  key={vendor.vendor}
                  className="flex items-center justify-between gap-3 border-b border-hairline py-2 text-[0.8125rem] last:border-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{vendor.vendor}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("finance.payables.byVendorCount", { count: num(vendor.count) })}
                    </span>
                  </span>
                  <MoneyText poisha={vendor.amountP} className="font-medium" />
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 pt-2 text-[0.8125rem] font-semibold">
                <span>{t("finance.payables.totalOpen")}</span>
                <MoneyText poisha={data.openP} />
              </li>
            </ul>
          )}
        </SectionCard>
      </div>

      {scheduling ? (
        <ScheduleDialog
          row={data?.rows.find((r) => r.payable.id === scheduling)}
          today={today}
          onClose={() => setScheduling(null)}
        />
      ) : null}
      {paying ? (
        <PayDialog row={data?.rows.find((r) => r.payable.id === paying)} onClose={() => setPaying(null)} />
      ) : null}
    </PageBody>
  )
}

function PayableRowView({
  row,
  onSchedule,
  onPay,
}: {
  row: PayableView
  onSchedule: () => void
  onPay: () => void
}) {
  const { t, dmy, num } = useLocale()
  const { payable } = row
  const paid = payable.status === "paid"
  return (
    <TableRow
      data-testid="payable-row"
      data-payable-id={payable.id}
      data-status={payable.status}
      data-overdue={row.overdueDays > 0 ? "true" : "false"}
    >
      <TableCell className="max-w-44 truncate">{row.vendor}</TableCell>
      <TableCell className="hidden @min-[40rem]/pay:table-cell">
        <DocNo>{row.poNo ?? ""}</DocNo>
      </TableCell>
      <TableCell className="hidden @min-[50rem]/pay:table-cell">
        <DocNo>{row.vendorInvoice?.vendorInvoiceNo ?? ""}</DocNo>
        {row.vendorInvoice?.vendorRef ? (
          <DocNo className="block text-muted-foreground">{row.vendorInvoice.vendorRef}</DocNo>
        ) : null}
      </TableCell>
      <TableCell className="text-right font-medium">
        <MoneyText poisha={payable.amountP} />
      </TableCell>
      <TableCell>
        <DateText value={payable.dueDate} />
        {!paid && row.overdueDays > 0 ? (
          <StatusText tone="destructive" className="block text-xs">
            {row.overdueDays === 1
              ? t("finance.payables.overdueOne")
              : t("finance.payables.overdue", { count: num(row.overdueDays) })}
          </StatusText>
        ) : null}
      </TableCell>
      <TableCell className="hidden @min-[32rem]/pay:table-cell">
        {paid ? (
          <span>
            <StatusText tone="success">
              {t("finance.payables.status.paid", { date: payable.paidAt ? dmy(payable.paidAt) : "" })}
            </StatusText>
            {payable.paymentRef ? <DocNo className="block text-muted-foreground">{payable.paymentRef}</DocNo> : null}
          </span>
        ) : payable.status === "scheduled" ? (
          <StatusText tone="info">
            {t("finance.payables.status.scheduled", { date: payable.scheduledFor ? dmy(payable.scheduledFor) : "" })}
          </StatusText>
        ) : (
          <StatusText tone={row.overdueDays > 0 ? "destructive" : "warning"}>{t("finance.payables.status.open")}</StatusText>
        )}
      </TableCell>
      <TableCell className="text-right">
        {paid ? null : (
          <span className="inline-flex items-center gap-3">
            <button
              type="button"
              data-testid="payable-schedule"
              onClick={onSchedule}
              className="text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
            >
              {t("finance.payables.schedule")}
            </button>
            <button
              type="button"
              data-testid="payable-pay"
              onClick={onPay}
              className="text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
            >
              {t("finance.payables.pay")}
            </button>
          </span>
        )}
      </TableCell>
    </TableRow>
  )
}

function ScheduleDialog({
  row,
  today,
  onClose,
}: {
  row: PayableView | undefined
  today: string
  onClose: () => void
}) {
  const { t } = useLocale()
  const schedule = useFinanceCommand(schedulePayable)
  const [actionKey] = useActionKey()
  const [date, setDate] = React.useState(() => row?.payable.scheduledFor ?? nextPaymentRun(today))
  const days = useDayOptions(today, 28)
  if (!row) return null
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md" data-testid="payable-schedule-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            const done = await schedule.run({
              payableId: row.payable.id,
              expectedVersion: row.payable.version,
              scheduledFor: date,
              idempotencyKey: actionKey,
            })
            if (done) onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("finance.payables.scheduleTitle", { vendor: row.vendor ?? "" })}</DialogTitle>
            <DialogDescription>{t("finance.payables.scheduleHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="payable-run-date">{t("finance.payables.scheduleDate")}</Label>
            <NativeSelect
              id="payable-run-date"
              data-testid="payable-schedule-date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            >
              {days.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" data-testid="payable-schedule-confirm" disabled={!date || date < today || schedule.pending}>
              {schedule.pending ? <LoaderCircle className="animate-spin" /> : <CalendarClock />}
              {t("finance.payables.scheduleConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PayDialog({ row, onClose }: { row: PayableView | undefined; onClose: () => void }) {
  const { t, money } = useLocale()
  const pay = useFinanceCommand(payPayable)
  const [actionKey] = useActionKey()
  if (!row) return null
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md" data-testid="payable-pay-dialog">
        <DialogHeader>
          <DialogTitle>{t("finance.payables.payTitle", { vendor: row.vendor ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("finance.payables.payBody", {
              amount: money(row.payable.amountP),
              invoice: row.vendorInvoice?.vendorInvoiceNo ?? "",
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-4 py-3">
          <MoneyText poisha={row.payable.amountP} className="text-[1.375rem] font-semibold" />
          <SimulatedBadge />
        </div>
        <DialogFooter>
          <Button type="button" variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            data-testid="payable-pay-confirm"
            disabled={pay.pending}
            onClick={async () => {
              const done = await pay.run({
                payableId: row.payable.id,
                expectedVersion: row.payable.version,
                idempotencyKey: actionKey,
              })
              if (done) onClose()
            }}
          >
            {pay.pending ? <LoaderCircle className="animate-spin" /> : <Send />}
            {t("finance.payables.payConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
