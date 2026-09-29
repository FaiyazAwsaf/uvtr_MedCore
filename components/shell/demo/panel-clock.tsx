"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Clock, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { advanceClock, resetClock } from "@/core/clock/control"
import { DAY, HOUR, MINUTE } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { getControlDb } from "@/core/db/control"
import { useLocale } from "@/lib/i18n/provider"

import { SectionTitle } from "./section-title"

const STEPS = [
  { key: "demo.clock.plus15m", ms: 15 * MINUTE },
  { key: "demo.clock.plus1h", ms: HOUR },
  { key: "demo.clock.plus1d", ms: DAY },
  { key: "demo.clock.plus7d", ms: 7 * DAY },
] as const

/** Demo clock: current demo time and the shared fast-forward controls (plan §3.8). */
export function ClockSection() {
  const { t, num, time, dmy } = useLocale()
  const nowMs = useNow(1000)
  const clock = useLiveQuery(() => getControlDb().clock.get("clock"), [])
  const offset = clock?.offsetMs ?? 0
  const [busy, setBusy] = React.useState(false)

  const run = async (change: () => Promise<void>) => {
    setBusy(true)
    try {
      await change()
    } catch (error) {
      console.error("clock change", error)
      toast.error(t("demo.clock.failed"))
    } finally {
      setBusy(false)
    }
  }

  const ahead = Math.abs(offset)
  const parts: string[] = []
  const days = Math.floor(ahead / DAY)
  const hours = Math.floor((ahead % DAY) / HOUR)
  const minutes = Math.floor((ahead % HOUR) / MINUTE)
  if (days) parts.push(t("demo.clock.days", { n: num(days) }))
  if (hours) parts.push(t("demo.clock.hours", { n: num(hours) }))
  if (minutes || !parts.length)
    parts.push(t("demo.clock.minutes", { n: num(minutes) }))

  return (
    <section className="flex flex-col gap-3" data-testid="demo-clock">
      <SectionTitle
        icon={Clock}
        title={t("demo.clock.title")}
        hint={t("demo.clock.hint")}
      />
      <div className="rounded-lg bg-card p-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="figure text-2xl" data-testid="demo-clock-time">
            {nowMs ? time(nowMs) : ""}
          </span>
          <span className="text-sm text-muted-foreground">
            {nowMs ? dmy(nowMs) : ""}
          </span>
        </div>
        <p
          className={
            offset
              ? "mt-1 text-xs text-warning"
              : "mt-1 text-xs text-muted-foreground"
          }
        >
          {offset
            ? t(offset < 0 ? "demo.clock.behind" : "demo.clock.ahead", {
                duration: parts.join(" "),
              })
            : t("demo.clock.atRealTime")}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {STEPS.map((step) => (
            <Button
              key={step.key}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => run(() => advanceClock(step.ms))}
            >
              {t(step.key)}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || offset === 0}
            onClick={() => run(resetClock)}
          >
            <RotateCcw />
            {t("demo.clock.realTime")}
          </Button>
        </div>
      </div>
    </section>
  )
}
