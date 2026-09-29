"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Replace, ShoppingBag } from "lucide-react"
import { toast } from "sonner"

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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { BrandRow } from "@/core/db/schema"
import { brandsOfGeneric } from "@/core/search/medicines"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { usableUnits } from "@/modules/inventory/stock"

import { recordBoughtElsewhere, requestSubstitution } from "../../commands"
import { isEquivalentBrand } from "../../rules"
import { brandText, CategoryBadges, useActionKey, useModuleCommand } from "../shared"
import type { LineData } from "./use-dispense-data"

export function BoughtElsewhereDialog({
  data,
  onClose,
}: {
  data: LineData | null
  onClose: () => void
}) {
  const { t } = useLocale()
  const [reason, setReason] = React.useState("")
  const command = useModuleCommand(recordBoughtElsewhere)
  const label = data?.brand ? brandText(data.brand) : (data?.line.nonDictionaryName ?? "")

  const submit = async () => {
    if (!data) return
    const done = await command.run({
      rxLineId: data.line.id,
      reason: reason.trim() || undefined,
      expectedVersion: data.line.version,
    })
    if (done) {
      toast.success(t("pharmacy.dispense.bought.done", { brand: label }))
      setReason("")
      onClose()
    }
  }

  return (
    <Dialog open={!!data} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="size-5 text-link" />
            {t("pharmacy.dispense.bought.title")}
          </DialogTitle>
          <DialogDescription>
            {t("pharmacy.dispense.bought.body", { brand: label })}
          </DialogDescription>
        </DialogHeader>
        {data?.line.paymentCleared ? (
          <p className="rounded-md bg-surface-raised px-3 py-2 text-[0.8125rem] text-warning">
            {t("pharmacy.dispense.bought.paidNote")}
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bought-reason">{t("pharmacy.dispense.bought.reason")}</Label>
          <Textarea
            id="bought-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("pharmacy.dispense.bought.reasonPlaceholder")}
            rows={2}
          />
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button data-testid="bought-elsewhere-confirm" onClick={submit} disabled={command.pending}>
            {t("pharmacy.dispense.bought.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The pharmacist proposes another brand and the prescriber decides (PRD §9:
 * never a silent substitution). Other brands of the same generic and strength
 * are listed A to Z with this branch's stock, never ranked by stock or margin
 * (HAZ-04); one with nothing usable here can't be proposed. Another strength
 * would change the dose, so it is not offered.
 */
export function SubstitutionDialog({
  data,
  branch,
  doctorName,
  onClose,
}: {
  data: LineData | null
  branch: BranchCode
  doctorName: string
  onClose: () => void
}) {
  const { t, locale } = useLocale()
  const db = useDb()
  const [proposed, setProposed] = React.useState<string>("")
  const [reason, setReason] = React.useState("")
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(requestSubstitution)
  const genericId = data?.brand?.genericId

  const prescribed = data?.brand
  const options = useLiveQuery(async () => {
    if (!genericId || !prescribed) return []
    const brands = (await db.brands.where("genericId").equals(genericId).toArray()).filter((b) =>
      isEquivalentBrand(prescribed, b)
    )
    const ids = brands.map((b) => b.id)
    const levels = (await db.stockLevels.where("brandId").anyOf(ids).toArray()).filter(
      (l) => l.branchId === branch
    )
    const batches = (await db.batches.bulkGet(levels.map((l) => l.batchId))).filter(
      (b) => b !== undefined
    )
    const today = dhakaDate(now())
    return brandsOfGeneric(genericId, brands)
      .map((brand) => ({
        brand,
        usable: usableUnits(
          levels.filter((l) => l.brandId === brand.id),
          batches,
          today
        ),
      }))
  }, [db, genericId, branch, prescribed])

  const close = () => {
    setProposed("")
    setReason("")
    onClose()
  }

  const submit = async () => {
    if (!data || !proposed) return
    const done = await command.run({
      rxLineId: data.line.id,
      proposedBrandId: proposed,
      reason: reason.trim(),
      idempotencyKey: key,
    })
    if (done) {
      renewKey()
      toast.success(t("pharmacy.dispense.sub.done", { doctor: doctorName }))
      close()
    }
  }

  return (
    <Dialog open={!!data} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Replace className="size-5 text-link" />
            {t("pharmacy.dispense.sub.title")}
          </DialogTitle>
          <DialogDescription>
            {t("pharmacy.dispense.sub.body", { doctor: doctorName })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {t("pharmacy.dispense.sub.prescribed")}
          </span>
          <span className="font-medium" lang="en">
            {brandText(data?.brand)}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("pharmacy.dispense.sub.sameGeneric", {
              generic: data?.generic?.name ?? "",
              strength: prescribed?.strength ?? "",
            })}
          </span>
          {options && options.length === 0 ? (
            <p className="text-[0.8125rem] text-muted-foreground">{t("pharmacy.dispense.sub.none")}</p>
          ) : (
            <RadioGroup
              value={proposed}
              onValueChange={(value) => setProposed(String(value))}
              className="max-h-56 gap-1 overflow-y-auto"
              aria-label={t("pharmacy.dispense.sub.choose")}
            >
              {(options ?? []).map(({ brand, usable }: { brand: BrandRow; usable: number }) => (
                <label
                  key={brand.id}
                  data-testid="substitution-option"
                  data-brand-id={brand.id}
                  data-usable={usable}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2 py-2 has-data-checked:bg-primary-soft",
                    usable > 0 ? "cursor-pointer hover:bg-surface-raised" : "cursor-not-allowed opacity-60"
                  )}
                >
                  <RadioGroupItem value={brand.id} disabled={usable <= 0} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] font-medium" lang="en">
                      {brandText(brand)}
                    </span>
                    <CategoryBadges brand={brand} className="mt-0.5" />
                  </span>
                  <StockBadge status={usable > 0 ? "in-stock" : "out"} qty={usable} />
                </label>
              ))}
            </RadioGroup>
          )}
          <p className="text-xs text-muted-foreground">{t("pharmacy.dispense.sub.strengthNote")}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sub-reason">{t("pharmacy.dispense.sub.reason")}</Label>
          <Textarea
            id="sub-reason"
            data-testid="substitution-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("pharmacy.dispense.sub.reasonPlaceholder")}
            rows={2}
            lang={locale}
          />
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="substitution-send"
            onClick={submit}
            disabled={!proposed || reason.trim().length < 2 || command.pending}
          >
            {t("pharmacy.dispense.sub.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
