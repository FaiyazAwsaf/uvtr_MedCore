"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"
import {
  CheckCheck,
  CloudUpload,
  GitMerge,
  ShieldCheck,
  UserCheck,
  Users,
  UserSearch,
} from "lucide-react"

import { SegmentedPills } from "@/components/motion/segmented"
import { EmptyState } from "@/components/shared/empty-state"
import { StatusPill } from "@/components/shared/status"
import { useSupervisorOverride } from "@/components/shared/supervisor-override-dialog"
import { UhidText } from "@/components/shared/uhid-text"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { branches } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type {
  ApprovalRow,
  PatientRow,
  ReviewItemRow,
  StaffRow,
} from "@/core/db/schema"
import type { RuleViolation } from "@/core/engine/errors"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { MERGE_AUTHORITY, resolveReview } from "../commands"
import {
  fieldText,
  parseReviewDetail,
  provisionalUhidOf,
  splitDuplicate,
  type CandidateMatch,
} from "../review"
import { useDeskCommand } from "./desk-command"
import { DeskHeader, PersonLine, RuleAlert } from "./desk-ui"

type ReviewData = {
  items: ReviewItemRow[]
  patients: Map<string, PatientRow>
  staff: Map<string, StaffRow>
  approvals: Map<string, ApprovalRow>
}

/** Every review item with the records and people it mentions (live). */
function useReviewData(): ReviewData | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const items = await db.reviewQueue.toArray()
    const patientIds = [...new Set(items.flatMap((i) => i.patientIds))]
    const patients = new Map<string, PatientRow>()
    for (const row of await db.patients.bulkGet(patientIds))
      if (row) patients.set(row.id, row)
    const approvals = new Map<string, ApprovalRow>()
    for (const row of await db.approvals
      .where("kind")
      .equals("merge")
      .toArray()) {
      if (row.refs.reviewId) approvals.set(row.refs.reviewId, row)
    }
    const staffIds = [
      ...new Set(
        [
          ...items.map((i) => i.resolvedBy),
          ...[...approvals.values()].map((a) => a.approverId),
        ].filter((id): id is string => !!id)
      ),
    ]
    const staff = new Map<string, StaffRow>()
    for (const row of await db.staff.bulkGet(staffIds))
      if (row) staff.set(row.id, row)
    return { items, patients, staff, approvals }
  }, [db])
}

/**
 * The data steward's review queue (plan §3.7 and §9 `/reception/review`):
 * records the offline replay could not settle on its own. Sync duplicates
 * show the record from the branch beside the central records it may match,
 * with the match score and reasons; identity conflicts show each field's
 * central and branch value. Nothing is merged automatically: "Same person" is
 * a two-person merge confirmed by a supervisor (HAZ-02).
 */
export function ReviewQueue() {
  const { t, num } = useLocale()
  const data = useReviewData()
  const [view, setView] = React.useState<"open" | "resolved">("open")
  const override = useSupervisorOverride()

  const open = (data?.items ?? [])
    .filter((i) => i.status === "open")
    .sort((a, b) => b.createdAt - a.createdAt)
  const resolved = (data?.items ?? [])
    .filter((i) => i.status === "resolved")
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
  const shown = view === "open" ? open : resolved

  return (
    <div className="@container/review flex flex-col gap-4 py-2">
      <DeskHeader
        title={t("identity.review.title")}
        subtitle={t("identity.review.subtitle")}
        actions={
          <SegmentedPills
            size="sm"
            value={view}
            onChange={setView}
            options={[
              {
                value: "open",
                label: t("identity.review.open", { count: num(open.length) }),
              },
              {
                value: "resolved",
                label: t("identity.review.resolved", {
                  count: num(resolved.length),
                }),
              },
            ]}
          />
        }
      />

      {!data ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : !shown.length ? (
        <div className="surface-card">
          <EmptyState
            icon={view === "open" ? CheckCheck : UserSearch}
            title={
              view === "open"
                ? t("identity.review.emptyOpen")
                : t("identity.review.emptyResolved")
            }
            description={
              view === "open" ? t("identity.review.emptyOpenHint") : undefined
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              data={data}
              requestOverride={override.request}
            />
          ))}
        </div>
      )}
      {override.dialog}
    </div>
  )
}

type RequestOverride = ReturnType<typeof useSupervisorOverride>["request"]

function ReviewCard({
  item,
  data,
  requestOverride,
}: {
  item: ReviewItemRow
  data: ReviewData
  requestOverride: RequestOverride
}) {
  const { t, locale, dateTime } = useLocale()
  const branch = branches.find((b) => b.code === item.branchId)
  const Icon = item.kind === "sync-duplicate" ? Users : UserSearch
  return (
    <section
      data-testid="review-item"
      data-review-id={item.id}
      data-kind={item.kind}
      data-status={item.status}
      className="surface-card @container flex min-w-0 flex-col gap-4 p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="icon-well flex size-9 shrink-0 items-center justify-center text-link">
            <Icon className="size-[1.125rem]" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[0.9375rem] font-semibold">
              {t(`identity.review.kind.${item.kind}`)}
            </h2>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <CloudUpload className="size-3.5" />
              {t("identity.review.from", {
                branch: branch
                  ? `${branch.name[locale]} (${branch.code})`
                  : item.branchId,
              })}
              <span className="nums">· {dateTime(item.createdAt)}</span>
            </p>
          </div>
        </div>
        <StatusPill tone={item.status === "open" ? "warning" : "success"} dot>
          {item.status === "open"
            ? t("identity.review.statusOpen")
            : t("identity.review.statusResolved")}
        </StatusPill>
      </header>

      {item.status === "resolved" ? (
        <ResolvedNote item={item} data={data} />
      ) : null}

      {item.kind === "sync-duplicate" ? (
        <DuplicateReview
          item={item}
          data={data}
          requestOverride={requestOverride}
        />
      ) : (
        <ConflictReview item={item} data={data} />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * One record, side by side
 * ------------------------------------------------------------------ */

function masked(value: string | undefined): string | undefined {
  return value ? `•••• ${value.slice(-4)}` : undefined
}

function RecordBlock({
  patient,
  compare,
  label,
  tone,
  match,
  action,
}: {
  patient: PatientRow
  /** The record on the other side: differing values are highlighted */
  compare?: PatientRow
  label: React.ReactNode
  tone: "incoming" | "central"
  match?: CandidateMatch
  action?: React.ReactNode
}) {
  const { t, locale, dmy, digits, dateTime, num } = useLocale()
  const branch = branches.find((b) => b.code === patient.registeredAtBranch)
  const provisional = provisionalUhidOf(patient)
  const differs = (field: keyof PatientRow) =>
    !!compare &&
    JSON.stringify(patient[field] ?? null) !==
      JSON.stringify(compare[field] ?? null)
  const rows: {
    key: string
    label: string
    value: React.ReactNode
    diff?: boolean
  }[] = [
    {
      key: "nameEn",
      label: t("identity.review.fields.nameEn"),
      value: patient.nameEn,
      diff: differs("nameEn"),
    },
    {
      key: "nameBn",
      label: t("identity.review.fields.nameBn"),
      value: <span lang="bn">{patient.nameBn}</span>,
      diff: differs("nameBn"),
    },
    {
      key: "dob",
      label: t("identity.review.fields.dob"),
      value: <span className="nums">{dmy(patient.dob)}</span>,
      diff: differs("dob"),
    },
    {
      key: "sex",
      label: t("identity.review.fields.sex"),
      value: t(`common.sexLong.${patient.sex}`),
      diff: differs("sex"),
    },
    {
      key: "phone",
      label: t("identity.review.fields.phone"),
      value: patient.phone ? (
        <span className="nums">{digits(patient.phone)}</span>
      ) : (
        <span className="text-muted-foreground">
          {t("identity.patient.noPhone")}
        </span>
      ),
      diff: differs("phone"),
    },
    {
      key: "nid",
      label: t("identity.review.fields.nid"),
      value: patient.nid ? (
        <span lang="en" className="font-mono">
          {masked(patient.nid)}
        </span>
      ) : (
        <span className="text-muted-foreground">
          {t("identity.patient.noId")}
        </span>
      ),
      diff: differs("nid"),
    },
    {
      key: "registered",
      label: t("identity.review.fields.registered"),
      value: (
        <span className="nums">
          {branch
            ? `${branch.name[locale]} (${branch.code})`
            : patient.registeredAtBranch}
          , {dateTime(patient.originAt ?? patient.createdAt)}
        </span>
      ),
    },
  ]

  return (
    <div
      data-testid="review-record"
      data-patient-id={patient.id}
      data-side={tone}
      className={cn(
        "@container flex min-w-0 flex-col gap-3 rounded-md border p-3",
        tone === "incoming"
          ? "border-[color-mix(in_oklch,var(--warning)_35%,transparent)] bg-[color-mix(in_oklch,var(--warning)_6%,transparent)]"
          : "border-border/70"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {patient.identityStatus === "under-review" ? (
          <StatusPill tone="warning">
            {t("identity.review.underReview")}
          </StatusPill>
        ) : patient.identityStatus === "merged" ? (
          <StatusPill tone="muted">{t("identity.review.mergedTag")}</StatusPill>
        ) : null}
      </div>
      <PersonLine patient={patient} size={40} showUhid={false} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]">
        <UhidText uhid={patient.uhid} withLabel />
        {tone === "incoming" && provisional && provisional !== patient.uhid ? (
          <span
            data-testid="review-provisional"
            className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] px-2 py-0.5 text-[0.6875rem]"
          >
            <span className="font-medium">
              {t("identity.review.provisional")}
            </span>
            <UhidText uhid={provisional} />
          </span>
        ) : null}
      </div>
      {tone === "central" && patient.aliases.length ? (
        <p
          data-testid="review-aliases"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
        >
          {t("identity.review.aliases")}
          {patient.aliases.map((alias) => (
            <UhidText
              key={alias}
              uhid={alias}
              className="rounded-full bg-surface-raised px-2 py-0.5 text-foreground/85"
            />
          ))}
        </p>
      ) : null}
      <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1.5 text-[0.8125rem]">
        {rows.map((row) => (
          <React.Fragment key={row.key}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd
              data-diff={row.diff || undefined}
              className={cn(
                "min-w-0 break-words",
                row.diff &&
                  "rounded-sm bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] px-1 font-medium"
              )}
            >
              {row.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      {match ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2.5">
          <span
            data-testid="review-score"
            className={cn(
              "nums rounded-full px-2.5 py-0.5 text-xs font-semibold",
              match.score >= 0.8
                ? "bg-[color-mix(in_oklch,var(--destructive)_15%,transparent)] text-destructive"
                : "bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] text-warning"
            )}
          >
            {t("identity.duplicate.match", {
              percent: num(Math.round(match.score * 100)),
            })}
          </span>
          {match.reasons.map((reason) => (
            <span
              key={reason}
              className="rounded-full bg-surface-raised px-2 py-0.5 text-[0.6875rem] text-foreground/85"
            >
              {t(`identity.duplicate.reasons.${reason}`)}
            </span>
          ))}
        </div>
      ) : null}
      {action ? <div className="flex justify-end">{action}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Sync duplicate: same person (two-person merge) or different people
 * ------------------------------------------------------------------ */

function DuplicateReview({
  item,
  data,
  requestOverride,
}: {
  item: ReviewItemRow
  data: ReviewData
  requestOverride: RequestOverride
}) {
  const { t, uhid } = useLocale()
  const resolve = useDeskCommand(resolveReview)
  const [reason, setReason] = React.useState("")
  const [rule, setRule] = React.useState<RuleViolation | null>(null)
  const reasonId = React.useId()
  const { incoming, candidates } = splitDuplicate(item, data.patients)
  const matches = parseReviewDetail(item.detail)
  const isOpen = item.status === "open"

  if (!incoming) return null

  const onSame = async (candidate: PatientRow) => {
    setRule(null)
    const approval = await requestOverride({
      authority: MERGE_AUTHORITY,
      title: t("identity.review.mergeTitle"),
      description: t("identity.review.mergeBody", {
        merged: uhid(incoming.uhid),
        survivor: uhid(candidate.uhid),
      }),
    })
    if (!approval) return
    const outcome = await resolve.run({
      reviewId: item.id,
      decision: "same",
      survivorId: candidate.id,
      mergedId: incoming.id,
      approval: {
        approverStaffId: approval.approverStaffId,
        reason:
          approval.reason.length >= 3
            ? approval.reason
            : t("identity.review.mergeReasonDefault"),
        pinVerified: true,
      },
    })
    if (outcome.ok) {
      toast.success(
        t("identity.review.mergedToast", {
          survivor: uhid(candidate.uhid),
          alias: uhid(incoming.uhid),
        })
      )
    } else if (outcome.rule) setRule(outcome.rule)
  }

  const onDifferent = async () => {
    setRule(null)
    const outcome = await resolve.run({
      reviewId: item.id,
      decision: "different",
      reason: reason.trim(),
    })
    if (outcome.ok) toast.success(t("identity.review.differentToast"))
    else if (outcome.rule) setRule(outcome.rule)
  }

  return (
    <div className="flex flex-col gap-4">
      {isOpen ? (
        <p className="text-[0.8125rem] text-foreground/85">
          {t("identity.review.duplicateHint")}
        </p>
      ) : null}
      {rule ? <RuleAlert rule={rule} /> : null}
      <div className="grid min-w-0 items-start gap-3 @[44rem]:grid-cols-2">
        <RecordBlock
          patient={incoming}
          compare={candidates[0]}
          tone="incoming"
          label={t("identity.review.incoming")}
        />
        <div className="flex min-w-0 flex-col gap-3">
          {candidates.map((candidate) => (
            <RecordBlock
              key={candidate.id}
              patient={candidate}
              compare={incoming}
              tone="central"
              label={t("identity.review.central")}
              match={matches.get(candidate.id)}
              action={
                isOpen && candidate.identityStatus !== "merged" ? (
                  <Button
                    data-testid="review-same"
                    data-patient-id={candidate.id}
                    variant="outline"
                    size="sm"
                    disabled={resolve.pending}
                    onClick={() => onSame(candidate)}
                  >
                    <GitMerge />
                    {t("identity.review.same")}
                  </Button>
                ) : null
              }
            />
          ))}
        </div>
      </div>
      {isOpen ? (
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <label htmlFor={reasonId} className="text-[0.8125rem] font-medium">
            {t("identity.review.reasonLabel")}
          </label>
          <Textarea
            id={reasonId}
            data-testid="review-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("identity.review.reasonPlaceholder")}
            className="min-h-14"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              {t("identity.review.mergeNote")}
            </p>
            <Button
              data-testid="review-different"
              variant="neutral"
              size="sm"
              disabled={reason.trim().length < 3 || resolve.pending}
              onClick={onDifferent}
            >
              <UserCheck />
              {t("identity.review.different")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Identity conflict: keep central or keep the branch's value, per field
 * ------------------------------------------------------------------ */

function ConflictReview({
  item,
  data,
}: {
  item: ReviewItemRow
  data: ReviewData
}) {
  const { t, tk } = useLocale()
  const resolve = useDeskCommand(resolveReview)
  const [keep, setKeep] = React.useState<Record<string, "central" | "edge">>({})
  const [rule, setRule] = React.useState<RuleViolation | null>(null)
  const patient = data.patients.get(item.patientIds[0])
  const fields = item.fields ?? []
  const isOpen = item.status === "open"
  const ready = fields.every((f) => keep[f.field])

  const apply = async () => {
    setRule(null)
    const outcome = await resolve.run({
      reviewId: item.id,
      decision: "fields",
      keep,
    })
    if (outcome.ok) toast.success(t("identity.review.fieldsToast"))
    else if (outcome.rule) setRule(outcome.rule)
  }

  return (
    <div className="flex flex-col gap-3">
      {patient ? <PersonLine patient={patient} size={40} /> : null}
      {isOpen ? (
        <p className="text-[0.8125rem] text-foreground/85">
          {t("identity.review.conflictHint")}
        </p>
      ) : null}
      {rule ? <RuleAlert rule={rule} /> : null}
      <div className="overflow-x-auto rounded-md border border-border/70">
        <table className="w-full min-w-[34rem] text-[0.8125rem]">
          <thead className="bg-surface-raised text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t("identity.review.field")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("identity.review.centralValue")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("identity.review.edgeValue")}
              </th>
              {isOpen ? (
                <th className="px-3 py-2 font-medium">
                  {t("identity.review.keep")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {fields.map((f) => (
              <tr key={f.field} data-testid="review-field" data-field={f.field}>
                <td className="px-3 py-2 text-muted-foreground">
                  {tk(`identity.review.fields.${f.field}`)}
                </td>
                <td className="px-3 py-2 font-medium">
                  {fieldText(f.field, f.centralValue) || "·"}
                </td>
                <td className="px-3 py-2 font-medium">
                  {fieldText(f.field, f.edgeValue) || "·"}
                </td>
                {isOpen ? (
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {(["central", "edge"] as const).map((side) => (
                        <button
                          key={side}
                          type="button"
                          data-testid="review-keep"
                          data-field={f.field}
                          data-choice={side}
                          aria-pressed={keep[f.field] === side}
                          onClick={() =>
                            setKeep((current) => ({
                              ...current,
                              [f.field]: side,
                            }))
                          }
                          className={cn(
                            "h-8 rounded-full px-3 text-xs font-medium transition-colors",
                            keep[f.field] === side
                              ? "bg-primary text-primary-foreground"
                              : "bg-surface-raised text-foreground/85 hover:text-foreground"
                          )}
                        >
                          {side === "central"
                            ? t("identity.review.keepCentral")
                            : t("identity.review.keepEdge")}
                        </button>
                      ))}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isOpen ? (
        <div className="flex justify-end">
          <Button
            data-testid="review-apply"
            size="sm"
            disabled={!ready || resolve.pending}
            onClick={apply}
          >
            <CheckCheck />
            {t("identity.review.apply")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * What was decided, by whom
 * ------------------------------------------------------------------ */

function ResolvedNote({
  item,
  data,
}: {
  item: ReviewItemRow
  data: ReviewData
}) {
  const { t, locale, dateTime, uhid } = useLocale()
  const staffName = (id: string | undefined) => {
    const row = id ? data.staff.get(id) : undefined
    return row ? (locale === "bn" ? row.nameBn : row.nameEn) : ""
  }
  const approval = data.approvals.get(item.id)
  let text = ""
  if (item.resolution === "same") {
    // Either side may have been kept: the merged one points at the survivor.
    const merged = item.patientIds
      .map((id) => data.patients.get(id))
      .find((p) => p?.identityStatus === "merged" && p.mergedInto)
    const survivor = merged?.mergedInto
      ? data.patients.get(merged.mergedInto)
      : undefined
    text = t("identity.review.resolvedSame", {
      survivor: survivor ? uhid(survivor.uhid) : "",
      alias: merged ? uhid(merged.uhid) : "",
      approver: staffName(approval?.approverId),
    })
  } else if (item.resolution === "different") {
    text = t("identity.review.resolvedDifferent", { reason: item.reason ?? "" })
  } else if (item.resolution === "kept-edge") {
    text = t("identity.review.resolvedKeptEdge")
  } else {
    text = t("identity.review.resolvedKeptCentral")
  }
  return (
    <div
      data-testid="review-resolved"
      data-resolution={item.resolution}
      className="flex flex-col gap-1 rounded-md bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-3.5 py-2.5 text-[0.8125rem]"
    >
      <p className="font-medium">{text}</p>
      <p className="nums text-xs text-muted-foreground">
        {t("identity.review.resolvedBy", {
          name: staffName(item.resolvedBy),
          time: item.resolvedAt ? dateTime(item.resolvedAt) : "",
        })}
      </p>
    </div>
  )
}
