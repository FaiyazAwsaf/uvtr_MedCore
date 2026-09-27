"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { CircleCheck, TriangleAlert, Unplug, Wifi } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { branches, type BranchCode } from "@/config/brand.config"
import { useDbInfo } from "@/core/db/DbProvider"
import { getEdgeDb } from "@/core/db/database"
import type { NetworkRow } from "@/core/db/schema"
import { onlineRow } from "@/core/sync/network"
import { cutBranch } from "@/core/sync/offline"
import { reconnectBranch } from "@/core/sync/replay"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { branchName } from "@/modules/demo/components/labels"

import { SectionTitle } from "./section-title"
import { useDemoUi } from "./store"

/**
 * Branch network (plan §3.7): cut a branch's internet (its windows move to
 * the edge store) and reconnect it (ordered replay with progress).
 */
export function NetworkSection() {
  const { t } = useLocale()
  const { network, branch } = useDbInfo()
  return (
    <section className="flex flex-col gap-3" data-testid="demo-network">
      <SectionTitle
        icon={Wifi}
        title={t("demo.network.title")}
        hint={t("demo.network.hint")}
      />
      <ul className="divide-y divide-hairline overflow-hidden rounded-lg bg-card">
        {branches.map((b) => (
          <BranchNetworkRow
            key={b.code}
            code={b.code}
            row={
              network.find((n) => n.branchId === b.code) ?? onlineRow(b.code)
            }
            mine={b.code === branch}
          />
        ))}
      </ul>
    </section>
  )
}

function BranchNetworkRow({
  code,
  row,
  mine,
}: {
  code: BranchCode
  row: NetworkRow
  mine: boolean
}) {
  const { t, num, time, locale } = useLocale()
  const replay = useDemoUi((s) => s.replay[code])
  const pending = useDemoUi((s) => s.pending[code])
  const queued = useLiveQuery(
    async () => (row.status === "offline" ? getEdgeDb(code).outbox.count() : 0),
    [code, row.status]
  )

  const cut = async () => {
    const ui = useDemoUi.getState()
    ui.setPending(code, "cut")
    ui.setReplay(code, undefined)
    try {
      await cutBranch(code)
    } catch (error) {
      console.error("cut branch", error)
      toast.error(t("demo.network.failed"))
    } finally {
      useDemoUi.getState().setPending(code, undefined)
    }
  }

  const reconnect = async () => {
    const ui = useDemoUi.getState()
    ui.setPending(code, "reconnect")
    ui.setReplay(code, { status: "running", done: 0, total: 0, conflicts: 0 })
    try {
      const outcome = await reconnectBranch(code, (progress) =>
        useDemoUi.getState().setReplay(code, { status: "running", ...progress })
      )
      useDemoUi.getState().setReplay(code, { status: "done", outcome })
      if (!outcome.edgeChainOk) toast.warning(t("demo.network.edgeChainBroken"))
    } catch (error) {
      console.error("reconnect branch", error)
      useDemoUi.getState().setReplay(code, { status: "error" })
      toast.error(t("demo.network.failed"))
    } finally {
      useDemoUi.getState().setPending(code, undefined)
    }
  }

  const running = replay?.status === "running" ? replay : null
  const syncing = row.status === "syncing" || !!running
  const statusText =
    row.status === "online" && !running
      ? t("demo.network.online")
      : syncing
        ? t("demo.network.syncing")
        : t("demo.network.offlineSince", {
            time: row.since ? time(row.since) : "",
          })

  return (
    <li
      className="flex flex-col gap-2 px-3 py-2.5"
      data-testid={`network-${code}`}
      data-status={row.status}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            syncing
              ? "animate-pulse bg-info"
              : row.status === "online"
                ? "bg-success"
                : "bg-warning"
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <span className="truncate">{branchName(code, locale)}</span>
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              {code}
            </span>
            {mine ? (
              <span className="rounded-full bg-primary-soft px-1.5 text-[0.625rem] text-primary">
                {t("demo.network.yourBranch")}
              </span>
            ) : null}
          </p>
          <p
            className={cn(
              "text-[0.6875rem]",
              syncing
                ? "text-info"
                : row.status === "online"
                  ? "text-success"
                  : "text-warning"
            )}
          >
            {statusText}
            {row.status === "offline" && queued ? (
              <span className="text-muted-foreground">
                {" · "}
                {t("demo.network.queued", { count: num(queued) })}
              </span>
            ) : null}
          </p>
        </div>
        {row.status === "online" ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={!!pending || syncing}
            onClick={cut}
            data-testid={`network-cut-${code}`}
          >
            <Unplug />
            {t("demo.network.cut")}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!!pending || syncing}
            onClick={reconnect}
            data-testid={`network-reconnect-${code}`}
          >
            <Wifi />
            {t("demo.network.reconnect")}
          </Button>
        )}
      </div>

      {syncing ? (
        <div className="flex flex-col gap-1 pl-5.5">
          <Progress
            value={
              running && running.total
                ? (running.done / running.total) * 100
                : null
            }
          />
          {running && running.total ? (
            <p className="text-[0.6875rem] text-muted-foreground">
              {t("demo.network.replaying", {
                done: num(running.done),
                total: num(running.total),
              })}
            </p>
          ) : null}
        </div>
      ) : replay?.status === "done" && row.status === "online" ? (
        <p
          className={cn(
            "flex items-center gap-1.5 pl-5.5 text-[0.6875rem]",
            replay.outcome.conflicts ? "text-warning" : "text-success"
          )}
        >
          {replay.outcome.conflicts ? (
            <TriangleAlert className="size-3" />
          ) : (
            <CircleCheck className="size-3" />
          )}
          {t("demo.network.replayed", {
            count: num(replay.outcome.count),
            conflicts: num(replay.outcome.conflicts),
          })}
        </p>
      ) : row.lastReplay && row.status === "online" ? (
        <p className="pl-5.5 text-[0.6875rem] text-muted-foreground">
          {t("demo.network.lastSync", {
            time: time(row.lastReplay.at),
            count: num(row.lastReplay.count),
            conflicts: num(row.lastReplay.conflicts),
          })}
        </p>
      ) : null}
    </li>
  )
}
