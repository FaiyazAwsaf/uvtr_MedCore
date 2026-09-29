"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { BadgeCheck, CircleAlert, Download, History, LoaderCircle, NotebookTabs } from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { companies, type CompanyCode } from "@/config/brand.config"
import { addDaysISO } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { NativeSelect } from "@/modules/identity/components/desk-ui"

import { recordExport } from "../commands"
import { journalCsv, journalFileName, type AccountKey } from "../journal"
import { exportHistory, journalPreview } from "../queries"
import {
  DocNo,
  downloadText,
  LiveChip,
  OfflineBranchesNotice,
  PageBody,
  PageHeader,
  useActionKey,
  useDayOptions,
  useFinanceCommand,
  useToday,
} from "./shared"

/**
 * `/finance/export` (plan §3.13, simulated connector): pick a company and a
 * day, preview its journal built from that day's records (balanced, debit
 * equals credit), then download the CSV and record the export. A payment
 * taken at a counter today shows in today's preview at once.
 */
export function ExportScreen() {
  const db = useDb()
  const { t, tk, locale, num } = useLocale()
  const today = useToday()
  const [companyId, setCompanyId] = React.useState<CompanyCode>("C1")
  const [date, setDate] = React.useState<string | null>(null)
  const day = date ?? (today ? addDaysISO(today, -1) : "")
  const journal = useLiveQuery(
    () => (day ? journalPreview(db, day, companyId) : undefined),
    [db, day, companyId]
  )
  const history = useLiveQuery(() => exportHistory(db), [db])
  const days = useDayOptions(today, -31)
  const record = useFinanceCommand(recordExport)
  const [actionKey, nextKey] = useActionKey()
  const [done, setDone] = React.useState<string | null>(null)

  const accountName = (account: AccountKey) => {
    if (account.startsWith("revenue.")) {
      return `${t("finance.export.revenuePrefix")}: ${tk(`finance.serviceType.${account.slice("revenue.".length)}`)}`
    }
    return tk(`finance.accounts.${account}`)
  }

  const download = async () => {
    if (!journal || !journal.balanced) return
    const result = await record.run({
      date: journal.date,
      companyId: journal.companyId,
      totalDebitP: journal.totalDebitP,
      totalCreditP: journal.totalCreditP,
      rows: journal.rows.length,
      idempotencyKey: actionKey,
    })
    if (!result) return
    downloadText(journalFileName(journal.companyId, journal.date), journalCsv(journal))
    setDone(result.fileName)
    nextKey()
  }

  return (
    <PageBody className="@container/page" data-testid="export-screen">
      <PageHeader title={t("finance.export.title")} subtitle={t("finance.export.subtitle")} actions={<LiveChip />} />

      <OfflineBranchesNotice />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-72 max-w-full flex-col gap-1.5">
          <Label htmlFor="export-company">{t("finance.export.company")}</Label>
          <NativeSelect
            id="export-company"
            data-testid="export-company"
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value as CompanyCode)
              setDone(null)
            }}
          >
            {companies.map((company) => (
              <option key={company.code} value={company.code}>
                {company.name[locale]} ({company.code})
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex w-60 max-w-full flex-col gap-1.5">
          <Label htmlFor="export-date">{t("finance.export.date")}</Label>
          <NativeSelect
            id="export-date"
            data-testid="export-date"
            value={day}
            onChange={(event) => {
              setDate(event.target.value)
              setDone(null)
            }}
          >
            {days.map((option, index) => (
              <option key={option.value} value={option.value}>
                {index === 0
                  ? t("finance.export.today", { date: option.label })
                  : index === 1
                    ? t("finance.export.yesterday", { date: option.label })
                    : option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <SectionCard
        title={t("finance.export.previewTitle")}
        subtitle={
          journal
            ? t("finance.export.previewCaption", {
                invoices: num(journal.counts.invoices),
                payments: num(journal.counts.payments),
                creditNotes: num(journal.counts.creditNotes),
                accruals: num(journal.counts.accruals),
                deposits: num(journal.counts.deposits),
                payables: num(journal.counts.payables),
              })
            : undefined
        }
        icon={NotebookTabs}
        size="sm"
        action={
          <span className="hidden items-center gap-2 @min-[40rem]/page:flex">
            <SimulatedBadge label={t("finance.export.sent")} />
          </span>
        }
      >
        {!journal ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div
            data-testid="export-preview"
            data-debit={journal.totalDebitP}
            data-credit={journal.totalCreditP}
            data-balanced={journal.balanced ? "true" : "false"}
            data-rows={journal.rows.length}
            className="@container/jr flex flex-col gap-3"
          >
            {journal.rows.length === 0 ? (
              <EmptyState size="sm" icon={NotebookTabs} title={t("finance.export.empty")} />
            ) : (
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden @min-[34rem]/jr:table-cell">{t("finance.export.col.code")}</TableHead>
                    <TableHead>{t("finance.export.col.account")}</TableHead>
                    <TableHead className="hidden @min-[46rem]/jr:table-cell">{t("finance.export.col.memo")}</TableHead>
                    <TableHead className="text-right">{t("finance.export.col.debit")}</TableHead>
                    <TableHead className="text-right">{t("finance.export.col.credit")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journal.rows.map((row) => (
                    <TableRow key={row.key} data-testid="journal-row" data-account={row.account} data-section={row.section}>
                      <TableCell className="hidden @min-[34rem]/jr:table-cell">
                        <DocNo>{row.code}</DocNo>
                      </TableCell>
                      <TableCell className={cn("max-w-64 truncate", row.creditP > 0 && "pl-8")}>
                        {accountName(row.account)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground @min-[46rem]/jr:table-cell">
                        {tk(`finance.export.section.${row.section}`)}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.debitP ? <MoneyText poisha={row.debitP} /> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.creditP ? <MoneyText poisha={row.creditP} /> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="hidden @min-[34rem]/jr:table-cell" />
                    <TableCell>{t("finance.export.total")}</TableCell>
                    <TableCell className="hidden @min-[46rem]/jr:table-cell" />
                    <TableCell className="text-right">
                      <MoneyText poisha={journal.totalDebitP} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText poisha={journal.totalCreditP} />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p
                className={cn(
                  "flex items-center gap-2 text-sm font-semibold",
                  journal.balanced ? "text-success" : "text-destructive"
                )}
              >
                {journal.balanced ? <BadgeCheck className="size-4" /> : <CircleAlert className="size-4" />}
                {journal.balanced ? t("finance.export.balanced") : t("finance.export.unbalanced")}
              </p>
              <span className="flex items-center gap-2">
                <SimulatedBadge className="@min-[40rem]/page:hidden" />
                <Button
                  data-testid="export-download"
                  disabled={!journal.balanced || record.pending}
                  onClick={() => void download()}
                >
                  {record.pending ? <LoaderCircle className="animate-spin" /> : <Download />}
                  {t("finance.export.download")}
                </Button>
              </span>
            </div>
            {done ? (
              <p
                data-testid="export-done"
                className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-[0.8125rem] font-medium text-link"
              >
                <BadgeCheck className="size-4" />
                {t("finance.export.done", { fileName: done })}
              </p>
            ) : null}
          </div>
        )}
      </SectionCard>

      <SectionCard title={t("finance.export.historyTitle")} icon={History} size="sm">
        {!history ? (
          <Skeleton className="h-24 w-full" />
        ) : history.length === 0 ? (
          <EmptyState size="sm" icon={History} title={t("finance.export.empty")} />
        ) : (
          <div className="@container/hist">
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("finance.export.history.date")}</TableHead>
                  <TableHead>{t("finance.export.history.company")}</TableHead>
                  <TableHead className="hidden text-right @min-[34rem]/hist:table-cell">{t("finance.export.history.rows")}</TableHead>
                  <TableHead className="text-right">{t("finance.export.history.debit")}</TableHead>
                  <TableHead className="hidden text-right @min-[44rem]/hist:table-cell">{t("finance.export.history.credit")}</TableHead>
                  <TableHead className="hidden @min-[56rem]/hist:table-cell">{t("finance.export.history.file")}</TableHead>
                  <TableHead className="hidden @min-[64rem]/hist:table-cell">{t("finance.export.history.by")}</TableHead>
                  <TableHead className="hidden @min-[50rem]/hist:table-cell">{t("finance.export.history.at")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(({ row, by }) => (
                  <TableRow key={row.id} data-testid="export-row" data-export-id={row.id} data-company={row.companyId}>
                    <TableCell>
                      <DateText value={row.date} />
                    </TableCell>
                    <TableCell>
                      <DocNo>{row.companyId}</DocNo>
                    </TableCell>
                    <TableCell className="hidden text-right @min-[34rem]/hist:table-cell">{num(row.rows)}</TableCell>
                    <TableCell className="text-right">
                      <MoneyText poisha={row.totalDebitP} />
                    </TableCell>
                    <TableCell className="hidden text-right @min-[44rem]/hist:table-cell">
                      <MoneyText poisha={row.totalCreditP} />
                    </TableCell>
                    <TableCell className="hidden @min-[56rem]/hist:table-cell">
                      <DocNo>{row.fileName}</DocNo>
                    </TableCell>
                    <TableCell className="hidden max-w-40 truncate @min-[64rem]/hist:table-cell">
                      {by ? by[locale] : row.exportedBy}
                    </TableCell>
                    <TableCell className="hidden @min-[50rem]/hist:table-cell">
                      <DateText value={row.createdAt} variant="dmyTime" />
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
