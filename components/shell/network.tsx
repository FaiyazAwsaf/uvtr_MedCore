"use client"

import * as React from "react"
import { Loader2, Wifi, WifiOff } from "lucide-react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { branches, type BranchCode } from "@/config/brand.config"
import { useDbInfo } from "@/core/db/DbProvider"
import type { NetworkRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

function branchName(code: BranchCode, locale: "en" | "bn") {
  const branch = branches.find((b) => b.code === code)
  return branch ? `${branch.name[locale]} (${code})` : code
}

function rowFor(network: NetworkRow[], code: BranchCode): NetworkRow {
  return (
    network.find((row) => row.branchId === code) ?? {
      branchId: code,
      status: "online",
      queuedCount: 0,
    }
  )
}

/** One line of branch status for the badge and its popover. */
function StatusLine({ row }: { row: NetworkRow }) {
  const { t, num, time, locale } = useLocale()
  const offline = row.status === "offline"
  const syncing = row.status === "syncing"
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          offline ? "bg-warning" : syncing ? "bg-info" : "bg-success"
        )}
      />
      <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
        {branchName(row.branchId, locale)}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {offline
          ? row.since
            ? t("shell.network.offlineSince", { time: time(row.since) })
            : t("shell.network.offline")
          : syncing
            ? t("shell.network.syncing")
            : t("shell.network.online")}
        {offline && row.queuedCount
          ? ` · ${t("shell.network.queued", { count: num(row.queuedCount) })}`
          : ""}
      </span>
    </div>
  )
}

/**
 * Network badge: this window's branch online, or offline with the time since
 * and the queued count (plan §3.7). Network-level personas see how many
 * branches are offline. The popover lists every branch.
 */
export function NetworkBadge({ className }: { className?: string }) {
  const { t, num, time } = useLocale()
  const { network, branch } = useDbInfo()
  const own = branch ? rowFor(network, branch) : null
  const offlineRows = network.filter((row) => row.status !== "online")

  const state: "online" | "offline" | "syncing" = own
    ? own.status
    : offlineRows.length
      ? "offline"
      : "online"

  const label = own
    ? own.status === "offline"
      ? own.since
        ? t("shell.network.offlineSince", { time: time(own.since) })
        : t("shell.network.offline")
      : own.status === "syncing"
        ? t("shell.network.syncing")
        : t("shell.network.online")
    : offlineRows.length === 1
      ? `${offlineRows[0].branchId} · ${t("shell.network.offline")}`
      : offlineRows.length
        ? t("shell.network.someOffline", { count: num(offlineRows.length) })
        : t("shell.network.online")

  const queued = own?.status === "offline" ? own.queuedCount : 0
  const Icon = state === "offline" ? WifiOff : state === "syncing" ? Loader2 : Wifi

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-slot="network-badge"
            data-state={state}
            aria-label={`${t("shell.network.title")}: ${label}`}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-[0.8125rem] font-medium shadow-(--card-shadow) transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              state === "online" && "bg-card text-foreground hover:bg-surface-raised",
              state === "offline" &&
                "bg-[color-mix(in_oklch,var(--warning)_20%,var(--card))] text-foreground",
              state === "syncing" &&
                "bg-[color-mix(in_oklch,var(--info)_18%,var(--card))] text-foreground",
              className
            )}
          />
        }
      >
        <span className="relative flex">
          <Icon
            className={cn(
              "size-4",
              state === "online" && "text-success",
              state === "offline" && "text-warning",
              state === "syncing" && "animate-spin text-info"
            )}
          />
        </span>
        {/* Narrow top bars show the icon (and queued count) only; while offline
            the banner under the top bar carries the full sentence. */}
        <span className="hidden whitespace-nowrap @min-[64rem]/topbar:inline">
          {label}
        </span>
        {queued ? (
          <span className="count-badge nums flex h-5 min-w-5 items-center justify-center px-1.5 text-[0.6875rem] font-semibold">
            {num(queued)}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-1 p-4">
        <div className="pb-1 text-[0.9375rem] font-semibold">{t("shell.network.title")}</div>
        <div className="divide-y divide-hairline">
          {branches.map((b) => (
            <StatusLine key={b.code} row={rowFor(network, b.code)} />
          ))}
        </div>
        {!own && !offlineRows.length ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {t("shell.network.allOnline")}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Persistent warning under the top bar while this window's branch is offline
 * and working on its edge store (plan §3.7 step 5).
 */
export function OfflineBanner() {
  const { t, num, time, locale } = useLocale()
  const { network, branch, isEdge } = useDbInfo()
  if (!branch || !isEdge) return null
  const row = rowFor(network, branch)
  if (row.status === "online") return null
  return (
    <div
      role="status"
      data-slot="offline-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-y border-[color-mix(in_oklch,var(--warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--warning)_16%,var(--background))] px-4 py-2.5 text-[0.8125rem] xl:px-6 print:hidden"
    >
      <span className="flex min-w-0 items-center gap-2.5 font-medium">
        <WifiOff className="size-4 shrink-0 text-warning" />
        <span className="min-w-0">
          {t("shell.network.banner", {
            branch: branchName(branch, locale),
            time: row.since ? time(row.since) : "",
          })}
        </span>
      </span>
      {row.queuedCount ? (
        <span className="ml-auto text-muted-foreground">
          {t("shell.network.bannerQueued", { count: num(row.queuedCount) })}
        </span>
      ) : null}
    </div>
  )
}
