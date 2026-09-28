"use client"

import * as React from "react"
import { Pencil, Trash2 } from "lucide-react"

import { StatusPill, StatusText, type Tone } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import type { MealTiming, RxLineStatus } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import type { MedicineCatalogRows } from "@/modules/consultation/components/data"

import { brandLabel, FORM_PREFIX } from "./medicine-search"
import { RxStockBadge, type StockLookup } from "./stock"

/** One prescription line as shown on the pad (a stored line or a line being revised). */
export type LineView = {
  key: string
  brandId?: string
  genericId?: string
  nonDictionaryName?: string
  strength: string
  form: string
  dosePattern: string
  mealTiming: MealTiming
  durationDays: number
  qtyPrescribed: number
  instructionsEn: string
  instructionsBn: string
  isAntibiotic: boolean
  isControlled: boolean
  status?: RxLineStatus
  dispensedQty?: number
  substituted?: boolean
}

const STATUS_TONE: Record<RxLineStatus, Tone> = {
  open: "info",
  partial: "warning",
  dispensed: "success",
  "bought-elsewhere": "muted",
  "awaiting-prescriber": "warning",
  cancelled: "muted",
}

/** The medicine name as written: "Tab. Ace 500 mg" plus its generic. */
export function useLineName(catalog: MedicineCatalogRows | undefined) {
  return React.useCallback(
    (line: Pick<LineView, "brandId" | "nonDictionaryName" | "strength" | "form" | "genericId">) => {
      const brand = line.brandId ? catalog?.brandById.get(line.brandId) : undefined
      if (brand) {
        return {
          prefix: FORM_PREFIX[brand.form] ?? "",
          name: brandLabel(brand),
          generic: catalog?.genericById.get(brand.genericId)?.name ?? "",
          brand,
        }
      }
      return {
        prefix: FORM_PREFIX[line.form] ?? "",
        name: `${line.nonDictionaryName ?? ""} ${line.strength}`.trim(),
        generic: "",
        brand: undefined,
      }
    },
    [catalog]
  )
}

export function RxLines({
  lines,
  catalog,
  stock,
  editable,
  showStatus,
  onEdit,
  onRemove,
}: {
  lines: LineView[]
  catalog: MedicineCatalogRows | undefined
  stock?: StockLookup
  editable: boolean
  showStatus: boolean
  onEdit?: (key: string) => void
  onRemove?: (key: string) => void
}) {
  const { t, tk, num, locale } = useLocale()
  const nameOf = useLineName(catalog)
  return (
    <ol className="@container/lines flex flex-col" data-testid="rx-lines">
      {lines.map((line, index) => {
        const n = nameOf(line)
        const view = n.brand && stock ? stock.of(n.brand.id) : undefined
        return (
          <li
            key={line.key}
            data-testid="rx-line"
            data-brand-id={line.brandId ?? ""}
            data-dose={line.dosePattern}
            data-qty={line.qtyPrescribed}
            className="flex gap-3 border-b border-hairline py-2.5 last:border-0"
          >
            <span className="nums w-5 shrink-0 pt-0.5 text-right text-[0.8125rem] font-semibold text-muted-foreground">
              {num(index + 1)}.
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[0.875rem] font-semibold" lang="en">
                  <span className="mr-1 font-normal text-muted-foreground">{n.prefix}</span>
                  {n.name}
                </span>
                {n.generic ? (
                  <span className="text-xs text-muted-foreground" lang="en">
                    ({n.generic})
                  </span>
                ) : null}
                {line.nonDictionaryName ? (
                  <StatusPill tone="warning" className="h-5 px-2 text-[0.625rem]">
                    {t("prescribing.lines.nonDictionary")}
                  </StatusPill>
                ) : null}
                {line.isAntibiotic ? (
                  <StatusPill tone="warning" className="h-5 px-2 text-[0.625rem]">
                    {t("prescribing.lines.antibiotic")}
                  </StatusPill>
                ) : null}
                {line.isControlled ? (
                  <StatusPill tone="destructive" className="h-5 px-2 text-[0.625rem]">
                    {t("prescribing.lines.controlled")}
                  </StatusPill>
                ) : null}
                {line.substituted ? (
                  <StatusPill tone="info" className="h-5 px-2 text-[0.625rem]">
                    {t("prescribing.lines.substituted")}
                  </StatusPill>
                ) : null}
              </div>
              <div className="mt-0.5 text-[0.8125rem]" lang="bn" data-testid="rx-line-bn">
                {line.instructionsBn}
              </div>
              <div className="text-xs text-muted-foreground" lang="en">
                {line.instructionsEn}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="nums">
                  {t("prescribing.lines.qty")}:{" "}
                  {n.brand
                    ? t("prescribing.lines.units", { count: num(line.qtyPrescribed), unit: n.brand.unitLabel[locale] })
                    : num(line.qtyPrescribed)}
                </span>
                {view && stock ? (
                  <RxStockBadge brand={n.brand!} view={view} lookup={stock} compact testId="rx-line-stock" />
                ) : null}
                {showStatus && line.status ? (
                  <StatusText tone={STATUS_TONE[line.status]} dot className="text-xs">
                    {tk(`prescribing.lines.lineStatus.${line.status}`)}
                    {line.dispensedQty ? ` · ${num(line.dispensedQty)}` : ""}
                  </StatusText>
                ) : null}
              </div>
            </div>
            {editable ? (
              <div className={cn("flex shrink-0 items-start gap-1")}>
                {onEdit ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title={t("prescribing.lines.edit")}
                    aria-label={t("prescribing.lines.edit")}
                    onClick={() => onEdit(line.key)}
                    data-testid="rx-line-edit"
                  >
                    <Pencil />
                  </Button>
                ) : null}
                {onRemove ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    title={t("prescribing.lines.remove")}
                    aria-label={t("prescribing.lines.remove")}
                    onClick={() => onRemove(line.key)}
                    data-testid="rx-line-remove"
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
