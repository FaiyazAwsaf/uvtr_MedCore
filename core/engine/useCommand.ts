"use client"

import * as React from "react"
import type { z } from "zod"

import { useDb } from "@/core/db/DbProvider"
import { useActor } from "@/core/session/persona"

import { commit } from "./commit"
import { feedbackFor, useEngineFeedback } from "./feedback"
import type { CommandDef } from "./types"

/**
 * Run a command as this window's persona against this window's database.
 * Failures are shown through the engine feedback dialogs unless `silent`.
 *
 *   const sign = useCommand(signRx)
 *   const result = await sign.run({ rxId, expectedVersion: rx.version })
 *   if (result) ... // undefined when it failed
 */
export function useCommand<S extends z.ZodType, O>(def: CommandDef<S, O>) {
  const db = useDb()
  const actor = useActor()
  const show = useEngineFeedback((state) => state.show)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  const run = React.useCallback(
    async (input: z.input<S>, opts?: { silent?: boolean }): Promise<O | undefined> => {
      if (!actor) {
        show({ kind: "no-persona", command: def.name })
        return undefined
      }
      setPending(true)
      setError(null)
      try {
        return (await commit(def, input, { db, actor })).result
      } catch (caught) {
        setError(caught)
        if (!opts?.silent) show(feedbackFor(caught, def.name))
        return undefined
      } finally {
        setPending(false)
      }
    },
    [db, actor, def, show]
  )

  return { run, pending, error }
}
