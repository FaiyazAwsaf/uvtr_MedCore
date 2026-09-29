"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  Link2,
  LoaderCircle,
  NotebookPen,
  SearchX,
  Smartphone,
} from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { SectionCard } from "@/components/shared/section-card"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { StatusText, type Tone } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/core/db/DbProvider"
import type { MfsSettlementRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { importSettlement, matchSettlementLine, noteSettlementLine } from "../commands"
import {
  settlementDetail,
  settlementFiles,
  type SettlementLineView,
  type SettlementSummary,
} from "../queries"
import {
  DocNo,
  LiveChip,
  PageBody,
  PageHeader,
  TenderTag,
  useActionKey,
  useFinanceCommand,
} from "./shared"

const STATUS_TONE: Record<MfsSettlementRow["status"], Tone> = {
  "pending-import": "warning",
  imported: "info",
  reconciled: "success",
}

/**
 * `/finance/mfs` (plan §9): the bKash and Nagad settlement files by day.
 * Importing a file (simulated connector) matches its lines to the counter's
 * payments by transaction id and amount; what is left is matched by hand to
 * a payment of that amount that day (the provider's own, or one recorded as
 * cash at the counter) or given a note for follow-up.
 */
export function MfsScreen() {
  const db = useDb()
  const { t } = useLocale()
  const params = useSearchParams()
  const files = useLiveQuery(() => settlementFiles(db), [db])
  const [picked, setPicked] = React.useState<string | null>(params.get("file"))
  const selectedId =
    (picked && files?.some((f) => f.file.id === picked) ? picked : null) ??
    files?.find((f) => f.file.status === "imported" && f.unmatched > 0)?.file.id ??
    files?.find((f) => f.file.status === "pending-import")?.file.id ??
    files?.[0]?.file.id ??
    null

  return (
    <PageBody className="@container/page" data-testid="mfs-screen">
      <PageHeader title={t("finance.mfs.title")} subtitle={t("finance.mfs.subtitle")} actions={<LiveChip />} />
      <div className="grid items-start gap-4 @min-[64rem]/page:grid-cols-[18rem_minmax(0,1fr)] @min-[100rem]/page:grid-cols-[22rem_minmax(0,1fr)]">
        <SectionCard title={t("finance.mfs.files")} icon={FileSpreadsheet} size="sm">
          {!files ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <ul className="grid gap-2 @min-[40rem]/page:grid-cols-2 @min-[64rem]/page:grid-cols-1">
              {files.map((summary) => (
                <li key={summary.file.id}>
                  <FileCard
                    summary={summary}
                    selected={summary.file.id === selectedId}
                    onSelect={() => setPicked(summary.file.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        {selectedId ? (
          <SettlementPanel settlementId={selectedId} />
        ) : (
          <section className="surface-card">
            <EmptyState icon={FileSpreadsheet} title={t("finance.mfs.pick")} />
          </section>
        )}
      </div>
    </PageBody>
  )
}

function FileCard({
  summary,
  selected,
  onSelect,
}: {
  summary: SettlementSummary
  selected: boolean
  onSelect: () => void
}) {
  const { t, tk, num } = useLocale()
  const { file } = summary
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="mfs-file"
      data-settlement-id={file.id}
      data-status={file.status}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-raised"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <Smartphone className="size-4 text-link" />
          {tk(`finance.provider.${file.provider}`)}
        </span>
        <StatusText tone={STATUS_TONE[file.status]} dot>
          {tk(`finance.mfs.status.${file.status}`)}
        </StatusText>
      </span>
      <span className="flex items-center justify-between gap-2 text-[0.8125rem] text-muted-foreground">
        <DateText value={file.date} />
        <MoneyText poisha={summary.totalP} className="text-foreground" />
      </span>
      <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>{t("finance.mfs.fileLines", { count: num(file.lines.length) })}</span>
        {file.status !== "pending-import" ? (
          <>
            <span>{t("finance.mfs.fileMatched", { count: num(summary.matched) })}</span>
            {summary.unmatched ? (
              <span className="font-medium text-destructive">
                {t("finance.mfs.fileUnmatched", { count: num(summary.unmatched) })}
              </span>
            ) : null}
          </>
        ) : null}
      </span>
    </button>
  )
}

function SettlementPanel({ settlementId }: { settlementId: string }) {
  const db = useDb()
  const { t, tk, dmy, time } = useLocale()
  const detail = useLiveQuery(() => settlementDetail(db, settlementId), [db, settlementId])
  const [actionKey, nextKey] = useActionKey()
  const importFile = useFinanceCommand(importSettlement)
  const [matching, setMatching] = React.useState<string | null>(null)
  const [noting, setNoting] = React.useState<string | null>(null)

  if (!detail) {
    return <Skeleton className="h-64 w-full rounded-lg" />
  }
  const { file } = detail
  const provider = tk(`finance.provider.${file.provider}`)
  const matchingLine = detail.lines.find((l) => l.line.ref === matching)
  const notingLine = detail.lines.find((l) => l.line.ref === noting)

  return (
    <SectionCard
      title={t("finance.mfs.linesTitle", { provider, date: dmy(file.date) })}
      subtitle={
        file.importedAt
          ? t("finance.mfs.importedAt", { when: `${dmy(file.importedAt)}, ${time(file.importedAt)}` })
          : undefined
      }
      icon={Smartphone}
      size="sm"
      action={
        <StatusText tone={STATUS_TONE[file.status]} dot data-testid="mfs-status" data-status={file.status}>
          {tk(`finance.mfs.status.${file.status}`)}
        </StatusText>
      }
    >
      <div className="flex flex-col gap-4" data-testid="mfs-detail" data-settlement-id={file.id}>
        {file.status === "pending-import" ? (
          <div className="flex flex-col gap-3 rounded-md bg-surface-raised p-4">
            <p className="text-[0.8125rem] text-muted-foreground">
              {t("finance.mfs.importHint", { provider, date: dmy(file.date) })}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                data-testid="mfs-import"
                disabled={importFile.pending}
                onClick={async () => {
                  const done = await importFile.run({
                    settlementId: file.id,
                    expectedVersion: file.version,
                    idempotencyKey: actionKey,
                  })
                  if (done) nextKey()
                }}
              >
                {importFile.pending ? <LoaderCircle className="animate-spin" /> : <FileDown />}
                {t("finance.mfs.import")}
              </Button>
              <SimulatedBadge />
            </div>
            <p className="text-xs text-muted-foreground">{t("finance.mfs.pendingNotice")}</p>
          </div>
        ) : file.status === "reconciled" ? (
          <p className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2 text-[0.8125rem] font-medium text-link">
            <CheckCircle2 className="size-4" />
            {t("finance.mfs.reconciled")}
          </p>
        ) : null}

        <div className="@container/lines">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead className="hidden @min-[34rem]/lines:table-cell">{t("finance.mfs.col.time")}</TableHead>
                <TableHead>{t("finance.mfs.col.ref")}</TableHead>
                <TableHead className="text-right">{t("finance.mfs.col.amount")}</TableHead>
                <TableHead>{t("finance.mfs.col.payment")}</TableHead>
                <TableHead className="hidden @min-[44rem]/lines:table-cell">{t("finance.mfs.col.matchedBy")}</TableHead>
                <TableHead className="hidden @min-[56rem]/lines:table-cell">{t("finance.mfs.col.note")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((view) => (
                <LineRow
                  key={view.line.ref}
                  view={view}
                  imported={file.status !== "pending-import"}
                  onMatch={() => setMatching(view.line.ref)}
                  onNote={() => setNoting(view.line.ref)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {matchingLine ? (
        <MatchDialog file={file} view={matchingLine} onClose={() => setMatching(null)} />
      ) : null}
      {notingLine ? <NoteDialog file={file} view={notingLine} onClose={() => setNoting(null)} /> : null}
    </SectionCard>
  )
}

function LineRow({
  view,
  imported,
  onMatch,
  onNote,
}: {
  view: SettlementLineView
  imported: boolean
  onMatch: () => void
  onNote: () => void
}) {
  const { t, locale } = useLocale()
  const { line, payment, matchedBy } = view
  const matched = !!line.matchedPaymentId
  return (
    <TableRow data-testid="mfs-line" data-ref={line.ref} data-matched={matched ? "true" : "false"}>
      <TableCell className="hidden @min-[34rem]/lines:table-cell">
        <DateText value={line.at} variant="time" />
      </TableCell>
      <TableCell>
        <DocNo>{line.ref}</DocNo>
      </TableCell>
      <TableCell className="text-right">
        <MoneyText poisha={line.amountP} />
      </TableCell>
      <TableCell>
        {payment ? (
          <span className="flex min-w-0 items-center gap-2">
            <TenderTag tender={payment.payment.tender} className="hidden @min-[40rem]/lines:inline-flex" />
            <DocNo>{payment.invoiceNo ?? ""}</DocNo>
            <span className="hidden max-w-36 truncate text-muted-foreground @min-[64rem]/lines:inline">
              {payment.patient ? nameIn(payment.patient, locale) : ""}
            </span>
          </span>
        ) : !imported ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusText tone="destructive">{t("finance.mfs.unmatched")}</StatusText>
            <button
              type="button"
              data-testid="mfs-match"
              onClick={onMatch}
              className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
            >
              <Link2 className="size-3.5" />
              {t("finance.mfs.match")}
            </button>
            <button
              type="button"
              data-testid="mfs-note"
              onClick={onNote}
              className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
            >
              <NotebookPen className="size-3.5" />
              {line.note ? t("finance.mfs.editNote") : t("finance.mfs.addNote")}
            </button>
          </span>
        )}
      </TableCell>
      <TableCell className="hidden @min-[44rem]/lines:table-cell">
        {matchedBy === "auto" ? (
          <StatusText tone="success">{t("finance.mfs.matchedAuto")}</StatusText>
        ) : matchedBy ? (
          <StatusText tone="primary">{matchedBy[locale]}</StatusText>
        ) : null}
      </TableCell>
      <TableCell className="hidden max-w-56 truncate text-muted-foreground @min-[56rem]/lines:table-cell" title={line.note}>
        {line.note ?? ""}
      </TableCell>
    </TableRow>
  )
}

function MatchDialog({
  file,
  view,
  onClose,
}: {
  file: MfsSettlementRow
  view: SettlementLineView
  onClose: () => void
}) {
  const { t, tk, money, dmy, locale } = useLocale()
  const match = useFinanceCommand(matchSettlementLine)
  const [actionKey] = useActionKey()
  const provider = tk(`finance.provider.${file.provider}`)
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg" data-testid="mfs-match-dialog">
        <DialogHeader>
          <DialogTitle>{t("finance.mfs.candidates.title", { ref: view.line.ref })}</DialogTitle>
          <DialogDescription>
            {t("finance.mfs.candidates.description", {
              date: dmy(file.date),
              amount: money(view.line.amountP),
            })}
          </DialogDescription>
        </DialogHeader>
        {view.candidates.length === 0 ? (
          <EmptyState size="sm" icon={SearchX} title={t("finance.mfs.candidates.empty")} />
        ) : (
          <ul className="flex max-h-[50svh] flex-col gap-2 overflow-y-auto">
            {view.candidates.map((candidate) => (
              <li key={candidate.payment.id}>
                <button
                  type="button"
                  data-testid="mfs-candidate"
                  data-payment-id={candidate.payment.id}
                  disabled={match.pending}
                  onClick={async () => {
                    const done = await match.run({
                      settlementId: file.id,
                      expectedVersion: file.version,
                      ref: view.line.ref,
                      paymentId: candidate.payment.id,
                      idempotencyKey: actionKey,
                    })
                    if (done) onClose()
                  }}
                  className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-primary-soft disabled:opacity-60"
                >
                  <TenderTag tender={candidate.payment.tender} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] font-medium">
                      {candidate.kind === "cash"
                        ? t("finance.mfs.candidates.cash")
                        : t("finance.mfs.candidates.mfs", { provider, ref: candidate.payment.ref ?? "" })}
                    </span>
                    <span className="flex gap-2 text-xs text-muted-foreground">
                      <DocNo>{candidate.invoiceNo ?? ""}</DocNo>
                      <DateText value={candidate.payment.confirmedAt ?? candidate.payment.requestedAt} variant="time" />
                      <span className="truncate">{candidate.patient ? nameIn(candidate.patient, locale) : ""}</span>
                    </span>
                  </span>
                  <span className="text-[0.8125rem] font-medium text-link">{t("finance.mfs.candidates.pick")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NoteDialog({
  file,
  view,
  onClose,
}: {
  file: MfsSettlementRow
  view: SettlementLineView
  onClose: () => void
}) {
  const { t } = useLocale()
  const note = useFinanceCommand(noteSettlementLine)
  const [actionKey] = useActionKey()
  const [text, setText] = React.useState(view.line.note ?? "")
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md" data-testid="mfs-note-dialog">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!text.trim()) return
            const done = await note.run({
              settlementId: file.id,
              expectedVersion: file.version,
              ref: view.line.ref,
              note: text.trim(),
              idempotencyKey: actionKey,
            })
            if (done) onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("finance.mfs.noteDialog.title", { ref: view.line.ref })}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="mfs-note-text">{t("finance.mfs.noteDialog.label")}</Label>
            <Textarea
              id="mfs-note-text"
              data-testid="mfs-note-input"
              value={text}
              maxLength={200}
              placeholder={t("finance.mfs.noteDialog.placeholder")}
              onChange={(event) => setText(event.target.value)}
              className="min-h-20"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="neutral" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" data-testid="mfs-note-save" disabled={!text.trim() || note.pending}>
              {note.pending ? <LoaderCircle className="animate-spin" /> : <NotebookPen />}
              {t("finance.mfs.noteDialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
