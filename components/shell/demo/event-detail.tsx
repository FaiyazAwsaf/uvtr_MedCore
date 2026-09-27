"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowLeft, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import type { AuditRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import {
  DiffList,
  diffLines,
  formatValue,
  MONO_DATA,
} from "@/modules/demo/components/audit/diff"
import {
  actorName,
  branchLabel,
  consumerLabel,
  eventDef,
  eventLabel,
  roleLabel,
  SEVERITY_DOT,
} from "@/modules/demo/components/labels"

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1.5 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Pairs({
  values,
  empty,
}: {
  values: Record<string, unknown>
  empty: string
}) {
  const entries = Object.entries(values)
  if (!entries.length)
    return <span className="text-muted-foreground">{empty}</span>
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map(([key, value]) => (
        <li key={key} className={cn("text-[0.6875rem] break-all", MONO_DATA)}>
          <span className="text-muted-foreground">{key}: </span>
          {formatValue(value, 80)}
        </li>
      ))}
    </ul>
  )
}

/** One event in full: payload, links, commit and the audit rows it wrote. */
export function EventDetail({
  seq,
  onBack,
  onOnlyPatient,
}: {
  seq: number
  onBack: () => void
  onOnlyPatient: (patientId: string) => void
}) {
  const { t, tk, num, locale, dateTime, relative } = useLocale()
  const db = useDb()
  const event = useLiveQuery(
    async () => (await db.events.get(seq)) ?? null,
    [db, seq]
  )
  const commitId = event?.commitId
  const audit = useLiveQuery(
    async () =>
      commitId ? db.audit.where("commitId").equals(commitId).sortBy("seq") : [],
    [db, commitId]
  )

  if (event === undefined) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {t("demo.common.loading")}
      </p>
    )
  }

  const back = (
    <Button
      variant="ghost"
      size="sm"
      onClick={onBack}
      className="-ml-2 self-start"
    >
      <ArrowLeft />
      {t("demo.stream.details.back")}
    </Button>
  )
  if (event === null) return <div className="flex flex-col p-4">{back}</div>

  const def = eventDef(event.type)
  const label = eventLabel(event, tk, num)
  const consumers = (event.consumers ?? []).map((key) => consumerLabel(key, tk))
  const none = t("demo.stream.details.none")

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="event-detail">
      {back}
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2.5 shrink-0 rounded-full",
            SEVERITY_DOT[def?.severity ?? "info"]
          )}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{label.text}</p>
          <p className="font-mono text-[0.6875rem] text-muted-foreground">
            {event.type} v{event.v}
          </p>
        </div>
      </div>

      <dl className="divide-y divide-hairline rounded-lg bg-card px-3">
        <Field label={t("demo.stream.details.at")}>
          {dateTime(event.at)}{" "}
          <span className="text-muted-foreground">({relative(event.at)})</span>
        </Field>
        <Field label={t("demo.stream.details.actor")}>
          {actorName(event.actor, locale, tk)}
          <span className="text-muted-foreground">
            {" · "}
            {roleLabel(event.actor?.role, tk)}
            {" · "}
            {branchLabel(event.branchId, locale)}
          </span>
        </Field>
        <Field label={t("demo.stream.details.consumers")}>
          {consumers.length ? (
            <span className="flex flex-wrap gap-1">
              {consumers.map((consumer, i) => (
                <span
                  key={`${consumer}-${i}`}
                  className="rounded-full bg-surface-raised px-1.5 py-px text-[0.625rem]"
                >
                  {consumer}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">{none}</span>
          )}
        </Field>
        <Field label={t("demo.stream.details.params")}>
          <Pairs values={event.params ?? {}} empty={none} />
        </Field>
        <Field label={t("demo.stream.details.refs")}>
          <Pairs values={event.refs ?? {}} empty={none} />
        </Field>
        <Field label={t("demo.stream.details.commit")}>
          <span className="font-mono text-[0.6875rem] break-all">
            {event.commitId}
          </span>
        </Field>
        <Field label={t("demo.stream.details.command")}>
          <span className="font-mono text-[0.6875rem]">{event.command}</span>
        </Field>
        <Field label={t("demo.stream.details.seq")}>
          <span className="font-mono text-[0.6875rem]">{event.seq}</span>
        </Field>
        <Field label={t("demo.stream.details.origin")}>
          <span className="font-mono text-[0.6875rem]">{event.origin}</span>
          {event.originAt ? (
            <span className="block text-muted-foreground">
              {t("demo.stream.details.originAt")}: {dateTime(event.originAt)}
            </span>
          ) : null}
          {event.replayedAt ? (
            <span className="block text-info">
              {t("demo.stream.details.replayedAt")}:{" "}
              {dateTime(event.replayedAt)}
            </span>
          ) : null}
        </Field>
      </dl>

      <section className="flex flex-col gap-2">
        <h4 className="micro">{t("demo.stream.details.audit")}</h4>
        {audit === undefined ? null : audit.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("demo.stream.details.noAudit")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {audit.map((row) => (
              <AuditLine key={row.seq} row={row} />
            ))}
          </ul>
        )}
      </section>

      {event.patientId ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onOnlyPatient(event.patientId!)}
        >
          <UserRound />
          {t("demo.stream.details.onlyPatient")}
        </Button>
      ) : null}
    </div>
  )
}

function AuditLine({ row }: { row: AuditRow }) {
  const { t, tk, num } = useLocale()
  return (
    <li className="rounded-lg bg-card p-2.5">
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-mono text-muted-foreground">#{row.seq}</span>
        <span className="font-medium">
          {tk(`demo.audit.actions.${row.action}`)}
        </span>
        <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground">
          {row.entity}/{row.entityId}
        </span>
      </p>
      <DiffList
        className="mt-1"
        lines={diffLines(row)}
        limit={8}
        moreLabel={(count) => t("demo.audit.moreFields", { count: num(count) })}
      />
    </li>
  )
}
