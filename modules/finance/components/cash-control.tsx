"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import {
  Banknote,
  FileWarning,
  Hourglass,
  ReceiptText,
  Scale,
  SearchX,
  Smartphone,
  Store,
  WifiOff,
} from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText, type Tone } from "@/components/shared/status"
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
import type { PaymentRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

import { cashControl, VARIANCE_THRESHOLD_P } from "../queries"
import {
  BranchFilter,
  branchLabel,
  branchOrNull,
  DocNo,
  FinanceKpis,
  LiveChip,
  OfflineBranchesNotice,
  PageBody,
  PageHeader,
  TenderTag,
  useBranchFilter,
  useToday,
} from "./shared"

const QUEUE_TONE: Partial<Record<PaymentRow["status"], Tone>> = {
  pending: "warning",
  timeout: "destructive",
  failed: "destructive",
}

/**
 * `/finance` cash control (plan §9, objective §7): what sits in every open
 * drawer now, recent closed shifts with their variances and who approved
 * them, bKash and Nagad payments still to reconcile, settlement lines no
 * payment explains, and receipts issued offline. Live across windows.
 */
export function CashControlScreen() {
  const db = useDb()
  const { t, tk, money, num, locale } = useLocale()
  const today = useToday()
  const [branch, setBranch] = useBranchFilter()
  const data = useLiveQuery(
    () => (today ? cashControl(db, branchOrNull(branch), today) : undefined),
    [db, branch, today]
  )
  const kpi = data?.kpi

  return (
    <PageBody className="@container/page" data-testid="cash-control">
      <PageHeader title={t("finance.cash.title")} subtitle={t("finance.cash.subtitle")} actions={<LiveChip />} />
      <OfflineBranchesNotice />
      <BranchFilter value={branch} onChange={setBranch} />

      <FinanceKpis
        label={t("finance.cash.title")}
        items={[
          {
            key: "drawers",
            variant: "cyan",
            icon: Banknote,
            title: t("finance.cash.kpi.drawers"),
            value: money(kpi?.drawerCashP ?? 0),
            caption: t("finance.cash.kpi.drawersCaption", { count: num(kpi?.openShifts ?? 0) }),
            testId: "cash-kpi-drawers",
          },
          {
            key: "pending",
            variant: "yellow",
            icon: Hourglass,
            title: t("finance.cash.kpi.pendingMfs"),
            value: money(kpi?.pendingMfsP ?? 0),
            caption: t("finance.cash.kpi.pendingMfsCaption", {
              count: num(kpi?.pendingMfs ?? 0),
              timedOut: num(kpi?.timedOut ?? 0),
            }),
          },
          {
            key: "unmatched",
            variant: "pink",
            icon: FileWarning,
            title: t("finance.cash.kpi.unmatched"),
            value: num(kpi?.unmatchedLines ?? 0),
            caption: t("finance.cash.kpi.unmatchedCaption", { amount: money(kpi?.unmatchedP ?? 0) }),
            href: "/finance/mfs",
          },
          {
            key: "variances",
            variant: "purple",
            icon: Scale,
            title: t("finance.cash.kpi.variances"),
            value: money(kpi?.varianceWeekP ?? 0),
            caption: t("finance.cash.kpi.variancesCaption", { count: num(kpi?.varianceShifts ?? 0) }),
          },
        ]}
      />

      {/* Open shifts */}
      <SectionCard
        title={t("finance.cash.open.title")}
        subtitle={t("finance.cash.open.subtitle")}
        icon={Store}
        size="sm"
      >
        {!data ? (
          <Skeleton className="h-24 w-full" />
        ) : data.openShifts.length === 0 ? (
          <EmptyState size="sm" icon={Store} title={t("finance.cash.open.empty")} />
        ) : (
          <div className="@container/open">
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("finance.cash.col.branch")}</TableHead>
                  <TableHead>{t("finance.cash.col.cashier")}</TableHead>
                  <TableHead className="hidden @min-[34rem]/open:table-cell">{t("finance.cash.col.opened")}</TableHead>
                  <TableHead className="hidden text-right @min-[48rem]/open:table-cell">{t("finance.cash.col.float")}</TableHead>
                  <TableHead className="text-right">{t("finance.cash.col.cashIn")}</TableHead>
                  <TableHead className="hidden text-right @min-[62rem]/open:table-cell">{t("finance.cash.col.deposits")}</TableHead>
                  <TableHead className="hidden text-right @min-[62rem]/open:table-cell">{t("finance.cash.col.refunds")}</TableHead>
                  <TableHead className="text-right">{t("finance.cash.col.expected")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.openShifts.map(({ shift, cashier, summary }) => (
                  <TableRow
                    key={shift.id}
                    data-testid="cash-shift-row"
                    data-shift-id={shift.id}
                    data-expected={summary.expectedCashP}
                  >
                    <TableCell>{branchLabel(shift.branchId, locale)}</TableCell>
                    <TableCell className="max-w-44 truncate">{cashier ? cashier[locale] : shift.cashierId}</TableCell>
                    <TableCell className="hidden @min-[34rem]/open:table-cell">
                      <DateText value={shift.openedAt} variant="dmyTime" />
                    </TableCell>
                    <TableCell className="hidden text-right @min-[48rem]/open:table-cell">
                      <MoneyText poisha={shift.floatP} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText poisha={summary.cashInP} />
                    </TableCell>
                    <TableCell className="hidden text-right @min-[62rem]/open:table-cell">
                      <MoneyText poisha={summary.cashDepositsP} />
                    </TableCell>
                    <TableCell className="hidden text-right @min-[62rem]/open:table-cell">
                      <MoneyText poisha={-summary.cashRefundsP} colorize />
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <MoneyText poisha={summary.expectedCashP} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <div className="grid items-start gap-4 @min-[72rem]/page:grid-cols-2">
        {/* Reconciliation queue */}
        <SectionCard title={t("finance.cash.mfs.title")} subtitle={t("finance.cash.mfs.subtitle")} icon={Smartphone} size="sm">
          {!data ? (
            <Skeleton className="h-20 w-full" />
          ) : data.queue.length === 0 ? (
            <EmptyState size="sm" icon={Smartphone} title={t("finance.cash.mfs.empty")} />
          ) : (
            <div className="@container/queue">
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("finance.cash.col.time")}</TableHead>
                    <TableHead className="hidden @min-[30rem]/queue:table-cell">{t("finance.cash.col.invoice")}</TableHead>
                    <TableHead className="hidden @min-[40rem]/queue:table-cell">{t("finance.cash.col.patient")}</TableHead>
                    <TableHead>{t("finance.cash.col.tender")}</TableHead>
                    <TableHead className="text-right">{t("finance.cash.col.amount")}</TableHead>
                    <TableHead>{t("finance.cash.col.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.queue.map(({ payment, invoiceNo, patient }) => (
                    <TableRow
                      key={payment.id}
                      data-testid="cash-mfs-row"
                      data-payment-id={payment.id}
                      data-status={payment.status}
                    >
                      <TableCell>
                        <DateText value={payment.requestedAt} variant="dmyTime" />
                      </TableCell>
                      <TableCell className="hidden @min-[30rem]/queue:table-cell">
                        <DocNo>{invoiceNo ?? ""}</DocNo>
                      </TableCell>
                      <TableCell className="hidden max-w-40 truncate @min-[40rem]/queue:table-cell">
                        {patient ? nameIn(patient, locale) : ""}
                      </TableCell>
                      <TableCell>
                        <TenderTag tender={payment.tender} />
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyText poisha={payment.amountP} />
                      </TableCell>
                      <TableCell className="max-w-48 truncate">
                        <StatusText tone={QUEUE_TONE[payment.status] ?? "muted"}>
                          {tk(`finance.cash.paymentStatus.${payment.status}`)}
                        </StatusText>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        {/* Settlement lines nobody has explained */}
        <SectionCard
          title={t("finance.cash.unmatched.title")}
          subtitle={t("finance.cash.unmatched.subtitle")}
          icon={SearchX}
          size="sm"
          seeAllHref="/finance/mfs"
          seeAllLabel={t("finance.cash.unmatched.open")}
        >
          {!data ? (
            <Skeleton className="h-20 w-full" />
          ) : data.unmatched.length === 0 ? (
            <EmptyState size="sm" icon={SearchX} title={t("finance.cash.unmatched.empty")} />
          ) : (
            <div className="@container/unm">
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("finance.cash.col.provider")}</TableHead>
                    <TableHead className="hidden @min-[30rem]/unm:table-cell">{t("finance.cash.col.date")}</TableHead>
                    <TableHead>{t("finance.cash.col.ref")}</TableHead>
                    <TableHead className="text-right">{t("finance.cash.col.amount")}</TableHead>
                    <TableHead className="hidden @min-[38rem]/unm:table-cell">{t("finance.cash.col.note")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.unmatched.map(({ settlementId, provider, date, line }) => (
                    <TableRow key={`${settlementId}:${line.ref}`} data-testid="cash-unmatched-row" data-ref={line.ref}>
                      <TableCell>{tk(`finance.provider.${provider}`)}</TableCell>
                      <TableCell className="hidden @min-[30rem]/unm:table-cell">
                        <DateText value={date} />
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/finance/mfs?file=${settlementId}`}
                          className="text-link underline-offset-4 hover:underline"
                        >
                          <DocNo>{line.ref}</DocNo>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyText poisha={line.amountP} />
                      </TableCell>
                      <TableCell className="hidden max-w-48 truncate text-muted-foreground @min-[38rem]/unm:table-cell">
                        {line.note ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Recent closed shifts and their variances */}
      <SectionCard
        title={t("finance.cash.closed.title")}
        subtitle={t("finance.cash.closed.subtitle", { threshold: money(VARIANCE_THRESHOLD_P) })}
        icon={Scale}
        size="sm"
      >
        {!data ? (
          <Skeleton className="h-20 w-full" />
        ) : data.closedShifts.length === 0 ? (
          <EmptyState size="sm" icon={Scale} title={t("finance.cash.closed.empty")} />
        ) : (
          <div className="@container/closed">
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("finance.cash.col.closedAt")}</TableHead>
                  <TableHead className="hidden @min-[36rem]/closed:table-cell">{t("finance.cash.col.branch")}</TableHead>
                  <TableHead>{t("finance.cash.col.cashier")}</TableHead>
                  <TableHead className="hidden text-right @min-[48rem]/closed:table-cell">{t("finance.cash.col.expected")}</TableHead>
                  <TableHead className="hidden text-right @min-[48rem]/closed:table-cell">{t("finance.cash.col.counted")}</TableHead>
                  <TableHead className="text-right">{t("finance.cash.col.variance")}</TableHead>
                  <TableHead>{t("finance.cash.col.approver")}</TableHead>
                  <TableHead className="hidden @min-[62rem]/closed:table-cell">{t("finance.cash.col.reason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.closedShifts.map(({ shift, cashier, approver, reason }) => (
                  <TableRow
                    key={shift.id}
                    data-testid="cash-variance-row"
                    data-shift-id={shift.id}
                    data-variance={shift.varianceP ?? 0}
                  >
                    <TableCell>
                      <DateText value={shift.closedAt ?? shift.updatedAt} variant="dmyTime" />
                    </TableCell>
                    <TableCell className="hidden @min-[36rem]/closed:table-cell">{branchLabel(shift.branchId, locale)}</TableCell>
                    <TableCell className="max-w-40 truncate">{cashier ? cashier[locale] : shift.cashierId}</TableCell>
                    <TableCell className="hidden text-right @min-[48rem]/closed:table-cell">
                      <MoneyText poisha={shift.expectedP ?? 0} />
                    </TableCell>
                    <TableCell className="hidden text-right @min-[48rem]/closed:table-cell">
                      <MoneyText poisha={shift.countedP ?? 0} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {shift.varianceP ? (
                        <MoneyText poisha={shift.varianceP} signed colorize />
                      ) : (
                        <StatusText tone="success">{t("finance.cash.closed.balanced")}</StatusText>
                      )}
                    </TableCell>
                    <TableCell className="max-w-40 truncate">
                      {approver ? (
                        approver[locale]
                      ) : (
                        <span className="text-muted-foreground">{t("finance.cash.closed.noApproval")}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-80 truncate text-muted-foreground @min-[62rem]/closed:table-cell" title={reason}>
                      {reason ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* Receipts issued while a branch was offline */}
      <SectionCard
        title={t("finance.cash.offline.title")}
        subtitle={t("finance.cash.offline.subtitle")}
        icon={WifiOff}
        size="sm"
        action={<StatusText tone="info" className="text-xs">{t("finance.cash.offline.info")}</StatusText>}
      >
        {!data ? (
          <Skeleton className="h-16 w-full" />
        ) : data.offline.length === 0 ? (
          <EmptyState size="sm" icon={ReceiptText} title={t("finance.cash.offline.empty")} />
        ) : (
          <div className="@container/off">
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("finance.cash.col.invoice")}</TableHead>
                  <TableHead className="hidden @min-[30rem]/off:table-cell">{t("finance.cash.col.branch")}</TableHead>
                  <TableHead>{t("finance.cash.col.time")}</TableHead>
                  <TableHead className="hidden @min-[40rem]/off:table-cell">{t("finance.cash.col.patient")}</TableHead>
                  <TableHead className="text-right">{t("finance.cash.col.amount")}</TableHead>
                  <TableHead className="hidden @min-[34rem]/off:table-cell">{t("finance.cash.col.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.offline.map(({ invoice, patient }) => (
                  <TableRow key={invoice.id} data-testid="cash-offline-row" data-invoice-id={invoice.id}>
                    <TableCell>
                      <DocNo>{invoice.invoiceNo}</DocNo>
                    </TableCell>
                    <TableCell className="hidden @min-[30rem]/off:table-cell">{branchLabel(invoice.branchId, locale)}</TableCell>
                    <TableCell>
                      <DateText value={invoice.createdAt} variant="dmyTime" />
                    </TableCell>
                    <TableCell className="hidden max-w-40 truncate @min-[40rem]/off:table-cell">
                      {patient ? nameIn(patient, locale) : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText poisha={invoice.totalP} />
                    </TableCell>
                    <TableCell className="hidden @min-[34rem]/off:table-cell">
                      <StatusText tone={invoice.status === "paid" ? "success" : "warning"}>
                        {tk(`finance.cash.invoiceStatus.${invoice.status}`)}
                      </StatusText>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </PageBody>
  )
}
