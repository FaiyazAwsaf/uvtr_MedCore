"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { BedDouble, Building2, CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { PatientAvatar } from "@/components/shared/avatars"
import { PatientPicker } from "@/components/shared/patient-picker"
import { ageOf, nameIn, otherName } from "@/components/shared/person"
import { UhidText } from "@/components/shared/uhid-text"
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
import type { BranchCode } from "@/config/brand.config"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { BedRow, Id, PatientRow } from "@/core/db/schema"
import { dbReader } from "@/modules/billing/queries"
import { coverFor } from "@/modules/billing/settle"
import { useActionKey } from "@/modules/pharmacy/components/shared"
import { useLocale } from "@/lib/i18n/provider"

import { admit, type AdmitResult } from "../commands"
import { consultantsAt, currentStayOf } from "../queries"
import { admittable, REASON_PRESETS, wardRefusal } from "../stay"
import {
  branchLabel,
  Field,
  NativeSelect,
  NotClinicalNote,
  ProblemAlert,
  useDemoNow,
  useInpatientCommand,
  useRuleText,
  useWardText,
} from "./shared"

const OTHER = "__other"

/**
 * Admit a patient (plan §9 `/reception/inpatient`): a vacant or reserved bed
 * at this branch, a registered patient who is not admitted anywhere, the
 * consultant (one who works here) and an administrative reason. The bed's
 * version is taken when it is chosen: if another window fills it first, the
 * save conflicts ("Record changed") instead of double-booking it.
 */
export function AdmitDialog({
  open,
  onOpenChange,
  branch,
  initialBed,
  onOpenStay,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  branch: BranchCode
  /** The bed the dialog was opened from, as it was then */
  initialBed?: Pick<BedRow, "id" | "version"> | null
  onOpenStay: (admissionId: Id) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[36rem]" data-testid="admit-dialog">
        {open ? (
          <AdmitForm
            branch={branch}
            initialBed={initialBed ?? null}
            onClose={() => onOpenChange(false)}
            onOpenStay={onOpenStay}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function AdmitForm({
  branch,
  initialBed,
  onClose,
  onOpenStay,
}: {
  branch: BranchCode
  initialBed: Pick<BedRow, "id" | "version"> | null
  onClose: () => void
  onOpenStay: (admissionId: Id) => void
}) {
  const db = useDb()
  const { t, tk, locale, money, num } = useLocale()
  const nowMs = useDemoNow()
  const today = dhakaDate(nowMs)
  const wardText = useWardText()
  const ruleText = useRuleText()

  const data = useLiveQuery(async () => {
    const [wards, beds, consultants] = await Promise.all([
      db.wards.where("branchId").equals(branch).toArray(),
      db.beds.where("branchId").equals(branch).toArray(),
      consultantsAt(db, branch),
    ])
    return { wards, beds, consultants }
  }, [db, branch])

  /** The bed as it was when chosen (its version guards the admission). */
  const [picked, setPicked] = React.useState<Pick<BedRow, "id" | "version"> | null>(initialBed)
  const [patient, setPatient] = React.useState<PatientRow | null>(null)
  const [consultantId, setConsultantId] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [otherReason, setOtherReason] = React.useState("")
  const [done, setDone] = React.useState<AdmitResult | null>(null)
  const [actionKey, renewKey] = useActionKey()
  const command = useInpatientCommand(admit)

  const wardById = React.useMemo(() => new Map((data?.wards ?? []).map((w) => [w.id, w])), [data])
  const liveBed = data?.beds.find((b) => b.id === picked?.id)
  const ward = liveBed ? wardById.get(liveBed.wardId) : undefined

  const current = useLiveQuery(
    async () => (patient ? await currentStayOf(db, patient.id) : null),
    [db, patient]
  )
  const cover = useLiveQuery(
    async () => (patient ? await coverFor(dbReader(db), patient, today) : null),
    [db, patient, today]
  )

  const reasonText = reason === OTHER ? otherReason.trim() : reason
  const refusal = patient && ward ? wardRefusal(ward, patient, today) : null
  const ready =
    !!picked && !!patient && !!consultantId && !!reasonText && !current && !refusal && !command.pending

  const bedOptions = React.useMemo(() => {
    if (!data) return []
    return data.wards
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((w) => ({
        ward: w,
        beds: data.beds
          .filter((b) => b.wardId === w.id && (admittable(b) || b.id === picked?.id))
          .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })),
      }))
      .filter((group) => group.beds.length > 0)
  }, [data, picked])

  const save = async () => {
    if (!ready || !picked || !patient) return
    const result = await command.run({
      patientId: patient.id,
      bedId: picked.id,
      bedVersion: picked.version,
      consultantId,
      reason: reasonText,
      idempotencyKey: actionKey,
    })
    if (!result) return
    renewKey()
    setDone(result)
    toast(t("inpatient.admit.done.title"), {
      description: `${result.admissionNo} · ${nameIn(patient, locale)}`,
      icon: <BedDouble className="size-4 text-primary" />,
    })
  }

  const reset = () => {
    setDone(null)
    setPicked(null)
    setPatient(null)
    setReason("")
    setOtherReason("")
    command.clear()
  }

  if (done) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{t("inpatient.admit.done.title")}</DialogTitle>
          <DialogDescription>{t("inpatient.admit.done.body", { bed: done.bedCode })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-md bg-primary-soft px-4 py-3">
          <CheckCircle2 className="size-6 shrink-0 text-success" />
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{t("inpatient.drawer.admissionNo")}</div>
            <div data-testid="admission-no" lang="en" className="font-mono text-lg font-semibold">
              {done.admissionNo}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="neutral" onClick={reset}>
            {t("inpatient.admit.done.another")}
          </Button>
          <Button
            type="button"
            data-testid="admit-open-stay"
            onClick={() => {
              onClose()
              onOpenStay(done.admissionId)
            }}
          >
            {t("inpatient.admit.done.open")}
          </Button>
        </DialogFooter>
      </>
    )
  }

  const age = patient ? ageOf(patient.dob, nowMs) : null

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("inpatient.admit.title")}</DialogTitle>
        <DialogDescription>
          {t("inpatient.admit.subtitle", { branch: branchLabel(branch, locale) })}
        </DialogDescription>
      </DialogHeader>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Field label={t("inpatient.admit.bed")} htmlFor="admit-bed">
          <NativeSelect
            id="admit-bed"
            data-testid="admit-bed"
            value={picked?.id ?? ""}
            onChange={(event) => {
              const bed = data?.beds.find((b) => b.id === event.target.value)
              setPicked(bed ? { id: bed.id, version: bed.version } : null)
              command.clear()
            }}
          >
            <option value="" disabled>
              {bedOptions.length ? t("inpatient.admit.bedPlaceholder") : t("inpatient.admit.noBeds")}
            </option>
            {bedOptions.map(({ ward: w, beds }) => (
              <optgroup key={w.id} label={wardText(w).name}>
                {beds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.status === "reserved"
                      ? t("inpatient.admit.bedReserved", { bed: b.code, ward: wardText(w).kind })
                      : t("inpatient.admit.bedOption", { bed: b.code, ward: wardText(w).kind })}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
          {ward ? (
            <p className="text-xs text-muted-foreground">
              {t("inpatient.admit.rate", { rate: money(ward.bedDayRateP) })}
            </p>
          ) : null}
        </Field>

        <Field label={t("inpatient.admit.patient")}>
          {patient ? (
            <div
              data-testid="admit-patient-selected"
              data-patient-id={patient.id}
              className="flex items-center gap-3 rounded-md bg-surface-raised px-3 py-2"
            >
              <PatientAvatar patient={patient} size={36} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {nameIn(patient, locale)}
                  {otherName(patient, locale) ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {otherName(patient, locale)}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {age ? (
                    <span className="nums">
                      {tk(age.unit === "years" ? "common.years" : "common.months", { count: num(age.value) })} ·{" "}
                      {tk(`common.sexShort.${patient.sex}`)}
                    </span>
                  ) : null}
                  <UhidText uhid={patient.uhid} />
                </span>
              </div>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => {
                  setPatient(null)
                  command.clear()
                }}
              >
                {t("inpatient.admit.changePatient")}
              </Button>
            </div>
          ) : (
            <div data-testid="admit-patient">
              <PatientPicker onSelect={setPatient} />
            </div>
          )}
          {current ? (
            <p data-testid="admit-already" className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <TriangleAlert className="size-3.5" />
              {t("inpatient.admit.alreadyAdmitted", {
                admissionNo: current.admission.admissionNo,
                bed: current.bed?.code ?? "",
              })}
            </p>
          ) : null}
          {refusal && ward ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <TriangleAlert className="size-3.5" />
              {ruleText({ code: refusal, params: { ward: ward.code } })}
            </p>
          ) : null}
          {cover ? (
            <p data-testid="admit-corporate" className="flex items-center gap-1.5 text-xs text-link">
              <Building2 className="size-3.5" />
              {t("inpatient.admit.corporate", {
                client: cover.client?.name[locale] ?? cover.clientId,
                pct: num(cover.coPayPct),
              })}
            </p>
          ) : null}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("inpatient.admit.consultant")} htmlFor="admit-consultant">
            <NativeSelect
              id="admit-consultant"
              data-testid="admit-consultant"
              value={consultantId}
              onChange={(event) => setConsultantId(event.target.value)}
            >
              <option value="" disabled>
                {t("inpatient.admit.consultantPlaceholder")}
              </option>
              {(data?.consultants ?? []).map((c) => (
                <option key={c.doctor.id} value={c.doctor.id}>
                  {t("inpatient.admit.consultantOption", {
                    name: c.staff ? nameIn(c.staff, locale) : c.doctor.id,
                    specialty: c.specialty?.name[locale] ?? "",
                  })}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("inpatient.admit.reason")} htmlFor="admit-reason">
            <NativeSelect
              id="admit-reason"
              data-testid="admit-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              <option value="" disabled>
                {t("inpatient.admit.reasonPlaceholder")}
              </option>
              {REASON_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.text}>
                  {tk(`inpatient.reasons.${preset.key}`)}
                </option>
              ))}
              <option value={OTHER}>{t("inpatient.admit.reasonOther")}</option>
            </NativeSelect>
          </Field>
        </div>
        {reason === OTHER ? (
          <Input
            data-testid="admit-reason-other"
            aria-label={t("inpatient.admit.reasonOther")}
            maxLength={120}
            value={otherReason}
            placeholder={t("inpatient.admit.reasonOtherPlaceholder")}
            onChange={(event) => setOtherReason(event.target.value)}
          />
        ) : null}
        <p className="-mt-2 text-xs text-muted-foreground">{t("inpatient.admit.reasonHint")}</p>

        <ProblemAlert problem={command.problem} />
        <NotClinicalNote />

        <DialogFooter>
          <Button type="button" variant="neutral" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" data-testid="admit-save" disabled={!ready}>
            {command.pending ? <LoaderCircle className="animate-spin" /> : <BedDouble />}
            {command.pending ? t("inpatient.admit.saving") : t("inpatient.admit.save")}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
