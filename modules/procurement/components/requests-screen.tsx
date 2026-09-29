"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { ClipboardList, Plus, Save, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"
import type { BranchCode } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type { BatchRow, BrandRow, PackSize, VendorRow } from "@/core/db/schema"
import { approvalTierFor, valueTier } from "@/core/procurement/rules"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { NativeSelect } from "@/modules/identity/components/desk-ui"
import { MedicineSearch } from "@/modules/medicine-library/components/medicine-search"
import { brandLabel } from "@/modules/inventory/stock"
import {
  branchName,
  LiveChip,
  PageBody,
  PageHeader,
  useActionKey,
  useModuleCommand,
} from "@/modules/pharmacy/components/shared"

import { estUnitCostP, latestBatch, suggestedVendorId, unitsPer } from "../calc"
import { savePr, submitPr } from "../commands"
import { loadPr, loadPrs, type PrData, type PrItem } from "../queries"
import { PrStatusPill, QtyText, unitWord, useTierText } from "./bits"
import { STOCK_BRANCHES, StoreBranchPicker, useStoreBranch } from "./store-context"

/**
 * "/store/requests" (plan §9): the branch's purchase requests, and the
 * request editor (library search, packs, estimated cost, suggested supplier,
 * the approval tier live as the total changes). `?pr=<id>` opens a request,
 * `?new=1` a blank one, `?add=<brandId>&packs=<n>&branch=<code>` a new one
 * with a low-stock item already on it.
 */
export function RequestsScreen() {
  const params = useSearchParams()
  const prId = params.get("pr")
  const add = params.get("add")
  const isNew = params.get("new") === "1" || !!add
  if (prId) return <PrPage key={prId} prId={prId} />
  if (isNew) {
    const branch = params.get("branch") as BranchCode | null
    const packs = Math.max(1, Math.round(Number(params.get("packs")) || 1))
    return (
      <PrEditor
        key={`new:${add ?? ""}`}
        initial={{
          branch: branch && STOCK_BRANCHES.includes(branch) ? branch : null,
          lines: add ? [{ key: add, brandId: add, qty: packs }] : [],
          note: "",
        }}
      />
    )
  }
  return <RequestsList />
}

/* ================================================================== *
 * List
 * ================================================================== */

function RequestsList() {
  const { t, num, locale } = useLocale()
  const db = useDb()
  const router = useRouter()
  const { branch, label } = useStoreBranch()
  const [filter, setFilter] = React.useState<"open" | "all">("open")
  const data = useLiveQuery(() => loadPrs(db, branch), [db, branch])
  const items = (data?.items ?? []).filter(
    (item) => filter === "all" || ["draft", "submitted", "approved"].includes(item.pr.status)
  )
  const tierText = useTierText()

  return (
    <PageBody data-testid="requests-screen">
      <PageHeader
        title={t("procurement.requests.title")}
        subtitle={
          branch
            ? t("procurement.requests.subtitle", { branch: label })
            : t("procurement.requests.subtitleNetwork")
        }
        actions={
          <>
            <LiveChip />
            <StoreBranchPicker />
            <Button data-testid="pr-new" size="sm" onClick={() => router.push("/store/requests?new=1")}>
              <Plus />
              {t("procurement.requests.new")}
            </Button>
          </>
        }
      />
      <section className="@container/t surface-card flex flex-col gap-3 p-4">
        <SegmentedPills
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: t("procurement.requests.filter.open") },
            { value: "all", label: t("procurement.requests.filter.all") },
          ]}
        />
        {data && items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t("procurement.requests.empty")}
            description={t("procurement.requests.emptyHint")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procurement.requests.col.pr")}</TableHead>
                <TableHead className="hidden @min-[40rem]/t:table-cell">
                  {t("procurement.requests.col.requester")}
                </TableHead>
                <TableHead className="hidden @min-[52rem]/t:table-cell">
                  {t("procurement.requests.col.items")}
                </TableHead>
                <TableHead className="text-right">{t("procurement.requests.col.total")}</TableHead>
                <TableHead className="hidden @min-[46rem]/t:table-cell">
                  {t("procurement.requests.col.tier")}
                </TableHead>
                <TableHead>{t("procurement.requests.col.status")}</TableHead>
                <TableHead className="hidden @min-[60rem]/t:table-cell">
                  {t("procurement.requests.col.updated")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(({ pr, lines, requester }) => (
                <TableRow
                  key={pr.id}
                  data-testid="pr-row"
                  data-pr-no={pr.prNo}
                  data-status={pr.status}
                  onClick={() => router.push(`/store/requests?pr=${pr.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <span className="block font-mono text-xs font-semibold" lang="en">
                      {pr.prNo}
                    </span>
                    {!branch ? (
                      <span className="text-xs text-muted-foreground">
                        {branchName(pr.branchId, locale)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden @min-[40rem]/t:table-cell">
                    {requester ? nameIn(requester, locale) : ""}
                  </TableCell>
                  <TableCell className="nums hidden text-muted-foreground @min-[52rem]/t:table-cell">
                    {t("procurement.common.items", { count: num(lines.length) })}
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyText poisha={pr.totalP} className="font-medium" />
                  </TableCell>
                  <TableCell className="hidden text-[0.8125rem] @min-[46rem]/t:table-cell">
                    {tierText.name(pr.approvalTier)}
                  </TableCell>
                  <TableCell>
                    <PrStatusPill status={pr.status} />
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground @min-[60rem]/t:table-cell">
                    <DateText value={pr.submittedAt ?? pr.updatedAt} variant="relative" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </PageBody>
  )
}

/* ================================================================== *
 * One request: the editor for the requester's draft, a view otherwise
 * ================================================================== */

function PrPage({ prId }: { prId: string }) {
  const db = useDb()
  const { staffId } = useStoreBranch()
  const data = useLiveQuery(() => loadPr(db, prId), [db, prId])
  if (data === undefined) return null
  if (data === null) return <RequestsList />
  const item = data.items[0]
  const editable = item.pr.status === "draft" && item.pr.requestedBy === staffId
  if (editable) {
    // The editor keeps its own form state, seeded from the stored draft; only
    // the requester changes a draft, so a new version is their own save.
    return (
      <PrEditor
        key={`${item.pr.id}:${item.pr.version}`}
        existing={item}
        initial={{
          branch: item.pr.branchId,
          lines: item.lines.map((line) => ({
            key: line.id,
            brandId: line.brandId,
            packLabel: line.pack?.label,
            qty: line.qty,
          })),
          note: item.pr.note ?? "",
        }}
      />
    )
  }
  return <PrView data={data} />
}

type DraftLine = { key: string; brandId: string; packLabel?: string; qty: number }

type BrandInfo = {
  brand: BrandRow
  batches: BatchRow[]
  vendor?: VendorRow
}

/** Brands on the form with their batches (for the cost estimate) and suggested supplier. */
function useBrandInfo(brandIds: string[]): Map<string, BrandInfo> | undefined {
  const db = useDb()
  const idsKey = brandIds.join(",")
  return useLiveQuery(async () => {
    const ids = idsKey ? idsKey.split(",") : []
    const [brands, batches, vendors] = await Promise.all([
      db.brands.bulkGet(ids),
      ids.length ? db.batches.where("brandId").anyOf(ids).toArray() : [],
      db.vendors.toArray(),
    ])
    const out = new Map<string, BrandInfo>()
    for (const brand of brands) {
      if (!brand) continue
      const vendorId = suggestedVendorId(brand)
      out.set(brand.id, {
        brand,
        batches: batches.filter((b) => b.brandId === brand.id),
        vendor: vendors.find((v) => v.id === vendorId),
      })
    }
    return out
  }, [db, idsKey])
}

function packOf(info: BrandInfo | undefined, label?: string): PackSize | undefined {
  const sizes = info?.brand.packSizes ?? []
  return sizes.find((p) => p.label === label) ?? sizes[0]
}

function PrEditor({
  existing,
  initial,
}: {
  existing?: PrItem
  initial: { branch: BranchCode | null; lines: DraftLine[]; note: string }
}) {
  const { t, num, money, locale } = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const store = useStoreBranch()
  const tierText = useTierText()
  const [branch, setBranch] = React.useState<BranchCode>(
    store.fixed ? store.branch! : (initial.branch ?? store.branch ?? STOCK_BRANCHES[0])
  )
  const [lines, setLines] = React.useState<DraftLine[]>(initial.lines)
  const [note, setNote] = React.useState(initial.note)
  const [saveKey, renewSaveKey] = useActionKey()
  const [submitKey, renewSubmitKey] = useActionKey()
  const save = useModuleCommand(savePr)
  const submit = useModuleCommand(submitPr)
  const info = useBrandInfo(lines.map((l) => l.brandId))

  const priced = lines.map((line) => {
    const brandInfo = info?.get(line.brandId)
    const pack = packOf(brandInfo, line.packLabel)
    const cost = brandInfo ? estUnitCostP(brandInfo.brand, brandInfo.batches, pack) : 0
    return { line, info: brandInfo, pack, cost, total: cost * Math.max(0, line.qty) }
  })
  const totalP = priced.reduce((sum, p) => sum + p.total, 0)
  const tier = approvalTierFor(totalP, store.authorities)
  const byValue = valueTier(totalP)
  const vendors = new Set(priced.map((p) => p.info?.vendor?.id).filter(Boolean))
  const vendorId = vendors.size === 1 ? [...vendors][0] : undefined
  const invalid =
    !lines.length || lines.some((l) => !(l.qty > 0)) || priced.some((p) => !p.info)

  const addBrand = (brandId: string) => {
    const brand = info?.get(brandId)?.brand
    if (lines.some((l) => l.brandId === brandId)) {
      toast(t("procurement.editor.already", { item: brand ? brandLabel(brand) : "" }))
      return
    }
    setLines((prev) => [...prev, { key: `${brandId}:${prev.length}`, brandId, qty: 1 }])
  }
  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key))

  const saveDraft = async () => {
    const result = await save.run({
      prId: existing?.pr.id,
      branchId: branch,
      lines: priced.map((p) => ({
        brandId: p.line.brandId,
        qty: p.line.qty,
        pack: p.pack,
        estUnitCostP: p.cost,
      })),
      vendorId,
      note: note.trim() || undefined,
      expectedVersion: existing?.pr.version,
      idempotencyKey: saveKey,
    })
    renewSaveKey()
    return result
  }

  const onSave = async () => {
    const result = await saveDraft()
    if (!result) return
    toast.success(t("procurement.editor.saved", { prNo: result.prNo }))
    if (!existing) router.replace(`${pathname}?pr=${result.prId}`)
  }

  const onSubmit = async () => {
    const saved = await saveDraft()
    if (!saved) return
    const result = await submit.run({
      prId: saved.prId,
      expectedVersion: saved.version,
      idempotencyKey: submitKey,
    })
    renewSubmitKey()
    if (!result) {
      if (!existing) router.replace(`${pathname}?pr=${saved.prId}`)
      return
    }
    toast.success(
      t("procurement.editor.submitted", {
        prNo: result.prNo,
        tier: tierText.name(result.approvalTier),
      })
    )
    router.replace(`${pathname}?pr=${saved.prId}`)
  }

  return (
    <PageBody data-testid="pr-editor">
      <PageHeader
        back={{ href: "/store/requests", label: t("procurement.editor.back") }}
        title={
          existing
            ? t("procurement.editor.title", { prNo: existing.pr.prNo })
            : t("procurement.editor.newTitle")
        }
        actions={
          store.fixed ? (
            <StoreBranchPicker />
          ) : (
            <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              {t("procurement.editor.branch")}
              <NativeSelect
                data-testid="pr-branch"
                value={branch}
                onChange={(event) => setBranch(event.target.value as BranchCode)}
                className="h-8 min-w-40 text-[0.8125rem]"
              >
                {STOCK_BRANCHES.map((code) => (
                  <option key={code} value={code}>
                    {branchName(code, locale)}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )
        }
      />

      <section className="@container/pr surface-card flex flex-col gap-4 p-4 @min-[48rem]/pr:p-5">
        <div data-testid="pr-search">
          <MedicineSearch
            placeholder={t("procurement.editor.search")}
            onPick={(hit) => hit.brandId && addBrand(hit.brandId)}
          />
        </div>

        {lines.length === 0 ? (
          <EmptyState
            size="sm"
            icon={ClipboardList}
            title={t("procurement.editor.emptyLines")}
            description={t("procurement.editor.emptyLinesHint")}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {priced.map(({ line, info: brandInfo, pack, cost, total }) => {
              const brand = brandInfo?.brand
              const units = Math.max(0, line.qty) * unitsPer(pack)
              const fromBatch = brandInfo ? !!latestBatch(brandInfo.batches) : false
              return (
                <li
                  key={line.key}
                  data-testid="pr-line"
                  data-brand-id={line.brandId}
                  className="grid grid-cols-2 items-center gap-x-3 gap-y-2 rounded-md bg-surface-raised/60 p-3 @min-[46rem]/pr:grid-cols-[minmax(0,1fr)_10rem_6.5rem_8rem_8rem_auto]"
                >
                  <span className="col-span-2 min-w-0 @min-[46rem]/pr:col-span-1">
                    <span className="block truncate font-medium" lang="en">
                      {brand ? brandLabel(brand) : line.brandId}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {brandInfo?.vendor
                        ? t("procurement.editor.vendor", { vendor: brandInfo.vendor.name })
                        : ""}
                    </span>
                  </span>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("procurement.editor.col.pack")}
                    {brand && brand.packSizes.length > 0 ? (
                      <NativeSelect
                        data-testid="pr-pack"
                        value={pack?.label ?? ""}
                        onChange={(event) => update(line.key, { packLabel: event.target.value })}
                        className="h-8 text-[0.8125rem]"
                        lang="en"
                      >
                        {brand.packSizes.map((p) => (
                          <option key={p.label} value={p.label}>
                            {p.label}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <span className="h-8 text-[0.8125rem] leading-8 text-foreground">
                        {t("procurement.common.looseUnits")}
                      </span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("procurement.editor.col.qty")}
                    <Input
                      data-testid="pr-qty"
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={Number.isFinite(line.qty) ? String(line.qty) : ""}
                      aria-invalid={!(line.qty > 0) || undefined}
                      onChange={(event) =>
                        update(line.key, { qty: Math.round(Number(event.target.value)) })
                      }
                      className="nums h-8 text-center"
                    />
                  </label>
                  <span className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("procurement.editor.col.cost")}
                    <span className="flex h-8 flex-col justify-center">
                      <MoneyText poisha={cost} className="text-[0.8125rem] text-foreground" />
                      <span className="truncate text-[0.6875rem]">
                        {fromBatch
                          ? t("procurement.editor.costLatest")
                          : t("procurement.editor.costFallback")}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t("procurement.editor.col.lineTotal")}
                    <span className="flex h-8 flex-col justify-center">
                      <MoneyText poisha={total} className="text-[0.8125rem] font-semibold text-foreground" />
                      <span className="nums truncate text-[0.6875rem]">
                        {t("procurement.common.equals", {
                          count: num(units),
                          unit: unitWord(brand?.unitLabel, units, locale),
                        })}
                      </span>
                    </span>
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="justify-self-end"
                    aria-label={t("procurement.editor.remove", { item: brand ? brandLabel(brand) : "" })}
                    onClick={() => remove(line.key)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pr-note">{t("procurement.editor.note")}</Label>
          <Textarea
            id="pr-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("procurement.editor.notePlaceholder")}
          />
        </div>

        <footer className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-hairline pt-4">
          <div className="min-w-0 flex-1 basis-72">
            <p className="text-xs text-muted-foreground">{t("procurement.editor.total")}</p>
            <p data-testid="pr-total" data-total={totalP} className="figure text-[1.5rem] leading-tight">
              {money(totalP)}
            </p>
            <p data-testid="pr-tier" data-tier={tier} className="mt-1 text-[0.8125rem] font-medium">
              {t("procurement.editor.approval", {
                tier: tierText.name(tier),
                range: tierText.range(tier),
              })}
            </p>
            {tier !== byValue && totalP > 0 ? (
              <p data-testid="pr-tier-raised" className="mt-0.5 max-w-[60ch] text-xs text-muted-foreground">
                {t("procurement.editor.raised", { valueTier: tierText.name(byValue) })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="pr-save"
              variant="outline"
              onClick={onSave}
              disabled={invalid || save.pending || submit.pending}
            >
              <Save />
              {t("procurement.editor.saveDraft")}
            </Button>
            <Button
              data-testid="pr-submit"
              onClick={onSubmit}
              disabled={invalid || save.pending || submit.pending}
            >
              <Send />
              {t("procurement.editor.submit")}
            </Button>
          </div>
        </footer>
      </section>
    </PageBody>
  )
}

/** A submitted (or someone else's) request: read only, with its tier, status and decision. */
function PrView({ data }: { data: PrData }) {
  const { t, locale } = useLocale()
  const tierText = useTierText()
  const { pr, lines, requester, decider, pos } = data.items[0]
  return (
    <PageBody data-testid="pr-view" data-pr-no={pr.prNo} data-status={pr.status}>
      <PageHeader
        back={{ href: "/store/requests", label: t("procurement.editor.back") }}
        title={t("procurement.editor.title", { prNo: pr.prNo })}
        actions={
          <>
            <LiveChip />
            <PrStatusPill status={pr.status} />
          </>
        }
      />
      <section className="@container/t surface-card flex flex-col gap-4 p-4 @min-[48rem]/t:p-5">
        <KeyValueGrid
          columns={4}
          items={[
            { label: t("procurement.common.branch"), value: branchName(pr.branchId, locale) },
            {
              label: t("procurement.requests.col.requester"),
              value: requester ? nameIn(requester, locale) : "",
            },
            {
              label: t("procurement.editor.submittedAt"),
              value: pr.submittedAt ? <DateText value={pr.submittedAt} variant="dmyTime" /> : "-",
            },
            {
              label: t("procurement.requests.col.tier"),
              value: (
                <span data-testid="pr-tier" data-tier={pr.approvalTier}>
                  {tierText.full(pr.approvalTier)}
                </span>
              ),
              wide: true,
            },
          ]}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("procurement.editor.col.item")}</TableHead>
              <TableHead>{t("procurement.editor.col.qty")}</TableHead>
              <TableHead className="hidden text-right @min-[34rem]/t:table-cell">
                {t("procurement.editor.col.cost")}
              </TableHead>
              <TableHead className="text-right">{t("procurement.editor.col.lineTotal")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const brand = data.brands.get(line.brandId)
              return (
                <TableRow key={line.id} data-testid="pr-line" data-brand-id={line.brandId}>
                  <TableCell className="font-medium" lang="en">
                    {brand ? brandLabel(brand) : line.brandId}
                  </TableCell>
                  <TableCell>
                    <QtyText qty={line.qty} pack={line.pack} brand={brand} />
                  </TableCell>
                  <TableCell className="hidden text-right @min-[34rem]/t:table-cell">
                    <MoneyText poisha={line.estUnitCostP} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyText poisha={line.lineTotalP} className="font-medium" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-hairline pt-3">
          <div>
            <p className="text-xs text-muted-foreground">{t("procurement.editor.total")}</p>
            <p data-testid="pr-total" data-total={pr.totalP} className="figure text-[1.375rem]">
              <MoneyText poisha={pr.totalP} />
            </p>
          </div>
          <Decision
            status={pr.status}
            tier={tierText.name(pr.approvalTier)}
            decider={decider ? nameIn(decider, locale) : ""}
            note={pr.decisionNote}
            at={pr.decidedAt}
          />
        </div>
        {pos.length ? (
          <p className="text-[0.8125rem]">
            {t("procurement.editor.orderedAs", { poNos: pos.map((p) => p.poNo).join(", ") })}{" "}
            <Link href="/store/po" className="font-medium text-link underline-offset-4 hover:underline">
              {t("procurement.editor.goToOrders")}
            </Link>
          </p>
        ) : null}
        {pr.note ? <p className="text-[0.8125rem] text-muted-foreground italic">{pr.note}</p> : null}
      </section>
    </PageBody>
  )
}

function Decision({
  status,
  tier,
  decider,
  note,
  at,
}: {
  status: PrItem["pr"]["status"]
  tier: string
  decider: string
  note?: string
  at?: number
}) {
  const { t } = useLocale()
  if (status === "draft") return null
  if (status === "submitted") {
    return (
      <StatusText tone="warning" dot data-testid="pr-decision">
        {t("procurement.editor.waiting", { tier })}
      </StatusText>
    )
  }
  const rejected = status === "rejected"
  return (
    <div data-testid="pr-decision" className={cn("text-right text-[0.8125rem]")}>
      <StatusText tone={rejected ? "destructive" : "success"} dot>
        {rejected
          ? t("procurement.editor.rejectedBy", { name: decider })
          : t("procurement.editor.approvedBy", { name: decider })}
      </StatusText>
      {at ? (
        <span className="block text-xs text-muted-foreground">
          <DateText value={at} variant="dmyTime" />
        </span>
      ) : null}
      {note ? (
        <span className="block text-xs text-muted-foreground">
          {t("procurement.editor.decisionNote", { note })}
        </span>
      ) : null}
    </div>
  )
}
