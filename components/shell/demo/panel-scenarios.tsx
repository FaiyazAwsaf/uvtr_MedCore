"use client"

import { useRouter } from "next/navigation"
import { Play, Rocket } from "lucide-react"

import { Button } from "@/components/ui/button"
import { HOME_ROUTE } from "@/core/rbac/routes"
import { SCENARIOS } from "@/core/scenarios/registry"
import type { ScenarioDef } from "@/core/scenarios/types"
import { defaultPersonaFor, findPersona } from "@/core/seed/content/personas"
import { setPersona } from "@/core/session/persona"
import { getSession, updateSession } from "@/core/session/session"
import { useLocale } from "@/lib/i18n/provider"
import { roleLabel } from "@/modules/demo/components/labels"

import { SectionTitle } from "./section-title"
import { useDemoUi } from "./store"

function groupByModule(list: ScenarioDef[]): [string, ScenarioDef[]][] {
  const groups = new Map<string, ScenarioDef[]>()
  for (const scenario of list) {
    const group = groups.get(scenario.module) ?? []
    group.push(scenario)
    groups.set(scenario.module, group)
  }
  return [...groups.entries()]
}

/**
 * Scenario launchers (plan §10), grouped by module. Until Phase 3 adds real
 * setups, launching switches this window to the scenario's role, opens its
 * home screen and shows the cue card.
 */
export function ScenariosSection() {
  const { t, tk } = useLocale()
  const router = useRouter()

  const launch = (scenario: ScenarioDef) => {
    const current = findPersona(getSession().personaId ?? "")
    if (current?.role !== scenario.role) {
      const persona = defaultPersonaFor(scenario.role)
      if (persona) setPersona(persona.id)
    }
    updateSession({ cue: { scenarioId: scenario.id, step: 0 } })
    useDemoUi.getState().setPanelOpen(false)
    router.push(HOME_ROUTE[scenario.role])
  }

  const moduleTitle = (module: string) => {
    const key = `${module}.title`
    const label = tk(key)
    return label === key ? module : label
  }

  return (
    <section className="flex flex-col gap-3" data-testid="demo-scenarios">
      <SectionTitle icon={Rocket} title={t("demo.scenarios.title")} />
      {SCENARIOS.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg bg-card px-4 py-8 text-center">
          <span className="icon-well flex size-10 items-center justify-center text-muted-foreground">
            <Rocket className="size-4" />
          </span>
          <p className="text-xs text-muted-foreground">
            {t("demo.scenarios.empty")}
          </p>
        </div>
      ) : (
        groupByModule(SCENARIOS).map(([module, list]) => (
          <div key={module} className="flex flex-col gap-1.5">
            <h4 className="micro">{moduleTitle(module)}</h4>
            <ul className="divide-y divide-hairline overflow-hidden rounded-lg bg-card">
              {list.map((scenario) => (
                <li
                  key={scenario.id}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <span className="w-8 shrink-0 font-mono text-[0.6875rem] text-muted-foreground">
                    {scenario.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {tk(scenario.titleKey)}
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground">
                      {roleLabel(scenario.role, tk)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => launch(scenario)}
                  >
                    <Play />
                    {t("demo.scenarios.launch")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
