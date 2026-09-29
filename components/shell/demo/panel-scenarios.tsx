"use client"

import { useLiveQuery } from "dexie-react-hooks"
import { FastForward, Loader2, Play, Rocket, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useDb } from "@/core/db/DbProvider"
import { SCENARIOS } from "@/core/scenarios/registry"
import type { ScenarioDef } from "@/core/scenarios/types"
import { findPersona } from "@/core/seed/content/personas"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { roleLabel } from "@/modules/demo/components/labels"

import { SectionTitle } from "./section-title"
import { useScenarioLauncher } from "./use-scenario-launcher"

/** S1 < S2 < S4 < S4D < S10: by letter, then number, then suffix. */
function launcherOrder(a: ScenarioDef, b: ScenarioDef): number {
  const parse = (id: string) => {
    const match = /^([A-Z]+)(\d+)(.*)$/.exec(id)
    return match
      ? ([match[1], Number(match[2]), match[3]] as const)
      : ([id, 0, ""] as const)
  }
  const [la, na, sa] = parse(a.id)
  const [lb, nb, sb] = parse(b.id)
  return la.localeCompare(lb) || na - nb || sa.localeCompare(sb)
}

/**
 * Scenario launchers (plan §10): the main-journey jumps (J1 to J6) and the
 * exception scenarios (S1 to S16). Launching runs the setup, switches this
 * window to the scenario's persona, opens its screen and the cue card.
 */
export function ScenariosSection() {
  const { t, tk, time, locale } = useLocale()
  const db = useDb()
  const { running, failed, launch } = useScenarioLauncher()
  const lastRuns = useLiveQuery(async () => {
    const runs = await db.scenarioRuns.orderBy("at").toArray()
    return new Map(runs.map((run) => [run.scenarioId, run.at]))
  }, [db])

  const jumps = SCENARIOS.filter((s) => s.kind === "jump").sort(launcherOrder)
  const scenarios = SCENARIOS.filter((s) => s.kind === "scenario").sort(
    launcherOrder
  )

  const personaLine = (scenario: ScenarioDef) => {
    const persona = findPersona(scenario.persona)
    if (!persona) return scenario.persona
    const name = persona.staff
      ? locale === "bn"
        ? persona.staff.nameBn
        : persona.staff.nameEn
      : (persona.patientName?.[locale] ?? "")
    return `${roleLabel(persona.role, tk)} · ${name}${persona.branchId ? ` (${persona.branchId})` : ""}`
  }

  if (SCENARIOS.length === 0) {
    return (
      <section className="flex flex-col gap-3" data-testid="demo-scenarios">
        <SectionTitle icon={Rocket} title={t("demo.scenarios.title")} />
        <div className="flex flex-col items-center gap-2 rounded-lg bg-card px-4 py-8 text-center">
          <span className="icon-well flex size-10 items-center justify-center text-muted-foreground">
            <Rocket className="size-4" />
          </span>
          <p className="text-xs text-muted-foreground">
            {t("demo.scenarios.empty")}
          </p>
        </div>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-5" data-testid="demo-scenarios">
      {jumps.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionTitle
            icon={FastForward}
            title={t("demo.scenarios.jumpTitle")}
          />
          <p className="text-[0.6875rem] text-muted-foreground">
            {t("demo.scenarios.jumpHint")}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {jumps.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                data-testid="scenario-launch"
                data-scenario-id={scenario.id}
                data-kind="jump"
                disabled={running !== null}
                onClick={() => void launch(scenario)}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-lg bg-card px-2.5 py-2 text-left transition-colors outline-none hover:bg-primary-soft focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60",
                  failed?.id === scenario.id && "ring-1 ring-destructive/60"
                )}
              >
                <span className="w-6 shrink-0 font-mono text-[0.6875rem] text-primary">
                  {scenario.id}
                </span>
                <span className="min-w-0 flex-1 text-xs leading-snug font-medium">
                  {tk(scenario.titleKey)}
                </span>
                {running === scenario.id ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {scenarios.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionTitle icon={Rocket} title={t("demo.scenarios.title")} />
          <ul className="divide-y divide-hairline overflow-hidden rounded-lg bg-card">
            {scenarios.map((scenario) => {
              const lastRun = lastRuns?.get(scenario.id)
              const isRunning = running === scenario.id
              return (
                <li
                  key={scenario.id}
                  data-testid="scenario-row"
                  data-scenario-id={scenario.id}
                  className="flex flex-col gap-1.5 px-3 py-2.5"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 w-8 shrink-0 font-mono text-[0.6875rem] text-primary">
                      {scenario.id}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs leading-snug font-medium">
                        {tk(scenario.titleKey)}
                      </span>
                      {scenario.summaryKey ? (
                        <span className="mt-0.5 block text-[0.6875rem] leading-snug text-muted-foreground">
                          {tk(scenario.summaryKey)}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">
                        {personaLine(scenario)}
                        {lastRun
                          ? ` · ${t("demo.scenarios.lastRun", { time: time(lastRun) })}`
                          : ""}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant={isRunning ? "secondary" : "outline"}
                      data-testid="scenario-launch"
                      data-scenario-id={scenario.id}
                      data-kind="scenario"
                      disabled={running !== null}
                      onClick={() => void launch(scenario)}
                    >
                      {isRunning ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Play />
                      )}
                      {isRunning
                        ? t("demo.scenarios.running")
                        : t("demo.scenarios.launch")}
                    </Button>
                  </div>
                  {failed?.id === scenario.id ? (
                    <p
                      data-testid="scenario-error"
                      data-scenario-id={scenario.id}
                      className="flex items-start gap-1.5 pl-11 text-[0.6875rem] text-destructive"
                    >
                      <TriangleAlert className="mt-px size-3 shrink-0" />
                      {t("demo.scenarios.failed")}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
