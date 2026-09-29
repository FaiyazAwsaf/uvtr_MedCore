"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { AlertTriangle, CheckCircle2, FileCheck2 } from "lucide-react"

import { DateField } from "@/components/shared/date-field"
import { MoneyText } from "@/components/shared/money-text"
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
import { rules } from "@/config/rules.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { brandLabel } from "@/modules/inventory/stock"
import { useActionKey, useModuleCommand } from "@/modules/pharmacy/components/shared"

import { acceptedNotInvoiced } from "../calc"
import { recordVendorInvoice } from "../commands"
import { loadPoDetail, type PoDetail } from "../queries"

type Result = Awaited<ReturnType<(typeof recordVendorInvoice)["run"]>>

type LineForm = { qty: string; price: string }

/** Poisha to the taka text an input shows ("91" or "96.46"). */
const takaText = (poisha: number) =>
  poisha % 100 === 0 ? String(poisha / 100) : (poisha / 100).toFixed(2)

/** The taka typed into an input, in poisha (NaN when it is not a number). */
const toPoisha = (text: string) => Math.round(Number(text.replace(/,/g, "")) * 100)

/**
 * Record a supplier's invoice for an order and see the three-way match at
 * once (objective §3D): lines start with what was accepted and not yet
 * billed, at the PO price. Matched: the payable is created for finance.
 * Mismatch: the differences, and the invoice goes to finance's worklist.
 */
export function VendorInvoiceDialog({ poId, onClose }: { poId: Id | null; onClose: () => void }) {
  const db = useDb()
  const detail = useLiveQuery(() => (poId ? loadPoDetail(db, poId) : null), [db, poId])
  return (
    <Dialog open={!!poId} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-2xl" data-testid="vi-dialog">
        {detail ? <InvoiceForm key={detail.po.id} detail={detail} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function InvoiceForm({ detail, onClose }: { detail: PoDetail; onClose: () => void }) {
  const { t, num, money, dmy } = useLocale()
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(recordVendorInvoice)
  const [result, setResult] = React.useState<Result | null>(null)
  const billable = React.useMemo(
    () =>
      acceptedNotInvoiced(
        detail.grns.flatMap((g) => g.lines),
        detail.invoices.map((i) => i.invoice)
      ),
    [detail]
  )
  const [ref, setRef] = React.useState("")
  const [date, setDate] = React.useState(() => dhakaDate(now()))
  const [form, setForm] = React.useState<Record<Id, LineForm>>(() =>
    Object.fromEntries(
      detail.lines.map((line) => [
        line.id,
        { qty: String(billable[line.id] ?? 0), price: takaText(line.unitCostP) },
      ])
    )
  )
  const lines = detail.lines.map((line) => {
    const f = form[line.id] ?? { qty: "0", price: takaText(line.unitCostP) }
    const qty = Math.round(Number(f.qty))
    const priceP = toPoisha(f.price)
    return { line, f, qty, priceP, amountP: qty > 0 && priceP >= 0 ? qty * priceP : 0 }
  })
  const totalP = lines.reduce((sum, l) => sum + l.amountP, 0)
  const nothing = detail.lines.every((line) => !(billable[line.id] > 0))
  const valid =
    ref.trim().length > 0 &&
    !!date &&
    lines.some((l) => l.qty > 0) &&
    lines.every((l) => Number.isFinite(l.qty) && l.qty >= 0 && Number.isFinite(l.priceP) && l.priceP >= 0)

  const submit = async () => {
    const out = await command.run({
      poId: detail.po.id,
      vendorRef: ref.trim(),
      invoiceDate: date,
      lines: lines
        .filter((l) => l.qty > 0)
        .map((l) => ({ poLineId: l.line.id, qty: l.qty, unitCostP: l.priceP })),
      idempotencyKey: key,
    })
    renewKey()
    if (out) setResult(out)
  }

  if (result) {
    const matched = result.status === "matched"
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("procurement.invoice.title", { poNo: detail.po.poNo })}</DialogTitle>
          <DialogDescription>
            {t("procurement.invoice.recordedAs", { vendorInvoiceNo: result.vendorInvoiceNo })}
          </DialogDescription>
        </DialogHeader>
        <div
          data-testid="vi-result"
          data-status={result.status}
          className={cn(
            "flex flex-col gap-3 rounded-md p-4",
            matched
              ? "bg-[color-mix(in_oklch,var(--success)_12%,transparent)]"
              : "bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)]"
          )}
        >
          <p className="flex items-center gap-2 text-sm font-semibold">
            {matched ? (
              <CheckCircle2 className="size-5 text-success" />
            ) : (
              <AlertTriangle className="size-5 text-destructive" />
            )}
            {matched
              ? t("procurement.invoice.matched", { date: result.dueDate ? dmy(result.dueDate) : "" })
              : t("procurement.invoice.mismatch")}
          </p>
          <p className="text-[0.8125rem] text-muted-foreground">
            {matched ? t("procurement.invoice.matchedHint") : t("procurement.invoice.mismatchHint")}
          </p>
          {!matched ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("procurement.invoice.diff.item")}</TableHead>
                  <TableHead>{t("procurement.invoice.diff.field")}</TableHead>
                  <TableHead className="text-right">{t("procurement.invoice.diff.po")}</TableHead>
                  <TableHead className="text-right">{t("procurement.invoice.diff.grn")}</TableHead>
                  <TableHead className="text-right">{t("procurement.invoice.diff.invoice")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.diffs.map((diff, index) => {
                  const line = detail.lines.find((l) => l.id === diff.poLineId)
                  const brand = line ? detail.brands.get(line.brandId) : undefined
                  const show = (value: number) =>
                    diff.field === "price" ? money(value) : num(value)
                  return (
                    <TableRow key={index} data-testid="vi-diff" data-field={diff.field}>
                      <TableCell lang="en">{brand ? brandLabel(brand) : ""}</TableCell>
                      <TableCell>{t(`procurement.invoice.diff.${diff.field}`)}</TableCell>
                      <TableCell className="nums text-right">{show(diff.po)}</TableCell>
                      <TableCell className="nums text-right">{show(diff.grn)}</TableCell>
                      <TableCell className="nums text-right font-semibold text-destructive">
                        {show(diff.invoice)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : null}
          {result.poClosed ? (
            <p className="text-[0.8125rem]">{t("procurement.invoice.closed", { poNo: detail.po.poNo })}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button data-testid="vi-close" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("procurement.invoice.title", { poNo: detail.po.poNo })}</DialogTitle>
        <DialogDescription>
          {t("procurement.invoice.body", { pct: num(rules.threeWayMatch.priceTolerancePct) })}
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vi-ref">{t("procurement.invoice.ref")}</Label>
          <Input
            id="vi-ref"
            data-testid="vi-ref"
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            placeholder={t("procurement.invoice.refPlaceholder")}
            autoComplete="off"
            lang="en"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vi-date">{t("procurement.invoice.date")}</Label>
          <DateField id="vi-date" data-testid="vi-date" value={date} onChange={setDate} />
        </div>
      </div>
      {nothing ? (
        <p className="text-[0.8125rem] text-muted-foreground">{t("procurement.invoice.nothing")}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {lines.map(({ line, f, amountP }) => {
          const brand = detail.brands.get(line.brandId)
          const set = (patch: Partial<LineForm>) =>
            setForm((prev) => ({ ...prev, [line.id]: { ...f, ...patch } }))
          return (
            <li
              key={line.id}
              data-testid="vi-line"
              data-po-line-id={line.id}
              className="grid grid-cols-2 items-end gap-3 rounded-md bg-surface-raised/60 p-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_7rem]"
            >
              <span className="col-span-2 min-w-0 sm:col-span-1">
                <span className="block truncate font-medium" lang="en">
                  {brand ? brandLabel(brand) : ""}
                </span>
                <span className="nums block text-xs text-muted-foreground">
                  {t("procurement.invoice.col.billable")}: {num(billable[line.id] ?? 0)}
                  {line.pack ? ` · ${line.pack.label}` : ""}
                </span>
              </span>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("procurement.invoice.col.qty")}
                <Input
                  data-testid="vi-qty"
                  type="number"
                  min={0}
                  value={f.qty}
                  onChange={(event) => set({ qty: event.target.value })}
                  className="nums h-8 text-center"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("procurement.invoice.col.price")}
                <Input
                  data-testid="vi-price"
                  inputMode="decimal"
                  value={f.price}
                  onChange={(event) => set({ price: event.target.value })}
                  className="nums h-8 text-right"
                />
                <span className="text-[0.6875rem]">
                  {t("procurement.invoice.poPrice", { price: money(line.unitCostP) })}
                </span>
              </label>
              <span className="flex flex-col items-end gap-1 self-start text-xs text-muted-foreground">
                {t("procurement.invoice.col.amount")}
                <MoneyText poisha={amountP} className="text-[0.8125rem] font-semibold text-foreground" />
              </span>
            </li>
          )
        })}
      </ul>
      <p className="flex items-baseline justify-end gap-3 text-sm">
        <span className="text-muted-foreground">{t("procurement.invoice.total")}</span>
        <MoneyText poisha={totalP} className="figure text-[1.25rem]" />
      </p>
      <DialogFooter>
        <Button variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button data-testid="vi-save" onClick={submit} disabled={!valid || command.pending}>
          <FileCheck2 />
          {t("procurement.invoice.save")}
        </Button>
      </DialogFooter>
    </>
  )
}
