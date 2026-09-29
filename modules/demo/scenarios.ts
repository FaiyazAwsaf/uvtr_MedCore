import type { ScenarioDef } from "@/core/scenarios/types"

import { journeyScenarios } from "./journey/scenarios"
import { offlineScenarios } from "./launchers/offline"

/** Scenario launchers owned by this module (plan §10). */
export const demoScenarios: ScenarioDef[] = [
  ...journeyScenarios,
  ...offlineScenarios,
]
