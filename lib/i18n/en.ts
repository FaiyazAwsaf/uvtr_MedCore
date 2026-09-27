import { coreEn } from "./core/en"

/**
 * The English dictionary, composed from namespaces. Each module adds its own
 * namespace here (see docs/implementation_plan.md §3.11).
 */
export const en = {
  ...coreEn,
}

export type Dictionary = typeof en
