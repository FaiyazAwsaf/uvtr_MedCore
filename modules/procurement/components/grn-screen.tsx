"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CheckCircle2,
  FileCheck2,
  PackageCheck,
  PackageOpen,
  Plus,
  Printer,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { DateField } from "@/components/shared/date-field"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { GrnLineRow, Id, PoLineRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
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

import { isShortExpiry, minExpiryFor, pendingOf, unitsPer } from "../calc"
import { receiveGoods } from "../commands"
import { loadPoDetail, loadPos, type PoDetail } from "../queries"
import { PoStatusPill, ProgressText, QtyText, unitWord, useItemsText } from "./bits"
import { GrnSheet, PrintDialog } from "./print"
import { StoreBranchPicker, useStoreBranch } from "./store-context"
import { VendorInvoiceDialog } from "./vendor-invoice-dialog"

type Reason = NonNullable<GrnLineRow["rejectReason"]>
const REASONS: Reason[] = ["damaged", "short-expiry", "wrong-item", "other"]

/**
 * "/store/grn" (plan §9, S12): the orders due at the branch, and
 * `?po=<id>` to receive one: lots with batch, expiry, received and rejected
 * packs, a reason and quarantine. A short-dated lot is proposed for refusal
 * as short expiry and quarantine as soon as its expiry is typed.
 */
export function GrnScreen() {
  const params = useSearchParams()
  const poId = params.get("po")
  if (poId) return <ReceiveView key={poId} poId={poId} />
  return <AwaitingList />
}

/* ================================================================== *
 * Orders due for delivery
 * ================================================================== */

function AwaitingList() {
  const { t, locale } = useLocale()
  const db = useDb()
  const router = useRouter()
  const { branch, label } = useStoreBranch()
  const today = dhakaDate(useNow(60_000) || now())
  const itemsText = useItemsText()
  const data = useLiveQuery(
    () => loadPos(db, branch, { status: ["issued", "partial"] }),
    [db, branch]
  )
  const items = [...(data?.items ?? [])].sort(
    (a, b) => (a.po.expectedAt ?? 0) - (b.po.expectedAt ?? 0) || a.po.poNo.localeCompare(b.po.poNo)
  )
  return (
    <PageBody data-testid="grn-screen">
      <PageHeader
        title={t("procurement.grn.title")}
        subtitle={
          branch ? t("procurement.grn.subtitle", { branch: label }) : t("procurement.grn.subtitleNetwork")
        }
        actions={
          <>
            <LiveChip />
            <StoreBranchPicker />
          </>
        }
      />
      <section className="@container/t surface-card flex flex-col gap-3 p-4">
        <h2 className="text-[0.9375rem] font-semibold">{t("procurement.grn.awaiting")}</h2>
        {data && items.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title={t("procurement.grn.empty")}
            description={t("procurement.grn.emptyHint")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procurement.orders.col.po")}</TableHead>
                <TableHead className="hidden @min-[36rem]/t:table-cell">
                  {t("procurement.orders.col.vendor")}
                </TableHead>
                <TableHead className="hidden @min-[48rem]/t:table-cell">
                  {t("procurement.orders.col.expected")}
                </TableHead>
                <TableHead>{t("procurement.orders.col.progress")}</TableHead>
                <TableHead className="hidden @min-[56rem]/t:table-cell">
                  {t("procurement.orders.col.status")}
                </TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(({ po, lines, vendor }) => {
                const late = po.expectedAt ? dhakaDate(po.expectedAt) < today : false
                return (
                  <TableRow key={po.id} data-testid="grn-po" data-po-no={po.poNo} data-status={po.status}>
                    <TableCell>
                      <span className="block font-mono text-xs font-semibold" lang="en">
                        {po.poNo}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {!branch ? `${branchName(po.branchId, locale)} · ` : ""}
                        {itemsText(lines.length)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-64 truncate @min-[36rem]/t:table-cell">
                      {vendor?.name}
                    </TableCell>
                    <TableCell className="hidden text-xs @min-[48rem]/t:table-cell">
                      {po.expectedAt ? (
                        <StatusText tone={late ? "destructive" : "muted"}>
                          <DateText value={po.expectedAt} />
                        </StatusText>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-[0.8125rem]">
                      <ProgressText lines={lines} className="nums whitespace-nowrap" />
                    </TableCell>
                    <TableCell className="hidden @min-[56rem]/t:table-cell">
                      <PoStatusPill status={po.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        data-testid="grn-receive"
                        size="sm"
                        onClick={() => router.push(`/store/grn?po=${po.id}`)}
                      >
                        <PackageCheck />
                        {t("procurement.grn.receive")}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </PageBody>
  )
}

/* ================================================================== *
 * Receive one order
 * ================================================================== */

type Lot = {
  key: string
  batchNo: string
  expiry: string
  received: string
  rejected: string
  reason: Reason | ""
  quarantine: boolean
  /** Set when the form proposed the short-expiry refusal itself */
  auto: boolean
}

type Posted = Awaited<ReturnType<(typeof receiveGoods)["run"]>>

const toInt = (text: string) => (text.trim() === "" ? 0 : Math.round(Number(text)))

function ReceiveView({ poId }: { poId: Id }) {
  const db = useDb()
  const detail = useLiveQuery(() => loadPoDetail(db, poId), [db, poId])
  const [posted, setPosted] = React.useState<Posted | null>(null)
  if (detail === undefined) return null
  if (detail === null) return <AwaitingList />
  if (posted) return <Done detail={detail} posted={posted} />
  return <ReceiveForm detail={detail} onPosted={setPosted} />
}

function ReceiveForm({ detail, onPosted }: { detail: PoDetail; onPosted: (p: Posted) => void }) {
  const { t, num, locale, dmy } = useLocale()
  const today = dhakaDate(useNow(60_000) || now())
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(receiveGoods)
  const { po, lines, vendor } = detail
  const open = po.status === "issued" || po.status === "partial"
  const [note, setNote] = React.useState("")
  const [lots, setLots] = React.useState<Record<Id, Lot[]>>(() =>
    Object.fromEntries(
      lines.map((line) => [line.id, [newLot(`${line.id}:0`, pendingOf(line))]])
    )
  )

  const setLot = (lineId: Id, lotKey: string, patch: Partial<Lot>) =>
    setLots((prev) => ({
      ...prev,
      [lineId]: prev[lineId].map((lot) => {
        if (lot.key !== lotKey) return lot
        const next = { ...lot, ...patch }
        const short = next.expiry.length === 10 && isShortExpiry(next.expiry, today)
        if (short) {
          // A short-dated lot is refused in full as short expiry and held for the vendor.
          return {
            ...next,
            rejected: next.received,
            reason: "short-expiry",
            quarantine: lot.auto ? next.quarantine : true,
            auto: true,
          }
        }
        if (lot.auto && !short) {
          return { ...next, rejected: "0", reason: "", quarantine: false, auto: false }
        }
        return next
      }),
    }))
  const lotCount = React.useRef(0)
  const addLot = (lineId: Id) => {
    lotCount.current += 1
    const lotKey = `${lineId}:new:${lotCount.current}`
    setLots((prev) => ({ ...prev, [lineId]: [...prev[lineId], newLot(lotKey, 0)] }))
  }
  const removeLot = (lineId: Id, lotKey: string) =>
    setLots((prev) => ({ ...prev, [lineId]: prev[lineId].filter((l) => l.key !== lotKey) }))

  const perLine = lines.map((line) => {
    const own = lots[line.id] ?? []
    const received = own.reduce((s, l) => s + toInt(l.received), 0)
    const rejected = own.reduce((s, l) => s + toInt(l.rejected), 0)
    return { line, own, received, rejected, accepted: received - rejected, pending: pendingOf(line) }
  })
  const totals = perLine.reduce(
    (s, l) => ({
      received: s.received + l.received,
      accepted: s.accepted + l.accepted,
      rejected: s.rejected + l.rejected,
    }),
    { received: 0, accepted: 0, rejected: 0 }
  )
  const lotProblems = (lot: Lot) => {
    const received = toInt(lot.received)
    const rejected = toInt(lot.rejected)
    if (received === 0 && rejected === 0) return false
    return (
      !Number.isFinite(received) ||
      !Number.isFinite(rejected) ||
      received < 0 ||
      rejected < 0 ||
      rejected > received ||
      !lot.batchNo.trim() ||
      lot.expiry.length !== 10 ||
      (rejected > 0 && !lot.reason)
    )
  }
  const valid =
    open &&
    totals.received > 0 &&
    perLine.every((l) => l.accepted <= l.pending && l.own.every((lot) => !lotProblems(lot)))

  const post = async () => {
    const result = await command.run({
      poId: po.id,
      lots: perLine.flatMap(({ line, own }) =>
        own
          .filter((lot) => toInt(lot.received) > 0 || toInt(lot.rejected) > 0)
          .map((lot) => ({
            poLineId: line.id,
            batchNo: lot.batchNo.trim(),
            expiry: lot.expiry,
            received: toInt(lot.received),
            rejected: toInt(lot.rejected),
            rejectReason: toInt(lot.rejected) > 0 && lot.reason ? lot.reason : undefined,
            quarantine: toInt(lot.rejected) > 0 && lot.quarantine,
          }))
      ),
      note: note.trim() || undefined,
      expectedVersion: po.version,
      idempotencyKey: key,
    })
    renewKey()
    if (result) {
      toast.success(t("procurement.grn.done.title", { grnNo: result.grnNo }))
      onPosted(result)
    }
  }

  return (
    <PageBody data-testid="grn-form" data-po-no={po.poNo}>
      <PageHeader
        back={{ href: "/store/grn", label: t("procurement.grn.form.back") }}
        title={t("procurement.grn.form.title", { poNo: po.poNo })}
        subtitle={`${vendor?.name ?? ""} · ${branchName(po.branchId, locale)}`}
        actions={
          <>
            <LiveChip />
            <PoStatusPill status={po.status} />
          </>
        }
      />
      {!open ? (
        <section className="surface-card p-6 text-sm">
          <Link href={`/store/po?po=${po.id}`} className="font-medium text-link underline-offset-4 hover:underline">
            {po.poNo}
          </Link>
        </section>
      ) : (
        <section className="@container/grn surface-card flex flex-col gap-4 p-4">
          {perLine.map(({ line, own, accepted, pending }) => {
            const brand = detail.brands.get(line.brandId)
            const over = accepted > pending
            return (
              <div key={line.id} data-testid="grn-line" data-po-line-id={line.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold" lang="en">
                    {brand ? brandLabel(brand) : ""}
                  </span>
                  <QtyText
                    qty={line.qtyOrdered}
                    pack={line.pack}
                    brand={brand}
                    showUnits={false}
                    className="text-[0.8125rem] text-muted-foreground"
                  />
                  <span className="nums text-[0.8125rem] text-muted-foreground">
                    {t("procurement.grn.form.pendingOf", {
                      pending: num(pending),
                      ordered: num(line.qtyOrdered),
                    })}
                  </span>
                  <MoneyText poisha={line.unitCostP} className="ml-auto text-xs text-muted-foreground" />
                </div>
                {own.map((lot, index) => (
                  <LotRow
                    key={lot.key}
                    lot={lot}
                    index={index}
                    line={line}
                    unit={brand?.unitLabel}
                    today={today}
                    onChange={(patch) => setLot(line.id, lot.key, patch)}
                    onRemove={own.length > 1 ? () => removeLot(line.id, lot.key) : undefined}
                  />
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  <Button data-testid="grn-add-lot" size="xs" variant="ghost" onClick={() => addLot(line.id)}>
                    <Plus />
                    {t("procurement.grn.form.addLot")}
                  </Button>
                  {over ? (
                    <StatusText tone="destructive" className="text-xs">
                      {t("procurement.grn.form.abovePending", { pending: num(pending) })}
                    </StatusText>
                  ) : null}
                </div>
              </div>
            )
          })}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="grn-note">{t("procurement.grn.form.note")}</Label>
            <Textarea id="grn-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
            <p className="nums text-[0.8125rem]">
              {t("procurement.grn.form.summary", {
                received: num(totals.received),
                accepted: num(totals.accepted),
                rejected: num(totals.rejected),
              })}
              <span className="block text-xs text-muted-foreground">
                {t("procurement.grn.form.minShelfLife", { date: dmy(minExpiryFor(today)) })}
              </span>
            </p>
            <Button data-testid="grn-post" onClick={post} disabled={!valid || command.pending}>
              <PackageCheck />
              {t("procurement.grn.form.post")}
            </Button>
          </footer>
        </section>
      )}
    </PageBody>
  )
}

function newLot(key: string, received: number): Lot {
  return {
    key,
    batchNo: "",
    expiry: "",
    received: String(received),
    rejected: "0",
    reason: "",
    quarantine: false,
    auto: false,
  }
}

function LotRow({
  lot,
  index,
  line,
  unit,
  today,
  onChange,
  onRemove,
}: {
  lot: Lot
  index: number
  line: PoLineRow
  unit?: { en: string; bn: string }
  today: string
  onChange: (patch: Partial<Lot>) => void
  onRemove?: () => void
}) {
  const { t, num, dmy, locale } = useLocale()
  const received = toInt(lot.received)
  const rejected = toInt(lot.rejected)
  const accepted = Math.max(0, received - rejected)
  const short = lot.expiry.length === 10 && isShortExpiry(lot.expiry, today)
  const units = accepted * unitsPer(line.pack)
  const field = "flex min-w-0 flex-col gap-1 text-xs text-muted-foreground"
  return (
    <div
      data-testid="grn-lot"
      data-po-line-id={line.id}
      data-short={short || undefined}
      className={cn(
        "grid grid-cols-2 items-end gap-x-3 gap-y-2 rounded-md bg-surface-raised/60 p-3 @min-[40rem]/grn:grid-cols-3 @min-[62rem]/grn:grid-cols-[minmax(0,1fr)_9.5rem_5.5rem_5.5rem_9rem_auto_auto]",
        short && "ring-1 ring-warning/50"
      )}
    >
      <label className={field}>
        <span>
          {t("procurement.grn.form.lot", { n: num(index + 1) })} · {t("procurement.grn.form.batch")}
        </span>
        <Input
          data-testid="grn-batch"
          value={lot.batchNo}
          onChange={(event) => onChange({ batchNo: event.target.value.toUpperCase() })}
          className="h-8 font-mono"
          autoComplete="off"
          lang="en"
        />
      </label>
      <label className={field}>
        {t("procurement.grn.form.expiry")}
        <DateField
          data-testid="grn-expiry"
          value={lot.expiry}
          onChange={(expiry) => onChange({ expiry })}
          aria-invalid={short || undefined}
          className="h-8"
        />
      </label>
      <label className={field}>
        {t("procurement.grn.form.received")}
        <Input
          data-testid="grn-received"
          type="number"
          min={0}
          value={lot.received}
          onChange={(event) => onChange({ received: event.target.value })}
          className="nums h-8 text-center"
        />
      </label>
      <label className={field}>
        {t("procurement.grn.form.rejected")}
        <Input
          data-testid="grn-rejected"
          type="number"
          min={0}
          value={lot.rejected}
          onChange={(event) => onChange({ rejected: event.target.value })}
          aria-invalid={rejected > received || undefined}
          className="nums h-8 text-center"
        />
      </label>
      <label className={field}>
        {t("procurement.grn.form.reason")}
        <NativeSelect
          data-testid="grn-reason"
          value={lot.reason}
          disabled={rejected <= 0}
          onChange={(event) => onChange({ reason: event.target.value as Reason | "" })}
          aria-invalid={(rejected > 0 && !lot.reason) || undefined}
          className="h-8 text-[0.8125rem]"
        >
          <option value="">{t("procurement.grn.form.reasonPick")}</option>
          {REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {t(`procurement.rejectReason.${reason}`)}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
        <Switch
          data-testid="grn-quarantine"
          size="sm"
          checked={lot.quarantine}
          disabled={rejected <= 0}
          onCheckedChange={(checked) => onChange({ quarantine: checked })}
        />
        <ShieldAlert className="size-3.5" />
        {t("procurement.grn.form.quarantine")}
      </label>
      <div className="flex h-8 items-center justify-end gap-2">
        <span className="nums text-[0.8125rem] font-semibold text-success" title={`${num(units)} ${unitWord(unit, units, locale)}`}>
          {t("procurement.grn.form.accepted", { count: num(accepted) })}
        </span>
        {onRemove ? (
          <Button size="icon-xs" variant="ghost" aria-label={t("procurement.grn.form.removeLot")} onClick={onRemove}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
      {short ? (
        <p className="col-span-full text-xs text-warning" data-testid="grn-short">
          {t("procurement.grn.form.shortExpiry", { date: dmy(minExpiryFor(today)) })}
        </p>
      ) : rejected > 0 && !lot.reason ? (
        <p className="col-span-full text-xs text-destructive">{t("procurement.grn.form.needsReason")}</p>
      ) : null}
    </div>
  )
}

/* ================================================================== *
 * Posted
 * ================================================================== */

function Done({ detail, posted }: { detail: PoDetail; posted: Posted }) {
  const { t, num } = useLocale()
  const router = useRouter()
  const [printing, setPrinting] = React.useState(false)
  const [invoicing, setInvoicing] = React.useState(false)
  const grn = detail.grns.find((g) => g.grn.id === posted.grnId)
  return (
    <PageBody data-testid="grn-done" data-grn-no={posted.grnNo} data-po-no={detail.po.poNo}>
      <PageHeader
        back={{ href: "/store/grn", label: t("procurement.grn.form.back") }}
        title={t("procurement.grn.done.title", { grnNo: posted.grnNo })}
        subtitle={detail.vendor?.name}
        actions={<LiveChip />}
      />
      <section className="surface-card flex flex-col gap-4 p-6">
        <p className="flex items-center gap-3">
          <CheckCircle2 className="size-7 shrink-0 text-success" />
          <span data-testid="grn-summary" className="figure nums text-[1.5rem] leading-tight">
            {posted.pending > 0
              ? t("procurement.common.progress", {
                  accepted: num(posted.accepted),
                  pending: num(posted.pending),
                })
              : t("procurement.common.progressDone", { accepted: num(posted.accepted) })}
          </span>
        </p>
        <p className="text-[0.8125rem] text-muted-foreground">
          <span className="font-mono" lang="en">
            {detail.po.poNo}
          </span>
          {" · "}
          <ProgressText lines={detail.lines} className="nums" />
        </p>
        {posted.quarantinedLots > 0 ? (
          <StatusText tone="warning" className="text-[0.8125rem]">
            <ShieldAlert className="size-4" />
            {t(
              posted.quarantinedLots === 1
                ? "procurement.grn.done.quarantinedOne"
                : "procurement.grn.done.quarantined",
              { count: num(posted.quarantinedLots) }
            )}
          </StatusText>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button data-testid="grn-print" variant="outline" onClick={() => setPrinting(true)} disabled={!grn}>
            <Printer />
            {t("procurement.grn.done.print")}
          </Button>
          <Button data-testid="vi-open" onClick={() => setInvoicing(true)}>
            <FileCheck2 />
            {t("procurement.grn.done.invoice")}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/store/grn")}>
            {t("procurement.grn.done.back")}
          </Button>
        </div>
      </section>
      <PrintDialog
        open={printing && !!grn}
        onClose={() => setPrinting(false)}
        title={t("procurement.grn.print.previewTitle", { grnNo: posted.grnNo })}
      >
        {grn ? <GrnSheet detail={detail} item={grn} /> : null}
      </PrintDialog>
      <VendorInvoiceDialog poId={invoicing ? detail.po.id : null} onClose={() => setInvoicing(false)} />
    </PageBody>
  )
}
