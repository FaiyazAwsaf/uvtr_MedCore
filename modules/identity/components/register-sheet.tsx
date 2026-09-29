"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"
import { Baby, Home, Save } from "lucide-react"

import { PatientAvatar } from "@/components/shared/avatars"
import { nameIn } from "@/components/shared/person"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import type { PatientRow, Relation } from "@/core/db/schema"
import type { RuleViolation } from "@/core/engine/errors"
import { findLikelyDuplicates, type DuplicateCandidate } from "@/core/search/fuzzy"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import {
  confirmExistingPatient,
  registerPatient,
  type RegisterInput,
} from "../commands"
import {
  BLOOD_GROUPS,
  BRN_PATTERN,
  canBeGuardian,
  dobFromAge,
  GUARDIAN_RELATIONS,
  ID_MISSING_REASONS,
  isMinor,
  NID_PATTERN,
  normalizePhone,
  PASSPORT_PATTERN,
  RELATIONS,
  type IdMissingReason,
} from "../registration"
import { useDeskCommand } from "./desk-command"
import { ChoicePills, DmyInput, FormField, NativeSelect, RuleAlert } from "./desk-ui"
import { DuplicateWarning, type DuplicateEntry } from "./duplicate-warning"

export type RegisterPrefill = {
  nameEn?: string
  nameBn?: string
  phone?: string
  dob?: string
  sex?: "M" | "F"
  idMissingReason?: IdMissingReason
  /** "none": don't offer to link a household for this number */
  household?: "none"
}

/** How the sheet finished: a new patient, "same person" on the warning, or an existing record opened. */
export type RegisterOutcome = "registered" | "same" | "opened"

type Form = {
  nameEn: string
  nameBn: string
  dobMode: "dob" | "age"
  dob: string
  age: string
  sex: "" | "M" | "F"
  ownPhone: boolean
  phone: string
  attendantPhone: string
  nid: string
  brn: string
  passport: string
  idMissingReason: "" | IdMissingReason
  householdMode: "auto" | "join" | "new" | "none"
  relation: "" | Relation
  guardianId: string
  guardianRelation: "" | Relation
  consentTreatment: boolean
  consentSms: boolean
  consentApp: boolean
  bloodGroup: string
  address: string
}

function initialForm(prefill?: RegisterPrefill): Form {
  return {
    nameEn: prefill?.nameEn ?? "",
    nameBn: prefill?.nameBn ?? "",
    dobMode: "dob",
    dob: prefill?.dob ?? "",
    age: "",
    sex: prefill?.sex ?? "",
    ownPhone: true,
    phone: prefill?.phone ?? "",
    attendantPhone: "",
    nid: "",
    brn: "",
    passport: "",
    idMissingReason: prefill?.idMissingReason ?? "",
    householdMode: prefill?.household ?? "auto",
    relation: "",
    guardianId: "",
    guardianRelation: "",
    consentTreatment: true,
    consentSms: true,
    consentApp: false,
    bloodGroup: "",
    address: "",
  }
}

type Step =
  | { kind: "form" }
  | {
      kind: "duplicates"
      input: RegisterInput
      entry: DuplicateEntry
      candidates: DuplicateCandidate[]
      patients: Map<string, PatientRow>
    }

/**
 * Registration (plan §9 `/reception`, PRD §10.1) in a side sheet, so the
 * search stays where it was. Opens from the front desk and the walk-in flow.
 */
export function RegisterSheet({
  open,
  onOpenChange,
  prefill,
  formKey,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefill?: RegisterPrefill
  /** A new value starts the form again from `prefill` (even while open) */
  formKey?: number
  onDone: (patientId: string, outcome: RegisterOutcome) => void
}) {
  const { t } = useLocale()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-testid="register-sheet"
        className="w-full gap-0 data-[side=right]:sm:max-w-[38rem]"
      >
        <SheetHeader className="border-b border-hairline pb-4">
          <SheetTitle>{t("identity.register.title")}</SheetTitle>
          <SheetDescription>{t("identity.register.subtitle")}</SheetDescription>
        </SheetHeader>
        {open ? (
          <RegisterForm
            key={formKey}
            prefill={prefill}
            onCancel={() => onOpenChange(false)}
            onDone={(patientId, outcome) => {
              onOpenChange(false)
              onDone(patientId, outcome)
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function RegisterForm({
  prefill,
  onCancel,
  onDone,
}: {
  prefill?: RegisterPrefill
  onCancel: () => void
  onDone: (patientId: string, outcome: RegisterOutcome) => void
}) {
  const db = useDb()
  const { t, tk, locale, num, uhid } = useLocale()
  const register = useDeskCommand(registerPatient)
  const confirmSame = useDeskCommand(confirmExistingPatient)
  const [form, setForm] = React.useState<Form>(() => initialForm(prefill))
  const [submitted, setSubmitted] = React.useState(false)
  const [checking, setChecking] = React.useState(false)
  const [step, setStep] = React.useState<Step>({ kind: "form" })
  const [rule, setRule] = React.useState<RuleViolation | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const id = React.useId()
  const today = dhakaDate(now())

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  /* ---------------- derived ---------------- */

  const contact = normalizePhone(form.ownPhone ? form.phone : form.attendantPhone)
  const household = useLiveQuery(
    async () =>
      contact ? ((await db.households.where("phone").equals(contact).first()) ?? null) : null,
    [db, contact]
  )
  const members = useLiveQuery(
    async () =>
      household
        ? (await db.patients.bulkGet(household.memberIds)).filter(
            (p): p is PatientRow => !!p && p.identityStatus !== "merged"
          )
        : [],
    [db, household]
  )
  const householdMode =
    form.householdMode === "auto"
      ? household
        ? "join"
        : contact
          ? "new"
          : "none"
      : form.householdMode === "join" && !household
        ? "new"
        : form.householdMode === "new" && household
          ? "join"
          : form.householdMode

  const age = Number(form.age)
  const dob =
    form.dobMode === "dob"
      ? form.dob
      : form.age.trim() && Number.isInteger(age) && age >= 0 && age <= 120
        ? dobFromAge(age, today)
        : ""
  const minor = !!dob && dob <= today && isMinor(dob, today)
  const guardians = (householdMode === "join" ? (members ?? []) : []).filter((p) =>
    canBeGuardian(p, today)
  )
  const guardian = guardians.find((p) => p.id === form.guardianId)
  const nid = form.nid.replace(/\s/g, "")
  const brn = form.brn.replace(/\s/g, "")
  const passport = form.passport.replace(/\s/g, "").toUpperCase()
  const noId = !nid && !brn && !passport

  /* ---------------- validation ---------------- */

  const errors: Partial<Record<keyof Form, string>> = {}
  if (form.nameEn.trim().length < 2) errors.nameEn = t("identity.register.errors.nameEn")
  if (!form.nameBn.trim()) errors.nameBn = t("identity.register.errors.nameBn")
  if (form.dobMode === "dob") {
    if (!form.dob) errors.dob = t("identity.register.errors.dob")
    else if (form.dob > today) errors.dob = t("identity.register.errors.dobFuture")
  } else if (!dob) errors.age = t("identity.register.errors.age")
  if (!form.sex) errors.sex = t("identity.register.errors.sex")
  if (!contact) {
    if (form.ownPhone) errors.phone = t("identity.register.errors.phone")
    else errors.attendantPhone = t("identity.register.errors.phone")
  }
  if (nid && !NID_PATTERN.test(nid)) errors.nid = t("identity.register.errors.nid")
  if (brn && !BRN_PATTERN.test(brn)) errors.brn = t("identity.register.errors.brn")
  if (passport && !PASSPORT_PATTERN.test(passport)) errors.passport = t("identity.register.errors.passport")
  if (noId && !form.idMissingReason) errors.idMissingReason = t("identity.register.errors.idReason")
  if (householdMode === "join" && !form.relation) errors.relation = t("identity.register.errors.relation")
  if (minor) {
    if (!guardian) errors.guardianId = t("identity.register.errors.guardian")
    if (!form.guardianRelation) errors.guardianRelation = t("identity.register.errors.guardianRelation")
  }
  if (!form.consentTreatment) errors.consentTreatment = t("identity.register.errors.consent")
  const valid = Object.keys(errors).length === 0
  const err = (key: keyof Form) => (submitted ? errors[key] : undefined)

  /* ---------------- save ---------------- */

  const buildInput = (): RegisterInput => ({
    nameEn: form.nameEn.trim().replace(/\s+/g, " "),
    nameBn: form.nameBn.trim().replace(/\s+/g, " "),
    dob,
    dobEstimated: form.dobMode === "age",
    sex: form.sex as "M" | "F",
    phone: form.ownPhone ? contact : undefined,
    attendantPhone: form.ownPhone ? undefined : contact,
    nid: nid || undefined,
    brn: brn || undefined,
    passport: passport || undefined,
    idMissingReason: noId && form.idMissingReason ? form.idMissingReason : undefined,
    bloodGroup: (form.bloodGroup || undefined) as RegisterInput["bloodGroup"],
    address: form.address.trim() || undefined,
    household:
      householdMode === "join" && household
        ? { mode: "join", householdId: household.id, relation: form.relation as Relation }
        : householdMode === "new"
          ? { mode: "new" }
          : { mode: "none" },
    guardian:
      minor && guardian
        ? { patientId: guardian.id, relation: form.guardianRelation as Relation }
        : undefined,
    consents: {
      treatment: form.consentTreatment,
      sms: form.ownPhone && form.consentSms,
      app: form.consentApp,
    },
  })

  const toTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })

  const commitRegistration = async (input: RegisterInput) => {
    setRule(null)
    const outcome = await register.run(input)
    if (outcome.ok) {
      toast.success(
        t(outcome.result.provisional ? "identity.toast.registeredProvisional" : "identity.toast.registered", {
          uhid: uhid(outcome.result.uhid),
        })
      )
      onDone(outcome.result.patientId, "registered")
    } else if (outcome.rule) {
      setRule(outcome.rule)
      setStep({ kind: "form" })
      toTop()
    }
  }

  const onSave = async () => {
    setSubmitted(true)
    setRule(null)
    if (!valid) {
      toTop()
      return
    }
    const input = buildInput()
    setChecking(true)
    try {
      // The ranked duplicate warning comes BEFORE saving (HAZ-02). An exact
      // NID or BRN match skips it: the engine blocks that (INV-02) and audits it.
      const active = await db.patients.where("identityStatus").equals("active").toArray()
      const candidates = findLikelyDuplicates(
        {
          nameEn: input.nameEn,
          dob: input.dob,
          phone: contact,
          nid: input.nid,
          brn: input.brn,
        },
        active,
        { limit: 5 }
      )
      const exactId = candidates.some((c) => c.reasons.includes("nid") || c.reasons.includes("brn"))
      if (candidates.length && !exactId) {
        setStep({
          kind: "duplicates",
          input,
          entry: { nameEn: input.nameEn, nameBn: input.nameBn, dob: input.dob, phone: contact },
          candidates,
          patients: new Map(active.map((p) => [p.id, p])),
        })
        toTop()
        return
      }
    } finally {
      setChecking(false)
    }
    await commitRegistration(input)
  }

  const onSame = async (candidate: DuplicateCandidate) => {
    if (step.kind !== "duplicates") return
    setRule(null)
    const outcome = await confirmSame.run({
      patientId: candidate.patientId,
      candidateIds: step.candidates.map((c) => c.patientId),
      score: candidate.score,
    })
    if (outcome.ok) {
      toast.success(t("identity.toast.sameRecorded"))
      onDone(candidate.patientId, "same")
    } else if (outcome.rule) {
      setRule(outcome.rule)
    }
  }

  const onDifferent = async (reason: string) => {
    if (step.kind !== "duplicates") return
    const top = step.candidates[0]
    await commitRegistration({
      ...step.input,
      duplicateDecision: {
        candidateIds: step.candidates.map((c) => c.patientId),
        score: top?.score ?? 0,
        reason,
      },
    })
  }

  /** For an NID or BRN block: open the record that already holds the number. */
  const openHolder = async () => {
    const holder =
      (nid && (await db.patients.where("nid").equals(nid).first())) ||
      (brn && (await db.patients.where("brn").equals(brn).first())) ||
      undefined
    if (holder) onDone(holder.id, "opened")
  }

  const pending = register.pending || confirmSame.pending || checking

  /* ---------------- render ---------------- */

  return (
    <>
      <div ref={scrollRef} className="@container/reg min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {rule ? (
          <RuleAlert
            rule={rule}
            className="mb-4"
            action={
              rule.code === "NID_EXISTS" || rule.code === "BRN_EXISTS" ? (
                <Button size="sm" variant="outline" onClick={openHolder}>
                  {t("identity.register.openHolder")}
                </Button>
              ) : null
            }
          />
        ) : null}

        {step.kind === "duplicates" ? (
          <DuplicateWarning
            entry={step.entry}
            candidates={step.candidates}
            patients={step.patients}
            pending={pending}
            onSame={onSame}
            onDifferent={onDifferent}
            onBack={() => setStep({ kind: "form" })}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {/* Name */}
            <fieldset className="grid gap-4 @[30rem]/reg:grid-cols-2">
              <FormField label={t("identity.register.nameEn")} htmlFor={`${id}-en`} error={err("nameEn")}>
                <Input
                  id={`${id}-en`}
                  data-testid="register-name-en"
                  value={form.nameEn}
                  autoFocus
                  autoComplete="off"
                  aria-invalid={!!err("nameEn")}
                  placeholder={t("identity.register.nameEnPlaceholder")}
                  onChange={(e) => set("nameEn", e.target.value)}
                />
              </FormField>
              <FormField label={t("identity.register.nameBn")} htmlFor={`${id}-bn`} error={err("nameBn")}>
                <Input
                  id={`${id}-bn`}
                  data-testid="register-name-bn"
                  lang="bn"
                  value={form.nameBn}
                  autoComplete="off"
                  aria-invalid={!!err("nameBn")}
                  placeholder={t("identity.register.nameBnPlaceholder")}
                  onChange={(e) => set("nameBn", e.target.value)}
                />
              </FormField>
            </fieldset>

            {/* Age and sex */}
            <fieldset className="grid gap-4 @[30rem]/reg:grid-cols-2">
              <FormField
                label={
                  <span className="flex w-full items-center justify-between gap-2">
                    {form.dobMode === "dob" ? t("identity.register.dob") : t("identity.register.age")}
                    <button
                      type="button"
                      data-testid="register-dob-mode"
                      className="text-xs font-medium text-link underline-offset-4 hover:underline"
                      onClick={() => set("dobMode", form.dobMode === "dob" ? "age" : "dob")}
                    >
                      {form.dobMode === "dob" ? t("identity.register.useAge") : t("identity.register.useDob")}
                    </button>
                  </span>
                }
                htmlFor={`${id}-dob`}
                error={err("dob") ?? err("age")}
                hint={
                  dob && !errors.dob
                    ? t("identity.register.ageIs", { age: num(ageYears(dob, today)) })
                    : undefined
                }
              >
                {form.dobMode === "dob" ? (
                  <DmyInput
                    id={`${id}-dob`}
                    data-testid="register-dob"
                    value={form.dob}
                    aria-invalid={!!err("dob")}
                    onChange={(iso) => set("dob", iso)}
                  />
                ) : (
                  <Input
                    id={`${id}-dob`}
                    data-testid="register-age"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={120}
                    value={form.age}
                    aria-invalid={!!err("age")}
                    placeholder={t("identity.register.agePlaceholder")}
                    onChange={(e) => set("age", e.target.value)}
                  />
                )}
              </FormField>
              <FormField label={t("identity.register.sex")} error={err("sex")}>
                <ChoicePills
                  data-testid="register-sex"
                  name={`${id}-sex`}
                  value={form.sex}
                  invalid={!!err("sex")}
                  onChange={(value) => set("sex", value)}
                  options={[
                    { value: "M", label: t("common.sexLong.M") },
                    { value: "F", label: t("common.sexLong.F") },
                  ]}
                />
              </FormField>
            </fieldset>

            {/* Contact and household */}
            <fieldset className="flex flex-col gap-3">
              <div className="grid gap-4 @[30rem]/reg:grid-cols-2">
                {form.ownPhone ? (
                  <FormField
                    label={t("identity.register.phone")}
                    htmlFor={`${id}-phone`}
                    error={err("phone")}
                    hint={t("identity.register.phoneHint")}
                  >
                    <Input
                      id={`${id}-phone`}
                      data-testid="register-phone"
                      type="tel"
                      inputMode="tel"
                      value={form.phone}
                      aria-invalid={!!err("phone")}
                      placeholder="01XXX-XXXXXX"
                      className="nums"
                      onChange={(e) => set("phone", e.target.value)}
                    />
                  </FormField>
                ) : (
                  <FormField
                    label={t("identity.register.attendantPhone")}
                    htmlFor={`${id}-attendant`}
                    error={err("attendantPhone")}
                    hint={t("identity.register.attendantHint")}
                  >
                    <Input
                      id={`${id}-attendant`}
                      data-testid="register-attendant-phone"
                      type="tel"
                      inputMode="tel"
                      value={form.attendantPhone}
                      aria-invalid={!!err("attendantPhone")}
                      placeholder="01XXX-XXXXXX"
                      className="nums"
                      onChange={(e) => set("attendantPhone", e.target.value)}
                    />
                  </FormField>
                )}
                <label className="flex items-center gap-2.5 self-center text-[0.8125rem] @[30rem]/reg:mt-6">
                  <Checkbox
                    data-testid="register-no-phone"
                    checked={!form.ownPhone}
                    onCheckedChange={(checked) => set("ownPhone", !checked)}
                  />
                  {t("identity.register.noOwnPhone")}
                </label>
              </div>

              {contact ? (
                <div
                  data-testid="register-household"
                  className="flex flex-col gap-3 rounded-md bg-surface-raised px-3.5 py-3"
                >
                  <p className="flex items-center gap-2 text-[0.8125rem] font-medium">
                    <Home className="size-4 text-link" />
                    {household
                      ? t("identity.register.household.found", {
                          count: num(members?.length ?? household.memberIds.length),
                        })
                      : t("identity.register.household.none")}
                  </p>
                  {household && members?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {members.map((member) => (
                        <span
                          key={member.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-card py-0.5 pr-2.5 pl-0.5 text-xs"
                        >
                          <PatientAvatar patient={member} size={20} />
                          {nameIn(member, locale)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <ChoicePills
                    data-testid="register-household-mode"
                    name={`${id}-hh`}
                    value={householdMode}
                    onChange={(value) => set("householdMode", value)}
                    options={[
                      ...(household
                        ? [{ value: "join" as const, label: t("identity.register.household.join") }]
                        : [{ value: "new" as const, label: t("identity.register.household.start") }]),
                      { value: "none" as const, label: t("identity.register.household.skip") },
                    ]}
                  />
                  {householdMode === "join" ? (
                    <FormField
                      label={t("identity.register.household.relation")}
                      htmlFor={`${id}-relation`}
                      error={err("relation")}
                    >
                      <NativeSelect
                        id={`${id}-relation`}
                        data-testid="register-relation"
                        value={form.relation}
                        aria-invalid={!!err("relation")}
                        onChange={(e) => set("relation", e.target.value as Relation)}
                      >
                        <option value="">{t("identity.register.choose")}</option>
                        {RELATIONS.map((relation) => (
                          <option key={relation} value={relation}>
                            {t(`common.relation.${relation}`)}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
                  ) : householdMode === "new" ? (
                    <p className="text-xs text-muted-foreground">
                      {t("identity.register.household.startHint")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </fieldset>

            {/* Guardian for a minor */}
            {minor ? (
              <fieldset
                data-testid="register-guardian-section"
                className="flex flex-col gap-3 rounded-md border border-[color-mix(in_oklch,var(--info)_30%,transparent)] bg-[color-mix(in_oklch,var(--info)_8%,transparent)] px-3.5 py-3"
              >
                <p className="flex items-center gap-2 text-[0.8125rem] font-medium">
                  <Baby className="size-4 text-info" />
                  {t("identity.register.guardian.title")}
                </p>
                {guardians.length ? (
                  <>
                    <div role="radiogroup" data-testid="register-guardian" className="flex flex-col gap-1">
                      {guardians.map((person) => (
                        <label
                          key={person.id}
                          data-patient-id={person.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem] transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
                            form.guardianId === person.id ? "bg-primary-soft" : "hover:bg-card"
                          )}
                        >
                          <input
                            type="radio"
                            name={`${id}-guardian`}
                            value={person.id}
                            checked={form.guardianId === person.id}
                            onChange={() => set("guardianId", person.id)}
                            className="accent-[var(--primary)]"
                          />
                          <PatientAvatar patient={person} size={26} />
                          <span className="font-medium">{nameIn(person, locale)}</span>
                          {person.relationToHead ? (
                            <span className="text-xs text-muted-foreground">
                              {person.id === household?.headPatientId
                                ? t("identity.desk.household.head")
                                : t(`common.relation.${person.relationToHead}`)}
                            </span>
                          ) : null}
                        </label>
                      ))}
                    </div>
                    {err("guardianId") ? (
                      <p className="text-xs text-destructive">{err("guardianId")}</p>
                    ) : null}
                    <FormField
                      label={t("identity.register.guardian.relation")}
                      htmlFor={`${id}-grel`}
                      error={err("guardianRelation")}
                    >
                      <NativeSelect
                        id={`${id}-grel`}
                        data-testid="register-guardian-relation"
                        value={form.guardianRelation}
                        aria-invalid={!!err("guardianRelation")}
                        onChange={(e) => set("guardianRelation", e.target.value as Relation)}
                      >
                        <option value="">{t("identity.register.choose")}</option>
                        {GUARDIAN_RELATIONS.map((relation) => (
                          <option key={relation} value={relation}>
                            {t(`common.relation.${relation}`)}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormField>
                  </>
                ) : (
                  <p className="text-[0.8125rem] text-foreground/85">
                    {t("identity.register.guardian.needHousehold")}
                  </p>
                )}
              </fieldset>
            ) : null}

            {/* Identity documents */}
            <fieldset className="grid gap-4 @[30rem]/reg:grid-cols-2">
              <FormField label={t("identity.patient.nid")} htmlFor={`${id}-nid`} error={err("nid")} optional>
                <Input
                  id={`${id}-nid`}
                  data-testid="register-nid"
                  inputMode="numeric"
                  value={form.nid}
                  aria-invalid={!!err("nid")}
                  placeholder={t("identity.register.nidPlaceholder")}
                  className="nums font-mono"
                  onChange={(e) => set("nid", e.target.value)}
                />
              </FormField>
              <FormField label={t("identity.patient.brn")} htmlFor={`${id}-brn`} error={err("brn")} optional>
                <Input
                  id={`${id}-brn`}
                  data-testid="register-brn"
                  inputMode="numeric"
                  value={form.brn}
                  aria-invalid={!!err("brn")}
                  placeholder={t("identity.register.brnPlaceholder")}
                  className="nums font-mono"
                  onChange={(e) => set("brn", e.target.value)}
                />
              </FormField>
              <FormField
                label={t("identity.patient.passport")}
                htmlFor={`${id}-passport`}
                error={err("passport")}
                optional
              >
                <Input
                  id={`${id}-passport`}
                  data-testid="register-passport"
                  value={form.passport}
                  aria-invalid={!!err("passport")}
                  className="font-mono uppercase"
                  onChange={(e) => set("passport", e.target.value)}
                />
              </FormField>
              {noId ? (
                <FormField
                  label={t("identity.register.idReason")}
                  htmlFor={`${id}-reason`}
                  error={err("idMissingReason")}
                >
                  <NativeSelect
                    id={`${id}-reason`}
                    data-testid="register-id-reason"
                    value={form.idMissingReason}
                    aria-invalid={!!err("idMissingReason")}
                    onChange={(e) => set("idMissingReason", e.target.value as IdMissingReason)}
                  >
                    <option value="">{t("identity.register.choose")}</option>
                    {ID_MISSING_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {tk(`identity.idReasons.${reason}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              ) : null}
            </fieldset>

            {/* Consent per purpose */}
            <fieldset className="flex flex-col gap-2.5">
              <legend className="mb-1 text-[0.8125rem] font-medium">
                {minor && guardian
                  ? t("identity.register.consent.byGuardian", { name: nameIn(guardian, locale) })
                  : t("identity.register.consent.title")}
              </legend>
              <ConsentRow
                testId="register-consent-treatment"
                checked={form.consentTreatment}
                onChange={(value) => set("consentTreatment", value)}
                label={t("identity.register.consent.treatment")}
                hint={t("identity.register.consent.treatmentHint")}
                error={err("consentTreatment")}
              />
              <ConsentRow
                testId="register-consent-sms"
                checked={form.ownPhone && form.consentSms}
                disabled={!form.ownPhone}
                onChange={(value) => set("consentSms", value)}
                label={t("identity.register.consent.sms")}
                hint={
                  form.ownPhone
                    ? t("identity.register.consent.smsHint")
                    : t("identity.register.consent.smsNoPhone")
                }
              />
              <ConsentRow
                testId="register-consent-app"
                checked={form.consentApp}
                onChange={(value) => set("consentApp", value)}
                label={t("identity.register.consent.app")}
                hint={t("identity.register.consent.appHint")}
              />
            </fieldset>

            {/* Optional details */}
            <fieldset className="grid gap-4 @[30rem]/reg:grid-cols-[10rem_1fr]">
              <FormField label={t("common.bloodGroup")} htmlFor={`${id}-blood`} optional>
                <NativeSelect
                  id={`${id}-blood`}
                  data-testid="register-blood"
                  value={form.bloodGroup}
                  onChange={(e) => set("bloodGroup", e.target.value)}
                >
                  <option value="">{t("identity.register.unknown")}</option>
                  {BLOOD_GROUPS.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label={t("identity.patient.address")} htmlFor={`${id}-address`} optional>
                <Textarea
                  id={`${id}-address`}
                  data-testid="register-address"
                  value={form.address}
                  className="min-h-10"
                  onChange={(e) => set("address", e.target.value)}
                />
              </FormField>
            </fieldset>
          </div>
        )}
      </div>

      {step.kind === "form" ? (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-6 py-4">
          <p className="text-xs text-muted-foreground">
            {submitted && !valid
              ? t("identity.register.fixErrors", { count: num(Object.keys(errors).length) })
              : t("identity.register.uhidOnSave")}
          </p>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={onCancel} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button data-testid="register-save" onClick={onSave} disabled={pending}>
              <Save />
              {pending ? t("common.saving") : t("identity.register.save")}
            </Button>
          </div>
        </footer>
      ) : null}
    </>
  )
}

function ageYears(dob: string, today: string): number {
  const [by, bm, bd] = dob.split("-").map(Number)
  const [y, m, d] = today.split("-").map(Number)
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age -= 1
  return Math.max(0, age)
}

function ConsentRow({
  testId,
  checked,
  disabled,
  onChange,
  label,
  hint,
  error,
}: {
  testId: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
  label: string
  hint: string
  error?: string
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md bg-surface-raised/60 px-3 py-2.5",
        disabled && "cursor-not-allowed opacity-60",
        error && "ring-1 ring-destructive/60"
      )}
    >
      <Checkbox
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[0.8125rem] font-medium">{label}</span>
        <span className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </span>
      </span>
    </label>
  )
}
