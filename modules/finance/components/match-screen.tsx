"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Ban, CheckCheck, FileCheck2, FileWarning, LoaderCircle, ShieldCheck } from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, StatusText } from "@/components/shared/status"
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
import { Textarea } from "@/components/ui/textarea"
import { rules as config } from "@/config/rules.config"
import { useDb } from "@/core/db/DbProvider"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { resolveMismatch } from "../commands"
import { matchWorklist, type MatchView } from "../queries"
import {
  acceptNeedsCfo,
  CFO_AUTHORITY,
  diffPct,
  holdsCfo,
  RESOLUTIONS,
  type Resolution,
} from "../rules"
import {
  BranchFilter,
  branchLabel,
  branchOrNull,
  DocNo,
  LiveChip,
  PageBody,
  PageHeader,
  useActionKey,
  useBranchFilter,
  useFinanceCommand,
  useFinancePersona,
} from "./shared"

const RESOLUTION_ICON: Record<Resolution, typeof CheckCheck> = {
  "pay-po-price": FileCheck2,
  "accept-invoice": CheckCheck,
  "reject-invoice": Ban,
}

/**
 * `/finance/match` (PRD §8.7): vendor invoices that failed the three-way
 * match, open mismatches first with their differences line by line, then the
 * recently resolved ones. Resolving pays at the PO price, accepts the
 * invoice (the CFO decides outside tolerance) or rejects it.
 */
export function MatchScreen() {
  const db = useDb()
  const { t, num } = useLocale()
  const [branch, setBranch] = useBranchFilter()
  const data = useLiveQuery(() => matchWorklist(db, branchOrNull(branch)), [db, branch])
  const [resolving, setResolving] = React.useState<{ id: string; resolution: Resolution } | null>(null)
  const current = data?.open.find((v) => v.match.id === resolving?.id)

  return (
    <PageBody className="@container/page" data-testid="match-screen">
      <PageHeader
        title={t("finance.match.title")}
        subtitle={t("finance.match.subtitle")}
        actions={<LiveChip />}
      />
      <BranchFilter value={branch} onChange={setBranch} />
      <p className="text-xs text-muted-foreground">
        {t("finance.match.tolerance", { pct: num(config.threeWayMatch.priceTolerancePct) })}
      </p>

      <SectionCard
        title={t("finance.match.open")}
        icon={FileWarning}
        size="sm"
        action={
          data ? (
            <StatusPill tone={data.open.length ? "warning" : "success"}>{num(data.open.length)}</StatusPill>
          ) : null
        }
      >
        {!data ? (
          <Skeleton className="h-40 w-full" />
        ) : data.open.length === 0 ? (
          <EmptyState size="sm" icon={CheckCheck} title={t("finance.match.emptyOpen")} />
        ) : (
          <div className="flex flex-col gap-4">
            {data.open.map((view) => (
              <MismatchCard
                key={view.match.id}
                view={view}
                onResolve={(resolution) => setResolving({ id: view.match.id, resolution })}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={t("finance.match.resolved")} icon={CheckCheck} size="sm">
        {!data ? (
          <Skeleton className="h-24 w-full" />
        ) : data.resolved.length === 0 ? (
          <EmptyState size="sm" icon={CheckCheck} title={t("finance.match.emptyResolved")} />
        ) : (
          <ResolvedTable views={data.resolved} />
        )}
      </SectionCard>

      {current && resolving ? (
        <ResolveDialog view={current} initial={resolving.resolution} onClose={() => setResolving(null)} />
      ) : null}
    </PageBody>
  )
}

function MismatchCard({ view, onResolve }: { view: MatchView; onResolve: (r: Resolution) => void }) {
  const { t, tk, num, dec, locale } = useLocale()
  const invoice = view.vendorInvoice
  return (
    <article
      data-testid="match-row"
      data-match-id={view.match.id}
      data-status={view.match.status}
      className="@container/mm flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="icon-well flex size-9 items-center justify-center text-destructive">
            <FileWarning className="size-[1.125rem]" />
          </span>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-baseline gap-2 font-semibold">
              <DocNo className="text-sm">{view.poNo}</DocNo>
              <span className="truncate">{view.vendor}</span>
            </h3>
            <p className="text-xs text-muted-foreground">{branchLabel(view.branchId, locale)}</p>
          </div>
        </div>
        <StatusText tone="destructive" dot>
          {tk(`finance.match.status.${view.match.status}`)}
        </StatusText>
      </header>

      <KeyValueGrid
        columns={4}
        items={[
          { label: t("finance.match.field.vi"), value: <DocNo>{invoice?.vendorInvoiceNo ?? ""}</DocNo> },
          {
            label: t("finance.match.field.vendorRef"),
            value: invoice?.vendorRef ? <DocNo>{invoice.vendorRef}</DocNo> : "-",
          },
          { label: t("finance.match.field.grn"), value: <DocNo>{view.grnNos.join(", ")}</DocNo> },
          {
            label: t("finance.match.field.received"),
            value: invoice ? <DateText value={invoice.invoiceDate ?? invoice.receivedAt} /> : "-",
          },
          { label: t("finance.match.field.invoiced"), value: <MoneyText poisha={invoice?.amountP ?? 0} /> },
          { label: t("finance.match.field.atPoPrice"), value: <MoneyText poisha={view.atPoPriceP} /> },
          {
            label: t("finance.match.field.difference"),
            value: <MoneyText poisha={(invoice?.amountP ?? 0) - view.atPoPriceP} signed colorize />,
          },
        ]}
      />

      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead>{t("finance.match.diff.item")}</TableHead>
            <TableHead className="hidden @min-[32rem]/mm:table-cell">{t("finance.match.diff.check")}</TableHead>
            <TableHead className="text-right">{t("finance.match.diff.po")}</TableHead>
            <TableHead className="hidden text-right @min-[40rem]/mm:table-cell">{t("finance.match.diff.grn")}</TableHead>
            <TableHead className="text-right">{t("finance.match.diff.invoice")}</TableHead>
            <TableHead className="text-right">{t("finance.match.diff.difference")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.diffs.map((diff, index) => {
            const pct = diffPct(diff)
            const value = (n: number) => (diff.field === "price" ? <MoneyText poisha={n} /> : num(n))
            return (
              <TableRow key={`${diff.poLineId}:${diff.field}:${index}`} data-testid="match-diff" data-field={diff.field}>
                <TableCell className="max-w-48 truncate" lang="en">
                  {diff.item}
                </TableCell>
                <TableCell className="hidden @min-[32rem]/mm:table-cell">
                  {tk(`finance.match.diff.${diff.field}`)}
                </TableCell>
                <TableCell className="text-right">{value(diff.po)}</TableCell>
                <TableCell className="hidden text-right @min-[40rem]/mm:table-cell">{value(diff.grn)}</TableCell>
                <TableCell className="text-right font-medium">{value(diff.invoice)}</TableCell>
                <TableCell className="text-right">
                  <StatusText tone="destructive">
                    {pct === null ? "-" : `${pct > 0 ? "+" : ""}${dec(pct, 1)}%`}
                  </StatusText>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center gap-2">
        {RESOLUTIONS.map((resolution) => {
          const Icon = RESOLUTION_ICON[resolution]
          return (
            <Button
              key={resolution}
              size="sm"
              variant={
                resolution === "pay-po-price"
                  ? "default"
                  : resolution === "reject-invoice"
                    ? "destructive-outline"
                    : "outline"
              }
              data-testid="match-resolve"
              data-resolution={resolution}
              onClick={() => onResolve(resolution)}
            >
              <Icon />
              {tk(`finance.resolution.${resolution}`)}
              {resolution === "accept-invoice" && acceptNeedsCfo(view.match.diffs) ? (
                <span className="rounded-full bg-primary-soft px-1.5 text-[0.6875rem]">{t("finance.common.cfo")}</span>
              ) : null}
            </Button>
          )
        })}
      </div>
    </article>
  )
}

function ResolveDialog({
  view,
  initial,
  onClose,
}: {
  view: MatchView
  initial: Resolution
  onClose: () => void
}) {
  const { t, tk, money } = useLocale()
  const { authorities } = useFinancePersona()
  const resolve = useFinanceCommand(resolveMismatch)
  const override = useSupervisorOverride()
  const [actionKey] = useActionKey()
  const [resolution, setResolution] = React.useState<Resolution>(initial)
  const [note, setNote] = React.useState("")
  const invoice = view.vendorInvoice
  const needsCfo = resolution === "accept-invoice" && acceptNeedsCfo(view.match.diffs)
  const noteMissing = resolution === "reject-invoice" && !note.trim()
  const amountOf = (r: Resolution) =>
    r === "pay-po-price" ? view.atPoPriceP : r === "accept-invoice" ? (invoice?.amountP ?? 0) : 0

  const submit = async () => {
    let approval
    if (needsCfo && !holdsCfo(authorities)) {
      const granted = await override.request({
        authority: CFO_AUTHORITY,
        title: t("finance.match.cfoTitle"),
        description: t("finance.match.cfoDescription", {
          vendorInvoiceNo: invoice?.vendorInvoiceNo ?? "",
          amount: money(invoice?.amountP ?? 0),
        }),
      })
      if (!granted) return
      approval = {
        approverStaffId: granted.approverStaffId,
        reason: granted.reason,
        pinVerified: true as const,
      }
    }
    const done = await resolve.run({
      matchId: view.match.id,
      expectedVersion: view.match.version,
      resolution,
      note: note.trim() || undefined,
      approval,
      idempotencyKey: actionKey,
    })
    if (done) onClose()
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="sm:max-w-lg" data-testid="match-resolve-dialog">
          <DialogHeader>
            <DialogTitle>{t("finance.match.resolveTitle", { vendorInvoiceNo: invoice?.vendorInvoiceNo ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("finance.match.resolveBody", { poNo: view.poNo, vendor: view.vendor ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div role="radiogroup" className="flex flex-col gap-2">
            {RESOLUTIONS.map((r) => {
              const Icon = RESOLUTION_ICON[r]
              const active = r === resolution
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid="match-resolution-option"
                  data-resolution={r}
                  onClick={() => setResolution(r)}
                  className={cn(
                    "flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                    active ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-raised"
                  )}
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", r === "reject-invoice" ? "text-destructive" : "text-link")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{tk(`finance.resolution.${r}`)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {tk(`finance.match.option.${r}`, { amount: money(amountOf(r)) })}
                    </span>
                    {r === "accept-invoice" && acceptNeedsCfo(view.match.diffs) ? (
                      <span className="mt-1 flex items-center gap-1 text-xs font-medium text-link">
                        <ShieldCheck className="size-3.5" />
                        {t("finance.match.cfoHint")}
                      </span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="match-note">{t("finance.match.noteLabel")}</Label>
            <Textarea
              id="match-note"
              data-testid="match-note"
              value={note}
              maxLength={300}
              placeholder={t("finance.match.notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              aria-invalid={noteMissing}
              className="min-h-16"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              data-testid="match-resolve-confirm"
              variant={resolution === "reject-invoice" ? "destructive" : "default"}
              disabled={noteMissing || resolve.pending}
              onClick={() => void submit()}
            >
              {resolve.pending ? <LoaderCircle className="animate-spin" /> : needsCfo ? <ShieldCheck /> : <CheckCheck />}
              {t("finance.match.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {override.dialog}
    </>
  )
}

function ResolvedTable({ views }: { views: MatchView[] }) {
  const { t, tk, locale, dmy } = useLocale()
  return (
    <div className="@container/res">
      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead>{t("finance.match.field.po")}</TableHead>
            <TableHead className="hidden @min-[36rem]/res:table-cell">{t("finance.match.field.vendor")}</TableHead>
            <TableHead className="hidden @min-[46rem]/res:table-cell">{t("finance.match.field.vi")}</TableHead>
            <TableHead>{t("finance.common.status")}</TableHead>
            <TableHead className="text-right">{t("finance.common.amount")}</TableHead>
            <TableHead className="hidden @min-[56rem]/res:table-cell">{t("finance.common.note")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {views.map((view) => {
            const resolution = view.match.resolution
            return (
              <TableRow
                key={view.match.id}
                data-testid="match-row"
                data-match-id={view.match.id}
                data-status={view.match.status}
                data-resolution={resolution}
              >
                <TableCell>
                  <DocNo>{view.poNo}</DocNo>
                </TableCell>
                <TableCell className="hidden max-w-40 truncate @min-[36rem]/res:table-cell">{view.vendor}</TableCell>
                <TableCell className="hidden @min-[46rem]/res:table-cell">
                  <DocNo>{view.vendorInvoice?.vendorInvoiceNo ?? ""}</DocNo>
                </TableCell>
                <TableCell className="max-w-72">
                  <StatusText tone={resolution === "reject-invoice" ? "destructive" : "success"}>
                    {resolution ? tk(`finance.resolution.${resolution}`) : tk(`finance.match.status.${view.match.status}`)}
                  </StatusText>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[
                      view.resolvedBy ? view.resolvedBy[locale] : undefined,
                      view.match.resolvedAt ? dmy(view.match.resolvedAt) : undefined,
                      view.approver ? t("finance.common.approvedBy", { name: view.approver[locale] }) : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {view.payable ? (
                    <MoneyText poisha={view.payable.amountP} />
                  ) : (
                    <StatusText tone="muted">{t("finance.match.rejected")}</StatusText>
                  )}
                </TableCell>
                <TableCell className="hidden max-w-64 truncate text-muted-foreground @min-[56rem]/res:table-cell" title={view.match.note}>
                  {view.match.note ?? ""}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
