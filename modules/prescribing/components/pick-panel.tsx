"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowRightLeft,
  BadgePercent,
  Check,
  CopyPlus,
  FlaskConical,
  Plus,
  ShieldAlert,
  Truck,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { StatusPill } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import type { BranchCode } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type {
  BrandRow,
  MealTiming,
  PatientRow,
  ResultRow,
} from "@/core/db/schema"
import { brandsOfGeneric } from "@/core/search/medicines"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import type { MedicineCatalogRows } from "@/modules/consultation/components/data"
import { useClinicalCommand } from "@/modules/consultation/components/use-clinical-command"
import { requestTransfer } from "@/modules/inventory/commands"

import {
  allergyAlertsFor,
  criticalAlertsFor,
  duplicateAlertsFor,
  type AlertOverride,
  type DuplicateContext,
} from "../alerts"
import { alternativesFor } from "../alternatives"
import type { RxLineInput } from "../commands"
import { instructionsFor, parseDoseShortcut, quantityFor } from "../dose"
import { brandLabel, FORM_PREFIX, type MedicinePick } from "./medicine-search"
import {
  branchName,
  RxStockBadge,
  unitText,
  useStock,
  type StockLookup,
} from "./stock"

const DOSE_CHIPS = ["1+0+0", "0+0+1", "1+0+1", "1+1+1", "1/2+0+1/2", "SOS"]
const DAY_CHIPS = [3, 5, 7, 10, 14, 30]
const MEALS: MealTiming[] = ["before", "after", "with", "any"]

export type AlertContext = {
  thisRx: DuplicateContext["thisRx"]
  nameOf: (lineId: string) => string
  otherLines: DuplicateContext["otherLines"]
  results: ResultRow[]
  now: number
  exceptLineId?: string
}

export type PickInitial = {
  dosePattern: string
  mealTiming: MealTiming
  durationDays: number
  qtyPrescribed?: number
}

/**
 * One medicine being written: what it is, its live stock, the offer (shown
 * only after selection, HAZ-04), the interruptive alerts, the alternatives
 * when it is low or out, and the dose shortcut form.
 */
export function PickPanel({
  pick,
  catalog,
  patient,
  alerts: ctx,
  initial,
  mode,
  onPick,
  onClear,
  onSubmit,
  labTestName,
}: {
  pick: MedicinePick
  catalog: MedicineCatalogRows
  patient: PatientRow
  alerts: AlertContext
  initial?: PickInitial
  mode: "add" | "edit"
  onPick: (pick: MedicinePick) => void
  onClear: () => void
  onSubmit: (line: RxLineInput, overrides: AlertOverride[]) => Promise<boolean>
  labTestName: (testId: string) => string
}) {
  const { t, tk, num, dmy, locale } = useLocale()
  const db = useDb()
  const brand =
    pick.kind === "brand" ? catalog.brandById.get(pick.brandId) : undefined
  const generic = brand ? catalog.genericById.get(brand.genericId) : undefined
  const company = brand ? catalog.companyById.get(brand.companyId) : undefined
  const siblings = brand ? brandsOfGeneric(brand.genericId, catalog.brands) : []
  const stock = useStock(
    siblings.length ? siblings.map((b) => b.id) : brand ? [brand.id] : []
  )
  const view = brand && stock ? stock.of(brand.id) : undefined

  const offers = useLiveQuery(
    async () =>
      brand
        ? (await db.offers.where("brandId").equals(brand.id).toArray()).filter(
            (o) => o.active && (!o.branchId || o.branchId === stock?.branch)
          )
        : [],
    [db, brand?.id, stock?.branch]
  )

  /* ---------------- alerts (HAZ-10: only these three) ---------------- */
  const allergy = allergyAlertsFor(patient.allergies, {
    allergyClass: generic?.allergyClass,
    genericName: generic?.name,
    freeText: pick.kind === "free" ? pick.name : undefined,
  })
  const duplicates = duplicateAlertsFor(
    generic?.id,
    { thisRx: ctx.nameOf },
    {
      thisRx: ctx.thisRx,
      otherLines: ctx.otherLines,
      currentMeds: patient.currentMeds,
      now: ctx.now,
      exceptLineId: ctx.exceptLineId,
    }
  )
  const critical = criticalAlertsFor(ctx.results, ctx.now)
  const showAlerts = mode === "add"
  const [allergyOpen, setAllergyOpen] = React.useState(false)
  const [allergyReason, setAllergyReason] = React.useState("")
  const [dupAck, setDupAck] = React.useState(false)
  const [critAck, setCritAck] = React.useState(false)
  const acked =
    !showAlerts ||
    ((!allergy.length || allergyReason.trim().length > 0) &&
      (!duplicates.length || dupAck) &&
      (!critical.length || critAck))

  /* ---------------- dose form ---------------- */
  const [doseText, setDoseText] = React.useState(initial?.dosePattern ?? "")
  const [meal, setMeal] = React.useState<MealTiming>(
    initial?.mealTiming ?? "after"
  )
  const [daysText, setDaysText] = React.useState(
    String(initial?.durationDays ?? 5)
  )
  const [qtyText, setQtyText] = React.useState(
    initial?.qtyPrescribed !== undefined ? String(initial.qtyPrescribed) : ""
  )
  const [qtyTouched, setQtyTouched] = React.useState(false)
  const parsed = parseDoseShortcut(doseText)
  const days = Math.max(0, Math.min(365, Math.floor(Number(daysText) || 0)))
  const autoQty = parsed.valid ? quantityFor(parsed.code, days) : 0
  const qty =
    qtyTouched && qtyText.trim()
      ? Math.max(0, Math.floor(Number(qtyText) || 0))
      : autoQty
  const needsQty =
    !!brand && parsed.valid && autoQty === 0 && !(qtyTouched && qty > 0)
  const preview = parsed.valid
    ? instructionsFor(parsed.code, meal, days)
    : undefined
  const valid = parsed.valid && (brand ? qty >= 1 : true)
  const [busy, setBusy] = React.useState(false)

  const onDose = (text: string) => {
    setDoseText(text)
    const p = parseDoseShortcut(text)
    if (p.meal) setMeal(p.meal)
    if (p.durationDays !== undefined) setDaysText(String(p.durationDays))
  }

  const submit = async () => {
    const overrides: AlertOverride[] = []
    if (showAlerts && allergy.length)
      overrides.push({ kind: "allergy", reason: allergyReason.trim() })
    if (showAlerts && duplicates.length && dupAck)
      overrides.push({ kind: "duplicate" })
    if (showAlerts && critical.length && critAck)
      overrides.push({ kind: "critical" })
    const line: RxLineInput =
      pick.kind === "brand"
        ? {
            brandId: pick.brandId,
            dosePattern: parsed.code,
            mealTiming: meal,
            durationDays: days,
            qtyPrescribed:
              qtyTouched && qtyText.trim()
                ? qty
                : autoQty > 0
                  ? undefined
                  : qty,
          }
        : {
            nonDictionaryName: pick.name,
            dosePattern: parsed.code,
            mealTiming: meal,
            durationDays: days,
            qtyPrescribed: qty,
          }
    setBusy(true)
    const ok = await onSubmit(line, overrides)
    setBusy(false)
    if (ok)
      toast.success(
        t("prescribing.pick.added", {
          name: brand
            ? brandLabel(brand)
            : pick.kind === "free"
              ? pick.name
              : "",
        })
      )
  }

  const genericName = generic?.name ?? ""
  return (
    <div
      className="@container/pick flex flex-col gap-3 rounded-lg border border-border/70 bg-surface-raised/40 p-3"
      data-testid="rx-pick"
      data-brand-id={brand?.id}
    >
      {/* What it is */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1" lang="en">
          {brand ? (
            <>
              <div className="text-[0.9375rem] font-semibold">
                <span className="mr-1 font-normal text-muted-foreground">
                  {FORM_PREFIX[brand.form] ?? ""}
                </span>
                {brandLabel(brand)}
              </div>
              <div className="text-xs text-muted-foreground">
                {genericName} {brand.strength} {brand.form} ·{" "}
                {company?.shortName}
                {locale === "bn" && generic?.glossBn ? (
                  <span lang="bn"> · {generic.glossBn}</span>
                ) : null}
              </div>
            </>
          ) : pick.kind === "free" ? (
            <>
              <div className="text-[0.9375rem] font-semibold">{pick.name}</div>
              <div className="mt-1">
                <StatusPill tone="warning" data-testid="rx-non-dictionary">
                  {t("prescribing.pick.nonDictionary")}
                </StatusPill>
              </div>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {brand?.isAntibiotic ? (
            <StatusPill tone="warning">
              {t("prescribing.search.antibiotic")}
            </StatusPill>
          ) : null}
          {brand ? (
            <StatusPill
              tone={
                brand.category === "controlled"
                  ? "destructive"
                  : brand.category === "otc"
                    ? "muted"
                    : "info"
              }
            >
              {t(`prescribing.search.category.${brand.category}`)}
            </StatusPill>
          ) : null}
          {mode === "add" ? (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={onClear}
              title={t("prescribing.pick.clear")}
              aria-label={t("prescribing.pick.clear")}
              data-testid="rx-pick-clear"
            >
              <X />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Stock, the moment it is picked */}
      {brand && view && stock ? (
        <RxStockBadge brand={brand} view={view} lookup={stock} />
      ) : pick.kind === "free" ? (
        <p className="text-xs text-muted-foreground">
          {t("prescribing.pick.nonDictionaryHint")}
        </p>
      ) : null}

      {offers?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {offers.map((o) => (
            <StatusPill key={o.id} tone="primary" data-testid="rx-offer">
              <BadgePercent />
              {t("prescribing.pick.offer")}: {o.text[locale]}
            </StatusPill>
          ))}
        </div>
      ) : null}

      {/* Interruptive alerts */}
      {showAlerts &&
      (allergy.length || duplicates.length || critical.length) ? (
        <div className="flex flex-col gap-2">
          {allergy.map((a) => (
            <div
              key={a.substance}
              role="alert"
              data-testid="rx-alert"
              data-kind="allergy"
              className="rounded-md border border-destructive/50 bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] px-3 py-2.5"
            >
              <div className="flex items-start gap-2.5 text-destructive">
                <ShieldAlert className="mt-0.5 size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[0.8125rem] font-bold">
                    {t("prescribing.alerts.allergyTitle")}
                  </div>
                  <p className="text-[0.8125rem] text-foreground">
                    {a.allergyClass && generic?.allergyClass === a.allergyClass
                      ? t("prescribing.alerts.allergyBody", {
                          patient:
                            locale === "bn" ? patient.nameBn : patient.nameEn,
                          substance: a.substance,
                          generic: genericName,
                          klass: a.allergyClass,
                        })
                      : t("prescribing.alerts.allergyBodyName", {
                          patient:
                            locale === "bn" ? patient.nameBn : patient.nameEn,
                          substance: a.substance,
                        })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("prescribing.alerts.reaction", {
                      reaction: a.reaction,
                      severity: tk(
                        `consultation.summary.severity.${a.severity}`
                      ),
                    })}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      size="xs"
                      variant="neutral"
                      onClick={onClear}
                      data-testid="rx-alert-choose-another"
                    >
                      {t("prescribing.pick.clear")}
                    </Button>
                    {!allergyOpen ? (
                      <Button
                        size="xs"
                        variant="destructive-outline"
                        onClick={() => setAllergyOpen(true)}
                        data-testid="rx-alert-override"
                      >
                        {t("prescribing.alerts.override")}
                      </Button>
                    ) : null}
                  </div>
                  {allergyOpen ? (
                    <label className="mt-2 flex flex-col gap-1">
                      <span className="text-xs font-semibold text-foreground">
                        {t("prescribing.alerts.reason")}
                      </span>
                      <Input
                        className="h-8"
                        value={allergyReason}
                        data-testid="rx-alert-reason"
                        placeholder={t("prescribing.alerts.reasonPlaceholder")}
                        onChange={(e) => setAllergyReason(e.target.value)}
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          {duplicates.length ? (
            <div
              role="alert"
              data-testid="rx-alert"
              data-kind="duplicate"
              className="rounded-md border border-warning/50 bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-3 py-2.5"
            >
              <div className="flex items-start gap-2.5">
                <CopyPlus className="mt-0.5 size-5 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <div className="text-[0.8125rem] font-bold">
                    {t("prescribing.alerts.duplicateTitle")}
                  </div>
                  {duplicates.map((d, i) => (
                    <p key={i} className="text-[0.8125rem]">
                      {d.source === "this-rx"
                        ? t("prescribing.alerts.duplicateThisRx", {
                            generic: genericName,
                            name: d.name,
                          })
                        : d.source === "active-rx"
                          ? t("prescribing.alerts.duplicateActiveRx", {
                              generic: genericName,
                              name: d.name,
                              rxNo: d.rxNo ?? "",
                              date: d.signedAt ? dmy(d.signedAt) : "",
                            })
                          : t("prescribing.alerts.duplicateCurrentMeds", {
                              generic: genericName,
                              name: d.name,
                            })}
                    </p>
                  ))}
                  <label className="mt-2 flex items-center gap-2 text-[0.8125rem]">
                    <Checkbox
                      checked={dupAck}
                      onCheckedChange={(v) => setDupAck(!!v)}
                      data-testid="rx-alert-ack"
                    />
                    {t("prescribing.alerts.duplicateAck")}
                  </label>
                </div>
              </div>
            </div>
          ) : null}
          {critical.length ? (
            <div
              role="alert"
              data-testid="rx-alert"
              data-kind="critical"
              className="rounded-md border border-destructive/50 bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] px-3 py-2.5"
            >
              <div className="flex items-start gap-2.5">
                <FlaskConical className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <div className="text-[0.8125rem] font-bold text-destructive">
                    {t("prescribing.alerts.criticalTitle")}
                  </div>
                  {critical.slice(0, 2).map((c) => (
                    <p key={c.resultId} className="text-[0.8125rem]">
                      {t("prescribing.alerts.criticalBody", {
                        test: labTestName(c.testId),
                        value: c.value,
                        unit: c.unit ?? "",
                        flag: tk(`consultation.summary.flags.${c.flag}`),
                        date: dmy(c.at),
                      })}
                    </p>
                  ))}
                  <label className="mt-2 flex items-center gap-2 text-[0.8125rem]">
                    <Checkbox
                      checked={critAck}
                      onCheckedChange={(v) => setCritAck(!!v)}
                      data-testid="rx-alert-ack-critical"
                    />
                    {t("prescribing.alerts.criticalAck")}
                  </label>
                </div>
              </div>
            </div>
          ) : null}
          <p className="text-[0.6875rem] text-muted-foreground">
            {t("prescribing.alerts.onlyThree")}
          </p>
        </div>
      ) : null}

      {/* Alternatives when it is low or out here */}
      {brand && view && stock && view.local !== "in-stock" && mode === "add" ? (
        <Alternatives
          brand={brand}
          catalog={catalog}
          stock={stock}
          qty={autoQty || 10}
          onUse={(id) => onPick({ kind: "brand", brandId: id })}
        />
      ) : null}

      {/* Dose */}
      <div className="grid gap-3 @min-[34rem]/pick:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            className="text-xs font-semibold text-muted-foreground"
            htmlFor="rx-dose-input"
          >
            {t("prescribing.dose.pattern")}
          </label>
          <Input
            id="rx-dose-input"
            value={doseText}
            autoComplete="off"
            data-testid="rx-dose"
            aria-invalid={!!doseText.trim() && !parsed.valid}
            placeholder={t("prescribing.dose.patternPlaceholder")}
            className="h-9 font-mono"
            lang="en"
            onChange={(e) => onDose(e.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {DOSE_CHIPS.map((code) => (
              <button
                key={code}
                type="button"
                data-testid="rx-dose-chip"
                data-code={code}
                onClick={() => onDose(code)}
                className={cn(
                  "h-6 rounded-full px-2.5 font-mono text-[0.6875rem] transition-colors",
                  parsed.code === code
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-raised text-foreground/80 hover:text-foreground"
                )}
              >
                {code}
              </button>
            ))}
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">
            {doseText.trim() && !parsed.valid ? (
              <span className="text-destructive">
                {t("prescribing.dose.invalid")}
              </span>
            ) : (
              t("prescribing.dose.patternHint")
            )}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("prescribing.dose.meal")}
          </span>
          <SegmentedPills
            size="sm"
            value={meal}
            onChange={setMeal}
            options={MEALS.map((m) => ({
              value: m,
              label: t(`prescribing.dose.meals.${m}`),
            }))}
            className="flex-wrap"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            className="text-xs font-semibold text-muted-foreground"
            htmlFor="rx-duration-input"
          >
            {t("prescribing.dose.duration")}
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              id="rx-duration-input"
              type="number"
              min={0}
              max={365}
              value={daysText}
              data-testid="rx-duration"
              className="h-8 w-20"
              onChange={(e) => setDaysText(e.target.value)}
            />
            {DAY_CHIPS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDaysText(String(d))}
                className={cn(
                  "nums h-6 rounded-full px-2.5 text-[0.6875rem]",
                  days === d
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-raised text-foreground/80"
                )}
              >
                {num(d)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDaysText("0")}
              className={cn(
                "h-6 rounded-full px-2.5 text-[0.6875rem]",
                days === 0
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-raised text-foreground/80"
              )}
            >
              {t("prescribing.dose.continue")}
            </button>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            className="text-xs font-semibold text-muted-foreground"
            htmlFor="rx-qty-input"
          >
            {t("prescribing.dose.qty")}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="rx-qty-input"
              type="number"
              min={0}
              value={qtyTouched ? qtyText : autoQty ? String(autoQty) : ""}
              data-testid="rx-qty"
              aria-invalid={needsQty}
              className="h-8 w-24"
              onChange={(e) => {
                setQtyTouched(true)
                setQtyText(e.target.value)
              }}
            />
            <span className="text-xs text-muted-foreground">
              {brand ? unitText(brand.unitLabel, qty, locale) : ""} ·{" "}
              {needsQty ? (
                <span className="text-warning">
                  {t("prescribing.dose.qtyNeeded")}
                </span>
              ) : (
                t("prescribing.dose.qtyAuto")
              )}
            </span>
          </div>
        </div>
      </div>

      {preview ? (
        <div
          className="rounded-md bg-surface-raised px-3 py-2"
          data-testid="rx-dose-preview"
        >
          <div className="text-[0.6875rem] text-muted-foreground">
            {t("prescribing.dose.preview")}
          </div>
          <div className="text-[0.8125rem]" lang="en">
            {preview.en}
          </div>
          <div className="mt-1 text-[0.6875rem] text-muted-foreground">
            {t("prescribing.dose.printedLine")}
          </div>
          <div
            className="text-sm font-semibold"
            lang="bn"
            data-testid="rx-dose-bn"
          >
            {preview.bn}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {!acked ? (
          <span className="mr-auto text-xs text-warning">
            {t("prescribing.pick.needsAck")}
          </span>
        ) : null}
        {mode === "edit" ? (
          <Button size="sm" variant="ghost" onClick={onClear}>
            {t("prescribing.pick.cancelEdit")}
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={submit}
          disabled={!valid || !acked || busy}
          data-testid="rx-add"
        >
          {mode === "edit" ? <Check /> : <Plus />}
          {mode === "edit"
            ? t("prescribing.pick.update")
            : t("prescribing.pick.add")}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Alternatives({
  brand,
  catalog,
  stock,
  qty,
  onUse,
}: {
  brand: BrandRow
  catalog: MedicineCatalogRows
  stock: StockLookup
  qty: number
  onUse: (brandId: string) => void
}) {
  const { t, num, locale } = useLocale()
  const db = useDb()
  const transfer = useClinicalCommand(requestTransfer)
  const view = stock.of(brand.id)
  const alts = alternativesFor(
    brand,
    catalog.brands,
    view.byBranch,
    stock.branch,
    { offline: stock.offline }
  )

  const pending = useLiveQuery(async () => {
    const lines = await db.transferLines
      .where("brandId")
      .equals(brand.id)
      .toArray()
    const transfers = await db.transfers.bulkGet([
      ...new Set(lines.map((l) => l.transferId)),
    ])
    const open = new Map<BranchCode, string>()
    for (const tr of transfers) {
      if (!tr || tr.toBranchId !== stock.branch) continue
      if (tr.status === "received" || tr.status === "cancelled") continue
      open.set(tr.fromBranchId, tr.transferNo)
    }
    return open
  }, [db, brand.id, stock.branch])

  const ask = async (from: BranchCode) => {
    const out = await transfer.run({
      fromBranchId: from,
      toBranchId: stock.branch,
      lines: [{ brandId: brand.id, qty: Math.max(1, qty) }],
      requestedFrom: "doctor-prompt",
      note: t("prescribing.alternatives.transferNote", {
        branch: stock.branch,
      }),
    })
    if (out.ok) {
      toast.success(
        t("prescribing.alternatives.transferRequested", {
          transferNo: out.result.transferNo,
          branch: `${branchName(from, locale)} (${from})`,
        })
      )
    }
  }

  const brandRow = (b: BrandRow) => {
    const v = stock.of(b.id)
    const company = catalog.companyById.get(b.companyId)
    return (
      <li
        key={b.id}
        className="flex items-center gap-2 border-b border-hairline py-1.5 last:border-0"
      >
        <div className="min-w-0 flex-1" lang="en">
          <div className="truncate text-[0.8125rem] font-medium">
            <span className="mr-1 font-normal text-muted-foreground">
              {FORM_PREFIX[b.form] ?? ""}
            </span>
            {brandLabel(b)}
          </div>
          <div className="truncate text-[0.6875rem] text-muted-foreground">
            {company?.shortName}
          </div>
        </div>
        <RxStockBadge
          brand={b}
          view={v}
          lookup={stock}
          compact
          testId="rx-alternative-stock"
        />
        <Button
          size="xs"
          variant="outline"
          onClick={() => onUse(b.id)}
          data-testid="rx-alternative"
          data-brand-id={b.id}
        >
          {t("prescribing.alternatives.use")}
        </Button>
      </li>
    )
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3"
      data-testid="rx-alternatives"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
          <ArrowRightLeft className="size-4 text-link" />
          {t("prescribing.alternatives.title")}
        </h4>
        <span className="text-[0.6875rem] text-muted-foreground">
          {t("prescribing.alternatives.hint")}
        </span>
      </div>
      <div className="grid gap-3 @min-[56rem]/pick:grid-cols-2">
        <div>
          <div className="micro mb-1">
            {t("prescribing.alternatives.sameStrength")}
          </div>
          {alts.sameStrength.length ? (
            <ul>{alts.sameStrength.map(brandRow)}</ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("prescribing.alternatives.none")}
            </p>
          )}
        </div>
        <div>
          <div className="micro mb-1">
            {t("prescribing.alternatives.otherStrengths")}
          </div>
          {alts.otherStrengths.length ? (
            <ul>{alts.otherStrengths.map(brandRow)}</ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("prescribing.alternatives.none")}
            </p>
          )}
        </div>
      </div>
      <div>
        <div className="micro mb-1">
          {t("prescribing.alternatives.otherBranches", {
            name: brandLabel(brand),
          })}
        </div>
        {stock.offline ? (
          <p className="text-xs text-muted-foreground">
            {t("prescribing.stock.offline")}
          </p>
        ) : alts.otherBranches.length ? (
          <ul className="flex flex-col">
            {alts.otherBranches.map((b) => {
              const requested = pending?.get(b.branch)
              return (
                <li
                  key={b.branch}
                  className="flex flex-wrap items-center gap-2 border-b border-hairline py-1.5 last:border-0"
                >
                  <span className="min-w-0 flex-1 text-[0.8125rem]">
                    {branchName(b.branch, locale)} ({b.branch})
                  </span>
                  <StatusPill tone="info" className="h-5 px-2 text-[0.6875rem]">
                    <span className="nums">
                      {t("prescribing.stock.units", {
                        count: num(b.onHand),
                        unit: unitText(brand.unitLabel, b.onHand, locale),
                      })}
                    </span>
                  </StatusPill>
                  {requested ? (
                    <StatusPill
                      tone="success"
                      data-testid="rx-transfer-requested"
                      data-branch={b.branch}
                    >
                      <Truck />
                      {t("prescribing.alternatives.transferPending", {
                        transferNo: requested,
                      })}
                    </StatusPill>
                  ) : (
                    <Button
                      size="xs"
                      variant="neutral"
                      disabled={transfer.pending}
                      onClick={() => ask(b.branch)}
                      data-testid="rx-request-transfer"
                      data-branch={b.branch}
                    >
                      <Truck />
                      {t("prescribing.alternatives.requestTransfer", {
                        branch: b.branch,
                      })}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("prescribing.alternatives.noBranches")}
          </p>
        )}
      </div>
    </div>
  )
}
