"use client"

import * as React from "react"
import type { z } from "zod"

import { ruleMessage } from "@/components/shared/rule-message"
import { useDb } from "@/core/db/DbProvider"
import { commit } from "@/core/engine/commit"
import { ConflictError, RuleViolation } from "@/core/engine/errors"
import { feedbackFor, useEngineFeedback } from "@/core/engine/feedback"
import type { CommandDef } from "@/core/engine/types"
import { useActor } from "@/core/session/persona"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Front desk command runner. Like `useCommand`, but a refused rule comes back
 * to the screen so it can be shown next to the form or row it concerns (with
 * the front desk's own wording); conflicts, denials and anything unexpected
 * still go to the engine's dialogs.
 */
export type DeskOutcome<O> =
  | { ok: true; result: O }
  | { ok: false; rule?: RuleViolation; conflict?: ConflictError }

export function useDeskCommand<S extends z.ZodType, O>(def: CommandDef<S, O>) {
  const db = useDb()
  const actor = useActor()
  const show = useEngineFeedback((state) => state.show)
  const [pending, setPending] = React.useState(false)

  const run = React.useCallback(
    async (input: z.input<S>): Promise<DeskOutcome<O>> => {
      if (!actor) {
        show({ kind: "no-persona", command: def.name })
        return { ok: false }
      }
      setPending(true)
      try {
        const { result } = await commit(def, input, { db, actor })
        return { ok: true, result }
      } catch (error) {
        if (error instanceof RuleViolation) return { ok: false, rule: error }
        show(feedbackFor(error, def.name))
        // The conflict dialog explains it; the screen may also reload its form.
        if (error instanceof ConflictError) return { ok: false, conflict: error }
        return { ok: false }
      } finally {
        setPending(false)
      }
    },
    [db, actor, def, show]
  )

  return { run, pending }
}

const NAMESPACES = ["identity", "scheduling", "queue"] as const

/**
 * The message for a refused rule: the front desk modules' own `<module>.rules.<CODE>`
 * first, then the engine's shared `rules.<CODE>`, with params formatted for
 * the window's language (UHIDs grouped, dates as DD-MM-YYYY).
 */
export function useRuleText() {
  const { tk, num, money, dmy, uhid, locale } = useLocale()
  return React.useCallback(
    (rule: { code: string; params?: Record<string, string | number> }) => {
      const lookup = (key: string, params?: Record<string, string | number>) => {
        if (key.startsWith("rules.")) {
          const code = key.slice("rules.".length)
          for (const namespace of NAMESPACES) {
            const own = `${namespace}.rules.${code}`
            const text = tk(own, params)
            if (text !== own) return text
          }
        }
        return tk(key, params)
      }
      return ruleMessage(rule.code, rule.params ?? {}, {
        locale,
        tk: lookup,
        num: (value) => num(value),
        money,
        dmy,
        uhid,
      })
    },
    [tk, num, money, dmy, uhid, locale]
  )
}
