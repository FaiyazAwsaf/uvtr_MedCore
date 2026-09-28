"use client"

import * as React from "react"
import type { z } from "zod"

import { useDb } from "@/core/db/DbProvider"
import { commit } from "@/core/engine/commit"
import { RuleViolation } from "@/core/engine/errors"
import { feedbackFor, useEngineFeedback } from "@/core/engine/feedback"
import type { CommandDef } from "@/core/engine/types"
import { useActor } from "@/core/session/persona"
import { useLocale } from "@/lib/i18n/provider"

import { billingEn } from "../i18n/en"

/** Rule codes this module explains itself (`billing.rules.<CODE>`). */
const BILLING_RULES = new Set(Object.keys(billingEn.billing.rules))

export type BillingProblem = { code: string; params: Record<string, string | number> }

/**
 * `useCommand` for billing screens: the same commit, but a refusal with a
 * billing rule code comes back as an inline message next to the action
 * (for example "the payments add up to X but Y is due"), while conflicts,
 * denials and engine rules still open the shared engine dialogs. A second
 * call while one is running is ignored (the idempotency key covers the rest).
 */
export function useBillingCommand<S extends z.ZodType, O>(def: CommandDef<S, O>) {
  const db = useDb()
  const actor = useActor()
  const show = useEngineFeedback((state) => state.show)
  const [pending, setPending] = React.useState(false)
  const [problem, setProblem] = React.useState<BillingProblem | null>(null)
  const inFlight = React.useRef(false)

  const run = React.useCallback(
    async (input: z.input<S>): Promise<O | undefined> => {
      if (!actor) {
        show({ kind: "no-persona", command: def.name })
        return undefined
      }
      if (inFlight.current) return undefined
      inFlight.current = true
      setPending(true)
      setProblem(null)
      try {
        return (await commit(def, input, { db, actor })).result
      } catch (caught) {
        if (caught instanceof RuleViolation && BILLING_RULES.has(caught.code)) {
          setProblem({ code: caught.code, params: caught.params })
        } else {
          show(feedbackFor(caught, def.name))
        }
        return undefined
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [db, actor, def, show]
  )

  const clearProblem = React.useCallback(() => setProblem(null), [])
  return { run, pending, problem, clearProblem }
}

/** The message for a billing rule code, with money and numbers in the window's language. */
export function useProblemText(): (problem: BillingProblem) => string {
  const { tk, money, num } = useLocale()
  return React.useCallback(
    (problem: BillingProblem) => {
      const params: Record<string, string | number> = {}
      for (const [key, value] of Object.entries(problem.params)) {
        if (key === "rule") continue
        params[key] =
          typeof value === "number" ? (key.endsWith("P") ? money(value) : num(value)) : value
      }
      return tk(`billing.rules.${problem.code}`, params)
    },
    [tk, money, num]
  )
}
