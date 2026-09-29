"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  Building2,
  FileMinus2,
  LoaderCircle,
  Printer,
  ReceiptText,
  ShieldCheck,
  Users,
} from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { PrintLayout } from "@/components/shared/print-layout"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { useSupervisorOverride } from "@/components/shared/supervisor-override-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/core/db/DbProvider"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { NativeSelect } from "@/modules/identity/components/desk-ui"

import { issueCorporateCreditNote } from "../commands"
import {
  corporateClients,
  corporateStatement,
  type CorporateClientView,
  type CorporateStatement,
  type CorporateStatementLine,
} from "../queries"
import { CFO_AUTHORITY, CORPORATE_CN_CFO_LIMIT_P, creditNoteRoomP, holdsCfo } from "../rules"
import {
  branchLabel,
  DocNo,
  LiveChip,
  PageBody,
  PageHeader,
  parseTaka,
  useActionKey,
  useFinanceCommand,
  useFinancePersona,
  useMonthLabel,
} from "./shared"

/**
 * `/finance/corporate` (PRD §10.10): each client's contract (the contract
 * price as a discount, the co-pay collected at the counter, the annual limit
 * per employee), its roster with what each member has used, and the monthly
 * company statement. A disputed line gets a credit note: it reduces what the
 * company owes and gives the amount back to the employee's limit.
 */
export function CorporateScreen() {
  const db = useDb()
  const { t } = useLocale()
  const clients = useLiveQuery(() => corporateClients(db), [db])
  const [clientId, setClientId] = React.useState<string | null>(null)
  const selected =
    clients?.find((c) => c.client.id === clientId) ?? clients?.find((c) => c.months.length > 0) ?? clients?.[0]

  return (
    <PageBody className="@container/page" data-testid="corporate-screen">
      <PageHeader title={t("finance.corporate.title")} subtitle={t("finance.corporate.subtitle")} actions={<LiveChip />} />
      {!clients ? (
        <Skeleton className="h-28 w-full rounded-lg" />
      ) : (
        <div className="grid gap-3 @min-[40rem]/page:grid-cols-3" role="tablist" aria-label={t("finance.corporate.clients")}>
          {clients.map((view) => (
            <ClientCard
              key={view.client.id}
              view={view}
              selected={view.client.id === selected?.client.id}
              onSelect={() => setClientId(view.client.id)}
            />
          ))}
        </div>
      )}
      {selected ? <ClientDetail key={selected.client.id} view={selected} /> : null}
    </PageBody>
  )
}

function ClientCard({
  view,
  selected,
  onSelect,
}: {
  view: CorporateClientView
  selected: boolean
  onSelect: () => void
}) {
  const { t, locale, num, money } = useLocale()
  const { client, contract } = view
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-testid="corp-client"
      data-client-id={client.id}
      onClick={onSelect}
      className={cn(
        "surface-card flex min-w-0 flex-col gap-2 border p-4 text-left transition-colors",
        selected ? "border-primary bg-primary-soft" : "border-transparent hover:bg-surface-raised"
      )}
    >
      <span className="flex items-center gap-2">
        <span className="icon-well flex size-8 shrink-0 items-center justify-center text-link">
          <Building2 className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{client.name[locale]}</span>
          <DocNo className="text-muted-foreground">{client.code}</DocNo>
        </span>
      </span>
      {contract ? (
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {t("finance.corporate.contract.discount")} {num(contract.discountPct)}%
          </span>
          <span>
            {t("finance.corporate.contract.coPay")} {num(contract.coPayPct)}%
          </span>
          <span>
            {t("finance.corporate.contract.limit")} {money(contract.annualLimitP)}
          </span>
        </span>
      ) : null}
    </button>
  )
}

function ClientDetail({ view }: { view: CorporateClientView }) {
  const db = useDb()
  const { t, tk, num, dmy, locale } = useLocale()
  const monthLabel = useMonthLabel()
  const [month, setMonth] = React.useState<string | null>(null)
  const activeMonth = (month && view.months.includes(month) ? month : null) ?? view.months[0] ?? ""
  const statement = useLiveQuery(
    () => (activeMonth ? corporateStatement(db, view.client.id, activeMonth) : undefined),
    [db, view.client.id, activeMonth]
  )
  const [crediting, setCrediting] = React.useState<string | null>(null)
  const [printing, setPrinting] = React.useState(false)
  const { contract } = view
  const creditLine = statement?.lines.find((l) => l.invoice.id === crediting)

  return (
    <>
      {contract ? (
        <SectionCard title={view.client.name[locale]} subtitle={view.client.contactName} icon={Building2} size="sm">
          <KeyValueGrid
            columns={4}
            items={[
              { label: t("finance.corporate.contract.discount"), value: `${num(contract.discountPct)}%` },
              { label: t("finance.corporate.contract.coPay"), value: `${num(contract.coPayPct)}%` },
              { label: t("finance.corporate.contract.limit"), value: <MoneyText poisha={contract.annualLimitP} /> },
              { label: t("finance.corporate.contract.creditLimit"), value: <MoneyText poisha={view.client.creditLimitP} /> },
              {
                label: t("finance.corporate.contract.validity"),
                value: t("finance.corporate.contract.validRange", {
                  from: dmy(contract.validFrom),
                  to: dmy(contract.validTo),
                }),
              },
              {
                label: t("finance.corporate.contract.covered"),
                value: contract.coveredServices.map((s) => tk(`finance.serviceType.${s}`)).join(", "),
                wide: true,
              },
              {
                label: t("finance.corporate.roster.title"),
                value: t("finance.corporate.contract.employees", { count: num(view.roster.length) }),
              },
            ]}
          />
        </SectionCard>
      ) : null}

      <SectionCard
        title={t("finance.corporate.statement.title")}
        icon={ReceiptText}
        size="sm"
        action={
          <span className="flex items-center gap-2">
            <NativeSelect
              aria-label={t("finance.corporate.statement.month")}
              data-testid="corp-month"
              value={activeMonth}
              onChange={(event) => setMonth(event.target.value)}
              className="h-8 w-44 text-[0.8125rem]"
            >
              {view.months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              data-testid="corp-print"
              disabled={!statement?.lines.length}
              onClick={() => setPrinting(true)}
            >
              <Printer />
              <span className="hidden @min-[48rem]/page:inline">{t("finance.corporate.statement.print")}</span>
            </Button>
          </span>
        }
      >
        {!activeMonth ? (
          <EmptyState size="sm" icon={ReceiptText} title={t("finance.corporate.statement.empty")} />
        ) : !statement ? (
          <Skeleton className="h-32 w-full" />
        ) : statement.lines.length === 0 ? (
          <EmptyState size="sm" icon={ReceiptText} title={t("finance.corporate.statement.empty")} />
        ) : (
          <StatementTable
            statement={statement}
            clientName={view.client.name[locale]}
            onCredit={(invoiceId) => setCrediting(invoiceId)}
          />
        )}
      </SectionCard>

      <RosterCard view={view} />

      {creditLine ? <CreditNoteDialog line={creditLine} onClose={() => setCrediting(null)} /> : null}
      {printing && statement ? (
        <StatementPrint
          statement={statement}
          view={view}
          monthText={monthLabel(activeMonth)}
          onClose={() => setPrinting(false)}
        />
      ) : null}
    </>
  )
}

function StatementTable({
  statement,
  clientName,
  onCredit,
}: {
  statement: CorporateStatement
  clientName: string
  onCredit: (invoiceId: string) => void
}) {
  const { t, tk, locale } = useLocale()
  const totals = statement.totals
  return (
    <div className="@container/cs flex flex-col gap-3">
      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead>{t("finance.corporate.statement.col.date")}</TableHead>
            <TableHead>{t("finance.corporate.statement.col.invoice")}</TableHead>
            <TableHead className="hidden @min-[78rem]/cs:table-cell">{t("finance.corporate.statement.col.branch")}</TableHead>
            <TableHead className="hidden @min-[62rem]/cs:table-cell">{t("finance.corporate.statement.col.patient")}</TableHead>
            <TableHead className="hidden @min-[70rem]/cs:table-cell">{t("finance.corporate.statement.col.services")}</TableHead>
            <TableHead className="hidden text-right @min-[46rem]/cs:table-cell">{t("finance.corporate.statement.col.total")}</TableHead>
            <TableHead className="text-right">{t("finance.corporate.statement.col.coPay")}</TableHead>
            <TableHead className="text-right">{t("finance.corporate.statement.col.share")}</TableHead>
            <TableHead className="hidden text-right @min-[54rem]/cs:table-cell">{t("finance.corporate.statement.col.credit")}</TableHead>
            <TableHead className="text-right">{t("finance.corporate.statement.col.due")}</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {statement.lines.map((line) => (
            <TableRow
              key={line.invoice.id}
              data-testid="corp-statement-line"
              data-invoice-id={line.invoice.id}
              data-share={line.money.companyShareP}
              data-copay={line.money.coPayP}
              data-due={line.money.dueP}
            >
              <TableCell>
                <DateText value={line.invoice.date} />
              </TableCell>
              <TableCell>
                <DocNo>{line.invoice.invoiceNo}</DocNo>
              </TableCell>
              <TableCell className="hidden @min-[78rem]/cs:table-cell">{branchLabel(line.invoice.branchId, locale)}</TableCell>
              <TableCell className="hidden max-w-48 @min-[62rem]/cs:table-cell">
                <span className="block truncate">{line.patient ? nameIn(line.patient, locale) : ""}</span>
                {line.employee ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    <DocNo>{line.employee.employeeNo}</DocNo> · {tk(`finance.corporate.relation.${line.employee.relation}`)}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="hidden max-w-56 truncate @min-[70rem]/cs:table-cell" lang="en" title={line.services.join(", ")}>
                {line.services.join(", ")}
              </TableCell>
              <TableCell className="hidden text-right @min-[46rem]/cs:table-cell">
                <MoneyText poisha={line.money.totalP} />
              </TableCell>
              <TableCell className="text-right">
                <MoneyText poisha={line.money.coPayP} />
              </TableCell>
              <TableCell className="text-right">
                <MoneyText poisha={line.money.companyShareP} />
              </TableCell>
              <TableCell className="hidden text-right @min-[54rem]/cs:table-cell">
                {line.money.creditNotesP ? (
                  <MoneyText poisha={-line.money.creditNotesP} colorize />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="text-right font-medium">
                <MoneyText poisha={line.money.dueP} />
              </TableCell>
              <TableCell className="text-right">
                {creditNoteRoomP(line.money) > 0 ? (
                  <button
                    type="button"
                    data-testid="corp-credit-note"
                    onClick={() => onCredit(line.invoice.id)}
                    className="text-[0.8125rem] font-medium whitespace-nowrap text-link underline-offset-4 hover:underline"
                  >
                    {t("finance.corporate.statement.creditNote")}
                  </button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>{t("finance.corporate.statement.totals")}</TableCell>
            <TableCell className="hidden @min-[78rem]/cs:table-cell" />
            <TableCell className="hidden @min-[62rem]/cs:table-cell" />
            <TableCell className="hidden @min-[70rem]/cs:table-cell" />
            <TableCell className="hidden text-right @min-[46rem]/cs:table-cell">
              <MoneyText poisha={totals.totalP} />
            </TableCell>
            <TableCell className="text-right">
              <MoneyText poisha={totals.coPayP} />
            </TableCell>
            <TableCell className="text-right">
              <MoneyText poisha={totals.companyShareP} />
            </TableCell>
            <TableCell className="hidden text-right @min-[54rem]/cs:table-cell">
              <MoneyText poisha={-totals.creditNotesP} colorize />
            </TableCell>
            <TableCell className="text-right">
              <MoneyText poisha={totals.dueP} />
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
      <div
        data-testid="corp-due"
        data-due={totals.dueP}
        className="flex items-baseline justify-between gap-3 rounded-md bg-primary-soft px-4 py-3"
      >
        <span className="text-sm font-medium">{t("finance.corporate.statement.due", { client: clientName })}</span>
        <MoneyText poisha={totals.dueP} className="text-[1.375rem] font-semibold" />
      </div>
    </div>
  )
}

function RosterCard({ view }: { view: CorporateClientView }) {
  const { t, tk, money, locale } = useLocale()
  const limit = view.contract?.annualLimitP ?? 0
  return (
    <SectionCard title={t("finance.corporate.roster.title")} icon={Users} size="sm">
      {view.roster.length === 0 ? (
        <EmptyState size="sm" icon={Users} title={t("finance.corporate.statement.empty")} />
      ) : (
        <div className="@container/ros">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("finance.corporate.roster.employeeNo")}</TableHead>
                <TableHead>{t("finance.corporate.roster.name")}</TableHead>
                <TableHead className="hidden @min-[36rem]/ros:table-cell">{t("finance.corporate.roster.relation")}</TableHead>
                <TableHead className="hidden @min-[46rem]/ros:table-cell">{t("finance.corporate.roster.status")}</TableHead>
                <TableHead>{t("finance.corporate.roster.used")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.roster.map(({ employee, patient }) => {
                const pct = limit ? Math.min(100, (employee.usedP * 100) / limit) : 0
                return (
                  <TableRow
                    key={employee.id}
                    data-testid="corp-roster-row"
                    data-employee-id={employee.id}
                    data-used={employee.usedP}
                  >
                    <TableCell>
                      <DocNo>{employee.employeeNo}</DocNo>
                    </TableCell>
                    <TableCell className="max-w-44 truncate">{patient ? nameIn(patient, locale) : employee.nameEn}</TableCell>
                    <TableCell className="hidden @min-[36rem]/ros:table-cell">
                      {tk(`finance.corporate.relation.${employee.relation}`)}
                    </TableCell>
                    <TableCell className="hidden @min-[46rem]/ros:table-cell">
                      <StatusText tone={employee.status === "active" ? "success" : "muted"}>
                        {tk(`finance.corporate.employeeStatus.${employee.status}`)}
                      </StatusText>
                    </TableCell>
                    <TableCell className="min-w-44">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-raised @min-[40rem]/ros:w-28">
                          <span
                            className={cn("block h-full rounded-full", pct > 80 ? "bg-destructive" : "bg-primary")}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="text-xs whitespace-nowrap">
                          {t("finance.corporate.roster.usedOf", { used: money(employee.usedP), limit: money(limit) })}
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  )
}

function CreditNoteDialog({ line, onClose }: { line: CorporateStatementLine; onClose: () => void }) {
  const { t, money } = useLocale()
  const { authorities } = useFinancePersona()
  const issue = useFinanceCommand(issueCorporateCreditNote)
  const override = useSupervisorOverride()
  const [actionKey] = useActionKey()
  const [amountText, setAmountText] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [done, setDone] = React.useState<string | null>(null)
  const room = creditNoteRoomP(line.money)
  const amountP = parseTaka(amountText)
  const valid = amountP !== null && amountP > 0 && amountP <= room && reason.trim().length >= 3
  const needsCfo = amountP !== null && amountP > CORPORATE_CN_CFO_LIMIT_P

  const submit = async () => {
    if (!valid || amountP === null) return
    let approval
    if (needsCfo && !holdsCfo(authorities)) {
      const granted = await override.request({
        authority: CFO_AUTHORITY,
        title: t("finance.corporate.cn.cfoTitle"),
        description: t("finance.corporate.cn.cfoDescription", {
          amount: money(amountP),
          invoiceNo: line.invoice.invoiceNo,
        }),
      })
      if (!granted) return
      approval = { approverStaffId: granted.approverStaffId, reason: granted.reason, pinVerified: true as const }
    }
    const result = await issue.run({
      invoiceId: line.invoice.id,
      amountP,
      reason: reason.trim(),
      approval,
      idempotencyKey: actionKey,
    })
    if (result) setDone(result.creditNoteNo)
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="sm:max-w-md" data-testid="corp-cn-dialog">
          <DialogHeader>
            <DialogTitle>{t("finance.corporate.cn.title", { invoiceNo: line.invoice.invoiceNo })}</DialogTitle>
            <DialogDescription>
              {t("finance.corporate.cn.body", {
                share: money(line.money.companyShareP),
                credited: money(line.money.creditNotesP),
              })}
            </DialogDescription>
          </DialogHeader>
          {done ? (
            <p
              data-testid="corp-cn-done"
              className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-sm font-medium text-link"
            >
              <FileMinus2 className="size-4" />
              {t("finance.corporate.cn.done", { creditNoteNo: done })}
            </p>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="corp-cn-amount">{t("finance.corporate.cn.amount")}</Label>
                <Input
                  id="corp-cn-amount"
                  data-testid="corp-cn-amount"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  aria-invalid={amountP !== null && (amountP <= 0 || amountP > room)}
                  className="nums"
                />
                <span className="text-xs text-muted-foreground">
                  {t("finance.corporate.cn.max", { amount: money(room) })}
                </span>
                {needsCfo ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-link">
                    <ShieldCheck className="size-3.5" />
                    {t("finance.corporate.cn.cfo", { limit: money(CORPORATE_CN_CFO_LIMIT_P) })}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="corp-cn-reason">{t("finance.corporate.cn.reason")}</Label>
                <Textarea
                  id="corp-cn-reason"
                  data-testid="corp-cn-reason"
                  value={reason}
                  maxLength={300}
                  placeholder={t("finance.corporate.cn.reasonPlaceholder")}
                  onChange={(event) => setReason(event.target.value)}
                  className="min-h-16"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="neutral" onClick={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" data-testid="corp-cn-save" disabled={!valid || issue.pending}>
                  {issue.pending ? <LoaderCircle className="animate-spin" /> : <FileMinus2 />}
                  {t("finance.corporate.cn.save")}
                </Button>
              </DialogFooter>
            </form>
          )}
          {done ? (
            <DialogFooter>
              <Button type="button" data-testid="corp-cn-close" onClick={onClose}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
      {override.dialog}
    </>
  )
}

function StatementPrint({
  statement,
  view,
  monthText,
  onClose,
}: {
  statement: CorporateStatement
  view: CorporateClientView
  monthText: string
  onClose: () => void
}) {
  const { t, money, dmy, locale } = useLocale()
  const clientName = view.client.name[locale]
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-3xl" data-testid="corp-print-dialog">
        <DialogHeader>
          <DialogTitle>{t("finance.corporate.statement.printTitle")}</DialogTitle>
        </DialogHeader>
        <div className="-mx-2 max-h-[65svh] overflow-auto rounded-md bg-surface-raised p-3">
          <PrintLayout
            size="A4"
            title={t("finance.corporate.statement.printTitle")}
            docNo={view.client.code}
            meta={t("finance.corporate.statement.printMeta", { client: clientName, month: monthText })}
          >
            <table className="w-full border-collapse text-[0.6875rem]">
              <thead>
                <tr className="border-b border-[#999] text-left">
                  <th className="py-1 pr-2">{t("finance.corporate.statement.col.date")}</th>
                  <th className="py-1 pr-2">{t("finance.corporate.statement.col.invoice")}</th>
                  <th className="py-1 pr-2">{t("finance.corporate.statement.col.employee")}</th>
                  <th className="py-1 pr-2 text-right">{t("finance.corporate.statement.col.total")}</th>
                  <th className="py-1 pr-2 text-right">{t("finance.corporate.statement.col.coPay")}</th>
                  <th className="py-1 pr-2 text-right">{t("finance.corporate.statement.col.share")}</th>
                  <th className="py-1 pr-2 text-right">{t("finance.corporate.statement.col.credit")}</th>
                  <th className="py-1 text-right">{t("finance.corporate.statement.col.due")}</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((line) => (
                  <tr key={line.invoice.id} className="border-b border-[#e0e0e0]">
                    <td className="py-0.5 pr-2">{dmy(line.invoice.date)}</td>
                    <td className="py-0.5 pr-2 font-mono" lang="en">
                      {line.invoice.invoiceNo}
                    </td>
                    <td className="py-0.5 pr-2 font-mono" lang="en">
                      {line.employee?.employeeNo ?? ""}
                    </td>
                    <td className="py-0.5 pr-2 text-right">{money(line.money.totalP)}</td>
                    <td className="py-0.5 pr-2 text-right">{money(line.money.coPayP)}</td>
                    <td className="py-0.5 pr-2 text-right">{money(line.money.companyShareP)}</td>
                    <td className="py-0.5 pr-2 text-right">
                      {line.money.creditNotesP ? money(-line.money.creditNotesP) : ""}
                    </td>
                    <td className="py-0.5 text-right">{money(line.money.dueP)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#555] font-bold">
                  <td className="py-1" colSpan={3}>
                    {t("finance.corporate.statement.totals")}
                  </td>
                  <td className="py-1 pr-2 text-right">{money(statement.totals.totalP)}</td>
                  <td className="py-1 pr-2 text-right">{money(statement.totals.coPayP)}</td>
                  <td className="py-1 pr-2 text-right">{money(statement.totals.companyShareP)}</td>
                  <td className="py-1 pr-2 text-right">{money(-statement.totals.creditNotesP)}</td>
                  <td className="py-1 text-right">{money(statement.totals.dueP)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-3 text-[0.8125rem] font-semibold">
              {t("finance.corporate.statement.due", { client: clientName })}: {money(statement.totals.dueP)}
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
