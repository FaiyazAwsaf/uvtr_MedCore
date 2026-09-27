import type { BaseRow, Id, Ms, Origin } from "./schema"

/**
 * Base fields for rows written outside the engine (the seed only). Everything
 * else gets these from `commit()`.
 */
export function baseFields(
  id: Id,
  at: Ms,
  by: Id = "system",
  origin: Origin = "central"
): BaseRow {
  return {
    id,
    version: 1,
    createdAt: at,
    updatedAt: at,
    createdBy: by,
    updatedBy: by,
    origin,
  }
}

/** Build a complete row from its domain fields plus base fields. */
export function seedRow<T extends BaseRow>(
  id: Id,
  at: Ms,
  data: Omit<T, keyof BaseRow>
): T {
  return { ...baseFields(id, at), ...data } as T
}
