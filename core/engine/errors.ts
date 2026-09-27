import type { Id, Ms } from "@/core/db/schema"

/**
 * Engine errors. `useCommand` turns each into the right dialog: conflicts
 * offer "reload", rule violations explain the rule, denials name the role.
 */

/** Optimistic concurrency failure: someone committed a newer version first. */
export class ConflictError extends Error {
  readonly kind = "conflict" as const
  constructor(
    readonly table: string,
    readonly id: Id,
    readonly expectedVersion: number,
    readonly actualVersion: number,
    readonly updatedBy: Id,
    readonly updatedAt: Ms
  ) {
    super(
      `Record ${table}/${id} changed (v${expectedVersion} to v${actualVersion})`
    )
  }
}

/** A business rule (invariant or command check) refused the commit. */
export class RuleViolation extends Error {
  readonly kind = "rule" as const
  constructor(
    /** Stable code, e.g. "NID_EXISTS", "STOCK_NEGATIVE"; also an i18n key suffix */
    readonly code: string,
    readonly params: Record<string, string | number> = {},
    /** Record the blocked attempt in the audit log (PRD: attempts audited) */
    readonly audit: boolean = false
  ) {
    super(`Rule violation: ${code}`)
  }
}

/** The acting role may not run this command. Always audited. */
export class PermissionDenied extends Error {
  readonly kind = "denied" as const
  constructor(
    readonly command: string,
    readonly role: string,
    /** Roles that may run the command, for "This action is for <roles>" */
    readonly roles: readonly string[] | "any" = []
  ) {
    super(`Role ${role} may not run ${command}`)
  }
}

export class NotFoundError extends Error {
  readonly kind = "not-found" as const
  constructor(
    readonly table: string,
    readonly id: Id
  ) {
    super(`Not found: ${table}/${id}`)
  }
}

/** Command input failed schema validation. */
export class ValidationError extends Error {
  readonly kind = "validation" as const
  constructor(
    readonly command: string,
    readonly issues: { path: string; message: string }[]
  ) {
    super(`Invalid input for ${command}`)
  }
}

export type EngineError =
  | ConflictError
  | RuleViolation
  | PermissionDenied
  | NotFoundError
  | ValidationError

export function isEngineError(error: unknown): error is EngineError {
  return (
    error instanceof ConflictError ||
    error instanceof RuleViolation ||
    error instanceof PermissionDenied ||
    error instanceof NotFoundError ||
    error instanceof ValidationError
  )
}
