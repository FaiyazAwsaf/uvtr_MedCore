"use client"

import { create } from "zustand"

import {
  ConflictError,
  NotFoundError,
  PermissionDenied,
  RuleViolation,
  ValidationError,
} from "./errors"

/**
 * The engine's user-facing outcome for a failed command. The shell renders
 * it: conflicts as "Record changed, reload", rule violations as the rule's
 * message, denials as "This action is for <role>".
 */
export type EngineFeedback =
  | { kind: "conflict"; error: ConflictError; command: string }
  | { kind: "rule"; error: RuleViolation; command: string }
  | { kind: "denied"; error: PermissionDenied; command: string }
  | { kind: "validation"; error: ValidationError; command: string }
  | { kind: "not-found"; error: NotFoundError; command: string }
  | { kind: "no-persona"; command: string }
  | { kind: "unexpected"; message: string; command: string }

type FeedbackState = {
  current: EngineFeedback | null
  show: (feedback: EngineFeedback) => void
  clear: () => void
}

export const useEngineFeedback = create<FeedbackState>()((set) => ({
  current: null,
  show: (current) => set({ current }),
  clear: () => set({ current: null }),
}))

export function feedbackFor(error: unknown, command: string): EngineFeedback {
  if (error instanceof ConflictError) return { kind: "conflict", error, command }
  if (error instanceof RuleViolation) return { kind: "rule", error, command }
  if (error instanceof PermissionDenied) return { kind: "denied", error, command }
  if (error instanceof ValidationError) return { kind: "validation", error, command }
  if (error instanceof NotFoundError) return { kind: "not-found", error, command }
  return {
    kind: "unexpected",
    message: error instanceof Error ? error.message : String(error),
    command,
  }
}
