"use client"

import * as React from "react"
import type { Collection } from "dexie"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Search,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { verifyChain, type ChainStatus } from "@/core/audit/verify"
import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import type { AuditAction, AuditRow, PatientRow } from "@/core/db/schema"
import { ROLES } from "@/core/rbac/types"
import { PERSONAS } from "@/core/seed/content/personas"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { actorName, personaName, roleLabel, staffName } from "../labels"
import { DiffList, diffLines, MONO_DATA } from "./diff"

const PAGE_SIZE = 50
const ACTIONS: AuditAction[] = [
  "insert",
  "update",
  "delete",
  "blocked",
  "system",
]
const ACTION_TEXT: Record<AuditAction, string> = {
  insert: "text-success",
  update: "text-info",
  delete: "text-destructive",
  blocked: "text-warning",
  system: "text-muted-foreground",
}

type Filters = {
  action: "all" | AuditAction
  entity: string
  actor: string
  patient: string
}
const NO_FILTERS: Filters = {
  action: "all",
  entity: "all",
  actor: "all",
  patient: "",
}

/** Staff personas in role order, plus the system actor, for the actor filter. */
const ACTOR_OPTIONS = ROLES.flatMap((role) =>
  PERSONAS.filter((p) => p.role === role)
    .sort((a, b) => a.order - b.order)
    .map((p) => ({
      role,
      persona: p,
      staffId: p.staff?.id ?? p.patientId ?? p.id,
    }))
)

/**
 * Newest-first rows for the filters. The most selective indexed filter picks
 * the index; the rest are applied while iterating. Offsets keep a page cheap
 * even with thousands of rows.
 */
function auditCollection(
  db: MedcoreDb,
  filters: Filters
): Collection<AuditRow, number> {
  let collection: Collection<AuditRow, number>
  if (filters.entity !== "all") {
    collection = db.audit.where("entity").equals(filters.entity).reverse()
  } else if (filters.action !== "all") {
    collection = db.audit.where("action").equals(filters.action).reverse()
  } else {
    collection = db.audit.orderBy("seq").reverse()
  }
  const checks: ((row: AuditRow) => boolean)[] = []
  if (filters.entity !== "all" && filters.action !== "all") {
    const action = filters.action
    checks.push((row) => row.action === action)
  }
  if (filters.actor !== "all") {
    const actor = filters.actor
    checks.push((row) => (row.actor?.staffId ?? "system") === actor)
  }
  const patient = filters.patient.trim().toLowerCase()
  if (patient)
    checks.push(
      (row) => !!row.patientId && row.patientId.toLowerCase().includes(patient)
    )
  return checks.length
    ? collection.filter((row) => checks.every((check) => check(row)))
    : collection
}

/**
 * The audit viewer (plan §3.5, "/audit"): every audit row newest first with
 * its old to new diff, filters, and hash-chain verification.
 */
export function AuditViewer() {
  const { t, num } = useLocale()
  const db = useDb()
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS)
  const [page, setPage] = React.useState(0)
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const [chain, setChain] = React.useState<ChainStatus | null>(null)
  const [verifying, setVerifying] = React.useState(true)

  React.useEffect(() => {
    let alive = true
    verifyChain(db)
      .then((status) => {
        if (alive) setChain(status)
      })
      .catch((error) => console.error("verify chain", error))
      .finally(() => {
        if (alive) setVerifying(false)
      })
    return () => {
      alive = false
    }
  }, [db])

  const verify = async () => {
    setVerifying(true)
    try {
      setChain(await verifyChain(db))
    } catch (error) {
      console.error("verify chain", error)
    } finally {
      setVerifying(false)
    }
  }

  const data = useLiveQuery(async () => {
    const total = await auditCollection(db, filters).count()
    const rows = await auditCollection(db, filters)
      .offset(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray()
    return { total, rows }
  }, [db, filters, page])

  const entities = useLiveQuery(
    async () => (await db.audit.orderBy("entity").uniqueKeys()).map(String),
    [db]
  )
  const maxSeq = useLiveQuery(
    async () => (await db.audit.orderBy("seq").last())?.seq ?? 0,
    [db]
  )

  const patientIds = React.useMemo(
    () =>
      [
        ...new Set((data?.rows ?? []).map((r) => r.patientId).filter(Boolean)),
      ] as string[],
    [data]
  )
  const patients = useLiveQuery(async () => {
    const rows = await db.patients.bulkGet(patientIds)
    const map = new Map<string, PatientRow>()
    for (const row of rows) if (row) map.set(row.id, row)
    return map
  }, [db, patientIds])

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(0)
    setExpanded(null)
  }
  const filtered =
    filters.action !== "all" ||
    filters.entity !== "all" ||
    filters.actor !== "all" ||
    filters.patient.trim() !== ""

  const broken = chain && !chain.ok ? (chain.brokenAt ?? null) : null
  const jumpTo = (seq: number) => {
    setFilters(NO_FILTERS)
    setPage(Math.floor(Math.max(0, (maxSeq ?? seq) - seq) / PAGE_SIZE))
    setExpanded(seq)
  }

  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const from = total ? page * PAGE_SIZE + 1 : 0
  const to = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6" data-testid="audit-viewer">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.375rem] leading-tight font-semibold">
            {t("demo.audit.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("demo.audit.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="status"
            data-testid="audit-chain"
            data-state={
              verifying
                ? "verifying"
                : chain
                  ? chain.ok
                    ? "intact"
                    : "broken"
                  : "unknown"
            }
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
              verifying || !chain
                ? "bg-surface-raised text-muted-foreground"
                : chain.ok
                  ? "bg-success/15 text-success"
                  : "bg-destructive/15 text-destructive"
            )}
          >
            {verifying ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : chain?.ok ? (
              <ShieldCheck className="size-3.5" />
            ) : (
              <ShieldX className="size-3.5" />
            )}
            {verifying
              ? t("demo.audit.verifying")
              : chain?.ok
                ? t("demo.audit.intact", { count: num(chain.count) })
                : broken !== null
                  ? t("demo.audit.broken", { seq: broken })
                  : null}
          </div>
          {broken !== null && !verifying ? (
            <Button variant="link" size="sm" onClick={() => jumpTo(broken)}>
              {t("demo.audit.jump", { seq: broken })}
            </Button>
          ) : null}
          <Button
            onClick={verify}
            disabled={verifying}
            data-testid="audit-verify"
          >
            <ShieldCheck />
            {t("demo.audit.verify")}
          </Button>
        </div>
      </header>

      <div className="surface-card @container flex min-w-0 flex-col gap-3 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.action}
            onValueChange={(value) =>
              value && update({ action: value as Filters["action"] })
            }
          >
            <SelectTrigger
              className="min-w-32"
              aria-label={t("demo.audit.filters.action")}
            >
              <SelectValue>
                {(value: string) =>
                  value === "all"
                    ? t("demo.audit.filters.allActions")
                    : t(`demo.audit.actions.${value as AuditAction}`)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("demo.audit.filters.allActions")}
              </SelectItem>
              {ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  {t(`demo.audit.actions.${action}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.entity}
            onValueChange={(value) => value && update({ entity: value })}
          >
            <SelectTrigger
              className="min-w-32"
              aria-label={t("demo.audit.filters.entity")}
            >
              <SelectValue>
                {(value: string) =>
                  value === "all" ? t("demo.audit.filters.allEntities") : value
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("demo.audit.filters.allEntities")}
              </SelectItem>
              {(entities ?? []).map((entity) => (
                <SelectItem key={entity} value={entity}>
                  <span className="font-mono">{entity}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ActorFilter
            value={filters.actor}
            onChange={(actor) => update({ actor })}
          />

          <div className="relative min-w-40 flex-1 sm:max-w-60">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.patient}
              onChange={(e) => update({ patient: e.target.value })}
              placeholder={t("demo.audit.filters.patient")}
              aria-label={t("demo.audit.filters.patient")}
              className="pl-8 font-mono"
            />
          </div>

          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update(NO_FILTERS)}
            >
              <X />
              {t("demo.audit.filters.clear")}
            </Button>
          ) : null}
        </div>

        <Table className="text-xs">
          <TableHeader className="bg-surface-raised [&_tr]:border-0">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 rounded-l-md text-muted-foreground">
                {t("demo.audit.columns.seq")}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t("demo.audit.columns.time")}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t("demo.audit.columns.actor")}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t("demo.audit.columns.action")}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t("demo.audit.columns.entity")}
              </TableHead>
              <TableHead className="hidden text-muted-foreground @[64rem]:table-cell">
                {t("demo.audit.columns.patient")}
              </TableHead>
              <TableHead className="text-muted-foreground">
                {t("demo.audit.columns.changes")}
              </TableHead>
              <TableHead className="hidden text-muted-foreground @[72rem]:table-cell">
                {t("demo.audit.columns.reason")}
              </TableHead>
              <TableHead className="hidden text-muted-foreground @[56rem]:table-cell">
                {t("demo.audit.columns.origin")}
              </TableHead>
              <TableHead className="hidden rounded-r-md text-muted-foreground @[60rem]:table-cell">
                {t("demo.audit.columns.hash")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data === undefined ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={10}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("demo.common.loading")}
                </TableCell>
              </TableRow>
            ) : data.rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={10}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("demo.audit.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((row) => (
                <AuditTableRow
                  key={row.seq}
                  row={row}
                  patient={
                    row.patientId ? patients?.get(row.patientId) : undefined
                  }
                  broken={row.seq === broken}
                  expanded={expanded === row.seq}
                  onToggle={() =>
                    setExpanded((current) =>
                      current === row.seq ? null : row.seq
                    )
                  }
                />
              ))
            )}
          </TableBody>
        </Table>

        <footer className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span data-testid="audit-range">
            {t("demo.audit.range", {
              from: num(from),
              to: num(to),
              total: num(total),
            })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page === 0}
            onClick={() => {
              setPage(page - 1)
              setExpanded(null)
            }}
            aria-label={t("demo.audit.prev")}
            title={t("demo.audit.prev")}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= pages - 1}
            onClick={() => {
              setPage(page + 1)
              setExpanded(null)
            }}
            aria-label={t("demo.audit.next")}
            title={t("demo.audit.next")}
          >
            <ChevronRight />
          </Button>
        </footer>
      </div>
    </div>
  )
}

function ActorFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { t, tk, locale } = useLocale()
  const label = (id: string) =>
    id === "all" ? t("demo.audit.filters.allActors") : staffName(id, locale, tk)
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger
        className="min-w-36"
        aria-label={t("demo.audit.filters.actor")}
      >
        <SelectValue>{(id: string) => label(id)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("demo.audit.filters.allActors")}</SelectItem>
        <SelectItem value="system">{t("demo.common.system")}</SelectItem>
        {ROLES.map((role) => {
          const options = ACTOR_OPTIONS.filter((o) => o.role === role)
          if (!options.length) return null
          return (
            <SelectGroup key={role}>
              <SelectLabel>{roleLabel(role, tk)}</SelectLabel>
              {options.map((o) => (
                <SelectItem key={o.staffId} value={o.staffId}>
                  {personaName(o.persona, locale)}
                </SelectItem>
              ))}
            </SelectGroup>
          )
        })}
      </SelectContent>
    </Select>
  )
}

function AuditTableRow({
  row,
  patient,
  broken,
  expanded,
  onToggle,
}: {
  row: AuditRow
  patient: PatientRow | undefined
  broken: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const { t, tk, num, locale, dateTime, relative, uhid } = useLocale()
  const lines = diffLines(row)
  const edge = row.origin !== "central"
  const approver = row.approvedBy ? staffName(row.approvedBy, locale, tk) : null

  return (
    <>
      <TableRow
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid="audit-row"
        data-seq={row.seq}
        className={cn(
          "cursor-pointer border-hairline align-top hover:bg-primary-soft",
          expanded && "bg-primary-soft",
          broken && "bg-destructive/10 hover:bg-destructive/15"
        )}
      >
        <TableCell className="font-mono text-muted-foreground">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            className="inline-flex items-center gap-0.5 outline-none focus-visible:text-foreground"
          >
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                expanded && "rotate-90"
              )}
            />
            {row.seq}
          </button>
        </TableCell>
        <TableCell title={relative(row.at)}>{dateTime(row.at)}</TableCell>
        <TableCell className="max-w-44">
          <span className="block truncate font-medium">
            {actorName(row.actor, locale, tk)}
          </span>
          {row.actor && row.actor.role !== "system" ? (
            <span className="block truncate text-[0.6875rem] text-muted-foreground">
              {roleLabel(row.actor.role, tk)}
              {row.actor.branchId ? ` · ${row.actor.branchId}` : ""}
            </span>
          ) : null}
        </TableCell>
        <TableCell className={cn("font-medium", ACTION_TEXT[row.action])}>
          {tk(`demo.audit.actions.${row.action}`)}
          {row.code ? (
            <span className="block font-mono text-[0.625rem]">{row.code}</span>
          ) : null}
        </TableCell>
        <TableCell className="max-w-40">
          <span className="block truncate font-mono">{row.entity}</span>
          <span className="block truncate font-mono text-[0.625rem] text-muted-foreground">
            {row.entityId}
          </span>
        </TableCell>
        <TableCell className="hidden max-w-40 @[64rem]:table-cell">
          {row.patientId ? (
            <>
              <span className="block truncate">
                {patient
                  ? locale === "bn"
                    ? patient.nameBn
                    : patient.nameEn
                  : ""}
              </span>
              <span className="block truncate font-mono text-[0.625rem] text-muted-foreground">
                {patient ? uhid(patient.uhid) : row.patientId}
              </span>
            </>
          ) : null}
        </TableCell>
        <TableCell className="max-w-[22rem] min-w-40 whitespace-normal">
          <DiffList
            lines={lines}
            limit={3}
            max={28}
            moreLabel={(count) =>
              t("demo.audit.moreFields", { count: num(count) })
            }
          />
        </TableCell>
        <TableCell className="hidden max-w-44 whitespace-normal @[72rem]:table-cell">
          {row.reason ? <span className="block">{row.reason}</span> : null}
          {approver ? (
            <span className="block text-[0.6875rem] text-muted-foreground">
              {t("demo.audit.approvedBy", { name: approver })}
            </span>
          ) : null}
        </TableCell>
        <TableCell className="hidden @[56rem]:table-cell">
          {edge ? (
            <span className="rounded-full border border-warning/40 px-1.5 py-px font-mono text-[0.625rem] text-warning">
              {row.origin}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t("demo.audit.central")}
            </span>
          )}
        </TableCell>
        <TableCell className="hidden font-mono text-[0.6875rem] text-muted-foreground @[60rem]:table-cell">
          {row.hash.slice(0, 8)}
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="border-hairline bg-card hover:bg-card">
          <TableCell colSpan={10} className="whitespace-normal">
            <AuditDetails row={row} patient={patient} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

function Detail({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-all", className)}>{children}</dd>
    </>
  )
}

/**
 * The full row: before and after, plus the fields whose columns are hidden
 * on narrow screens (patient, reason, approver, origin) and the hash links.
 */
function AuditDetails({
  row,
  patient,
}: {
  row: AuditRow
  patient: PatientRow | undefined
}) {
  const { t, tk, locale, dateTime, uhid } = useLocale()
  const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2)
  return (
    <div
      className="grid gap-3 py-1 @[48rem]:grid-cols-2"
      data-testid="audit-details"
    >
      <div className="min-w-0">
        <p className="micro mb-1">{t("demo.audit.details.before")}</p>
        <pre
          className={cn(
            "max-h-56 overflow-auto rounded-md bg-surface-raised p-2 text-[0.6875rem] leading-relaxed",
            MONO_DATA
          )}
        >
          {pretty(row.before)}
        </pre>
      </div>
      <div className="min-w-0">
        <p className="micro mb-1">{t("demo.audit.details.after")}</p>
        <pre
          className={cn(
            "max-h-56 overflow-auto rounded-md bg-surface-raised p-2 text-[0.6875rem] leading-relaxed",
            MONO_DATA
          )}
        >
          {pretty(row.after)}
        </pre>
      </div>
      <dl className="grid min-w-0 grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-[0.6875rem] @[48rem]:col-span-2">
        <Detail label={t("demo.audit.columns.time")}>{dateTime(row.at)}</Detail>
        {row.patientId ? (
          <Detail label={t("demo.audit.columns.patient")}>
            {patient ? (
              <>
                {locale === "bn" ? patient.nameBn : patient.nameEn}{" "}
                <span className="font-mono">{uhid(patient.uhid)}</span>{" "}
              </>
            ) : null}
            <span className="font-mono text-muted-foreground">
              {row.patientId}
            </span>
          </Detail>
        ) : null}
        {row.reason ? (
          <Detail label={t("demo.audit.columns.reason")}>{row.reason}</Detail>
        ) : null}
        {row.approvedBy ? (
          <Detail label={t("demo.audit.details.approver")}>
            {staffName(row.approvedBy, locale, tk)}
          </Detail>
        ) : null}
        <Detail label={t("demo.audit.columns.origin")} className="font-mono">
          {row.origin}
        </Detail>
        <Detail label={t("demo.audit.details.command")} className="font-mono">
          {row.command}
        </Detail>
        <Detail label={t("demo.audit.details.commit")} className="font-mono">
          {row.commitId}
        </Detail>
        {row.code ? (
          <Detail label={t("demo.audit.details.code")} className="font-mono">
            {row.code}
          </Detail>
        ) : null}
        <Detail
          label={t("demo.audit.details.prevHash")}
          className="font-mono text-muted-foreground"
        >
          {row.prevHash}
        </Detail>
        <Detail label={t("demo.audit.details.hash")} className="font-mono">
          {row.hash}
        </Detail>
      </dl>
    </div>
  )
}
