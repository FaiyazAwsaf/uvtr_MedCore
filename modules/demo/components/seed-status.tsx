"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { CalendarCheck, RotateCcw, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { getControlDb } from "@/core/db/control"
import type { DemoMetaRow } from "@/core/db/schema"
import { resetDemo } from "@/core/demo/reset"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/**
 * Seed metadata and whether it is stale: the seed is anchored to a demo day,
 * so once the demo date moves on (a new real day, or +1d on the clock) the
 * relative dates drift and a reset re-anchors them (plan §3.8).
 */
export function useSeedStatus(): {
  meta: DemoMetaRow | null | undefined
  today: string | undefined
  stale: boolean
} {
  const meta = useLiveQuery(
    async () => (await getControlDb().demoMeta.get("meta")) ?? null,
    []
  )
  const nowMs = useNow(30_000)
  const today = nowMs ? dhakaDate(nowMs) : undefined
  return { meta, today, stale: !!meta && !!today && meta.seedDate !== today }
}

/** Reset with a confirm step. Every window reloads once the seed is restored. */
export function ResetDemoButton({
  className,
  variant = "outline",
}: {
  className?: string
  variant?: "outline" | "default"
}) {
  const { t } = useLocale()
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const reset = async () => {
    setBusy(true)
    try {
      await resetDemo()
      // resetDemo publishes "reset": every window, this one included, reloads.
    } catch (error) {
      console.error("reset demo", error)
      toast.error(t("demo.seed.resetFailed"))
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <Button
        variant={variant}
        size="sm"
        className={className}
        onClick={() => setConfirming(true)}
        data-testid="demo-reset"
      >
        <RotateCcw />
        {t("demo.seed.reset")}
      </Button>
    )
  }
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-2 rounded-md bg-destructive/10 p-3",
        className
      )}
    >
      <p className="text-xs text-destructive">{t("demo.seed.resetConfirm")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={reset}
          data-testid="demo-reset-confirm"
        >
          <RotateCcw />
          {busy ? t("demo.seed.resetting") : t("demo.seed.resetConfirmAction")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          {t("demo.common.cancel")}
        </Button>
      </div>
    </div>
  )
}

/** Seed date, the stale prompt and the reset button, as one block. */
export function SeedStatus({ className }: { className?: string }) {
  const { t, dmy, dateTime } = useLocale()
  const { meta, stale } = useSeedStatus()

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-testid="seed-status"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "icon-well flex size-8 shrink-0 items-center justify-center",
            stale ? "text-warning" : "text-success"
          )}
        >
          {stale ? (
            <TriangleAlert className="size-4" />
          ) : (
            <CalendarCheck className="size-4" />
          )}
        </span>
        <div className="min-w-0 text-xs">
          <p className="font-medium">
            {meta
              ? t("demo.seed.seededFor", { date: dmy(meta.seedDate) })
              : t("demo.seed.notSeeded")}
          </p>
          <p className="text-[0.6875rem] text-muted-foreground">
            {meta
              ? t("demo.seed.seededAt", { time: dateTime(meta.seededAt) })
              : null}
            {meta && !stale ? ` · ${t("demo.seed.current")}` : null}
          </p>
        </div>
      </div>
      {stale && meta ? (
        <p
          className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning"
          data-testid="seed-stale"
        >
          {t("demo.seed.stale", { date: dmy(meta.seedDate) })}
        </p>
      ) : null}
      <ResetDemoButton
        className="self-start"
        variant={stale ? "default" : "outline"}
      />
    </div>
  )
}
