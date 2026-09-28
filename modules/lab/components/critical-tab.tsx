"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { PhoneCall, Siren } from "lucide-react"
import { toast } from "sonner"

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

import { logCriticalCall } from "../commands"
import { resultText } from "../logic"
import { useLabCommand } from "./lab-feedback"
import { FlagText, PatientCell } from "./lab-ui"
import { staffName, useDoctorStaff } from "./use-lab-data"

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
 * The call stays open until acknowledged; minutes since the call are shown
 * against the 30-minute escalation window.
 */
export function CriticalTab({
  branch,
  tests,
}: {
  branch: BranchCode
  tests: Map<string, LabTestRow> | undefined
}) {
  const { t } = useLocale()
  const rows = useCriticals(branch)
  const [logging, setLogging] = React.useState<CriticalView | null>(null)
  return (
    <SectionCard
      size="sm"
      icon={Siren}
      title={t("lab.critical.title")}
      subtitle={t("lab.critical.subtitle")}
    >
      {rows && !rows.length ? (
        <EmptyState size="sm" icon={Siren} title={t("lab.critical.empty")} />
      ) : (
        <div className="@container/table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("lab.common.patient")}</TableHead>
                <TableHead>{t("lab.common.result")}</TableHead>
                <TableHead className="hidden @min-[40rem]/table:table-cell">
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
  onLog,
}: {
  row: CriticalView
  tests: Map<string, LabTestRow> | undefined
  onLog: () => void
}) {
  const { t, num, time } = useLocale()
  const tick = useNow(30_000)
  const call = row.calls[0]
  const line = valueLine(row, tests)
  const minutes = call
    ? Math.max(0, Math.floor(((tick || now()) - call.calledAt) / MINUTE))
    : 0
  return (
    <TableRow
      data-testid="critical-row"
      data-result-id={row.result.id}
      data-call-status={call?.status ?? "none"}
    >
      <TableCell className="max-w-[14rem]">
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
      <TableCell className="hidden text-xs text-muted-foreground @min-[40rem]/table:table-cell">
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
        ) : call.status === "open" ? (
          <span className="flex flex-col">
            <StatusText tone={minutes >= 30 ? "destructive" : "warning"} dot>
              {t("lab.critical.callOpen", { time: time(call.calledAt) })}
            </StatusText>
            <span
              className={cn(
                "nums pl-3",
                minutes >= 30 ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {t("lab.critical.sinceCall", { minutes: num(minutes) })} ·{" "}
              {call.readBack
                ? t("lab.critical.readBackYes")
                : t("lab.critical.readBackNo")}
            </span>
          </span>
        ) : call.status === "acknowledged" ? (
          <StatusText tone="success" dot>
            {t("lab.critical.acknowledged", {
              time: call.ackAt ? time(call.ackAt) : "",
            })}
          </StatusText>
        ) : (
          <StatusText tone="info" dot>
            {t("lab.critical.escalated", {
              time: call.escalatedAt ? time(call.escalatedAt) : "",
            })}
          </StatusText>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant={call ? "neutral" : "default"}
          data-testid="critical-log"
          onClick={onLog}
        >
          <PhoneCall />
          <span className="hidden @min-[36rem]/table:inline">
            {t("lab.critical.logCall")}
          </span>
        </Button>
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
