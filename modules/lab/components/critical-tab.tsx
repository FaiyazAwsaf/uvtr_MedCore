"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Check, PhoneCall, Siren } from "lucide-react"
import { labToast as toast } from "./lab-toast"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BranchCode } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { atDhaka, DAY, dhakaDate, dhakaTime, MINUTE } from "@/core/clock/dates"
import { now } from "@/core/clock/clock"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import type {
  CriticalCallRow,
  LabOrderItemRow,
  LabOrderRow,
  LabTestRow,
  PatientRow,
  ResultRow,
} from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import {
  acknowledgeCritical,
  escalateCritical,
  logCriticalCall,
} from "../commands"
import { autoEscalationEnabled } from "../jobs"
import { escalationDueAt, isCallOverdue, resultText } from "../logic"
import { useLabCommand } from "./lab-feedback"
import { FlagText, PatientCell } from "./lab-ui"
import {
  FOCUS_ROW,
  staffName,
  useDoctorStaff,
  useScrollToFocus,
} from "./use-lab-data"

export type CriticalView = {
  result: ResultRow
  item: LabOrderItemRow
  order?: LabOrderRow
  patient?: PatientRow
  calls: CriticalCallRow[]
}

/** Validated critical results at the branch since `since`, newest first. */
export async function loadCriticals(
  db: MedcoreDb,
  branch: BranchCode,
  since: number
): Promise<CriticalView[]> {
  const results = await db.results
    .where("status")
    .equals("validated")
    .filter((r) => r.critical && r.createdAt >= since)
    .toArray()
  if (!results.length) return []
  const items = await db.labOrderItems.bulkGet(
    results.map((r) => r.labOrderItemId)
  )
  const calls = await db.criticalCalls
    .where("resultId")
    .anyOf(results.map((r) => r.id))
    .toArray()
  const out: CriticalView[] = []
  for (let i = 0; i < results.length; i++) {
    const item = items[i]
    if (!item || item.branchId !== branch) continue
    out.push({
      result: results[i],
      item,
      order: await db.labOrders.get(item.labOrderId),
      patient: await db.patients.get(results[i].patientId),
      calls: calls
        .filter((c) => c.resultId === results[i].id)
        .sort((a, b) => b.calledAt - a.calledAt),
    })
  }
  return out.sort((a, b) => b.result.createdAt - a.result.createdAt)
}

export function useCriticals(branch: BranchCode) {
  const db = useDb()
  const tick = useNow(60_000)
  const since = Math.floor(((tick || now()) - 3 * DAY) / 60_000) * 60_000
  return useLiveQuery(
    () => loadCriticals(db, branch, since),
    [db, branch, since]
  )
}

/**
 * Critical results (HAZ-05): each validated critical value, whether the
 * doctor has been phoned, and a form to log the call with its read-back.
 * The call stays open until acknowledged. `rules.criticalEscalationMin`
 * minutes after the call (on the demo clock, live in every window) an open
 * call turns overdue and the pathologist escalates it to the duty doctor;
 * with the Tier 2 toggle on, the sweeper does that automatically.
 */
export function CriticalTab({
  branch,
  tests,
  focus,
}: {
  branch: BranchCode
  tests: Map<string, LabTestRow> | undefined
  focus?: string
}) {
  const { t, num } = useLocale()
  const rows = useCriticals(branch)
  const [logging, setLogging] = React.useState<CriticalView | null>(null)
  const minutes = rules.criticalEscalationMin
  return (
    <SectionCard
      size="sm"
      icon={Siren}
      title={t("lab.critical.title")}
      subtitle={t("lab.critical.subtitle")}
    >
      <p
        className="-mt-1 text-xs text-muted-foreground"
        data-testid="critical-auto"
        data-enabled={autoEscalationEnabled()}
      >
        {autoEscalationEnabled()
          ? t("lab.critical.autoOn", { minutes: num(minutes) })
          : t("lab.critical.autoOff", { minutes: num(minutes) })}
      </p>
      {rows && !rows.length ? (
        <EmptyState size="sm" icon={Siren} title={t("lab.critical.empty")} />
      ) : (
        <div className="@container/table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("lab.common.patient")}</TableHead>
                <TableHead>{t("lab.common.result")}</TableHead>
                <TableHead className="hidden @min-[58rem]/table:table-cell">
                  {t("lab.common.validated")}
                </TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((row) => (
                <CriticalRowView
                  key={row.result.id}
                  row={row}
                  tests={tests}
                  focused={focus === row.result.id}
                  onLog={() => setLogging(row)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog
        open={!!logging}
        onOpenChange={(next) => (!next ? setLogging(null) : undefined)}
      >
        <DialogContent className="sm:max-w-lg" data-testid="critical-dialog">
          {logging ? (
            <CallBody
              key={logging.result.id}
              row={logging}
              tests={tests}
              onClose={() => setLogging(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

function valueLine(
  row: CriticalView,
  tests: Map<string, LabTestRow> | undefined
) {
  const analyte = tests
    ?.get(row.result.testId)
    ?.analytes.find((a) => a.code === row.result.analyteCode)
  return {
    name: analyte?.name ?? row.result.analyteCode,
    value: resultText(row.result, analyte?.decimals ?? 2),
    unit: row.result.unit ?? "",
  }
}

function CriticalRowView({
  row,
  tests,
  focused,
  onLog,
}: {
  row: CriticalView
  tests: Map<string, LabTestRow> | undefined
  focused: boolean
  onLog: () => void
}) {
  const { t, tk, num, time, locale } = useLocale()
  const tick = useNow(5_000)
  const doctors = useDoctorStaff()
  const ref = useScrollToFocus<HTMLTableRowElement>(focused)
  const ack = useLabCommand(acknowledgeCritical)
  const escalate = useLabCommand(escalateCritical)
  const call = row.calls[0]
  const line = valueLine(row, tests)
  const at = tick || now()
  const limit = rules.criticalEscalationMin
  const minutes = call
    ? Math.max(0, Math.floor((at - call.calledAt) / MINUTE))
    : 0
  const overdue = !!call && isCallOverdue(call, at, limit)
  const escalatedTo = staffName(doctors, call?.escalatedTo, locale)

  const onAck = async () => {
    if (!call) return
    const done = await ack.run({
      callId: call.id,
      expectedVersion: call.version,
    })
    if (done) toast.success(t("lab.critical.ackedToast", { analyte: line.name }))
  }
  const onEscalate = async () => {
    if (!call) return
    const done = await escalate.run({
      callId: call.id,
      expectedVersion: call.version,
    })
    if (done) {
      toast.warning(
        t("lab.critical.escalatedToast", {
          doctor: staffName(doctors, done.escalatedTo, locale) ?? "",
        })
      )
    }
  }

  return (
    <TableRow
      ref={ref}
      data-testid="critical-row"
      data-result-id={row.result.id}
      data-item-id={row.item.id}
      data-call-id={call?.id}
      data-call-status={call?.status ?? "none"}
      data-overdue={overdue || undefined}
      data-focused={focused || undefined}
      className={cn(focused && FOCUS_ROW)}
    >
      <TableCell className="max-w-56">
        <PatientCell patient={row.patient} />
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <span className="text-[0.8125rem] font-medium">{line.name}</span>
          <span className="font-mono font-semibold text-destructive" lang="en">
            {line.value}
          </span>
          <span className="text-xs text-muted-foreground" lang="en">
            {line.unit}
          </span>
          <FlagText flag={row.result.flag} />
        </span>
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground @min-[58rem]/table:table-cell">
        {row.result.validatedAt ? (
          <DateText value={row.result.validatedAt} variant="dmyTime" />
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell className="text-xs whitespace-normal">
        {!call ? (
          <StatusText tone="destructive" dot>
            {t("lab.critical.notCalled")}
          </StatusText>
        ) : (
          <span className="flex flex-col gap-0.5">
            {call.status === "open" && overdue ? (
              <StatusText
                tone="destructive"
                dot
                className="font-semibold whitespace-normal"
                data-testid="critical-overdue"
              >
                {t("lab.critical.overdue")}
              </StatusText>
            ) : call.status === "open" ? (
              <StatusText tone="warning" dot className="whitespace-normal">
                {t("lab.critical.callOpen", { time: time(call.calledAt) })}
              </StatusText>
            ) : call.status === "acknowledged" ? (
              <StatusText
                tone="success"
                dot
                className="whitespace-normal"
                data-testid="critical-acked"
              >
                {t("lab.critical.acknowledged", {
                  time: call.ackAt ? time(call.ackAt) : "",
                })}
              </StatusText>
            ) : (
              <StatusText
                tone="info"
                dot
                className="whitespace-normal"
                data-testid="critical-escalated"
              >
                {t("lab.critical.escalatedTo", {
                  doctor: escalatedTo ?? "",
                  time: call.escalatedAt ? time(call.escalatedAt) : "",
                })}
                {call.auto ? ` · ${t("lab.critical.auto")}` : ""}
              </StatusText>
            )}
            <span className="pl-3 text-muted-foreground">
              {t("lab.critical.calledWho", {
                person: call.calledPerson,
                role: tk(`lab.critical.roles.${call.calledRole}`),
                time: time(call.calledAt),
              })}
            </span>
            <span
              className={cn(
                "nums pl-3",
                call.status === "open" && overdue
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {call.status === "open"
                ? `${t("lab.critical.sinceCall", { minutes: num(minutes) })} · `
                : ""}
              {call.readBack
                ? t("lab.critical.readBackYes")
                : t("lab.critical.readBackNo")}
              {call.readBackText ? `: "${call.readBackText}"` : ""}
            </span>
            {call.status === "open" && !overdue ? (
              <span className="nums pl-3 text-muted-foreground">
                {t("lab.critical.escalatesIn", {
                  minutes: num(
                    Math.max(
                      1,
                      Math.ceil(
                        (escalationDueAt(call, limit) - at) / MINUTE
                      )
                    )
                  ),
                })}
              </span>
            ) : null}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap justify-end gap-1.5 @min-[58rem]/table:flex-nowrap">
          {call && call.status === "open" && overdue ? (
            <Button
              size="sm"
              variant="destructive"
              data-testid="critical-escalate"
              disabled={escalate.pending}
              onClick={onEscalate}
            >
              <Siren />
              {t("lab.critical.escalate")}
            </Button>
          ) : null}
          {call && call.status !== "acknowledged" ? (
            <Button
              size="sm"
              variant="neutral"
              data-testid="critical-ack"
              disabled={ack.pending}
              title={t("lab.critical.ack")}
              onClick={onAck}
            >
              <Check />
              <span className="hidden @min-[58rem]/table:inline">
                {t("lab.critical.ack")}
              </span>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={call ? "neutral" : "default"}
            data-testid="critical-log"
            title={t("lab.critical.logCall")}
            onClick={onLog}
          >
            <PhoneCall />
            <span
              className={cn(
                call ? "hidden @min-[58rem]/table:inline" : "inline"
              )}
            >
              {t("lab.critical.logCall")}
            </span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

const ROLES = ["ordering-doctor", "duty-doctor", "ward"] as const

function CallBody({
  row,
  tests,
  onClose,
}: {
  row: CriticalView
  tests: Map<string, LabTestRow> | undefined
  onClose: () => void
}) {
  const { t, tk, locale } = useLocale()
  const doctors = useDoctorStaff()
  const log = useLabCommand(logCriticalCall)
  const orderingDoctor = staffName(doctors, row.order?.doctorId, locale)
  const [person, setPerson] = React.useState<string | null>(null)
  const [role, setRole] = React.useState<(typeof ROLES)[number]>(
    row.order?.doctorId ? "ordering-doctor" : "duty-doctor"
  )
  const [at, setAt] = React.useState(() => dhakaTime(now()))
  const [readBack, setReadBack] = React.useState(false)
  const [readBackText, setReadBackText] = React.useState("")
  const personText = person ?? orderingDoctor ?? ""
  const line = valueLine(row, tests)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (personText.trim().length < 2) return
    const calledAt = /^\d{2}:\d{2}$/.test(at)
      ? atDhaka(dhakaDate(now()), at)
      : undefined
    const done = await log.run({
      resultId: row.result.id,
      calledPerson: personText.trim(),
      calledRole: role,
      calledAt,
      readBack,
      readBackText: readBackText.trim() || undefined,
    })
    if (done) {
      toast.success(t("lab.critical.dialog.saved", { analyte: line.name }))
      onClose()
    }
  }

  return (
    <form onSubmit={save} className="contents">
      <DialogHeader>
        <DialogTitle>{t("lab.critical.dialog.title")}</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">{line.name}</span>{" "}
          <span className="font-mono font-semibold text-destructive" lang="en">
            {line.value} {line.unit}
          </span>
        </DialogDescription>
      </DialogHeader>
      <IdentityBanner patientId={row.result.patientId} compact />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="critical-person">
            {t("lab.critical.dialog.person")}
          </Label>
          <Input
            id="critical-person"
            data-testid="critical-person"
            value={personText}
            maxLength={80}
            onChange={(event) => setPerson(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="critical-time">{t("lab.critical.dialog.time")}</Label>
          <Input
            id="critical-time"
            data-testid="critical-time"
            type="time"
            value={at}
            onChange={(event) => setAt(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label id="critical-role-label">{t("lab.critical.dialog.role")}</Label>
        <div
          role="radiogroup"
          aria-labelledby="critical-role-label"
          className="flex flex-wrap gap-2"
          data-testid="critical-role"
        >
          {ROLES.map((code) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={role === code}
              data-role={code}
              onClick={() => setRole(code)}
              className={cn(
                "h-8 rounded-full border px-3 text-[0.8125rem] font-medium",
                role === code
                  ? "border-primary bg-primary-soft text-link"
                  : "border-border hover:bg-surface-raised"
              )}
            >
              {tk(`lab.critical.roles.${code}`)}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2.5 text-[0.8125rem] font-medium">
        <Checkbox
          checked={readBack}
          onCheckedChange={(checked) => setReadBack(checked === true)}
          data-testid="critical-readback"
        />
        {t("lab.critical.dialog.readBack")}
      </label>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="critical-readback-text">
          {t("lab.critical.dialog.readBackText")}
        </Label>
        <Input
          id="critical-readback-text"
          data-testid="critical-readback-text"
          value={readBackText}
          maxLength={300}
          placeholder={t("lab.critical.dialog.readBackPlaceholder")}
          onChange={(event) => setReadBackText(event.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          data-testid="critical-save"
          disabled={personText.trim().length < 2 || log.pending}
        >
          <PhoneCall />
          {t("lab.critical.dialog.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}
