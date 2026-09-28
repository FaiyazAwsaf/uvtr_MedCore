"use client"

import * as React from "react"
import { Ban } from "lucide-react"
import type { z } from "zod"
import { create } from "zustand"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useDb } from "@/core/db/DbProvider"
import { commit, RuleViolation } from "@/core/engine/commit"
import { feedbackFor, useEngineFeedback } from "@/core/engine/feedback"
import type { CommandDef } from "@/core/engine/types"
import { useActor } from "@/core/session/persona"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Lab-specific rule messages. Engine and core codes (PAYMENT_GATE,
 * SIGNED_IMMUTABLE, conflicts, denials) go to the shared engine dialogs; the
 * lab's own codes (LAB_*) are explained from the `lab.rules` namespace here.
 */

type LabRule = {
  code: string
  params: Record<string, string | number>
  audit: boolean
}

type LabFeedbackState = {
  current: LabRule | null
  show: (rule: LabRule) => void
  clear: () => void
}

export const useLabFeedback = create<LabFeedbackState>()((set) => ({
  current: null,
  show: (current) => set({ current }),
  clear: () => set({ current: null }),
}))

export function isLabRule(error: unknown): error is RuleViolation {
  return error instanceof RuleViolation && error.code.startsWith("LAB_")
}

/** The lab rule's message in the window's language, with statuses translated. */
export function useLabRuleMessage() {
  const { tk } = useLocale()
  return React.useCallback(
    (code: string, params: Record<string, string | number>) => {
      const formatted: Record<string, string | number> = { ...params }
      if (typeof params.status === "string") {
        const key = `lab.status.${params.status}`
        const label = tk(key)
        formatted.status = label === key ? params.status : label
      }
      const key = `lab.rules.${code}`
      const message = tk(key, formatted)
      return message === key ? code : message
    },
    [tk]
  )
}

export type LabRunOptions = {
  /** Return true when the screen shows this rule inline itself. */
  onRule?: (error: RuleViolation) => boolean
}

/**
 * Run a command as this window's persona (like `useCommand`), showing lab
 * rule codes with lab messages and everything else with the engine dialogs.
 */
export function useLabCommand<S extends z.ZodType, O>(def: CommandDef<S, O>) {
  const db = useDb()
  const actor = useActor()
  const showEngine = useEngineFeedback((state) => state.show)
  const showLab = useLabFeedback((state) => state.show)
  const [pending, setPending] = React.useState(false)

  const run = React.useCallback(
    async (input: z.input<S>, opts?: LabRunOptions): Promise<O | undefined> => {
      if (!actor) {
        showEngine({ kind: "no-persona", command: def.name })
        return undefined
      }
      setPending(true)
      try {
        return (await commit(def, input, { db, actor })).result
      } catch (caught) {
        if (caught instanceof RuleViolation && opts?.onRule?.(caught))
          return undefined
        if (isLabRule(caught)) {
          showLab({
            code: caught.code,
            params: caught.params,
            audit: caught.audit,
          })
        } else {
          showEngine(feedbackFor(caught, def.name))
        }
        return undefined
      } finally {
        setPending(false)
      }
    },
    [db, actor, def, showEngine, showLab]
  )

  return { run, pending }
}

/** Mounted once per lab and pathology route (their layouts). */
export function LabFeedbackHost() {
  const { t } = useLocale()
  const current = useLabFeedback((state) => state.current)
  const clear = useLabFeedback((state) => state.clear)
  const message = useLabRuleMessage()
  if (!current) return null
  return (
    <Dialog open onOpenChange={(next) => (!next ? clear() : undefined)}>
      <DialogContent className="sm:max-w-md" data-testid="lab-rule-dialog">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--destructive)_16%,transparent)] text-destructive [&_svg]:size-5">
              <Ban />
            </span>
            <DialogTitle>{t("lab.feedback.title")}</DialogTitle>
          </div>
          <DialogDescription className="pt-1 text-sm leading-relaxed text-foreground/90">
            {message(current.code, current.params)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            lang="en"
            className="rounded-sm bg-surface-raised px-2 py-1 font-mono text-[0.6875rem] text-foreground/80"
          >
            {current.code}
          </span>
          {current.audit ? <span>{t("lab.feedback.audited")}</span> : null}
        </div>
        <DialogFooter>
          <Button onClick={clear} autoFocus>
            {t("lab.feedback.ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
