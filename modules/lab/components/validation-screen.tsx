"use client"

import * as React from "react"
import {
  CheckCheck,
  ClipboardCheck,
  KeyRound,
  PencilLine,
  Siren,
  TrendingUp,
} from "lucide-react"
import { toast } from "sonner"

import { GeneratedAvatar } from "@/components/shared/avatars"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { rules } from "@/config/rules.config"
import type { LabTestRow, StaffRow } from "@/core/db/schema"
import { useActor } from "@/core/session/persona"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { validateItem } from "../commands"
import { useLabCommand } from "./lab-feedback"
import { ContainerChip, FlagSummary, LabPage, ResultsTable } from "./lab-ui"
import {
  useBranch,
  useItems,
  useLabTests,
  usePatientHistory,
  useStaff,
  type ItemView,
} from "./use-lab-data"

/**
 * "/lab/validation": technical validation per test (plan §6 `lab.validate`):
 * values against reference ranges and flags, the previous result with the
 * change (delta check), and a second person's check for manual values.
 */
export function ValidationScreen() {
  const { t } = useLocale()
  const branch = useBranch()
  const tests = useLabTests()
  const items = useItems(branch, "resulted")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const selected = items?.find((v) => v.item.id === selectedId) ?? items?.[0]

  return (
    <LabPage
      branch={branch}
      title={t("lab.validation.title")}
      subtitle={t("lab.validation.subtitle")}
      testId="lab-validation"
    >
      {items && !items.length ? (
        <SectionCard size="sm" title={t("lab.validation.listTitle")}>
          <EmptyState
            size="sm"
            icon={ClipboardCheck}
            title={t("lab.validation.listEmpty")}
          />
        </SectionCard>
      ) : (
        <div className="@container">
          <div className="grid gap-4 @min-[50rem]:grid-cols-[15rem_minmax(0,1fr)]">
            <SectionCard
              size="sm"
              title={t("lab.validation.listTitle")}
              className="self-start"
              bodyClassName="-mx-2"
            >
              <ul className="flex flex-col gap-0.5 @max-[50rem]:max-h-44 @max-[50rem]:overflow-y-auto">
                {(items ?? []).map((view) => (
                  <ValidateRow
                    key={view.item.id}
                    view={view}
                    test={tests?.get(view.item.testId)}
                    selected={selected?.item.id === view.item.id}
                    onSelect={() => setSelectedId(view.item.id)}
                  />
                ))}
              </ul>
            </SectionCard>
            {selected ? (
              <ValidationDetail
                key={selected.item.id}
                view={selected}
                test={tests?.get(selected.item.testId)}
              />
            ) : (
              <SectionCard size="sm" title={t("lab.validation.selectHint")} />
            )}
          </div>
        </div>
      )}
    </LabPage>
  )
}

function ValidateRow({
  view,
  test,
  selected,
  onSelect,
}: {
  view: ItemView
  test: LabTestRow | undefined
  selected: boolean
  onSelect: () => void
}) {
  const { locale } = useLocale()
  const flash = useFlashOnChange(view.item.version)
  const manual = view.results.some((r) => r.source === "manual")
  return (
    <li>
      <button
        type="button"
        data-testid="validate-row"
        data-item-id={view.item.id}
        aria-current={selected || undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
          selected ? "bg-primary-soft" : "hover:bg-surface-raised",
          flash
        )}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold" lang="en">
            {test?.code ?? "-"}
          </span>
          {manual ? <PencilLine className="size-3.5 text-info" /> : null}
          <span className="ml-auto text-[0.6875rem] text-muted-foreground">
            <DateText value={view.item.updatedAt} variant="relative" />
          </span>
        </span>
        <span className="truncate text-[0.8125rem] font-medium">
          {view.patient
            ? locale === "bn"
              ? view.patient.nameBn
              : view.patient.nameEn
            : "-"}
        </span>
        <FlagSummary results={view.results} />
      </button>
    </li>
  )
}

function ValidationDetail({
  view,
  test,
}: {
  view: ItemView
  test: LabTestRow | undefined
}) {
  const { t } = useLocale()
  const branch = useBranch()
  const actor = useActor()
  const staff = useStaff()
  const history = usePatientHistory(view.item.patientId)
  const validate = useLabCommand(validateItem)
  const [checkedBy, setCheckedBy] = React.useState<StaffRow | null>(null)

  const manual = view.results.filter((r) => r.source === "manual")
  const critical = view.results.some((r) => r.critical)
  const delta = view.results.some((r) => r.deltaFlag)
  const enteredBy = new Set(manual.map((r) => r.createdBy))
  const checkers = [...(staff?.values() ?? [])].filter(
    (s) =>
      (s.role === "labtech" || s.role === "pathologist") &&
      s.branchId === branch &&
      s.id !== actor?.staffId &&
      !enteredBy.has(s.id)
  )
  const ready = !manual.length || !!checkedBy

  const confirm = async () => {
    const done = await validate.run({
      itemId: view.item.id,
      expectedVersion: view.item.version,
      secondCheckBy: manual.length ? checkedBy?.id : undefined,
    })
    if (done)
      toast.success(
        t("lab.validation.validatedToast", { test: test?.code ?? "" })
      )
  }

  return (
    <SectionCard
      size="sm"
      title={
        <span className="flex items-baseline gap-2">
          <span>{test?.name ?? "-"}</span>
          <span className="font-mono text-xs text-muted-foreground" lang="en">
            {test?.code}
          </span>
        </span>
      }
      subtitle={
        view.specimen ? (
          <span className="flex flex-wrap items-center gap-x-2">
            <span>
              {t("lab.common.accession")}{" "}
              <span className="font-mono" lang="en">
                {view.specimen.accessionNo}
              </span>
            </span>
            <ContainerChip
              container={view.specimen.container}
              short
              className="text-xs"
            />
          </span>
        ) : undefined
      }
      className="min-w-0"
    >
      <div
        className="flex flex-col gap-3"
        data-testid="validation-detail"
        data-item-id={view.item.id}
      >
        <IdentityBanner patientId={view.item.patientId} compact />
        {critical ? (
          <Notice tone="destructive" icon={Siren}>
            {t("lab.validation.criticalNotice")}
          </Notice>
        ) : null}
        {delta ? (
          <Notice tone="warning" icon={TrendingUp}>
            {t("lab.validation.deltaNotice")}
          </Notice>
        ) : null}
        {test ? (
          <ResultsTable
            test={test}
            results={view.results}
            patient={view.patient}
            history={history}
            showPrevious
            testId="validation-results"
          />
        ) : null}
        {manual.length ? (
          <SecondCheck
            checkers={checkers}
            checkedBy={checkedBy}
            onChecked={setCheckedBy}
          />
        ) : null}
        <div className="flex justify-end">
          <Button
            data-testid="validate-confirm"
            disabled={!ready || validate.pending}
            onClick={confirm}
          >
            <CheckCheck />
            {t("lab.validation.validate")}
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: "destructive" | "warning" | "info"
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <p
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-md px-3 py-2 text-[0.8125rem]",
        tone === "destructive" &&
          "bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] text-destructive",
        tone === "warning" &&
          "bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] text-[color-mix(in_oklch,var(--warning),var(--foreground)_32%)] dark:text-warning",
        tone === "info" &&
          "bg-[color-mix(in_oklch,var(--info)_14%,transparent)] text-info"
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** A second person picks themselves and enters their PIN (simulated 1234). */
function SecondCheck({
  checkers,
  checkedBy,
  onChecked,
}: {
  checkers: StaffRow[]
  checkedBy: StaffRow | null
  onChecked: (staff: StaffRow | null) => void
}) {
  const { t, locale } = useLocale()
  const [pick, setPick] = React.useState<string | null>(null)
  const [pin, setPin] = React.useState("")
  const [wrong, setWrong] = React.useState(false)
  const chosen = checkers.find((s) => s.id === pick) ?? checkers[0]
  const name = (s: StaffRow) => (locale === "bn" ? s.nameBn : s.nameEn)

  if (checkedBy) {
    return (
      <Notice tone="info" icon={KeyRound}>
        <span data-testid="second-check-done">
          {t("lab.validation.secondCheck.confirmed", { name: name(checkedBy) })}
        </span>
      </Notice>
    )
  }
  return (
    <div
      className="flex flex-col gap-2.5 rounded-md border border-border p-3"
      data-testid="second-check"
    >
      <Notice tone="info" icon={PencilLine}>
        {t("lab.validation.manualNotice")}
      </Notice>
      <p className="text-[0.8125rem] font-semibold">
        {t("lab.validation.secondCheck.title")}
      </p>
      {checkers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("lab.validation.secondCheck.noCheckers")}
        </p>
      ) : (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!chosen || pin.length !== 4) return
            if (pin !== rules.simulated.supervisorPin) {
              setWrong(true)
              setPin("")
              return
            }
            onChecked(chosen)
          }}
        >
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label={t("lab.validation.secondCheck.checker")}
          >
            {checkers.map((s) => {
              const active = s.id === chosen?.id
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid="second-check-by"
                  data-staff-id={s.id}
                  onClick={() => setPick(s.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[0.8125rem]",
                    active
                      ? "border-primary bg-primary-soft"
                      : "border-border hover:bg-surface-raised"
                  )}
                >
                  <GeneratedAvatar
                    seed={s.avatarSeed || s.id}
                    sex={s.sex}
                    role={s.role}
                    size={24}
                  />
                  {name(s)}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("lab.validation.secondCheck.pin")}
              <Input
                className="h-8 w-28 font-mono tracking-[0.3em]"
                data-testid="second-check-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                value={pin}
                aria-invalid={wrong || undefined}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, ""))
                  setWrong(false)
                }}
              />
            </label>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              data-testid="second-check-confirm"
              disabled={pin.length !== 4}
            >
              <KeyRound />
              {t("lab.validation.secondCheck.confirm")}
            </Button>
            <span className="pb-1.5 text-xs text-muted-foreground">
              {wrong ? (
                <span className="text-destructive">
                  {t("lab.validation.secondCheck.wrongPin")}
                </span>
              ) : (
                t("lab.validation.secondCheck.pinHint")
              )}
            </span>
          </div>
        </form>
      )}
    </div>
  )
}
