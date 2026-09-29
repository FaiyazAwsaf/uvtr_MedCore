"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { BadgeCheck, Check, Inbox, ShieldCheck, X } from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { StatusText } from "@/components/shared/status"
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
import type { BrandRow, Id } from "@/core/db/schema"
import { mayApprovePr } from "@/core/procurement/rules"
import { usePersona } from "@/core/session/persona"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { brandLabel } from "@/modules/inventory/stock"
import {
  branchName,
  LiveChip,
  PageBody,
  PageHeader,
  useActionKey,
  useModuleCommand,
} from "@/modules/pharmacy/components/shared"

import { decidePr } from "../commands"
import { loadApprovals, loadCounterApprovals, type PrItem } from "../queries"
import { PrStatusPill, QtyText, useArrivals, useTierText } from "./bits"

type Tab = "pending" | "decided" | "counter"

const NO_AUTHORITIES: readonly string[] = []

/**
 * The approvals inbox (plan §9): `/store/approvals` for the store manager
 * and the head of procurement, `/finance/approvals` for the CFO. Pending
 * shows the submitted requests the person may decide by value (never their
 * own; a branch persona sees only their branch). Finance also gets a
 * read-only view of the approvals given at the counters.
 */
export function ApprovalsScreen({ mode }: { mode: "store" | "finance" }) {
  const { t, num } = useLocale()
  const db = useDb()
  const persona = usePersona()
  const staffId = persona?.staff?.id ?? null
  const authorities = persona?.staff?.authorities ?? NO_AUTHORITIES
  const own = persona?.branchId ?? null
  const [tab, setTab] = React.useState<Tab>("pending")
  const [deciding, setDeciding] = React.useState<{ item: PrItem; decision: "approve" | "reject" } | null>(
    null
  )
  const authKey = authorities.join(",")
  const data = useLiveQuery(
    () =>
      loadApprovals(db, { branch: own }, (pr) =>
        staffId ? mayApprovePr({ id: staffId, authorities: authKey.split(",") }, pr) : false
      ),
    [db, own, staffId, authKey]
  )
  const fresh = useArrivals(data?.pending.map((item) => item.pr.id))

  return (
    <PageBody data-testid="approvals-screen" data-mode={mode}>
      <PageHeader
        title={mode === "finance" ? t("procurement.approvals.financeTitle") : t("procurement.approvals.title")}
        subtitle={
          mode === "finance" ? t("procurement.approvals.financeSubtitle") : t("procurement.approvals.subtitle")
        }
        actions={<LiveChip />}
      />
      <SegmentedPills
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          {
            value: "pending",
            label: t("procurement.approvals.tabs.pending"),
            count: num(data?.pending.length ?? 0),
          },
          { value: "decided", label: t("procurement.approvals.tabs.decided") },
          ...(mode === "finance"
            ? [{ value: "counter" as const, label: t("procurement.approvals.tabs.counter") }]
            : []),
        ]}
      />

      {!data ? null : tab === "pending" ? (
        data.pending.length === 0 ? (
          <section className="surface-card">
            <EmptyState
              icon={Inbox}
              title={t("procurement.approvals.empty")}
              description={t("procurement.approvals.emptyHint")}
            />
          </section>
        ) : (
          <div className="flex flex-col gap-3">
            {data.pending.map((item) => (
              <PendingCard
                key={item.pr.id}
                item={item}
                brands={data.brands}
                fresh={fresh.has(item.pr.id)}
                onDecide={(decision) => setDeciding({ item, decision })}
              />
            ))}
          </div>
        )
      ) : tab === "decided" ? (
        <DecidedTable items={data.decided} linkToRequest={mode === "store"} />
      ) : (
        <CounterApprovals />
      )}
      <DecideDialog value={deciding} onClose={() => setDeciding(null)} />
    </PageBody>
  )
}

function PendingCard({
  item,
  brands,
  fresh,
  onDecide,
}: {
  item: PrItem
  brands: Map<Id, BrandRow>
  fresh: boolean
  onDecide: (decision: "approve" | "reject") => void
}) {
  const { t, num, locale } = useLocale()
  const tierText = useTierText()
  const { pr, lines, requester } = item
  const shown = lines.slice(0, 4)
  return (
    <article
      data-testid="approval-row"
      data-pr-no={pr.prNo}
      data-tier={pr.approvalTier}
      className={cn("surface-card @container/card flex flex-col gap-3 p-4", fresh && "flash-sync")}
    >
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-semibold" lang="en">
              {pr.prNo}
            </span>
            <span className="text-[0.8125rem] text-muted-foreground">
              {t("procurement.approvals.from", {
                name: requester ? nameIn(requester, locale) : "",
                branch: branchName(pr.branchId, locale),
              })}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pr.submittedAt ? (
              <>
                {t("procurement.editor.submittedAt")}{" "}
                <DateText value={pr.submittedAt} variant="relative" />
              </>
            ) : null}
            {" · "}
            {tierText.full(pr.approvalTier)}
          </p>
        </div>
        <MoneyText poisha={pr.totalP} className="figure text-[1.25rem]" />
      </header>
      <ul className="flex flex-col gap-1 rounded-md bg-surface-raised/60 px-3 py-2 text-[0.8125rem]">
        {shown.map((line) => {
          const brand = brands.get(line.brandId)
          return (
            <li key={line.id} className="flex flex-wrap items-baseline gap-x-3">
              <span className="min-w-0 flex-1 font-medium" lang="en">
                {brand ? brandLabel(brand) : line.brandId}
              </span>
              <QtyText
                qty={line.qty}
                pack={line.pack}
                brand={brand}
                showUnits={false}
                className="text-muted-foreground"
              />
              <MoneyText poisha={line.lineTotalP} className="w-24 text-right" />
            </li>
          )
        })}
        {lines.length > shown.length ? (
          <li className="text-xs text-muted-foreground">
            {t("procurement.common.items", { count: num(lines.length) })}
          </li>
        ) : null}
      </ul>
      {pr.note ? <p className="text-[0.8125rem] text-muted-foreground italic">{pr.note}</p> : null}
      <footer className="flex flex-wrap justify-end gap-2">
        <Button
          data-testid="approval-reject"
          size="sm"
          variant="destructive-outline"
          onClick={() => onDecide("reject")}
        >
          <X />
          {t("procurement.approvals.reject")}
        </Button>
        <Button data-testid="approval-approve" size="sm" onClick={() => onDecide("approve")}>
          <Check />
          {t("procurement.approvals.approve")}
        </Button>
      </footer>
    </article>
  )
}

function DecideDialog({
  value,
  onClose,
}: {
  value: { item: PrItem; decision: "approve" | "reject" } | null
  onClose: () => void
}) {
  const { t, money, locale } = useLocale()
  const [note, setNote] = React.useState("")
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(decidePr)
  const pr = value?.item.pr
  const reject = value?.decision === "reject"
  const close = () => {
    setNote("")
    onClose()
  }
  const submit = async () => {
    if (!value || !pr) return
    const result = await command.run({
      prId: pr.id,
      decision: value.decision,
      note: note.trim() || undefined,
      expectedVersion: pr.version,
      idempotencyKey: key,
    })
    renewKey()
    if (result) {
      toast.success(
        reject
          ? t("procurement.approvals.dialog.rejected", { prNo: pr.prNo })
          : t("procurement.approvals.dialog.approved", { prNo: pr.prNo })
      )
      close()
    } else {
      onClose()
    }
  }
  return (
    <Dialog open={!!value} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="sm:max-w-md" data-testid="approval-dialog">
        <DialogHeader>
          <DialogTitle>
            {reject
              ? t("procurement.approvals.dialog.rejectTitle", { prNo: pr?.prNo ?? "" })
              : t("procurement.approvals.dialog.approveTitle", { prNo: pr?.prNo ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {pr
              ? reject
                ? t("procurement.approvals.dialog.rejectBody", {
                    name: value?.item.requester ? nameIn(value.item.requester, locale) : "",
                  })
                : t("procurement.approvals.dialog.approveBody", {
                    amount: money(pr.totalP),
                    branch: branchName(pr.branchId, locale),
                  })
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="approval-note">
            {reject ? t("procurement.approvals.dialog.reason") : t("procurement.approvals.dialog.note")}
          </Label>
          <Textarea
            id="approval-note"
            data-testid="approval-reason"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("procurement.approvals.dialog.reasonPlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="approval-confirm"
            variant={reject ? "destructive" : "default"}
            onClick={submit}
            disabled={command.pending || (reject && !note.trim())}
          >
            {reject ? <X /> : <BadgeCheck />}
            {reject
              ? t("procurement.approvals.dialog.confirmReject")
              : t("procurement.approvals.dialog.confirmApprove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DecidedTable({ items, linkToRequest }: { items: PrItem[]; linkToRequest: boolean }) {
  const { t, locale } = useLocale()
  if (!items.length) {
    return (
      <section className="surface-card">
        <EmptyState
          icon={ShieldCheck}
          title={t("procurement.approvals.decidedEmpty")}
          description={t("procurement.approvals.decidedEmptyHint")}
        />
      </section>
    )
  }
  return (
    <section className="@container/t surface-card p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("procurement.requests.col.pr")}</TableHead>
            <TableHead className="hidden @min-[40rem]/t:table-cell">
              {t("procurement.requests.col.requester")}
            </TableHead>
            <TableHead className="text-right">{t("procurement.requests.col.total")}</TableHead>
            <TableHead>{t("procurement.requests.col.status")}</TableHead>
            <TableHead className="hidden @min-[52rem]/t:table-cell">
              {t("procurement.approvals.counter.col.reason")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(({ pr, requester, decider }) => (
            <TableRow key={pr.id} data-testid="approval-decided-row" data-pr-no={pr.prNo}>
              <TableCell>
                {linkToRequest ? (
                  <Link
                    href={`/store/requests?pr=${pr.id}`}
                    className="font-mono text-xs font-semibold text-link underline-offset-4 hover:underline"
                    lang="en"
                  >
                    {pr.prNo}
                  </Link>
                ) : (
                  <span className="font-mono text-xs font-semibold" lang="en">
                    {pr.prNo}
                  </span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {branchName(pr.branchId, locale)}
                </span>
              </TableCell>
              <TableCell className="hidden @min-[40rem]/t:table-cell">
                {requester ? nameIn(requester, locale) : ""}
              </TableCell>
              <TableCell className="text-right">
                <MoneyText poisha={pr.totalP} />
              </TableCell>
              <TableCell>
                <span className="flex flex-col gap-0.5">
                  <PrStatusPill status={pr.status} />
                  <span className="text-xs text-muted-foreground">
                    {pr.status === "rejected"
                      ? t("procurement.approvals.decision.rejected", {
                          name: decider ? nameIn(decider, locale) : "",
                        })
                      : t("procurement.approvals.decision.approved", {
                          name: decider ? nameIn(decider, locale) : "",
                        })}
                    {pr.decidedAt ? (
                      <>
                        {" · "}
                        <DateText value={pr.decidedAt} variant="relative" />
                      </>
                    ) : null}
                  </span>
                </span>
              </TableCell>
              <TableCell className="hidden text-[0.8125rem] text-muted-foreground @min-[52rem]/t:table-cell">
                {pr.decisionNote ?? ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

/** Finance oversight: approvals given at the counters and desks (read only). */
function CounterApprovals() {
  const { t, locale } = useLocale()
  const db = useDb()
  const rows = useLiveQuery(() => loadCounterApprovals(db), [db])
  return (
    <section className="@container/t surface-card flex flex-col gap-3 p-4">
      <p className="text-[0.8125rem] text-muted-foreground">{t("procurement.approvals.counter.hint")}</p>
      {rows && rows.length === 0 ? (
        <EmptyState size="sm" icon={ShieldCheck} title={t("procurement.approvals.counter.empty")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("procurement.approvals.counter.col.kind")}</TableHead>
              <TableHead>{t("procurement.approvals.counter.col.approver")}</TableHead>
              <TableHead className="hidden @min-[46rem]/t:table-cell">
                {t("procurement.approvals.counter.col.requester")}
              </TableHead>
              <TableHead className="text-right">{t("procurement.approvals.counter.col.amount")}</TableHead>
              <TableHead className="hidden @min-[72rem]/t:table-cell">
                {t("procurement.approvals.counter.col.reason")}
              </TableHead>
              <TableHead className="hidden @min-[34rem]/t:table-cell">
                {t("procurement.approvals.counter.col.at")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map(({ approval, approver, requester }) => (
              <TableRow key={approval.id} data-testid="approval-counter-row" data-kind={approval.kind}>
                <TableCell>
                  <StatusText tone={approval.status === "rejected" ? "destructive" : "info"}>
                    {t(`procurement.approvals.kind.${approval.kind}`)}
                  </StatusText>
                </TableCell>
                <TableCell>
                  {approver ? nameIn(approver, locale) : ""}
                  <span
                    className="block max-w-72 truncate text-xs text-muted-foreground @min-[72rem]/t:hidden"
                    title={approval.reason}
                  >
                    {approval.reason}
                  </span>
                </TableCell>
                <TableCell className="hidden @min-[46rem]/t:table-cell">
                  {requester ? nameIn(requester, locale) : ""}
                </TableCell>
                <TableCell className="text-right">
                  {approval.amountP !== undefined ? <MoneyText poisha={approval.amountP} /> : "-"}
                </TableCell>
                <TableCell className="hidden max-w-80 truncate text-[0.8125rem] text-muted-foreground @min-[72rem]/t:table-cell">
                  <span title={approval.reason}>{approval.reason}</span>
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground @min-[34rem]/t:table-cell">
                  <DateText value={approval.decidedAt ?? approval.createdAt} variant="dmyTime" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
