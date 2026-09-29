"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowLeftRight, ArrowRight, PackageCheck, Plus, Truck } from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { nameIn } from "@/components/shared/person"
import { StatusPill, type Tone } from "@/components/shared/status"
import { StockBadge } from "@/components/shared/stock-badge"
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
import { Textarea } from "@/components/ui/textarea"
import { branches, type BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type {
  BatchRow,
  BrandRow,
  StaffRow,
  StockLevelRow,
  TransferLineRow,
  TransferRow,
} from "@/core/db/schema"
import { fefoAllocate } from "@/core/stock/availability"
import { rankMedicines } from "@/core/search/medicines"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import {
  branchName,
  brandText,
  LiveChip,
  PageBody,
  PageHeader,
  unique,
  useActionKey,
  useModuleCommand,
  usePharmacyContext,
} from "@/modules/pharmacy/components/shared"

import { dispatchTransfer, receiveTransfer, requestTransfer } from "../commands"
import { usableUnits } from "../stock"

type TransferItem = {
  transfer: TransferRow
  lines: TransferLineRow[]
  requestedBy?: StaffRow
}

type TransfersData = {
  items: TransferItem[]
  brands: Map<string, BrandRow>
  batches: Map<string, BatchRow>
  levels: StockLevelRow[]
}

const STATUS_TONE: Record<TransferRow["status"], Tone> = {
  requested: "info",
  approved: "info",
  dispatched: "warning",
  received: "success",
  cancelled: "muted",
}

function useTransfers(branch: BranchCode | null): TransfersData | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!branch) return { items: [], brands: new Map(), batches: new Map(), levels: [] }
    const [outgoing, incoming] = await Promise.all([
      db.transfers.where("fromBranchId").equals(branch).toArray(),
      db.transfers.where("toBranchId").equals(branch).toArray(),
    ])
    const transfers = [...outgoing, ...incoming]
    const lines = transfers.length
      ? await db.transferLines.where("transferId").anyOf(transfers.map((t) => t.id)).toArray()
      : []
    const brandIds = unique(lines.map((l) => l.brandId))
    const [brands, staff, levels] = await Promise.all([
      db.brands.bulkGet(brandIds),
      db.staff.bulkGet(unique(transfers.map((t) => t.requestedBy))),
      brandIds.length ? db.stockLevels.where("brandId").anyOf(brandIds).toArray() : [],
    ])
    const batches = await db.batches.bulkGet(
      unique([...levels.map((l) => l.batchId), ...lines.map((l) => l.batchId)])
    )
    return {
      items: transfers
        .map((transfer) => ({
          transfer,
          lines: lines.filter((l) => l.transferId === transfer.id),
          requestedBy: staff.find((s) => s?.id === transfer.requestedBy),
        }))
        .sort((a, b) => b.transfer.updatedAt - a.transfer.updatedAt),
      brands: new Map(brands.filter(Boolean).map((b) => [b!.id, b!])),
      batches: new Map(batches.filter(Boolean).map((b) => [b!.id, b!])),
      levels,
    }
  }, [db, branch])
}

/**
 * Transfers to and from a branch (plan §9 `/pharmacy/transfers`,
 * `/store/transfers`). The pharmacy shows the pharmacist's own branch; the
 * store passes its branch (a network-level persona picks one), raises
 * requests "from the store", and sees each transfer's value at cost.
 */
export function TransfersScreen({
  branch: branchOverride,
  requestedFrom = "pharmacy",
  showValue = false,
  headerActions,
}: {
  /** The branch to show; defaults to the persona's (null: none picked yet) */
  branch?: BranchCode | null
  /** Where requests raised here come from */
  requestedFrom?: "pharmacy" | "store"
  /** Show dispatched value and shortfalls at cost (the store) */
  showValue?: boolean
  /** Extra header controls (the store's branch picker) */
  headerActions?: React.ReactNode
} = {}) {
  const { t, num, locale } = useLocale()
  const context = usePharmacyContext()
  const isEdge = context.isEdge
  const branch = branchOverride === undefined ? context.branch : branchOverride
  const branchLabel = branch ? branchName(branch, locale) : ""
  const data = useTransfers(branch)
  const [tab, setTab] = React.useState<"incoming" | "outgoing">("incoming")
  const [dispatching, setDispatching] = React.useState<TransferItem | null>(null)
  const [receiving, setReceiving] = React.useState<TransferItem | null>(null)
  const [requesting, setRequesting] = React.useState(false)

  const incoming = (data?.items ?? []).filter((i) => i.transfer.toBranchId === branch)
  const outgoing = (data?.items ?? []).filter((i) => i.transfer.fromBranchId === branch)
  const open = (list: TransferItem[]) =>
    list.filter((i) => ["requested", "approved", "dispatched"].includes(i.transfer.status)).length
  const shown = tab === "incoming" ? incoming : outgoing

  return (
    <PageBody data-testid="transfers-screen">
      <PageHeader
        title={t("inventory.transfers.title")}
        subtitle={t("inventory.transfers.subtitle", { branch: branchLabel })}
        actions={
          <>
            <LiveChip />
            {headerActions}
            <Button
              data-testid="transfer-request-open"
              size="sm"
              onClick={() => setRequesting(true)}
              disabled={!branch}
            >
              <Plus />
              {t("inventory.transfers.request.open")}
            </Button>
          </>
        }
      />
      {!branch ? (
        <section className="surface-card">
          <EmptyState icon={ArrowLeftRight} title={t("inventory.transfers.chooseBranch")} />
        </section>
      ) : null}
      <SegmentedPills
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          {
            value: "incoming",
            label: t("inventory.transfers.tabs.incoming"),
            count: num(open(incoming)),
          },
          {
            value: "outgoing",
            label: t("inventory.transfers.tabs.outgoing"),
            count: num(open(outgoing)),
          },
        ]}
      />
      {!branch ? null : data && shown.length === 0 ? (
        <section className="surface-card">
          <EmptyState
            icon={ArrowLeftRight}
            title={t("inventory.transfers.empty")}
            description={t("inventory.transfers.emptyHint")}
          />
        </section>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((item) => (
            <TransferCard
              key={item.transfer.id}
              item={item}
              data={data!}
              branch={branch!}
              onDispatch={() => setDispatching(item)}
              onReceive={() => setReceiving(item)}
              showValue={showValue}
            />
          ))}
        </div>
      )}
      {data && branch ? (
        <>
          <DispatchDialog
            item={dispatching}
            data={data}
            onClose={() => setDispatching(null)}
          />
          <ReceiveDialog item={receiving} data={data} onClose={() => setReceiving(null)} />
          <RequestDialog
            open={requesting}
            branch={branch}
            offline={isEdge}
            requestedFrom={requestedFrom}
            onClose={() => setRequesting(false)}
          />
        </>
      ) : null}
    </PageBody>
  )
}

function TransferCard({
  item,
  data,
  branch,
  onDispatch,
  onReceive,
  showValue = false,
}: {
  item: TransferItem
  data: TransfersData
  branch: BranchCode
  onDispatch: () => void
  onReceive: () => void
  showValue?: boolean
}) {
  const { t, num, dmy, money, locale } = useLocale()
  const { transfer, lines } = item
  const atSource = transfer.fromBranchId === branch
  const canDispatch =
    atSource && (transfer.status === "requested" || transfer.status === "approved")
  const canReceive = !atSource && transfer.status === "dispatched"
  const byBrand = unique(lines.map((l) => l.brandId)).map((brandId) => {
    const own = lines.filter((l) => l.brandId === brandId)
    return {
      brandId,
      requested: own.reduce((s, l) => s + l.qtyRequested, 0),
      sent: own.reduce((s, l) => s + l.qtyDispatched, 0),
      received: own.reduce((s, l) => s + l.qtyReceived, 0),
      batches: own.filter((l) => l.batchId && l.qtyDispatched > 0),
      notes: own.map((l) => l.discrepancy).filter((d) => d && !/^Short by \d+$/.test(d)),
    }
  })
  // Value at cost: what left the source shelf, and what never arrived.
  const costOf = (l: TransferLineRow) => (l.batchId ? (data.batches.get(l.batchId)?.costP ?? 0) : 0)
  const sentValueP = lines.reduce((sum, l) => sum + l.qtyDispatched * costOf(l), 0)
  const shortUnits = lines.reduce((sum, l) => sum + Math.max(0, l.qtyDispatched - l.qtyReceived), 0)
  const shortValueP = lines.reduce(
    (sum, l) => sum + Math.max(0, l.qtyDispatched - l.qtyReceived) * costOf(l),
    0
  )
  return (
    <article
      data-testid="transfer-row"
      data-transfer-id={transfer.id}
      data-status={transfer.status}
      className="surface-card flex flex-col gap-3 p-4"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-sm font-semibold" lang="en">
          {transfer.transferNo}
        </span>
        <span className="flex items-center gap-1.5 text-[0.8125rem]">
          {branchName(transfer.fromBranchId, locale)}
          <ArrowRight className="size-3.5 text-muted-foreground" />
          {branchName(transfer.toBranchId, locale)}
        </span>
        <StatusPill tone={STATUS_TONE[transfer.status]} dot>
          {t(`inventory.transfers.status.${transfer.status}`)}
        </StatusPill>
        <span className="ml-auto flex items-center gap-2">
          {canDispatch ? (
            <Button data-testid="transfer-dispatch" size="sm" onClick={onDispatch}>
              <Truck />
              {t("inventory.transfers.dispatch")}
            </Button>
          ) : null}
          {canReceive ? (
            <Button data-testid="transfer-receive" size="sm" onClick={onReceive}>
              <PackageCheck />
              {t("inventory.transfers.receive")}
            </Button>
          ) : null}
        </span>
      </header>
      <ul className="flex flex-col gap-2">
        {byBrand.map((line) => {
          const short = line.sent - line.received
          return (
            <li key={line.brandId} className="rounded-md bg-surface-raised/60 px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]">
                <span className="font-medium" lang="en">
                  {brandText(data.brands.get(line.brandId))}
                </span>
                <span className="nums text-muted-foreground">
                  {t("inventory.transfers.line.requested", { count: num(line.requested) })}
                </span>
                {line.sent > 0 ? (
                  <span className="nums text-muted-foreground">
                    {t("inventory.transfers.line.sent", { count: num(line.sent) })}
                  </span>
                ) : null}
                {transfer.status === "received" ? (
                  <span className="nums text-success">
                    {t("inventory.transfers.line.received", { count: num(line.received) })}
                  </span>
                ) : null}
                {transfer.status === "received" && short > 0 ? (
                  <span className="nums font-medium text-destructive">
                    {t("inventory.transfers.line.short", { count: num(short) })}
                  </span>
                ) : null}
              </div>
              {line.batches.map((l) => {
                const batch = l.batchId ? data.batches.get(l.batchId) : undefined
                return batch ? (
                  <p key={l.id} className="mt-0.5 text-xs text-muted-foreground">
                    <span>
                      {t("inventory.transfers.line.batch", {
                        batch: batch.batchNo,
                        date: dmy(batch.expiry),
                      })}
                    </span>
                  </p>
                ) : null
              })}
              {line.notes.map((note) => (
                <p key={note} className="mt-0.5 text-xs text-destructive">
                  {note}
                </p>
              ))}
            </li>
          )
        })}
      </ul>
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t("inventory.transfers.requestedBy", {
            name: item.requestedBy ? nameIn(item.requestedBy, locale) : "",
          })}{" "}
          <DateText value={transfer.createdAt} variant="dmyTime" />
        </span>
        <span>{t(`inventory.transfers.requestedFrom.${transfer.requestedFrom}`)}</span>
        {transfer.dispatchedAt ? (
          <span>
            {t("inventory.transfers.dispatchedAt")}{" "}
            <DateText value={transfer.dispatchedAt} variant="dmyTime" />
          </span>
        ) : null}
        {transfer.receivedAt ? (
          <span>
            {t("inventory.transfers.receivedAt")}{" "}
            <DateText value={transfer.receivedAt} variant="dmyTime" />
          </span>
        ) : null}
        {transfer.status === "requested" && !atSource ? (
          <span className="text-info">
            {t("inventory.transfers.waitingSource", {
              branch: branchName(transfer.fromBranchId, locale),
            })}
          </span>
        ) : null}
        {transfer.status === "dispatched" && atSource ? (
          <span className="text-warning">
            {t("inventory.transfers.waitingDestination", {
              branch: branchName(transfer.toBranchId, locale),
            })}
          </span>
        ) : null}
        {transfer.note ? <span className="italic">{transfer.note}</span> : null}
        {showValue && sentValueP > 0 ? (
          <span
            data-testid="transfer-value"
            data-value={sentValueP}
            className="nums ml-auto font-medium text-foreground"
          >
            {t("inventory.transfers.value", { amount: money(sentValueP) })}
          </span>
        ) : null}
        {showValue && transfer.status === "received" && shortUnits > 0 ? (
          <span data-testid="transfer-short-value" className="nums basis-full text-destructive">
            {t("inventory.transfers.shortValue", {
              count: num(shortUnits),
              amount: money(shortValueP),
            })}
          </span>
        ) : null}
      </footer>
    </article>
  )
}

function DispatchDialog({
  item,
  data,
  onClose,
}: {
  item: TransferItem | null
  data: TransfersData
  onClose: () => void
}) {
  const { t, num, dmy, locale } = useLocale()
  const [qty, setQty] = React.useState<Record<string, number>>({})
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(dispatchTransfer)
  const today = dhakaDate(now())
  const from = item?.transfer.fromBranchId

  const lines = (item?.lines ?? [])
    .filter((l) => l.qtyRequested > 0)
    .map((line) => {
      const levels = data.levels.filter((l) => l.branchId === from && l.brandId === line.brandId)
      const batches = levels
        .map((l) => data.batches.get(l.batchId))
        .filter((b): b is BatchRow => !!b)
      const usable = usableUnits(levels, batches, today)
      const send = Math.min(qty[line.id] ?? line.qtyRequested, usable)
      const picks = from
        ? fefoAllocate(send, from, line.brandId, levels, batches, today).picks
        : []
      return { line, usable, send, picks }
    })

  const close = () => {
    setQty({})
    onClose()
  }
  const submit = async () => {
    if (!item) return
    const result = await command.run({
      transferId: item.transfer.id,
      lines: lines.map((l) => ({ transferLineId: l.line.id, qty: l.send })),
      expectedVersion: item.transfer.version,
      idempotencyKey: key,
    })
    renewKey()
    if (result) {
      toast.success(
        t("inventory.transfers.dispatchDialog.done", { transferNo: item.transfer.transferNo })
      )
      close()
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("inventory.transfers.dispatchDialog.title", {
              transferNo: item?.transfer.transferNo ?? "",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("inventory.transfers.dispatchDialog.body", { branch: branchName(from, locale) })}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {lines.map(({ line, usable, send, picks }) => (
            <li key={line.id} className="rounded-md bg-surface-raised/60 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 font-medium" lang="en">
                  {brandText(data.brands.get(line.brandId))}
                </span>
                <StockBadge status={usable > 0 ? "in-stock" : "out"} qty={usable} />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t("inventory.transfers.dispatchDialog.send")}
                  <Input
                    type="number"
                    min={0}
                    max={Math.min(line.qtyRequested, usable)}
                    value={send}
                    onChange={(event) =>
                      setQty((prev) => ({
                        ...prev,
                        [line.id]: Math.max(0, Math.round(Number(event.target.value) || 0)),
                      }))
                    }
                    className="nums h-8 w-20 text-center"
                  />
                </label>
              </div>
              {usable < line.qtyRequested ? (
                <p className="mt-1 text-xs text-warning">
                  {t("inventory.transfers.dispatchDialog.short", { count: num(usable) })}
                </p>
              ) : null}
              {picks.map((pick) => (
                <p key={pick.batch.id} className="mt-1 flex gap-3 text-xs text-muted-foreground">
                  <span>
                    {t("inventory.transfers.line.batch", {
                      batch: pick.batch.batchNo,
                      date: dmy(pick.batch.expiry),
                    })}
                  </span>
                  <span className="nums ml-auto font-medium text-foreground">{num(pick.take)}</span>
                </p>
              ))}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="neutral" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="transfer-dispatch-confirm"
            onClick={submit}
            disabled={command.pending || lines.every((l) => l.send === 0)}
          >
            <Truck />
            {t("inventory.transfers.dispatchDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReceiveDialog({
  item,
  data,
  onClose,
}: {
  item: TransferItem | null
  data: TransfersData
  onClose: () => void
}) {
  const { t, dmy, num } = useLocale()
  const [counted, setCounted] = React.useState<Record<string, number>>({})
  const [note, setNote] = React.useState("")
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(receiveTransfer)
  const lines = (item?.lines ?? []).filter((l) => l.qtyDispatched > 0 && l.batchId)

  const close = () => {
    setCounted({})
    setNote("")
    onClose()
  }
  const submit = async () => {
    if (!item) return
    const result = await command.run({
      transferId: item.transfer.id,
      lines: lines.map((l) => {
        const got = counted[l.id] ?? l.qtyDispatched
        return {
          transferLineId: l.id,
          qtyReceived: got,
          note: got < l.qtyDispatched && note.trim() ? note.trim() : undefined,
        }
      }),
      expectedVersion: item.transfer.version,
      idempotencyKey: key,
    })
    renewKey()
    if (result) {
      toast.success(
        t("inventory.transfers.receiveDialog.done", { transferNo: item.transfer.transferNo })
      )
      close()
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("inventory.transfers.receiveDialog.title", {
              transferNo: item?.transfer.transferNo ?? "",
            })}
          </DialogTitle>
          <DialogDescription>{t("inventory.transfers.receiveDialog.body")}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {lines.map((line) => {
            const batch = line.batchId ? data.batches.get(line.batchId) : undefined
            const value = counted[line.id] ?? line.qtyDispatched
            return (
              <li
                key={line.id}
                className="flex flex-wrap items-center gap-3 rounded-md bg-surface-raised/60 p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium" lang="en">
                    {brandText(data.brands.get(line.brandId))}
                  </span>
                  {batch ? (
                    <span className="text-xs text-muted-foreground">
                      {t("inventory.transfers.line.batch", {
                        batch: batch.batchNo,
                        date: dmy(batch.expiry),
                      })}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("inventory.transfers.receiveDialog.sent")}{" "}
                  <span className="nums font-semibold text-foreground">{num(line.qtyDispatched)}</span>
                </span>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t("inventory.transfers.receiveDialog.counted")}
                  <Input
                    data-testid="transfer-count"
                    type="number"
                    min={0}
                    max={line.qtyDispatched}
                    value={value}
                    aria-invalid={value < line.qtyDispatched || undefined}
                    onChange={(event) =>
                      setCounted((prev) => ({
                        ...prev,
                        [line.id]: Math.max(
                          0,
                          Math.min(line.qtyDispatched, Math.round(Number(event.target.value) || 0))
                        ),
                      }))
                    }
                    className={cn("nums h-8 w-20 text-center")}
                  />
                </label>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="receive-note">{t("inventory.transfers.receiveDialog.note")}</Label>
          <Textarea
            id="receive-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("inventory.transfers.receiveDialog.notePlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button data-testid="transfer-receive-confirm" onClick={submit} disabled={command.pending}>
            <PackageCheck />
            {t("inventory.transfers.receiveDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RequestDialog({
  open,
  branch,
  offline,
  requestedFrom,
  onClose,
}: {
  open: boolean
  branch: BranchCode
  /** Other branches' stock is unknown while offline (HAZ-15) */
  offline: boolean
  requestedFrom: "pharmacy" | "store"
  onClose: () => void
}) {
  const { t, num, locale } = useLocale()
  const db = useDb()
  const [query, setQuery] = React.useState("")
  const [brandId, setBrandId] = React.useState<string | null>(null)
  const [from, setFrom] = React.useState<BranchCode | null>(null)
  const [qty, setQty] = React.useState("30")
  const [note, setNote] = React.useState("")
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(requestTransfer)

  const catalog = useLiveQuery(async () => {
    if (!open) return undefined
    const [brands, generics, companies, classes] = await Promise.all([
      db.brands.toArray(),
      db.generics.toArray(),
      db.pharmaCompanies.toArray(),
      db.drugClasses.toArray(),
    ])
    return { brands, generics, companies, classes }
  }, [db, open])
  const hits = catalog && query.trim().length >= 2
    ? rankMedicines(query, catalog, { kinds: ["brand"], limit: 8 })
    : []

  const sources = useLiveQuery(async () => {
    if (!brandId || offline) return []
    const levels = await db.stockLevels.where("brandId").equals(brandId).toArray()
    const batches = (await db.batches.bulkGet(unique(levels.map((l) => l.batchId)))).filter(
      (b): b is BatchRow => !!b
    )
    const today = dhakaDate(now())
    return branches
      .filter((b) => b.code !== branch)
      .map((b) => ({
        code: b.code,
        usable: usableUnits(levels.filter((l) => l.branchId === b.code), batches, today),
      }))
      .filter((b) => b.usable > 0)
  }, [db, brandId, branch, offline])

  const close = () => {
    setQuery("")
    setBrandId(null)
    setFrom(null)
    setQty("30")
    setNote("")
    onClose()
  }
  const units = Math.round(Number(qty) || 0)
  const source = from ?? sources?.[0]?.code ?? null
  const submit = async () => {
    if (!brandId || !source || units < 1) return
    const result = await command.run({
      fromBranchId: source,
      toBranchId: branch,
      lines: [{ brandId, qty: units }],
      requestedFrom,
      note: note.trim() || undefined,
      idempotencyKey: key,
    })
    renewKey()
    if (result) {
      toast.success(
        t("inventory.transfers.request.done", {
          transferNo: result.transferNo,
          branch: branchName(source, locale),
        })
      )
      close()
    }
  }
  const picked = brandId ? catalog?.brands.find((b) => b.id === brandId) : undefined

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("inventory.transfers.request.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="transfer-medicine">{t("inventory.transfers.request.medicine")}</Label>
          <Input
            id="transfer-medicine"
            data-testid="transfer-request-search"
            value={picked ? brandText(picked) : query}
            onChange={(event) => {
              setBrandId(null)
              setFrom(null)
              setQuery(event.target.value)
            }}
            placeholder={t("inventory.transfers.request.search")}
            autoComplete="off"
          />
          {!picked && hits.length ? (
            <ul className="max-h-44 overflow-y-auto rounded-md bg-surface-raised/60 p-1">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    data-testid="transfer-request-hit"
                    onClick={() => hit.brandId && setBrandId(hit.brandId)}
                    className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-primary-soft"
                  >
                    <span className="text-[0.8125rem] font-medium" lang="en">
                      {hit.label}
                    </span>
                    <span className="text-xs text-muted-foreground" lang="en">
                      {hit.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {picked ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("inventory.transfers.request.from")}</span>
            {sources && sources.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                {t("inventory.transfers.request.none")}
              </p>
            ) : (
              <SegmentedPills
                size="sm"
                value={source ?? ""}
                onChange={(value) => setFrom(value as BranchCode)}
                options={(sources ?? []).map((s) => ({
                  value: s.code,
                  label: t("inventory.transfers.request.stockAt", {
                    qty: num(s.usable),
                    branch: branchName(s.code, locale),
                  }),
                }))}
              />
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transfer-qty">{t("inventory.transfers.request.qty")}</Label>
            <Input
              id="transfer-qty"
              type="number"
              min={1}
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              className="nums w-28"
            />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor="transfer-note">{t("inventory.transfers.request.note")}</Label>
            <Input
              id="transfer-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("inventory.transfers.request.notePlaceholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="transfer-request-submit"
            onClick={submit}
            disabled={!picked || !source || units < 1 || command.pending}
          >
            <ArrowLeftRight />
            {t("inventory.transfers.request.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
