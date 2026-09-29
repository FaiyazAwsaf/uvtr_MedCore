"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  BadgeCheck,
  CircleAlert,
  Download,
  HandCoins,
  Percent,
  Printer,
  ReceiptText,
  Scale,
  Stethoscope,
} from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { UhidText } from "@/components/shared/uhid-text"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useDb } from "@/core/db/DbProvider"
import { HERO } from "@/core/seed/content/hero-ids"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { NativeSelect } from "@/modules/identity/components/desk-ui"

import { feeShareCsv } from "../csv"
import { feeShareDoctors, feeShareStatement, type FeeShareStatement, type StatementLine } from "../queries"
import { previousMonth } from "../rules"
import {
  DocNo,
  downloadText,
  FinanceKpis,
  PageBody,
  PageHeader,
  useFinancePersona,
  useMonthLabel,
  useToday,
} from "./shared"

/**
 * `/finance/fee-share` (PRD §10.9, plan §7.3): one consultant's statement for
 * one month. Every line shows the invoice line it came from and the contract
 * version it used; Reproduce recomputes each one with the same fee-share
 * maths billing used when the payment was collected. Read-only; printable
 * and downloadable.
 */
export function FeeShareScreen() {
  const db = useDb()
  const { t, locale } = useLocale()
  const today = useToday()
  const monthLabel = useMonthLabel()
  const doctors = useLiveQuery(() => feeShareDoctors(db), [db])
  const [doctorId, setDoctorId] = React.useState<string>(HERO.doctor.kamal)
  const [month, setMonth] = React.useState<string | null>(null)
  const [printing, setPrinting] = React.useState(false)

  const doctor = doctors?.find((d) => d.doctorId === doctorId) ?? doctors?.[0]
  const lastMonth = today ? previousMonth(today.slice(0, 7)) : ""
  const months = doctor?.months ?? []
  const activeMonth =
    (month && months.includes(month) ? month : null) ??
    (months.includes(lastMonth) ? lastMonth : months[0]) ??
    lastMonth
  const statement = useLiveQuery(
    () => (doctor && activeMonth ? feeShareStatement(db, doctor.doctorId, activeMonth) : undefined),
    [db, doctor?.doctorId, activeMonth]
  )
  const doctorName = doctor ? doctor.names[locale] : ""

  return (
    <PageBody className="@container/page" data-testid="fee-share-screen">
      <PageHeader
        title={t("finance.feeShare.title")}
        subtitle={t("finance.feeShare.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              data-testid="feeshare-csv"
              disabled={!statement?.lines.length}
              onClick={() =>
                statement &&
                downloadText(
                  `fee-share-${doctor?.doctorId ?? "doctor"}-${activeMonth}.csv`,
                  feeShareCsv(statement, doctor?.names.en ?? "")
                )
              }
            >
              <Download />
              {t("finance.common.csv")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="feeshare-print"
              disabled={!statement?.lines.length}
              onClick={() => setPrinting(true)}
            >
              <Printer />
              {t("finance.common.print")}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 @min-[40rem]/page:grid-cols-[minmax(0,22rem)_minmax(0,14rem)]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="feeshare-doctor">{t("finance.feeShare.doctor")}</Label>
          <NativeSelect
            id="feeshare-doctor"
            data-testid="feeshare-doctor"
            value={doctor?.doctorId ?? ""}
            onChange={(event) => {
              setDoctorId(event.target.value)
              setMonth(null)
            }}
          >
            {(doctors ?? []).map((d) => (
              <option key={d.doctorId} value={d.doctorId}>
                {d.names[locale]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="feeshare-month">{t("finance.feeShare.month")}</Label>
          <NativeSelect
            id="feeshare-month"
            data-testid="feeshare-month"
            value={activeMonth}
            onChange={(event) => setMonth(event.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {!statement ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : (
        <StatementView statement={statement} doctorName={doctorName} monthText={monthLabel(activeMonth)} />
      )}

      {printing && statement ? (
        <PrintDialog
          statement={statement}
          doctorName={doctorName}
          monthText={monthLabel(activeMonth)}
          onClose={() => setPrinting(false)}
        />
      ) : null}
    </PageBody>
  )
}

function StatementView({
  statement,
  doctorName,
  monthText,
}: {
  statement: FeeShareStatement
  doctorName: string
  monthText: string
}) {
  const { t, tk, money, num } = useLocale()
  const totals = statement.totals
  const ok = statement.failed.length === 0 && statement.lines.length > 0
  return (
    <>
      <FinanceKpis
        label={t("finance.feeShare.title")}
        items={[
          {
            key: "net",
            variant: "cyan",
            icon: ReceiptText,
            title: t("finance.feeShare.col.net"),
            value: money(totals.netP),
            caption: t("finance.feeShare.lines", { count: num(totals.lines) }),
          },
          {
            key: "share",
            variant: "yellow",
            icon: Percent,
            title: t("finance.feeShare.col.share"),
            value: money(totals.shareP),
            caption: t("finance.feeShare.reversals", { count: num(totals.reversals) }),
          },
          {
            key: "wht",
            variant: "pink",
            icon: Scale,
            title: t("finance.feeShare.wht"),
            value: money(totals.whtP),
            caption:
              statement.whtPct !== undefined
                ? t("finance.feeShare.whtValue", { pct: num(statement.whtPct) })
                : undefined,
          },
          {
            key: "payable",
            variant: "purple",
            icon: HandCoins,
            title: t("finance.feeShare.payableTotal"),
            value: money(totals.payableP),
            caption: monthText,
          },
        ]}
      />

      <div className="grid items-start gap-4 @min-[72rem]/page:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <SectionCard title={doctorName} subtitle={monthText} icon={Stethoscope} size="sm">
          <KeyValueGrid
            columns={3}
            items={[
              { label: t("finance.feeShare.bmdc"), value: statement.bmdcNo ?? "-", mono: true },
              {
                label: t("finance.feeShare.contract"),
                value: t("finance.feeShare.contractVersions", {
                  versions: statement.versions.map((v) => num(v)).join(", "),
                }),
              },
              {
                label: t("finance.feeShare.wht"),
                value:
                  statement.whtPct !== undefined
                    ? t("finance.feeShare.whtValue", { pct: num(statement.whtPct) })
                    : "-",
              },
              { label: t("finance.feeShare.month"), value: monthText },
              { label: t("finance.feeShare.col.basis"), value: t("finance.feeShare.trigger") },
            ]}
          />
        </SectionCard>

        <SectionCard title={t("finance.feeShare.reproduce.title")} icon={BadgeCheck} size="sm">
          <div
            data-testid="feeshare-reproduce"
            data-ok={ok ? "true" : "false"}
            data-count={statement.reproduced}
            className="flex flex-col gap-2"
          >
            <p
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold",
                ok ? "bg-primary-soft text-link" : "bg-surface-raised text-destructive"
              )}
            >
              {ok ? <BadgeCheck className="size-4" /> : <CircleAlert className="size-4" />}
              {ok
                ? t("finance.feeShare.reproduce.ok", { count: num(statement.reproduced) })
                : t("finance.feeShare.reproduce.fail", {
                    count: num(statement.failed.length),
                    total: num(statement.lines.length),
                  })}
            </p>
            <p className="text-xs text-muted-foreground">{t("finance.feeShare.reproduce.hint")}</p>
            {statement.failed.length ? (
              <ul className="flex flex-col gap-1 text-xs">
                {statement.failed.slice(0, 8).map((line) => (
                  <li key={line.accrual.id} className="flex justify-between gap-2">
                    <DocNo>{line.invoice?.invoiceNo ?? line.accrual.invoiceId}</DocNo>
                    <span className="text-destructive">
                      {line.reproduce.ok ? "" : tk(`finance.feeShare.reproduce.issue.${line.reproduce.issue}`)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <section className="@container/fs surface-card flex min-w-0 flex-col gap-3 p-4">
        {statement.lines.length === 0 ? (
          <EmptyState icon={Percent} title={t("finance.feeShare.empty")} />
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("finance.feeShare.col.date")}</TableHead>
                <TableHead>{t("finance.feeShare.col.invoice")}</TableHead>
                <TableHead className="hidden @min-[72rem]/fs:table-cell">{t("finance.feeShare.col.uhid")}</TableHead>
                <TableHead className="hidden @min-[64rem]/fs:table-cell">{t("finance.feeShare.col.service")}</TableHead>
                <TableHead className="hidden text-right @min-[70rem]/fs:table-cell">{t("finance.feeShare.col.gross")}</TableHead>
                <TableHead className="hidden text-right @min-[70rem]/fs:table-cell">{t("finance.feeShare.col.discount")}</TableHead>
                <TableHead className="text-right">{t("finance.feeShare.col.net")}</TableHead>
                <TableHead className="hidden @min-[80rem]/fs:table-cell">{t("finance.feeShare.col.basis")}</TableHead>
                <TableHead className="hidden text-right @min-[52rem]/fs:table-cell">{t("finance.feeShare.col.pct")}</TableHead>
                <TableHead className="text-right">{t("finance.feeShare.col.share")}</TableHead>
                <TableHead className="hidden text-right @min-[58rem]/fs:table-cell">{t("finance.feeShare.col.wht")}</TableHead>
                <TableHead className="text-right">{t("finance.feeShare.col.payable")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statement.lines.map((line) => (
                <FeeLine key={line.accrual.id} line={line} />
              ))}
            </TableBody>
            <TableFooter>
              <TableRow data-testid="feeshare-total" data-share={totals.shareP} data-payable={totals.payableP}>
                <TableCell colSpan={2}>{t("finance.feeShare.totals")}</TableCell>
                <TableCell className="hidden @min-[72rem]/fs:table-cell" />
                <TableCell className="hidden @min-[64rem]/fs:table-cell" />
                <TableCell className="hidden text-right @min-[70rem]/fs:table-cell">
                  <MoneyText poisha={totals.grossP} />
                </TableCell>
                <TableCell className="hidden text-right @min-[70rem]/fs:table-cell">
                  <MoneyText poisha={totals.discountP} />
                </TableCell>
                <TableCell className="text-right">
                  <MoneyText poisha={totals.netP} />
                </TableCell>
                <TableCell className="hidden @min-[80rem]/fs:table-cell" />
                <TableCell className="hidden @min-[52rem]/fs:table-cell" />
                <TableCell className="text-right">
                  <MoneyText poisha={totals.shareP} />
                </TableCell>
                <TableCell className="hidden text-right @min-[58rem]/fs:table-cell">
                  <MoneyText poisha={totals.whtP} />
                </TableCell>
                <TableCell className="text-right">
                  <MoneyText poisha={totals.payableP} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </section>
    </>
  )
}

function FeeLine({ line }: { line: StatementLine }) {
  const { t, tk, num, dmy, locale } = useLocale()
  const a = line.accrual
  const reversal = !!a.reversalOfId
  return (
    <TableRow
      data-testid="feeshare-line"
      data-accrual-id={a.id}
      data-reversal={reversal ? "true" : "false"}
      data-ok={line.reproduce.ok ? "true" : "false"}
      className={cn(reversal && "text-destructive")}
    >
      <TableCell>
        <DateText value={a.at} />
      </TableCell>
      <TableCell>
        <DocNo>{line.invoice?.invoiceNo ?? ""}</DocNo>
        {reversal && line.reverses ? (
          <span className="block text-xs">
            {t("finance.feeShare.reversal", {
              invoiceNo: line.reverses.invoiceNo ?? "",
              date: dmy(line.reverses.at),
            })}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="hidden @min-[72rem]/fs:table-cell">
        {a.patientUhid ? <UhidText uhid={a.patientUhid} /> : ""}
      </TableCell>
      <TableCell className="hidden max-w-56 truncate @min-[64rem]/fs:table-cell">
        {(locale === "bn" ? line.descriptionBn : undefined) ??
          line.description ??
          tk(`finance.serviceType.${a.serviceType}`)}
      </TableCell>
      <TableCell className="hidden text-right @min-[70rem]/fs:table-cell">
        <MoneyText poisha={a.grossP} />
      </TableCell>
      <TableCell className="hidden text-right @min-[70rem]/fs:table-cell">
        <MoneyText poisha={a.discountP} />
      </TableCell>
      <TableCell className="text-right">
        <MoneyText poisha={a.netP} />
      </TableCell>
      <TableCell className="hidden @min-[80rem]/fs:table-cell">
        {tk(`finance.feeShare.basis.${a.basis}`)}
      </TableCell>
      <TableCell className="hidden text-right @min-[52rem]/fs:table-cell">
        {line.pct !== undefined ? `${num(line.pct)}%` : "-"}
      </TableCell>
      <TableCell className="text-right font-medium">
        <MoneyText poisha={a.shareP} />
      </TableCell>
      <TableCell className="hidden text-right @min-[58rem]/fs:table-cell">
        <MoneyText poisha={a.whtP} />
      </TableCell>
      <TableCell className="text-right">
        <MoneyText poisha={a.shareP - a.whtP} />
      </TableCell>
    </TableRow>
  )
}

function PrintDialog({
  statement,
  doctorName,
  monthText,
  onClose,
}: {
  statement: FeeShareStatement
  doctorName: string
  monthText: string
  onClose: () => void
}) {
  const { t, money, num, dmy, uhid } = useLocale()
  const { persona } = useFinancePersona()
  const totals = statement.totals
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-3xl" data-testid="feeshare-print-dialog">
        <DialogHeader>
          <DialogTitle>{t("finance.feeShare.printTitle")}</DialogTitle>
        </DialogHeader>
        <div className="-mx-2 max-h-[65svh] overflow-auto rounded-md bg-surface-raised p-3">
          <PrintLayout
            size="A4"
            title={t("finance.feeShare.printTitle")}
            meta={t("finance.feeShare.printMeta", { month: monthText, doctor: doctorName })}
            footer={persona?.staff ? t("finance.feeShare.preparedBy", { name: persona.staff.nameEn }) : undefined}
          >
            <div className="mb-3 grid grid-cols-2 gap-1 text-[0.75rem]">
              <div>
                <b>{t("finance.feeShare.doctor")}:</b> {doctorName}
              </div>
              <div>
                <b>{t("finance.feeShare.bmdc")}:</b> <span lang="en">{statement.bmdcNo}</span>
              </div>
              <div>
                <b>{t("finance.feeShare.contract")}:</b>{" "}
                {t("finance.feeShare.contractVersions", { versions: statement.versions.map((v) => num(v)).join(", ") })}
              </div>
              <div>
                <b>{t("finance.feeShare.wht")}:</b>{" "}
                {statement.whtPct !== undefined ? t("finance.feeShare.whtValue", { pct: num(statement.whtPct) }) : "-"}
              </div>
            </div>
            <table className="w-full border-collapse text-[0.6875rem]">
              <thead>
                <tr className="border-b border-[#999] text-left">
                  <th className="py-1 pr-2">{t("finance.feeShare.col.date")}</th>
                  <th className="py-1 pr-2">{t("finance.feeShare.col.invoice")}</th>
                  <th className="py-1 pr-2">{t("finance.feeShare.col.uhid")}</th>
                  <th className="py-1 pr-2 text-right">{t("finance.feeShare.col.net")}</th>
                  <th className="py-1 pr-2 text-right">{t("finance.feeShare.col.share")}</th>
                  <th className="py-1 pr-2 text-right">{t("finance.feeShare.col.wht")}</th>
                  <th className="py-1 text-right">{t("finance.feeShare.col.payable")}</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((line) => (
                  <tr key={line.accrual.id} className="border-b border-[#e0e0e0]">
                    <td className="py-0.5 pr-2">{dmy(line.accrual.at)}</td>
                    <td className="py-0.5 pr-2 font-mono" lang="en">
                      {line.invoice?.invoiceNo ?? ""}
                    </td>
                    <td className="py-0.5 pr-2 font-mono" lang="en">
                      {line.accrual.patientUhid ? uhid(line.accrual.patientUhid) : ""}
                    </td>
                    <td className="py-0.5 pr-2 text-right">{money(line.accrual.netP)}</td>
                    <td className="py-0.5 pr-2 text-right">{money(line.accrual.shareP)}</td>
                    <td className="py-0.5 pr-2 text-right">{money(line.accrual.whtP)}</td>
                    <td className="py-0.5 text-right">{money(line.accrual.shareP - line.accrual.whtP)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#555] font-bold">
                  <td className="py-1" colSpan={3}>
                    {t("finance.feeShare.totals")}
                  </td>
                  <td className="py-1 pr-2 text-right">{money(totals.netP)}</td>
                  <td className="py-1 pr-2 text-right">{money(totals.shareP)}</td>
                  <td className="py-1 pr-2 text-right">{money(totals.whtP)}</td>
                  <td className="py-1 text-right">{money(totals.payableP)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-3 text-[0.75rem] font-semibold">
              {t("finance.feeShare.payableTotal")}: {money(totals.payableP)}
            </p>
          </PrintLayout>
        </div>
        <DialogFooter>
          <Button type="button" variant="neutral" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button type="button" onClick={() => window.print()}>
            <Printer />
            {t("common.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
