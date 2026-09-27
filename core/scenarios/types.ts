import type { Role } from "@/core/rbac/types"

/**
 * A scenario launcher (plan §10). `setup` becomes a real engine transaction in
 * Phase 1; until then scenarios are declared with metadata only.
 */
export type ScenarioDef = {
  /** Stable id, e.g. "S2" or "J3" */
  id: string
  module: string
  /** i18n key of the launcher title */
  titleKey: string
  /** Role the launching window switches to */
  role: Role
  /** i18n keys of the cue-card steps */
  cueKeys: string[]
}
