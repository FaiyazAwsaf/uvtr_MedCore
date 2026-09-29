import type { ScenarioDef } from "@/core/scenarios/types"

/**
 * Scenario launchers owned by this module (plan §10). S4D is the doctor's
 * side of S4: the pharmacist's window requests a substitute, this window
 * decides it.
 */
export const consultationScenarios: ScenarioDef[] = [
  {
    id: "S4D",
    kind: "scenario",
    module: "consultation",
    titleKey: "consultation.scenarios.S4D.title",
    summaryKey: "consultation.scenarios.S4D.summary",
    persona: "per_doctor_kamal",
    route: () => "/doctor/inbox",
    cueKeys: [
      "consultation.scenarios.S4D.cue.1",
      "consultation.scenarios.S4D.cue.2",
      "consultation.scenarios.S4D.cue.3",
      "consultation.scenarios.S4D.cue.4",
    ],
  },
]
