"use client"

import * as React from "react"
import type { z } from "zod"

import { useDb } from "@/core/db/DbProvider"
import { commit } from "@/core/engine/commit"
import { ConflictError } from "@/core/engine/errors"
import { feedbackFor, useEngineFeedback } from "@/core/engine/feedback"
import type { CommandDef } from "@/core/engine/types"
import { useActor } from "@/core/session/persona"

export type CommandOutcome<O> =
  { ok: true; result: O } | { ok: false; error: unknown; conflict: boolean }

/**
 * Runs a clinical command as this window's persona and reports the outcome,
 * so a screen can react (close a form, resync after a conflict). Failures go
 * to the engine's standard dialogs: the shared rule message resolves the
 * clinical modules' own codes (`consultation.rules.*`, `prescribing.rules.*`,
 * `orders.rules.*`). `quiet` skips the dialog (background autosave).
 */
export function useClinicalCommand<S extends z.ZodType, O>(
  def: CommandDef<S, O>
) {
  const db = useDb()
  const actor = useActor()
  const show = useEngineFeedback((state) => state.show)
  const [pending, setPending] = React.useState(false)

  const run = React.useCallback(
    async (
      input: z.input<S>,
      opts?: { quiet?: boolean }
    ): Promise<CommandOutcome<O>> => {
      if (!actor) {
        show({ kind: "no-persona", command: def.name })
        return { ok: false, error: null, conflict: false }
      }
      setPending(true)
      try {
        const outcome = await commit(def, input, { db, actor })
        return { ok: true, result: outcome.result }
      } catch (error) {
        if (!opts?.quiet) show(feedbackFor(error, def.name))
        return { ok: false, error, conflict: error instanceof ConflictError }
      } finally {
        setPending(false)
      }
    },
    [actor, db, def, show]
  )

  return { run, pending }
}
