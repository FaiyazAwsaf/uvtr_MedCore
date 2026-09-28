"use client"

import * as React from "react"
import { toast } from "sonner"
import type { z } from "zod"

import { ruleMessage } from "@/components/shared/rule-message"
import { useDb } from "@/core/db/DbProvider"
import { commit } from "@/core/engine/commit"
import { ConflictError, RuleViolation } from "@/core/engine/errors"
import { feedbackFor, useEngineFeedback } from "@/core/engine/feedback"
import type { CommandDef } from "@/core/engine/types"
import { useActor } from "@/core/session/persona"
import { useLocale } from "@/lib/i18n/provider"

/** Namespaces that carry messages for the clinical rule codes. */
const RULE_NAMESPACES = ["consultation", "prescribing", "orders"]

export type CommandOutcome<O> =
  | { ok: true; result: O }
  | { ok: false; error: unknown; conflict: boolean }

/**
 * Runs a clinical command as this window's persona. Rule codes the clinical
 * modules define are shown as a toast in the window's language (they are not
 * in the shared `rules` namespace); everything else (conflicts, denials,
 * shared rules) goes to the engine's standard dialogs.
 */
export function useClinicalCommand<S extends z.ZodType, O>(def: CommandDef<S, O>) {
  const db = useDb()
  const actor = useActor()
  const show = useEngineFeedback((state) => state.show)
  const { t, tk, locale, num, money, dmy, uhid } = useLocale()
  const [pending, setPending] = React.useState(false)

  const messageFor = React.useCallback(
    (error: RuleViolation): string | undefined => {
      const key = RULE_NAMESPACES.map((ns) => `${ns}.rules.${error.code}`).find(
        (candidate) => tk(candidate) !== candidate
      )
      if (!key) return undefined
      return ruleMessage(error.code, error.params, {
        locale,
        tk: (k, params) => (k === `rules.${error.code}` ? tk(key, params) : tk(k, params)),
        num: (value) => num(value),
        money,
        dmy,
        uhid,
      })
    },
    [tk, locale, num, money, dmy, uhid]
  )

  const run = React.useCallback(
    async (input: z.input<S>, opts?: { quiet?: boolean }): Promise<CommandOutcome<O>> => {
      if (!actor) {
        show({ kind: "no-persona", command: def.name })
        return { ok: false, error: null, conflict: false }
      }
      setPending(true)
      try {
        const outcome = await commit(def, input, { db, actor })
        return { ok: true, result: outcome.result }
      } catch (error) {
        const conflict = error instanceof ConflictError
        if (error instanceof RuleViolation) {
          const message = messageFor(error)
          if (message) {
            if (!opts?.quiet) {
              toast.error(message, {
                description: error.audit ? t("shell.feedback.audited") : undefined,
              })
            }
            return { ok: false, error, conflict }
          }
        }
        if (!opts?.quiet) show(feedbackFor(error, def.name))
        return { ok: false, error, conflict }
      } finally {
        setPending(false)
      }
    },
    [actor, db, def, messageFor, show, t]
  )

  return { run, pending }
}
