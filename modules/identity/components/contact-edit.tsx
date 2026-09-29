"use client"

import * as React from "react"
import { toast } from "sonner"
import { Pencil, RefreshCw, Save, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/core/db/DbProvider"
import type { PatientRow } from "@/core/db/schema"
import type { RuleViolation } from "@/core/engine/errors"
import { useLocale } from "@/lib/i18n/provider"

import { updateContact } from "../commands"
import { normalizePhone } from "../registration"
import { useDeskCommand } from "./desk-command"
import { FormField, RuleAlert } from "./desk-ui"

type Draft = {
  /** The version the form was opened on (sent as expectedVersion) */
  version: number
  phone: string
  attendantPhone: string
  address: string
}

function draftOf(patient: PatientRow): Draft {
  return {
    version: patient.version,
    phone: patient.phone ?? "",
    attendantPhone: patient.attendantPhone ?? "",
    address: patient.address ?? "",
  }
}

/** The "Edit contact" button of the patient panel. */
export function ContactEditButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  const { t } = useLocale()
  return (
    <Button
      data-testid="contact-edit"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
    >
      <Pencil />
      {t("identity.contact.edit")}
    </Button>
  )
}

/**
 * Contact details edited at the front desk (plan §10 S16). The form keeps the
 * version it was opened on and sends it with the save, so a change made
 * meanwhile in another window is refused by the engine and the conflict
 * dialog names who changed it. After that the form loads the latest version
 * so the change can be re-applied.
 */
export function ContactForm({
  patient,
  onClose,
}: {
  patient: PatientRow
  onClose: () => void
}) {
  const db = useDb()
  const { t, num } = useLocale()
  const command = useDeskCommand(updateContact)
  const [draft, setDraft] = React.useState<Draft>(() => draftOf(patient))
  const [submitted, setSubmitted] = React.useState(false)
  const [rule, setRule] = React.useState<RuleViolation | null>(null)
  const [reloaded, setReloaded] = React.useState<number | null>(null)
  const id = React.useId()

  const ownPhone = !!draft.phone.trim() || !draft.attendantPhone.trim()
  const phone = normalizePhone(draft.phone)
  const attendant = normalizePhone(draft.attendantPhone)
  const phoneError =
    draft.phone.trim() && !phone
      ? t("identity.register.errors.phone")
      : undefined
  const attendantError =
    draft.attendantPhone.trim() && !attendant
      ? t("identity.register.errors.phone")
      : undefined
  const missing = !phone && !attendant
  const valid = !phoneError && !attendantError && !missing
  const set = (key: keyof Omit<Draft, "version">, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const save = async () => {
    setSubmitted(true)
    setRule(null)
    if (!valid) return
    const outcome = await command.run({
      patientId: patient.id,
      expectedVersion: draft.version,
      phone,
      attendantPhone: phone ? undefined : attendant,
      address: draft.address.trim() || undefined,
    })
    if (outcome.ok) {
      toast.success(
        t("identity.contact.saved", { version: num(outcome.result.version) })
      )
      onClose()
    } else if (outcome.conflict) {
      // Someone saved first: load their version so the change can be re-applied.
      const latest = await db.patients.get(patient.id)
      if (latest) {
        setDraft(draftOf(latest))
        setReloaded(latest.version)
        setSubmitted(false)
      }
    } else if (outcome.rule) {
      setRule(outcome.rule)
    }
  }

  return (
    <section
      data-testid="contact-form"
      data-version={draft.version}
      className="surface-card @container flex flex-col gap-4 p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[0.9375rem] font-semibold">
            {t("identity.contact.title")}
          </h3>
          <p
            data-testid="contact-version"
            className="nums text-xs text-muted-foreground"
          >
            {t("identity.contact.editing", { version: num(draft.version) })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>

      {reloaded !== null ? (
        <p
          role="status"
          data-testid="contact-reloaded"
          className="flex items-start gap-2 rounded-md bg-[color-mix(in_oklch,var(--info)_12%,transparent)] px-3 py-2 text-[0.8125rem] text-foreground"
        >
          <RefreshCw className="mt-0.5 size-4 shrink-0 text-info" />
          {t("identity.contact.reloaded", { version: num(reloaded) })}
        </p>
      ) : null}
      {rule ? <RuleAlert rule={rule} /> : null}

      <div className="grid gap-4 @[30rem]:grid-cols-2">
        <FormField
          label={t("identity.register.phone")}
          htmlFor={`${id}-phone`}
          error={
            submitted
              ? (phoneError ??
                (missing ? t("identity.contact.needOne") : undefined))
              : undefined
          }
          hint={t("identity.contact.phoneHint")}
        >
          <Input
            id={`${id}-phone`}
            data-testid="contact-phone"
            type="tel"
            inputMode="tel"
            value={draft.phone}
            placeholder="01XXX-XXXXXX"
            className="nums"
            aria-invalid={submitted && (!!phoneError || missing)}
            onChange={(e) => set("phone", e.target.value)}
          />
        </FormField>
        {!ownPhone || draft.attendantPhone ? (
          <FormField
            label={t("identity.register.attendantPhone")}
            htmlFor={`${id}-attendant`}
            error={submitted ? attendantError : undefined}
            hint={t("identity.contact.attendantHint")}
          >
            <Input
              id={`${id}-attendant`}
              data-testid="contact-attendant-phone"
              type="tel"
              inputMode="tel"
              value={draft.attendantPhone}
              placeholder="01XXX-XXXXXX"
              className="nums"
              aria-invalid={submitted && !!attendantError}
              onChange={(e) => set("attendantPhone", e.target.value)}
            />
          </FormField>
        ) : null}
        <FormField
          label={t("identity.patient.address")}
          htmlFor={`${id}-address`}
          optional
          className="@[30rem]:col-span-2"
        >
          <Textarea
            id={`${id}-address`}
            data-testid="contact-address"
            value={draft.address}
            className="min-h-10"
            onChange={(e) => set("address", e.target.value)}
          />
        </FormField>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        <p className="text-xs text-muted-foreground">
          {t("identity.contact.versionHint")}
        </p>
        <div className="flex gap-2">
          <Button
            variant="neutral"
            size="sm"
            onClick={onClose}
            disabled={command.pending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="contact-save"
            size="sm"
            onClick={save}
            disabled={command.pending}
          >
            <Save />
            {command.pending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </footer>
    </section>
  )
}
