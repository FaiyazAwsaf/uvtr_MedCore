"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { FileCheck2, FileText, PackageOpen, Printer, Send } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id, VendorRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { NativeSelect } from "@/modules/identity/components/desk-ui"
import { brandLabel } from "@/modules/inventory/stock"
import {
  branchName,
  LiveChip,
  PageBody,
  PageHeader,
  useActionKey,
  useModuleCommand,
} from "@/modules/pharmacy/components/shared"

import { acceptedOf, pendingOf, poProgress, suggestedVendorId } from "../calc"
import { issuePo } from "../commands"
import { loadPoDetail, loadPos, loadPrs, type PoDetail, type PrItem } from "../queries"
import {
  GrnStatusText,
  PoStatusPill,
  ProgressText,
  QtyText,
  useArrivals,
  ViStatusText,
} from "./bits"
import { GrnSheet, PoSheet, PrintDialog } from "./print"
import { StoreBranchPicker, useStoreBranch } from "./store-context"
import { VendorInvoiceDialog } from "./vendor-invoice-dialog"

/**
 * "/store/po" (plan §9): approved requests ready to order, the orders with
 * their delivery progress ("80 received · 20 pending"), and `?po=<id>` for
 * one order with its receipts, vendor invoices and match results.
 */
export function PoScreen() {
  const params = useSearchParams()
  const poId = params.get("po")
  if (poId) return <PoDetailView key={poId} poId={poId} />
  return <PoList />
}

/* ================================================================== *
 * List
 * ================================================================== */

function PoList() {
  const { t, locale } = useLocale()
  const db = useDb()
  const router = useRouter()
  const { branch, label } = useStoreBranch()
  const ready = useLiveQuery(() => loadPrs(db, branch, { status: ["approved"] }), [db, branch])
  const orders = useLiveQuery(() => loadPos(db, branch), [db, branch])
  const [issuing, setIssuing] = React.useState<PrItem | null>(null)
  const fresh = useArrivals(orders?.items.map((i) => i.po.id))

  return (
    <PageBody data-testid="po-screen">
      <PageHeader
        title={t("procurement.orders.title")}
        subtitle={
          branch
            ? t("procurement.orders.subtitle", { branch: label })
            : t("procurement.orders.subtitleNetwork")
        }
        actions={
          <>
            <LiveChip />
            <StoreBranchPicker />
          </>
        }
      />

      {ready && ready.items.length ? (
        <SectionCard title={t("procurement.orders.ready.title")} icon={Send} size="sm">
          <ul className="flex flex-col divide-y divide-hairline">
            {ready.items.map((item) => (
              <li
                key={item.pr.id}
                data-testid="po-ready-row"
                data-pr-no={item.pr.prNo}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5"
              >
                <span className="min-w-0 flex-1 basis-56">
                  <span className="font-mono text-sm font-semibold" lang="en">
                    {item.pr.prNo}
                  </span>
                  <span className="ml-2 text-[0.8125rem] text-muted-foreground">
                    {branchName(item.pr.branchId, locale)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.lines
                      .map((l) => {
                        const brand = ready.brands.get(l.brandId)
                        return brand ? brandLabel(brand) : ""
                      })
                      .join(", ")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("procurement.orders.ready.approvedBy", {
                      name: item.decider ? nameIn(item.decider, locale) : "",
                    })}
                  </span>
                </span>
                <MoneyText poisha={item.pr.totalP} className="font-semibold" />
                <Button
                  data-testid="po-issue"
                  data-pr-no={item.pr.prNo}
                  size="sm"
                  onClick={() => setIssuing(item)}
                >
                  <FileText />
                  {t("procurement.orders.ready.issue")}
                </Button>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <section className="@container/t surface-card flex flex-col gap-3 p-4">
        <h2 className="text-[0.9375rem] font-semibold">{t("procurement.orders.list")}</h2>
        {orders && orders.items.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t("procurement.orders.empty")}
            description={t("procurement.orders.emptyHint")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procurement.orders.col.po")}</TableHead>
                <TableHead className="hidden @min-[38rem]/t:table-cell">
                  {t("procurement.orders.col.vendor")}
                </TableHead>
                <TableHead className="hidden @min-[56rem]/t:table-cell">
                  {t("procurement.orders.col.issued")}
                </TableHead>
                <TableHead className="hidden text-right @min-[30rem]/t:table-cell">
                  {t("procurement.orders.col.total")}
                </TableHead>
                <TableHead>{t("procurement.orders.col.progress")}</TableHead>
                <TableHead>{t("procurement.orders.col.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(orders?.items ?? []).map(({ po, lines, vendor }) => {
                const progress = poProgress(lines)
                return (
                  <TableRow
                    key={po.id}
                    data-testid="po-row"
                    data-po-no={po.poNo}
                    data-status={po.status}
                    onClick={() => router.push(`/store/po?po=${po.id}`)}
                    className={`cursor-pointer ${fresh.has(po.id) ? "flash-sync" : ""}`}
                  >
                    <TableCell>
                      <span className="block font-mono text-xs font-semibold" lang="en">
                        {po.poNo}
                      </span>
                      {!branch ? (
                        <span className="text-xs text-muted-foreground">
                          {branchName(po.branchId, locale)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden max-w-64 truncate @min-[38rem]/t:table-cell">
                      {vendor?.name}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground @min-[56rem]/t:table-cell">
                      <DateText value={po.issuedAt} />
                    </TableCell>
                    <TableCell className="hidden text-right @min-[30rem]/t:table-cell">
                      <MoneyText poisha={po.totalP} />
                    </TableCell>
                    <TableCell className="text-[0.8125rem]">
                      <ProgressText
                        lines={lines}
                        data-testid="po-pending"
                        data-po-no={po.poNo}
                        data-pending={progress.pending}
                        className="nums whitespace-nowrap"
                      />
                    </TableCell>
                    <TableCell>
                      <PoStatusPill status={po.status} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>
      <IssueDialog item={issuing} onClose={() => setIssuing(null)} />
    </PageBody>
  )
}

/* ================================================================== *
 * Issue a PO from an approved request
 * ================================================================== */

function IssueDialog({ item, onClose }: { item: PrItem | null; onClose: () => void }) {
  const { t, money } = useLocale()
  const db = useDb()
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(issuePo)
  const [expected, setExpected] = React.useState(() => addDaysISO(dhakaDate(now()), 3))
  const [chosen, setChosen] = React.useState<Record<Id, Id>>({})
  const data = useLiveQuery(async () => {
    if (!item) return undefined
    const [vendors, brands] = await Promise.all([
      db.vendors.toArray(),
      db.brands.bulkGet(item.lines.map((l) => l.brandId)),
    ])
    return {
      vendors: vendors.sort((a, b) => a.name.localeCompare(b.name)),
      brands: new Map(brands.filter(Boolean).map((b) => [b!.id, b!])),
    }
  }, [db, item])

  const close = () => {
    setChosen({})
    onClose()
  }
  const vendorFor = (lineId: Id, brandId: Id): Id => {
    const brand = data?.brands.get(brandId)
    return chosen[lineId] ?? item?.pr.vendorId ?? (brand ? suggestedVendorId(brand) : "")
  }
  const groups = new Map<Id, number>()
  for (const line of item?.lines ?? []) {
    const vendorId = vendorFor(line.id, line.brandId)
    groups.set(vendorId, (groups.get(vendorId) ?? 0) + line.lineTotalP)
  }
  const vendorName = (id: Id) => data?.vendors.find((v: VendorRow) => v.id === id)?.name ?? id

  const submit = async () => {
    if (!item) return
    const result = await command.run({
      prId: item.pr.id,
      vendors: item.lines.map((line) => ({
        prLineId: line.id,
        vendorId: vendorFor(line.id, line.brandId),
      })),
      expectedDate: expected,
      expectedVersion: item.pr.version,
      idempotencyKey: key,
    })
    renewKey()
    if (result) {
      for (const po of result.pos) {
        toast.success(
          t("procurement.orders.issueDialog.done", { poNo: po.poNo, vendor: vendorName(po.vendorId) })
        )
      }
      close()
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="sm:max-w-xl" data-testid="po-issue-dialog">
        <DialogHeader>
          <DialogTitle>
            {t("procurement.orders.issueDialog.title", { prNo: item?.pr.prNo ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("procurement.orders.issueDialog.body")}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {(item?.lines ?? []).map((line) => {
            const brand = data?.brands.get(line.brandId)
            return (
              <li key={line.id} className="flex flex-col gap-2 rounded-md bg-surface-raised/60 p-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="min-w-0 flex-1 font-medium" lang="en">
                    {brand ? brandLabel(brand) : ""}
                  </span>
                  <QtyText qty={line.qty} pack={line.pack} brand={brand} showUnits={false} className="text-[0.8125rem] text-muted-foreground" />
                  <MoneyText poisha={line.lineTotalP} className="text-[0.8125rem] font-medium" />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t("procurement.orders.issueDialog.supplier")}
                  <NativeSelect
                    data-testid="po-vendor"
                    value={vendorFor(line.id, line.brandId)}
                    onChange={(event) =>
                      setChosen((prev) => ({ ...prev, [line.id]: event.target.value }))
                    }
                    className="h-8 text-[0.8125rem]"
                  >
                    {(data?.vendors ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="po-expected">{t("procurement.orders.issueDialog.expected")}</Label>
            <Input
              id="po-expected"
              data-testid="po-expected"
              type="date"
              value={expected}
              onChange={(event) => setExpected(event.target.value)}
              className="w-44"
            />
          </div>
          <ul className="text-right text-[0.8125rem]">
            {[...groups].map(([vendorId, totalP]) => (
              <li key={vendorId}>
                <span className="text-muted-foreground">{vendorName(vendorId)}</span>{" "}
                <span className="font-semibold">{money(totalP)}</span>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="po-issue-confirm"
            onClick={submit}
            disabled={!data || !expected || command.pending}
          >
            <FileText />
            {t("procurement.orders.issueDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ================================================================== *
 * One order
 * ================================================================== */

function PoDetailView({ poId }: { poId: Id }) {
  const { t, num, locale } = useLocale()
  const db = useDb()
  const detail = useLiveQuery(() => loadPoDetail(db, poId), [db, poId])
  const approver = useLiveQuery(
    async () => (detail?.pr?.decidedBy ? db.staff.get(detail.pr.decidedBy) : undefined),
    [db, detail?.pr?.decidedBy]
  )
  const [printing, setPrinting] = React.useState<"po" | Id | null>(null)
  const [invoicing, setInvoicing] = React.useState(false)
  if (detail === undefined) return null
  if (detail === null) return <PoList />
  const { po, vendor, pr, lines } = detail
  const open = po.status === "issued" || po.status === "partial"
  const progress = poProgress(lines)
  const grnPrint = detail.grns.find((g) => g.grn.id === printing)

  return (
    <PageBody data-testid="po-detail" data-po-no={po.poNo} data-status={po.status}>
      <PageHeader
        back={{ href: "/store/po", label: t("procurement.orders.detail.back") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono" lang="en">
              {po.poNo}
            </span>
            <PoStatusPill status={po.status} />
          </span>
        }
        subtitle={vendor?.name}
        actions={
          <>
            <LiveChip />
            <Button data-testid="po-print" size="sm" variant="outline" onClick={() => setPrinting("po")}>
              <Printer />
              {t("procurement.orders.detail.printPo")}
            </Button>
            {open ? (
              <Button
                size="sm"
                variant="outline"
                render={<Link href={`/store/grn?po=${po.id}`} />}
                nativeButton={false}
              >
                <PackageOpen />
                {t("procurement.orders.detail.receive")}
              </Button>
            ) : null}
            {detail.grns.length ? (
              <Button data-testid="vi-open" size="sm" onClick={() => setInvoicing(true)}>
                <FileCheck2 />
                {t("procurement.orders.detail.recordInvoice")}
              </Button>
            ) : null}
          </>
        }
      />

      <section className="surface-card flex flex-col gap-4 p-4">
        <KeyValueGrid
          columns={4}
          items={[
            { label: t("procurement.common.branch"), value: branchName(po.branchId, locale) },
            {
              label: t("procurement.orders.detail.issuedOn"),
              value: <DateText value={po.issuedAt} variant="dmyTime" />,
            },
            {
              label: t("procurement.orders.detail.expectedOn"),
              value: po.expectedAt ? <DateText value={po.expectedAt} /> : "-",
            },
            {
              label: t("procurement.orders.detail.terms"),
              value: vendor ? t("procurement.orders.detail.termsDays", { days: num(vendor.paymentTermsDays) }) : "-",
            },
          ]}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem]">
          {pr ? (
            <span className="text-muted-foreground">
              {t("procurement.orders.detail.fromPr", { prNo: pr.prNo })}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-2">
            <Send className="size-4 text-link" />
            {t("procurement.orders.detail.sent")}
            <SimulatedBadge />
          </span>
          <ProgressText
            lines={lines}
            data-testid="po-pending"
            data-po-no={po.poNo}
            data-pending={progress.pending}
            className="nums ml-auto font-semibold"
          />
        </div>
      </section>

      <section className="@container/t surface-card flex flex-col gap-3 p-4">
        <h2 className="text-[0.9375rem] font-semibold">{t("procurement.orders.detail.lines")}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("procurement.common.item")}</TableHead>
              <TableHead>{t("procurement.orders.detail.ordered")}</TableHead>
              <TableHead className="text-right">{t("procurement.orders.detail.accepted")}</TableHead>
              <TableHead className="hidden text-right @min-[36rem]/t:table-cell">
                {t("procurement.orders.detail.rejected")}
              </TableHead>
              <TableHead className="text-right">{t("procurement.orders.detail.pending")}</TableHead>
              <TableHead className="hidden text-right @min-[46rem]/t:table-cell">
                {t("procurement.orders.detail.price")}
              </TableHead>
              <TableHead className="hidden text-right @min-[54rem]/t:table-cell">
                {t("procurement.orders.detail.amount")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const brand = detail.brands.get(line.brandId)
              return (
                <TableRow key={line.id} data-testid="po-line" data-po-line-id={line.id}>
                  <TableCell className="font-medium" lang="en">
                    {brand ? brandLabel(brand) : ""}
                  </TableCell>
                  <TableCell>
                    <QtyText qty={line.qtyOrdered} pack={line.pack} brand={brand} />
                  </TableCell>
                  <TableCell className="nums text-right text-success">{num(acceptedOf(line))}</TableCell>
                  <TableCell className="nums hidden text-right @min-[36rem]/t:table-cell">
                    {line.qtyRejected ? (
                      <span className="text-destructive">{num(line.qtyRejected)}</span>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="nums text-right font-medium">{num(pendingOf(line))}</TableCell>
                  <TableCell className="hidden text-right @min-[46rem]/t:table-cell">
                    <MoneyText poisha={line.unitCostP} />
                  </TableCell>
                  <TableCell className="hidden text-right @min-[54rem]/t:table-cell">
                    <MoneyText poisha={line.qtyOrdered * line.unitCostP} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <p className="flex items-baseline justify-end gap-3 text-sm">
          <span className="text-muted-foreground">{t("procurement.common.total")}</span>
          <MoneyText poisha={po.totalP} className="figure text-[1.25rem]" />
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 min-[1200px]:grid-cols-2">
        <GrnsCard detail={detail} onPrint={(id) => setPrinting(id)} />
        <InvoicesCard detail={detail} />
      </div>

      <PrintDialog
        open={printing === "po"}
        onClose={() => setPrinting(null)}
        title={t("procurement.orders.print.previewTitle", { poNo: po.poNo })}
      >
        <PoSheet detail={detail} approver={approver} />
      </PrintDialog>
      <PrintDialog
        open={!!grnPrint}
        onClose={() => setPrinting(null)}
        title={t("procurement.grn.print.previewTitle", { grnNo: grnPrint?.grn.grnNo ?? "" })}
      >
        {grnPrint ? <GrnSheet detail={detail} item={grnPrint} /> : null}
      </PrintDialog>
      <VendorInvoiceDialog poId={invoicing ? po.id : null} onClose={() => setInvoicing(false)} />
    </PageBody>
  )
}

function GrnsCard({ detail, onPrint }: { detail: PoDetail; onPrint: (grnId: Id) => void }) {
  const { t, num, locale } = useLocale()
  return (
    <SectionCard title={t("procurement.orders.detail.grns")} icon={PackageOpen} size="sm">
      {detail.grns.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground">{t("procurement.orders.detail.noGrns")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {detail.grns.map((item) => {
            const sum = (key: "qtyReceived" | "qtyAccepted" | "qtyRejected") =>
              item.lines.reduce((s, l) => s + l[key], 0)
            return (
              <li key={item.grn.id} data-testid="po-grn" data-grn-no={item.grn.grnNo} className="py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[0.8125rem] font-semibold" lang="en">
                    {item.grn.grnNo}
                  </span>
                  <GrnStatusText status={item.grn.status} />
                  <span className="text-xs text-muted-foreground">
                    <DateText value={item.grn.receivedAt} variant="dmyTime" />
                    {item.receivedBy ? ` · ${nameIn(item.receivedBy, locale)}` : ""}
                  </span>
                  <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onPrint(item.grn.id)}>
                    <Printer />
                    {t("procurement.orders.detail.printGrn")}
                  </Button>
                </div>
                <p className="nums text-xs text-muted-foreground">
                  {t("procurement.orders.detail.grnLine", {
                    received: num(sum("qtyReceived")),
                    accepted: num(sum("qtyAccepted")),
                    rejected: num(sum("qtyRejected")),
                  })}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {item.lines.map((line) => (
                    <li key={line.id} className="flex flex-wrap gap-x-3 text-xs">
                      <span className="font-mono" lang="en">
                        {line.batchNo}
                      </span>
                      <DateText value={line.expiry} className="text-muted-foreground" />
                      <span className="nums">{num(line.qtyReceived)}</span>
                      {line.rejectReason ? (
                        <StatusText tone="warning" className="text-xs">
                          {t(`procurement.rejectReason.${line.rejectReason}`)}
                          {line.quarantine ? ` · ${t("procurement.grn.print.quarantine")}` : ""}
                        </StatusText>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </SectionCard>
  )
}

function InvoicesCard({ detail }: { detail: PoDetail }) {
  const { t, num, dmy } = useLocale()
  return (
    <SectionCard title={t("procurement.orders.detail.invoices")} icon={FileCheck2} size="sm">
      {detail.invoices.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t("procurement.orders.detail.noInvoices")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {detail.invoices.map(({ invoice, match, payable }) => (
            <li
              key={invoice.id}
              data-testid="po-invoice"
              data-status={invoice.status}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[0.8125rem] font-semibold" lang="en">
                  {invoice.vendorInvoiceNo}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {invoice.vendorRef
                    ? t("procurement.orders.detail.vendorRef", { ref: invoice.vendorRef })
                    : ""}
                  {invoice.invoiceDate ? ` · ${dmy(invoice.invoiceDate)}` : ""}
                </span>
                {payable ? (
                  <span className="block text-xs text-muted-foreground">
                    {t("procurement.orders.detail.due", { date: dmy(payable.dueDate) })}
                  </span>
                ) : null}
                {match && match.diffs.length ? (
                  <span className="block text-xs text-destructive">
                    {t("procurement.orders.detail.diffs", { count: num(match.diffs.length) })}
                  </span>
                ) : null}
              </span>
              <MoneyText poisha={invoice.amountP} className="font-medium" />
              <ViStatusText status={invoice.status} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
