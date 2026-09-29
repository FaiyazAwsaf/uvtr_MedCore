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

export type AppProblem = {
  code: string
  params: Record<string, string | number>
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * `useCommand` for the phone: a business-rule refusal (slot taken, already
 * booked, a payment no longer pending...) comes back as `problem`, shown as
 * text inside the phone next to the action, instead of a dialog over the
 * whole window. Conflicts, denials and unexpected errors still use the shared
 * engine dialogs. A second call while one is running is ignored.
 */
export function useAppCommand<S extends z.ZodType, O>(def: CommandDef<S, O>) {
  const db = useDb()
  const actor = useActor()
  const show = useEngineFeedback((state) => state.show)
  const [pending, setPending] = React.useState(false)
  const [problem, setProblem] = React.useState<AppProblem | null>(null)
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
        if (caught instanceof RuleViolation) {
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

/**
 * The message for a refusal in the window's language: the app's own wording
 * first (`patientApp.rules`), then the owning modules' (`scheduling`, `queue`,
 * `billing`), then the engine's (`rules`), then a generic line naming the code.
 */
export function useProblemText(): (problem: AppProblem) => string {
  const { tk, money, num, dmy, uhid } = useLocale()
  return React.useCallback(
    (problem: AppProblem) => {
      const params: Record<string, string | number> = {}
      for (const [key, value] of Object.entries(problem.params)) {
        if (typeof value === "number")
          params[key] = key.endsWith("P") ? money(value) : num(value)
        else if (key === "uhid") params[key] = uhid(value)
        else if (ISO_DAY.test(value)) params[key] = dmy(value)
        else params[key] = value
      }
      for (const namespace of [
        "patientApp.rules",
        "scheduling.rules",
        "queue.rules",
        "billing.rules",
        "rules",
      ]) {
        const key = `${namespace}.${problem.code}`
        const text = tk(key, params)
        if (text !== key) return text
      }
      return tk("patientApp.rules.unknown", { code: problem.code })
    },
    [tk, money, num, dmy, uhid]
  )
}
