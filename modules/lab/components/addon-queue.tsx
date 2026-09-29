"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  Check,
  CircleAlert,
  Clock,
  Droplet,
  PlusCircle,
  RotateCcw,
} from "lucide-react"
import { labToast as toast } from "./lab-toast"

import { DateText } from "@/components/shared/date-text"
import { StatusText, type Tone } from "@/components/shared/status"
import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import type { BranchCode } from "@/config/brand.config"
import { now } from "@/core/clock/clock"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import type {
  LabOrderItemRow,
  LabTestRow,
  PatientRow,
  SpecimenRow,
  StaffRow,
} from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { decideAddOn, type AddOnDecision } from "../commands"
import {
  addOnCheck,
  addOnState,
  addOnVolumeMl,
  isWaitingAddOn,
  type AddOnCheck,
  type AddOnState,
} from "../logic"
import { useLabCommand } from "./lab-feedback"
import { ContainerChip, PatientCell } from "./lab-ui"
import {
  FOCUS_ROW,
  useScrollToFocus,
  useTodayStart,
} from "./use-lab-data"

type AddOnView = {
  item: LabOrderItemRow
  state: AddOnState
  /** The stored tube the request was made on */
  specimen?: SpecimenRow
  /** Where the test runs now: the same tube, or its new one */
  target?: SpecimenRow
  patient?: PatientRow
  requestedBy?: StaffRow
  /** Sample promised to approved add-ons on the tube that have not run yet */
  reservedMl: number
}

const STATUSES: LabOrderItemRow["status"][] = [
  "ordered",
  "paid",
  "collected",
  "received",
  "resulted",
  "validated",
  "signed",
]

const unique = <T,>(values: T[]) => [...new Set(values)]

/** Add-on requests at a branch: every pending one, and today's decided ones. */
async function loadAddOns(
  db: MedcoreDb,
  branch: BranchCode,
  since: number,
  tests: Map<string, LabTestRow>
): Promise<AddOnView[]> {
  const items: LabOrderItemRow[] = []
  for (const status of STATUSES) {
    items.push(
      ...(await db.labOrderItems
        .where("[branchId+status]")
        .equals([branch, status])
        .filter((i) => !!i.addOnOfItemId)
        .toArray())
    )
  }
  const parents = new Map(
    (await db.labOrderItems.bulkGet(unique(items.map((i) => i.addOnOfItemId!))))
      .filter(Boolean)
      .map((p) => [p!.id, p!])
  )
  const shown = items.filter((item) => {
    const state = addOnState(item, parents.get(item.addOnOfItemId!)?.specimenId)
    return state === "pending" || item.createdAt >= since
  })
  const specimenIds = unique(
    shown.flatMap((i) =>
      [parents.get(i.addOnOfItemId!)?.specimenId, i.specimenId].filter(
        (id): id is string => !!id
      )
    )
  )
  const specimens = new Map(
    (await db.specimens.bulkGet(specimenIds))
      .filter(Boolean)
      .map((s) => [s!.id, s!])
  )
  const onTubes = new Map(
    (
      await db.labOrderItems.bulkGet(
        unique([...specimens.values()].flatMap((s) => s.itemIds))
      )
    )
      .filter(Boolean)
      .map((i) => [i!.id, i!])
  )
  const patients = new Map(
    (await db.patients.bulkGet(unique(shown.map((i) => i.patientId))))
      .filter(Boolean)
      .map((p) => [p!.id, p!])
  )
  const staff = new Map(
    (await db.staff.bulkGet(unique(shown.map((i) => i.createdBy))))
      .filter(Boolean)
      .map((s) => [s!.id, s!])
  )

  const views = shown.map((item): AddOnView => {
    const parent = parents.get(item.addOnOfItemId!)
    const specimen = parent?.specimenId
      ? specimens.get(parent.specimenId)
      : undefined
    const reservedMl = (specimen?.itemIds ?? [])
      .map((id) => onTubes.get(id))
      .filter((i): i is LabOrderItemRow => !!i && isWaitingAddOn(i))
      .reduce((sum, i) => {
        const test = tests.get(i.testId)
        return sum + (test ? addOnVolumeMl(test) : 0)
      }, 0)
    return {
      item,
      state: addOnState(item, parent?.specimenId) ?? "pending",
      specimen,
      target: item.specimenId ? specimens.get(item.specimenId) : undefined,
      patient: patients.get(item.patientId),
      requestedBy: staff.get(item.createdBy),
      reservedMl,
    }
  })
  const pending = views
    .filter((v) => v.state === "pending")
    .sort((a, b) => a.item.createdAt - b.item.createdAt)
  const decided = views
    .filter((v) => v.state !== "pending")
    .sort((a, b) => b.item.updatedAt - a.item.updatedAt)
  return [...pending, ...decided]
}

/**
 * The add-on queue on specimen intake (plan §9, S6): doctors' requests to
 * run one more test on a sample already taken. For each one the lab sees
 * the stability (hours since collection against the test's limit) and the
 * sample left, then approves it on the same tube (billed, run once paid) or
 * asks for a new collection. Today's decisions stay listed below.
 */
export function AddOnQueue({
  branch,
  tests,
  focus,
}: {
  branch: BranchCode
  tests: Map<string, LabTestRow> | undefined
  focus?: string
}) {
  const { t, num } = useLocale()
  const db = useDb()
  const since = useTodayStart()
  const rows = useLiveQuery(
    async () => (tests ? loadAddOns(db, branch, since, tests) : undefined),
    [db, branch, since, tests]
  )
  const pending = rows?.filter((r) => r.state === "pending").length ?? 0
  return (
    <SectionCard
      size="sm"
      icon={PlusCircle}
      title={t("lab.addOn.title")}
      subtitle={t("lab.addOn.subtitle")}
      action={
        pending ? (
          <span className="nums inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[0.6875rem] font-semibold text-[#2a2410]">
            {num(pending)}
          </span>
        ) : null
      }
    >
      {rows && !rows.length ? (
        <p className="py-1 text-[0.8125rem] text-muted-foreground">
          {t("lab.addOn.empty")}
        </p>
      ) : (
        <ul className="flex flex-col" data-testid="addon-queue">
          {(rows ?? []).map((row) => (
            <AddOnRow
              key={row.item.id}
              row={row}
              test={tests?.get(row.item.testId)}
              focused={focus === row.item.id}
            />
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function CheckPill({
  ok,
  icon: Icon,
  children,
  testId,
}: {
  ok: boolean
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  testId: string
}) {
  return (
    <span
      data-testid={testId}
      data-ok={ok}
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        ok
          ? "bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-success"
          : "bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] text-destructive"
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {children}
      {ok ? (
        <Check className="size-3.5 shrink-0" />
      ) : (
        <CircleAlert className="size-3.5 shrink-0" />
      )}
    </span>
  )
}

function AddOnRow({
  row,
  test,
  focused,
}: {
  row: AddOnView
  test: LabTestRow | undefined
  focused: boolean
}) {
  const { t, tk, num, locale, money } = useLocale()
  const tick = useNow(15_000)
  const decide = useLabCommand(decideAddOn)
  // Hours and millilitres keep one decimal (2.5 ml, 48.5 h).
  const one = (value: number) => num(value, { maximumFractionDigits: 1 })
  const flash = useFlashOnChange(row.item.version)
  const ref = useScrollToFocus<HTMLLIElement>(focused)
  const { item, specimen, state } = row
  const pending = state === "pending"
  const check: AddOnCheck | undefined =
    specimen && test
      ? addOnCheck({
          specimen,
          test,
          now: tick || now(),
          reservedMl: row.reservedMl,
        })
      : undefined
  const doctor = row.requestedBy
    ? locale === "bn"
      ? row.requestedBy.nameBn
      : row.requestedBy.nameEn
    : t("lab.common.someone")

  const run = async (decision: AddOnDecision) => {
    const done = await decide.run({
      itemId: item.id,
      decision,
      expectedVersion: item.version,
    })
    if (!done) return
    toast.success(
      decision === "approve"
        ? t("lab.addOn.approvedToast", {
            test: test?.code ?? "",
            accessionNo: done.accessionNo,
          })
        : t("lab.addOn.newCollectionToast", {
            test: test?.code ?? "",
            accessionNo: done.accessionNo,
          })
    )
  }

  return (
    <li
      ref={ref}
      data-testid="addon-row"
      data-item-id={item.id}
      data-state={state}
      data-focused={focused || undefined}
      className={cn(
        "-mx-2 flex flex-col gap-2 rounded-md border-b border-hairline px-2 py-3 last:border-0",
        focused && FOCUS_ROW,
        flash
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <PatientCell patient={row.patient} className="min-w-48 flex-1" />
        <div className="flex min-w-0 flex-2 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span
              lang="en"
              className="inline-flex h-6 items-center rounded-full bg-primary-soft px-2 font-mono text-[0.6875rem] font-semibold text-link"
            >
              + {test?.code ?? item.testId}
            </span>
            <span className="text-[0.8125rem] font-medium" lang="en">
              {test?.name}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {t("lab.addOn.requestedBy", { name: doctor })} ·{" "}
            <DateText value={item.createdAt} variant="relative" />
          </span>
        </div>
      </div>

      {specimen ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("lab.addOn.onSpecimen")}{" "}
            <span className="font-mono text-foreground" lang="en">
              {specimen.accessionNo}
            </span>
          </span>
          <ContainerChip container={specimen.container} short />
          {specimen.collectedAt ? (
            <span>
              {t("lab.addOn.collectedAt")}{" "}
              <DateText value={specimen.collectedAt} variant="dmyTime" />
            </span>
          ) : null}
        </div>
      ) : null}

      {pending && check ? (
        <div className="flex flex-wrap items-center gap-2">
          <CheckPill ok={check.stable} icon={Clock} testId="addon-stability">
            {t("lab.addOn.stability", {
              hours: one(check.hours),
              limit: one(check.stabilityHours),
            })}
          </CheckPill>
          <CheckPill
            ok={check.enoughVolume}
            icon={Droplet}
            testId="addon-volume"
          >
            {t("lab.addOn.volume", {
              left: one(check.remainingMl),
              needed: one(check.neededMl),
            })}
          </CheckPill>
          {!check.sameContainer ? (
            <CheckPill ok={false} icon={CircleAlert} testId="addon-container">
              {t("lab.addOn.container")}
            </CheckPill>
          ) : null}
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              data-testid="addon-new-collection"
              disabled={decide.pending}
              onClick={() => run("new-collection")}
            >
              <RotateCcw />
              {t("lab.addOn.newCollection")}
            </Button>
            <Button
              size="sm"
              data-testid="addon-approve"
              disabled={!check.ok || decide.pending}
              title={!check.ok ? t("lab.addOn.cannotApprove") : undefined}
              onClick={() => run("approve")}
            >
              <Check />
              {t("lab.addOn.approve", {
                price: test ? money(test.priceP) : "",
              })}
            </Button>
          </div>
        </div>
      ) : null}

      {pending && check && !check.ok ? (
        <p className="text-xs text-destructive" data-testid="addon-advice">
          {!check.stable
            ? t("lab.addOn.adviceStability", {
                hours: one(check.hours),
                limit: one(check.stabilityHours),
              })
            : !check.enoughVolume
              ? t("lab.addOn.adviceVolume")
              : t("lab.addOn.adviceContainer")}
        </p>
      ) : null}

      {!pending ? (
        <DecisionLine
          row={row}
          price={test ? money(test.priceP) : ""}
          statusLabel={tk(`lab.status.${row.target?.status ?? item.status}`)}
        />
      ) : null}
    </li>
  )
}

/** What happened to a decided request, and where the test stands now. */
function DecisionLine({
  row,
  price,
  statusLabel,
}: {
  row: AddOnView
  price: string
  statusLabel: string
}) {
  const { t, tk } = useLocale()
  const { item, state, target } = row
  let tone: Tone = "info"
  let text: string
  if (state === "closed") {
    tone = "muted"
    text = t("lab.addOn.closed", { status: tk(`lab.status.${item.status}`) })
  } else if (state === "approved") {
    tone = "success"
    text = t("lab.addOn.approvedOn", {
      accessionNo: target?.accessionNo ?? "",
    })
  } else {
    tone = "warning"
    text = t("lab.addOn.newSample", {
      accessionNo: target?.accessionNo ?? "",
      status: statusLabel,
    })
  }
  const stage = !item.paymentCleared
    ? t("lab.addOn.awaitingPayment", { price })
    : item.status === "paid" && state === "approved"
      ? t("lab.addOn.readyToRun")
      : tk(`lab.status.${item.status}`)
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      data-testid="addon-decision"
    >
      <StatusText tone={tone} dot className="whitespace-normal">
        {text}
      </StatusText>
      {state !== "closed" ? (
        <span className="text-muted-foreground">{stage}</span>
      ) : null}
    </div>
  )
}
