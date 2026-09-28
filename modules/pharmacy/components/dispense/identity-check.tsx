"use client"

import * as React from "react"
import { BadgeCheck, CircleX, Fingerprint } from "lucide-react"

import { Input } from "@/components/ui/input"
import type { PatientRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { digitsOnly, matchIdentity, type IdentityMatch } from "../../rules"

/**
 * HAZ-01: a second identifier before any medicine is handed over. The patient
 * says their date of birth or phone number; the pharmacist types it and the
 * dispense button unlocks only on a match.
 */
export function IdentityCheck({
  patient,
  onChange,
}: {
  patient: Pick<PatientRow, "dob" | "phone">
  onChange: (match: IdentityMatch) => void
}) {
  const { t } = useLocale()
  const [value, setValue] = React.useState("")
  const match = matchIdentity(value, patient)
  const tried = digitsOnly(value).length >= 6

  return (
    <section
      className={cn(
        "surface-card flex flex-col gap-2 p-4 ring-1",
        match ? "ring-success/60" : "ring-transparent"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="icon-well flex size-8 shrink-0 items-center justify-center text-link">
          <Fingerprint className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] leading-snug font-semibold">
            {t("pharmacy.dispense.verify.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("pharmacy.dispense.verify.hint")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          data-testid="dispense-verify"
          value={value}
          autoComplete="off"
          inputMode="numeric"
          placeholder={t("pharmacy.dispense.verify.placeholder")}
          aria-invalid={tried && !match ? true : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            onChange(matchIdentity(event.target.value, patient))
          }}
          className={cn("max-w-72", match && "border-success")}
        />
        {match ? (
          <span
            data-testid="dispense-verified"
            className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-success"
          >
            <BadgeCheck className="size-4" />
            {t("pharmacy.dispense.verify.ok", {
              method: t(`pharmacy.dispense.verify.methods.${match}`),
            })}
          </span>
        ) : tried ? (
          <span className="flex items-center gap-1.5 text-[0.8125rem] text-destructive">
            <CircleX className="size-4" />
            {t("pharmacy.dispense.verify.mismatch")}
          </span>
        ) : null}
      </div>
    </section>
  )
}
