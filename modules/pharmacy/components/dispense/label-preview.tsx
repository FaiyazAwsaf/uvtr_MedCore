"use client"

import * as React from "react"
import { Printer } from "lucide-react"
import { toast } from "sonner"

import { PrintLayout } from "@/components/shared/print-layout"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import type { BranchCode } from "@/config/brand.config"
import type { Locale } from "@/lib/i18n/config"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { buildLabel, type LabelInput } from "../../label"

/** Latin from the UI face, Bengali glyphs from the embedded Noto Sans Bengali (HAZ-13). */
const LABEL_FONT = { fontFamily: "var(--font-sans), var(--font-bangla), system-ui, sans-serif" }

/**
 * One dispensing label on label stock (70 x 45 mm): hospital brand, patient
 * and UHID, medicine, the Bangla dose line with meal timing and duration, the
 * quantity given and what is still owed (HAZ-06), batch and expiry, the
 * pharmacist with their Pharmacy Council number, and the date.
 */
export function DispenseLabel({
  input,
  lang,
  branch,
  fresh = false,
}: {
  input: LabelInput
  lang: Locale
  branch?: BranchCode
  /** Printed just now: shows the simulated printer status */
  fresh?: boolean
}) {
  const { t } = useLocale()
  const model = buildLabel(input, lang)
  return (
    <figure
      data-testid="label-preview"
      data-label-lang={lang}
      className={cn("flex flex-col items-center gap-2", fresh && "flash-sync rounded-lg")}
    >
      <div lang={lang} style={LABEL_FONT} className="w-full">
        <PrintLayout size="label" branch={branch} docNo={input.rxNo} className="shadow-lg">
          <div className="flex flex-col gap-1 leading-snug">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[0.75rem] font-bold">{model.patient}</span>
              <span className="shrink-0 font-mono text-[0.625rem]" lang="en">
                {model.uhid}
              </span>
            </div>
            <div className="border-t border-[#ddd] pt-1">
              <div className="text-[0.8125rem] font-bold" lang="en">
                {model.medicine}
              </div>
              <div className="text-[0.625rem] text-[#555]" lang="en">
                {model.generic}
              </div>
            </div>
            <div className="rounded-sm bg-[#f1f1f1] px-1.5 py-1 text-[0.75rem] font-semibold">
              {model.dose}
            </div>
            <div className="flex flex-wrap justify-between gap-x-2 text-[0.6875rem]">
              <span className="font-semibold">{model.given}</span>
              <span className={cn(input.outstandingQty > 0 && "font-semibold")}>
                {model.outstanding}
              </span>
            </div>
            {model.batches.map((batch) => (
              <div key={batch} className="text-[0.625rem] text-[#444]">
                {batch}
              </div>
            ))}
            <div className="flex flex-wrap justify-between gap-x-2 border-t border-[#ddd] pt-1 text-[0.5625rem] text-[#444]">
              <span>{model.pharmacist}</span>
              <span>{model.date}</span>
            </div>
          </div>
        </PrintLayout>
      </div>
      <figcaption className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
        {fresh ? (
          <>
            <Printer className="size-3.5 text-success" />
            <span className="font-medium text-success">{t("pharmacy.dispense.labels.sent")}</span>
            <SimulatedBadge />
          </>
        ) : (
          <Button
            variant="link"
            size="xs"
            onClick={() =>
              toast.success(t("pharmacy.dispense.labels.sent"), { id: `label:${input.rxNo}` })
            }
          >
            <Printer />
            {t("pharmacy.dispense.labels.print")}
          </Button>
        )}
      </figcaption>
    </figure>
  )
}
