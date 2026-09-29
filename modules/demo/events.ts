import type { EventCatalog } from "@/core/events/types"

/** Platform and demo-control events (engine, clock, offline sync). */
export const demoEvents: EventCatalog = {
  RuleViolationBlocked: {
    module: "engine",
    labelKey: "demo.events.ruleViolationBlocked",
    consumers: ["demo.consumers.audit"],
    severity: "warning",
  },
  DemoReset: {
    module: "demo",
    labelKey: "demo.events.demoReset",
    consumers: ["demo.consumers.allWindows"],
    severity: "info",
  },
  ClockAdvanced: {
    module: "demo",
    labelKey: "demo.events.clockAdvanced",
    consumers: ["demo.consumers.allWindows", "demo.consumers.timers"],
    severity: "info",
  },
  ClockReset: {
    module: "demo",
    labelKey: "demo.events.clockReset",
    consumers: ["demo.consumers.allWindows", "demo.consumers.timers"],
    severity: "info",
  },
  BranchWentOffline: {
    module: "sync",
    labelKey: "demo.events.branchWentOffline",
    consumers: ["demo.consumers.allBranches", "demo.consumers.dashboard"],
    severity: "warning",
  },
  BranchReconnected: {
    module: "sync",
    labelKey: "demo.events.branchReconnected",
    consumers: ["demo.consumers.allBranches", "demo.consumers.dashboard"],
    severity: "success",
  },
  EdgeEventsReplayed: {
    module: "sync",
    labelKey: "demo.events.edgeEventsReplayed",
    consumers: ["demo.consumers.central", "demo.consumers.audit"],
    severity: "success",
  },
  IdentityConflictQueued: {
    module: "sync",
    labelKey: "demo.events.identityConflictQueued",
    consumers: ["demo.consumers.dataSteward"],
    severity: "warning",
  },
  ScenarioLaunched: {
    module: "demo",
    labelKey: "demo.events.scenarioLaunched",
    consumers: ["demo.consumers.presenter", "demo.consumers.audit"],
    severity: "info",
  },
  PatientContactUpdated: {
    module: "demo",
    labelKey: "demo.events.patientContactUpdated",
    consumers: ["demo.consumers.registry", "demo.consumers.audit"],
    severity: "info",
  },
}
