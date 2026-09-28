"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { ChevronRight, Hourglass, ReceiptText, Search } from "lucide-react"

import { PatientAvatar } from "@/components/shared/avatars"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { PatientPicker } from "@/components/shared/patient-picker"
import { nameIn } from "@/components/shared/person"
import { SectionCard } from "@/components/shared/section-card"
import { UhidText } from "@/components/shared/uhid-text"
import { Skeleton } from "@/components/ui/skeleton"
import type { BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { dueInvoicesAt, openBillsAt, type DueInvoice, type OpenBill } from "../queries"
import { SOURCE_ICON, SOURCE_KEY, SOURCE_ORDER, TENDER_TAG } from "./labels"

const FIRST_PAGE = 8

/**
 * Finding who to bill (plan §9 `/cashier`): search by UHID, name or phone,
 * the live list of patients with open bills at this branch (newest first; a
 * bill that just arrived from the doctor flashes), and invoices still
 * waiting for money, such as a bKash push the customer has not approved.
 */
export function PatientFinder({
  branch,
  onSelect,
  compact = false,
}: {
  branch: BranchCode
  onSelect: (patientId: Id, invoiceId?: Id) => void
  /** Beside an open bill: search box and list only, no card chrome */
  compact?: boolean
}) {
  const { t } = useLocale()
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SectionCard
        title={t("billing.cashier.search.title")}
        subtitle={compact ? undefined : t("billing.cashier.search.hint")}
        icon={Search}
        size="sm"
      >
        <div data-testid="cashier-search">
          <PatientPicker onSelect={(patient) => onSelect(patient.id)} />
        </div>
      </SectionCard>
      <DueInvoicesCard branch={branch} onSelect={onSelect} />
      <OpenBillsCard branch={branch} onSelect={onSelect} compact={compact} />
    </div>
  )
}

function OpenBillsCard({
  branch,
  onSelect,
  compact,
}: {
  branch: BranchCode
  onSelect: (patientId: Id) => void
  compact: boolean
}) {
  const db = useDb()
  const { t, num, locale } = useLocale()
  const bills = useLiveQuery(() => openBillsAt(db, branch), [db, branch])
  const [showAll, setShowAll] = React.useState(false)
  // Rows newer than this screen flash once when they arrive (live sync).
  const [mountedAt] = React.useState(() => now())
  const visible = showAll ? bills : bills?.slice(0, FIRST_PAGE)

  return (
    <SectionCard
      title={t("billing.cashier.openBills.title")}
      subtitle={
        bills
          ? t("billing.cashier.openBills.subtitle", { count: num(bills.length) })
          : undefined
      }
      icon={ReceiptText}
      size="sm"
      bodyClassName="-mx-1.5"
      onSeeAll={
        bills && bills.length > FIRST_PAGE ? () => setShowAll((value) => !value) : undefined
      }
      seeAllLabel={
        showAll
          ? t("billing.cashier.openBills.showFewer")
          : t("billing.cashier.openBills.showAll", { count: num(bills?.length ?? 0) })
      }
    >
      {!bills ? (
        <div className="flex flex-col gap-2 px-1.5">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-12 w-full" />
          ))}
        </div>
      ) : bills.length === 0 ? (
        <EmptyState size="sm" icon={ReceiptText} title={t("billing.cashier.openBills.empty")} />
      ) : (
        <ul className="flex flex-col">
          {visible!.map((bill) => (
            <li
              key={`${bill.patient.id}:${bill.latestAt}`}
              className="border-b border-hairline last:border-0"
            >
              <OpenBillRow
                bill={bill}
                fresh={bill.latestAt > mountedAt}
                compact={compact}
                locale={locale}
                onSelect={() => onSelect(bill.patient.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function OpenBillRow({
  bill,
  fresh,
  compact,
  locale,
  onSelect,
}: {
  bill: OpenBill
  fresh: boolean
  compact: boolean
  locale: "en" | "bn"
  onSelect: () => void
}) {
  const { t, num } = useLocale()
  return (
    <button
      type="button"
      data-testid="cashier-open-bill"
      data-patient-id={bill.patient.id}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-1.5 py-2.5 text-left transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/35",
        fresh && "flash-sync"
      )}
    >
      <PatientAvatar patient={bill.patient} size={36} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{nameIn(bill.patient, locale)}</span>
          {!compact ? (
            <UhidText uhid={bill.patient.uhid} className="text-xs text-muted-foreground" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {SOURCE_ORDER.filter((source) => bill.counts[source]).map((source) => {
            const Icon = SOURCE_ICON[source]
            return (
              <span
                key={source}
                title={t(`billing.source.${SOURCE_KEY[source]}` as never)}
                className="inline-flex items-center gap-1"
              >
                <Icon className="size-3.5" />
                <span className="nums">{num(bill.counts[source] ?? 0)}</span>
              </span>
            )
          })}
          <span aria-hidden className="text-border">
            ·
          </span>
          <DateText value={bill.latestAt} variant="relative" />
        </span>
      </span>
      <MoneyText poisha={bill.totalP} className="text-[0.8125rem] font-semibold" />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function DueInvoicesCard({
  branch,
  onSelect,
}: {
  branch: BranchCode
  onSelect: (patientId: Id, invoiceId?: Id) => void
}) {
  const db = useDb()
  const { t, num, locale } = useLocale()
  const due = useLiveQuery(() => dueInvoicesAt(db, branch), [db, branch])
  if (!due?.length) return null
  return (
    <SectionCard
      title={t("billing.cashier.due.title")}
      subtitle={t("billing.cashier.due.subtitle", { count: num(due.length) })}
      icon={Hourglass}
      size="sm"
      bodyClassName="-mx-1.5"
    >
      <ul className="flex flex-col">
        {due.slice(0, 6).map((row) => (
          <li key={row.invoice.id} className="border-b border-hairline last:border-0">
            <DueRow row={row} locale={locale} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

function DueRow({
  row,
  locale,
  onSelect,
}: {
  row: DueInvoice
  locale: "en" | "bn"
  onSelect: (patientId: Id, invoiceId?: Id) => void
}) {
  const { t } = useLocale()
  const pending = row.pending[0]
  return (
    <button
      type="button"
      data-testid="cashier-due-invoice"
      data-invoice-id={row.invoice.id}
      onClick={() => onSelect(row.invoice.patientId, row.invoice.id)}
      className="flex w-full items-center gap-3 rounded-md px-1.5 py-2.5 text-left transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/35"
    >
      {row.patient ? <PatientAvatar patient={row.patient} size={32} /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-semibold">
          {row.patient ? nameIn(row.patient, locale) : row.invoice.patientId}
        </span>
        <span lang="en" className="truncate font-mono text-[0.6875rem] text-muted-foreground">
          {row.invoice.invoiceNo}
        </span>
      </span>
      {pending ? (
        <span className={cn("tag", TENDER_TAG[pending.tender])}>
          {t("billing.cashier.due.waiting", { tender: t(`billing.tender.${pending.tender}`) })}
        </span>
      ) : (
        <span className="text-xs font-medium text-warning">{t("billing.cashier.due.partial")}</span>
      )}
      <MoneyText poisha={row.dueP} className="text-[0.8125rem] font-semibold" />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}
