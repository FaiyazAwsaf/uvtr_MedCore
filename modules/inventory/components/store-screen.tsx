"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  AlertTriangle,
  CalendarClock,
  ClipboardPlus,
  PackageX,
  ShieldAlert,
  Truck,
  Undo2,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { TableSearch } from "@/components/motion/data-table"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KpiCard, KpiGrid } from "@/components/shared/kpi-card"
import { MoneyText } from "@/components/shared/money-text"
import { StatusText, type Tone } from "@/components/shared/status"
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
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { rules } from "@/config/rules.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import {
  branchName,
  LiveChip,
  PageBody,
  PageHeader,
  useActionKey,
  useModuleCommand,
} from "@/modules/pharmacy/components/shared"
import { unitWord } from "@/modules/procurement/components/bits"
import {
  STOCK_BRANCHES,
  StoreBranchPicker,
  useStoreBranch,
} from "@/modules/procurement/components/store-context"
import { packsFor } from "@/modules/procurement/calc"

import { returnToVendor } from "../commands"
import { brandLabel } from "../stock"
import {
  loadStore,
  type QuarantineRow,
  type StockRow,
  type StockStatus,
  type StoreSummary,
} from "../store-stock"

type Tab = "low" | "expiring" | "quarantine" | "all"

const STATUS_TONE: Record<StockStatus, Tone> = {
  out: "destructive",
  low: "warning",
  ok: "success",
}

/** Compact in a quadrant; the full sample size once the row is wide. */
const CARD = "min-h-[5.75rem] gap-2.5 p-4 @min-[60rem]/kpis:min-h-[7rem] @min-[60rem]/kpis:p-5"

/**
 * "/store": stock at the store manager's branch, or the whole network for
 * the head of procurement (plan §9, objective §3D). Low-stock alerts with
 * "Add to purchase request", batches expiring soon, lots in quarantine
 * (returned to the vendor from here) and all stock, all live: an alert
 * clears in every window the moment a goods receipt lifts the brand above
 * its reorder level.
 */
export function StoreScreen() {
  const { t, num, money } = useLocale()
  const db = useDb()
  const { branch, label } = useStoreBranch()
  const today = dhakaDate(useNow(60_000) || now())
  const wide = useMediaQuery("(min-width: 1280px)")
  const data = useLiveQuery(() => loadStore(db, branch, today), [db, branch, today])
  const [tab, setTab] = React.useState<Tab>("low")

  const kpis = data?.kpis
  const cells = [
    {
      key: "value",
      icon: Wallet,
      variant: "cyan" as const,
      title: t("inventory.store.kpi.value"),
      value: money(kpis?.valueP ?? 0),
      hint: t("inventory.store.kpi.valueHint", { count: num(kpis?.brandsOnHand ?? 0) }),
    },
    {
      key: "low",
      icon: AlertTriangle,
      variant: "yellow" as const,
      title: t("inventory.store.kpi.low"),
      value: num(kpis?.low ?? 0),
      hint: t("inventory.store.kpi.lowHint"),
    },
    {
      key: "expiring",
      icon: CalendarClock,
      variant: "pink" as const,
      title: t("inventory.store.kpi.expiring"),
      value: num(kpis?.expiring ?? 0),
      hint: t("inventory.store.kpi.expiringHint", { days: num(rules.nearExpiryDays) }),
    },
    {
      key: "transit",
      icon: Truck,
      variant: "purple" as const,
      title: t("inventory.store.kpi.transit"),
      value: num((kpis?.inTransitIn ?? 0) + (kpis?.inTransitOut ?? 0)),
      hint: t("inventory.store.kpi.transitHint", {
        in: num(kpis?.inTransitIn ?? 0),
        out: num(kpis?.inTransitOut ?? 0),
      }),
    },
  ]

  return (
    <PageBody data-testid="store-screen">
      <PageHeader
        title={
          branch ? t("inventory.store.title", { branch: label }) : t("inventory.store.titleNetwork")
        }
        subtitle={branch ? t("inventory.store.subtitle") : t("inventory.store.subtitleNetwork")}
        actions={
          <>
            <LiveChip />
            <StoreBranchPicker />
            <Button
              size="sm"
              variant="outline"
              render={<Link href="/store/requests?new=1" />}
              nativeButton={false}
            >
              <ClipboardPlus />
              {t("inventory.store.newRequest")}
            </Button>
          </>
        }
      />

      {wide ? (
        <KpiGrid>
          {cells.map((cell) => (
            <KpiCard
              key={cell.key}
              variant={cell.variant}
              icon={cell.icon}
              title={cell.title}
              value={cell.value}
              caption={cell.hint}
              className={CARD}
            />
          ))}
        </KpiGrid>
      ) : (
        <div className="flex gap-2 overflow-x-auto" data-testid="store-kpis">
          {cells.map((cell) => (
            <span
              key={cell.key}
              title={cell.hint}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-card px-3.5 text-[0.8125rem]"
            >
              <cell.icon className="size-4 text-link" />
              <span className="text-muted-foreground">{cell.title}</span>
              <span className="nums font-semibold">{cell.value}</span>
            </span>
          ))}
        </div>
      )}

      {!branch && data ? <BranchesCard data={data} /> : null}

      <SegmentedPills
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: "low", label: t("inventory.store.tabs.low"), count: num(kpis?.low ?? 0) },
          {
            value: "expiring",
            label: t("inventory.store.tabs.expiring"),
            count: num(data?.expiring.length ?? 0),
          },
          {
            value: "quarantine",
            label: t("inventory.store.tabs.quarantine"),
            count: num(data?.quarantine.length ?? 0),
          },
          { value: "all", label: t("inventory.store.tabs.all") },
        ]}
      />

      {!data ? null : tab === "low" ? (
        <LowStockList rows={data.rows.filter((r) => r.alert)} network={!branch} />
      ) : tab === "expiring" ? (
        <ExpiringTable data={data} network={!branch} />
      ) : tab === "quarantine" ? (
        <QuarantineTable rows={data.quarantine} network={!branch} />
      ) : (
        <AllStockTable rows={data.rows} network={!branch} />
      )}
    </PageBody>
  )
}

/* ---------------- Network view: one line per branch ---------------- */

function BranchesCard({ data }: { data: StoreSummary }) {
  const { t, num, locale } = useLocale()
  const { setBranch } = useStoreBranch()
  const per = STOCK_BRANCHES.map((code) => {
    const rows = data.rows.filter((r) => r.branchId === code)
    return {
      code,
      valueP: rows.reduce((sum, r) => sum + r.valueP, 0),
      low: rows.filter((r) => r.alert).length,
      expiring: data.expiring.filter((e) => e.branchId === code && !e.expired).length,
      quarantined: data.quarantine.filter((q) => q.branchId === code).length,
    }
  })
  return (
    <section className="surface-card flex flex-col gap-2 p-4">
      <h2 className="text-[0.9375rem] font-semibold">{t("inventory.store.branches.title")}</h2>
      <ul className="grid grid-cols-1 gap-2 @container sm:grid-cols-2">
        {per.map((b) => (
          <li key={b.code}>
            <button
              type="button"
              onClick={() => setBranch(b.code)}
              aria-label={t("inventory.store.branches.open", { branch: branchName(b.code, locale) })}
              className="flex w-full items-center gap-3 rounded-md bg-surface-raised/60 px-3 py-2 text-left transition-colors hover:bg-primary-soft"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-medium">
                  {branchName(b.code, locale)}
                </span>
                <span className="nums block truncate text-xs text-muted-foreground">
                  {t("inventory.store.branches.row", {
                    low: num(b.low),
                    expiring: num(b.expiring),
                    quarantined: num(b.quarantined),
                  })}
                </span>
              </span>
              <MoneyText poisha={b.valueP} className="text-[0.8125rem] font-semibold" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------------- Low-stock alerts ---------------- */

function LowStockList({ rows, network }: { rows: StockRow[]; network: boolean }) {
  const { t, num, locale } = useLocale()
  const router = useRouter()
  if (!rows.length) {
    return (
      <section className="surface-card">
        <EmptyState
          icon={AlertTriangle}
          title={t("inventory.store.low.empty")}
          description={t("inventory.store.low.emptyHint")}
        />
      </section>
    )
  }
  return (
    <section className="surface-card flex flex-col p-2">
      <ul className="flex flex-col divide-y divide-hairline">
        {rows.map((row) => {
          const pack = row.brand.packSizes[0]
          const want = Math.max(row.reorderQty ?? 0, (row.reorderLevel ?? 0) - row.onHand, 1)
          const packs = packsFor(want, pack)
          const units = pack ? packs * pack.units : want
          const item = brandLabel(row.brand)
          const add = () =>
            router.push(
              `/store/requests?add=${encodeURIComponent(row.brand.id)}&packs=${packs}&branch=${row.branchId}`
            )
          return (
            <li
              key={row.key}
              data-testid="low-stock-row"
              data-brand-id={row.brand.id}
              data-branch={row.branchId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3"
            >
              <span
                className={cn(
                  "icon-well flex size-9 shrink-0 items-center justify-center",
                  row.status === "out" ? "text-destructive" : "text-warning"
                )}
              >
                {row.status === "out" ? (
                  <PackageX className="size-[1.125rem]" />
                ) : (
                  <AlertTriangle className="size-[1.125rem]" />
                )}
              </span>
              <span className="min-w-0 flex-1 basis-60">
                <span className="block text-sm font-semibold">
                  {row.status === "out"
                    ? t("inventory.store.low.out", { item })
                    : t("inventory.store.low.below", { item })}
                </span>
                <span className="nums block text-xs text-muted-foreground">
                  {network ? `${branchName(row.branchId, locale)} · ` : ""}
                  {t("inventory.store.low.detail", {
                    onHand: num(row.onHand),
                    reorderLevel: num(row.reorderLevel ?? 0),
                  })}
                </span>
                <span className="nums block text-xs text-muted-foreground">
                  {pack
                    ? t(packs === 1 ? "inventory.store.low.suggestOne" : "inventory.store.low.suggest", {
                        packs: num(packs),
                        pack: pack.label,
                        units: num(units),
                        unit: unitWord(row.brand.unitLabel, units, locale),
                      })
                    : t("inventory.store.low.suggestLoose", {
                        units: num(units),
                        unit: unitWord(row.brand.unitLabel, units, locale),
                      })}
                </span>
              </span>
              <StockBadge status={row.status === "out" ? "out" : "low"} qty={row.onHand} />
              <Button data-testid="low-stock-add" size="sm" variant="outline" onClick={add}>
                <ClipboardPlus />
                {t("inventory.store.low.add")}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ---------------- Expiring ---------------- */

function ExpiringTable({ data, network }: { data: StoreSummary; network: boolean }) {
  const { t, num, locale } = useLocale()
  return (
    <section className="@container/t surface-card flex flex-col gap-3 p-4">
      <p className="text-[0.8125rem] text-muted-foreground">
        {t("inventory.store.expiring.hint", { days: num(rules.nearExpiryDays) })}
      </p>
      {data.expiring.length === 0 ? (
        <EmptyState icon={CalendarClock} size="sm" title={t("inventory.store.expiring.empty")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inventory.store.expiring.col.item")}</TableHead>
              <TableHead>{t("inventory.store.expiring.col.batch")}</TableHead>
              <TableHead>{t("inventory.store.expiring.col.expiry")}</TableHead>
              <TableHead className="text-right">{t("inventory.store.expiring.col.qty")}</TableHead>
              <TableHead className="hidden text-right @min-[40rem]/t:table-cell">
                {t("inventory.store.expiring.col.value")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.expiring.map((row) => (
              <TableRow key={row.key} data-testid="expiring-row" data-expired={row.expired}>
                <TableCell>
                  <span className="block font-medium" lang="en">
                    {brandLabel(row.brand)}
                  </span>
                  {network ? (
                    <span className="text-xs text-muted-foreground">
                      {branchName(row.branchId, locale)}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-xs" lang="en">
                  {row.batch.batchNo}
                </TableCell>
                <TableCell>
                  <span className="flex flex-col">
                    <DateText value={row.batch.expiry} />
                    {row.expired ? (
                      <StatusText tone="destructive" className="text-xs">
                        {t("inventory.store.expiring.expired")}
                      </StatusText>
                    ) : (
                      <StatusText
                        tone={row.daysLeft <= 30 ? "destructive" : "warning"}
                        className="nums text-xs"
                      >
                        {t("inventory.store.expiring.days", { count: num(row.daysLeft) })}
                      </StatusText>
                    )}
                  </span>
                </TableCell>
                <TableCell className="nums text-right">{num(row.qty)}</TableCell>
                <TableCell className="hidden text-right @min-[40rem]/t:table-cell">
                  <MoneyText poisha={row.valueP} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

/* ---------------- Quarantine ---------------- */

function QuarantineTable({ rows, network }: { rows: QuarantineRow[]; network: boolean }) {
  const { t, num, locale } = useLocale()
  const [returning, setReturning] = React.useState<QuarantineRow | null>(null)
  return (
    <section className="@container/t surface-card flex flex-col gap-3 p-4">
      <p className="text-[0.8125rem] text-muted-foreground">{t("inventory.store.quarantine.hint")}</p>
      {rows.length === 0 ? (
        <EmptyState icon={ShieldAlert} size="sm" title={t("inventory.store.quarantine.empty")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inventory.store.quarantine.col.item")}</TableHead>
              <TableHead className="hidden @min-[34rem]/t:table-cell">
                {t("inventory.store.quarantine.col.batch")}
              </TableHead>
              <TableHead className="text-right">{t("inventory.store.quarantine.col.qty")}</TableHead>
              <TableHead className="hidden @min-[44rem]/t:table-cell">
                {t("inventory.store.quarantine.col.reason")}
              </TableHead>
              <TableHead>{t("inventory.store.quarantine.col.source")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.key}
                data-testid="quarantine-row"
                data-batch-id={row.batch.id}
                data-brand-id={row.brand.id}
              >
                <TableCell>
                  <span className="block font-medium" lang="en">
                    {brandLabel(row.brand)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {network ? `${branchName(row.branchId, locale)} · ` : ""}
                    <span className="font-mono @min-[34rem]/t:hidden" lang="en">
                      {row.batch.batchNo}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="hidden font-mono text-xs @min-[34rem]/t:table-cell" lang="en">
                  {row.batch.batchNo}
                  <span className="block font-sans text-muted-foreground">
                    <DateText value={row.batch.expiry} />
                  </span>
                </TableCell>
                <TableCell className="nums text-right">
                  {num(row.qty)}{" "}
                  <span className="text-xs text-muted-foreground">
                    {unitWord(row.brand.unitLabel, row.qty, locale)}
                  </span>
                </TableCell>
                <TableCell className="hidden @min-[44rem]/t:table-cell">
                  {row.rejectReason ? (
                    <StatusText tone="warning">
                      {t(`procurement.rejectReason.${row.rejectReason}`)}
                    </StatusText>
                  ) : (
                    <span className="text-xs text-muted-foreground">{row.note ?? ""}</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {row.grn ? (
                    <Link
                      href={row.po ? `/store/po?po=${row.po.id}` : "/store/po"}
                      className="font-mono text-link underline-offset-4 hover:underline"
                      lang="en"
                    >
                      {t("inventory.store.quarantine.grn", {
                        grnNo: row.grn.grnNo,
                        poNo: row.po?.poNo ?? "",
                      })}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("inventory.store.quarantine.patientReturn")}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.vendorLot ? (
                    <Button
                      data-testid="return-to-vendor"
                      size="xs"
                      variant="outline"
                      onClick={() => setReturning(row)}
                    >
                      <Undo2 />
                      {t("inventory.store.quarantine.returnAction")}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ReturnDialog row={returning} onClose={() => setReturning(null)} />
    </section>
  )
}

function ReturnDialog({ row, onClose }: { row: QuarantineRow | null; onClose: () => void }) {
  const { t, num, locale } = useLocale()
  const [reason, setReason] = React.useState("")
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(returnToVendor)
  const close = () => {
    setReason("")
    onClose()
  }
  const submit = async () => {
    if (!row) return
    const result = await command.run({
      branchId: row.branchId,
      batchId: row.batch.id,
      reason: reason.trim(),
      idempotencyKey: key,
    })
    renewKey()
    if (result) {
      toast.success(t("inventory.store.quarantine.done", { batchNo: row.batch.batchNo }))
      close()
    }
  }
  return (
    <Dialog open={!!row} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("inventory.store.quarantine.dialogTitle", { batchNo: row?.batch.batchNo ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {row
              ? t("inventory.store.quarantine.dialogBody", {
                  qty: num(row.qty),
                  unit: unitWord(row.brand.unitLabel, row.qty, locale),
                  item: brandLabel(row.brand),
                  vendor: row.vendor?.name ?? "",
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="return-reason">{t("inventory.store.quarantine.reason")}</Label>
          <Textarea
            id="return-reason"
            data-testid="return-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("inventory.store.quarantine.reasonPlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="return-confirm"
            onClick={submit}
            disabled={command.pending || reason.trim().length < 2}
          >
            <Undo2 />
            {t("inventory.store.quarantine.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------- All stock ---------------- */

const PAGE = 60

function AllStockTable({ rows, network }: { rows: StockRow[]; network: boolean }) {
  const { t, num, locale } = useLocale()
  const [query, setQuery] = React.useState("")
  const [shown, setShown] = React.useState(PAGE)
  const q = query.trim().toLowerCase()
  const matches = q
    ? rows.filter(
        (r) =>
          brandLabel(r.brand).toLowerCase().includes(q) ||
          r.brand.searchKeys.some((k) => k.startsWith(q))
      )
    : rows
  const visible = matches.slice(0, shown)
  return (
    <section className="@container/t surface-card flex flex-col gap-3 p-4">
      <TableSearch
        value={query}
        onChange={(value) => {
          setQuery(value)
          setShown(PAGE)
        }}
        placeholder={t("inventory.store.all.search")}
      />
      {visible.length === 0 ? (
        <EmptyState size="sm" icon={PackageX} title={t("inventory.store.all.empty")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("inventory.store.all.col.item")}</TableHead>
              <TableHead className="text-right">{t("inventory.store.all.col.onHand")}</TableHead>
              <TableHead className="hidden text-right @min-[30rem]/t:table-cell">
                {t("inventory.store.all.col.reorder")}
              </TableHead>
              <TableHead>{t("inventory.store.all.col.status")}</TableHead>
              <TableHead className="hidden @min-[52rem]/t:table-cell">
                {t("inventory.store.all.col.transit")}
              </TableHead>
              <TableHead className="hidden text-right @min-[58rem]/t:table-cell">
                {t("inventory.store.all.col.quarantined")}
              </TableHead>
              <TableHead className="hidden @min-[44rem]/t:table-cell">
                {t("inventory.store.all.col.expiry")}
              </TableHead>
              <TableHead className="hidden text-right @min-[38rem]/t:table-cell">
                {t("inventory.store.all.col.value")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow
                key={row.key}
                data-testid="store-stock-row"
                data-brand-id={row.brand.id}
                data-branch={row.branchId}
                data-status={row.status}
              >
                <TableCell>
                  <span className="block font-medium" lang="en">
                    {brandLabel(row.brand)}
                  </span>
                  {network ? (
                    <span className="text-xs text-muted-foreground">
                      {branchName(row.branchId, locale)}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="nums text-right font-medium">{num(row.onHand)}</TableCell>
                <TableCell className="nums hidden text-right text-muted-foreground @min-[30rem]/t:table-cell">
                  {row.reorderLevel !== undefined ? num(row.reorderLevel) : "-"}
                </TableCell>
                <TableCell>
                  <StatusText tone={STATUS_TONE[row.status]} dot>
                    {t(`inventory.store.all.status.${row.status}`)}
                  </StatusText>
                </TableCell>
                <TableCell className="nums hidden text-xs text-muted-foreground @min-[52rem]/t:table-cell">
                  {row.inTransitIn || row.inTransitOut
                    ? t("inventory.store.all.transit", {
                        in: num(row.inTransitIn),
                        out: num(row.inTransitOut),
                      })
                    : "-"}
                </TableCell>
                <TableCell className="nums hidden text-right @min-[58rem]/t:table-cell">
                  {row.quarantined ? num(row.quarantined) : "-"}
                </TableCell>
                <TableCell className="hidden text-xs @min-[44rem]/t:table-cell">
                  {row.nearestExpiry ? <DateText value={row.nearestExpiry} /> : "-"}
                </TableCell>
                <TableCell className="hidden text-right @min-[38rem]/t:table-cell">
                  <MoneyText poisha={row.valueP} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {matches.length > visible.length ? (
        <Button variant="link" className="self-center" onClick={() => setShown((n) => n + PAGE)}>
          {t("inventory.store.all.more", { count: num(matches.length - visible.length) })}
        </Button>
      ) : null}
    </section>
  )
}
