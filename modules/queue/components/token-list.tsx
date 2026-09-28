"use client"

import * as React from "react"
import { toast } from "sonner"
import { Megaphone, RotateCcw, SkipForward, Ticket } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { nameIn } from "@/components/shared/person"
import { StatusPill, type Tone } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import type { PatientRow, QueueTokenRow } from "@/core/db/schema"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { useDeskCommand, useRuleText } from "@/modules/identity/components/desk-command"

import { byPosition } from "../board"
import { callToken, recallToken, skipToken } from "../commands"

export const TOKEN_TONE: Record<QueueTokenRow["status"], Tone> = {
  waiting: "info",
  called: "primary",
  skipped: "warning",
  recalled: "info",
  "in-consult": "warning",
  done: "success",
}

/**
 * One session's tokens in queue order (the 2 booked : 1 walk-in positions)
 * with their status and the call, skip and recall actions. Staff only: it
 * shows names; the display board never does.
 */
export function TokenList({
  tokens,
  patients,
  highlightId,
}: {
  tokens: QueueTokenRow[]
  patients: Map<string, PatientRow>
  /** A token to flash (just issued here) */
  highlightId?: string | null
}) {
  const { t } = useLocale()
  const ordered = React.useMemo(() => byPosition(tokens), [tokens])
  if (!ordered.length) {
    return <EmptyState size="sm" icon={Ticket} title={t("queue.tokens.empty")} />
  }
  return (
    <ol data-testid="token-list" className="flex flex-col divide-y divide-hairline">
      {ordered.map((token) => (
        <TokenRow
          key={token.id}
          token={token}
          patient={patients.get(token.patientId)}
          highlight={token.id === highlightId}
        />
      ))}
    </ol>
  )
}

function TokenRow({
  token,
  patient,
  highlight,
}: {
  token: QueueTokenRow
  patient?: PatientRow
  highlight: boolean
}) {
  const { t, tk, locale, num, time } = useLocale()
  const ruleText = useRuleText()
  const call = useDeskCommand(callToken)
  const skip = useDeskCommand(skipToken)
  const recall = useDeskCommand(recallToken)
  const flash = useFlashOnChange(token.version)
  const pending = call.pending || skip.pending || recall.pending
  const finished = token.status === "done" || token.status === "in-consult"

  const act = async (command: typeof call, done: string) => {
    const outcome = await command.run({ tokenId: token.id, expectedVersion: token.version })
    if (outcome.ok) toast.success(done)
    else if (outcome.rule) toast.error(ruleText(outcome.rule))
  }

  return (
    <li
      data-testid="token-row"
      data-token-id={token.id}
      data-status={token.status}
      className={cn(
        "@container/tok flex items-center gap-3 px-1 py-2",
        token.status === "called" && "rounded-md bg-primary-soft",
        token.status === "done" && "opacity-55",
        (highlight || flash) && "flash-sync"
      )}
    >
      <span className="nums w-6 shrink-0 text-center text-xs text-muted-foreground">
        {num(token.position)}
      </span>
      <span
        lang="en"
        className="w-16 shrink-0 font-mono text-[1.0625rem] font-semibold tracking-tight"
      >
        {token.label}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.8125rem] font-medium">
          {patient ? nameIn(patient, locale) : ""}
        </span>
        <span className="nums truncate text-xs text-muted-foreground">
          {t(token.kind === "walk-in" ? "queue.tokens.walkIn" : "queue.tokens.booked")} ·{" "}
          {token.calledAt && token.status !== "waiting"
            ? t("queue.tokens.calledAt", { time: time(token.calledAt) })
            : t("queue.tokens.issuedAt", { time: time(token.issuedAt) })}
        </span>
      </span>
      <StatusPill tone={TOKEN_TONE[token.status]} className="hidden @[26rem]/tok:inline-flex">
        {tk(`queue.status.${token.status}`)}
      </StatusPill>
      <span className="flex shrink-0 items-center gap-1">
        {token.status === "waiting" || token.status === "recalled" || token.status === "skipped" ? (
          <Button
            data-testid="token-call"
            size="sm"
            variant={token.status === "skipped" ? "outline" : "default"}
            disabled={pending}
            onClick={() => act(call, t("queue.toast.called", { token: token.label }))}
          >
            <Megaphone />
            <span className="hidden @[30rem]/tok:inline">{t("queue.actions.call")}</span>
          </Button>
        ) : null}
        {token.status === "called" ? (
          <Button
            data-testid="token-skip"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => act(skip, t("queue.toast.skipped", { token: token.label }))}
          >
            <SkipForward />
            <span className="hidden @[30rem]/tok:inline">{t("queue.actions.skip")}</span>
          </Button>
        ) : null}
        {token.status === "skipped" ? (
          <Button
            data-testid="token-recall"
            size="sm"
            variant="neutral"
            disabled={pending}
            onClick={() => act(recall, t("queue.toast.recalled", { token: token.label }))}
          >
            <RotateCcw />
            <span className="hidden @[30rem]/tok:inline">{t("queue.actions.recall")}</span>
          </Button>
        ) : null}
        {finished ? (
          <span className="px-2 text-xs text-muted-foreground @[26rem]/tok:hidden">
            {tk(`queue.status.${token.status}`)}
          </span>
        ) : null}
      </span>
    </li>
  )
}
