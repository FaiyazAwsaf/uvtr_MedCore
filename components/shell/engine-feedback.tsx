"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  ConflictDialog,
  DeniedDialog,
  NoPersonaDialog,
  RuleViolationDialog,
} from "@/components/shared/engine-dialogs"
import { useEngineFeedback } from "@/core/engine/feedback"
import { useLocale } from "@/lib/i18n/provider"

/**
 * Renders the engine's user-facing outcome for a failed command
 * (`useEngineFeedback().current`, plan §3.3): conflicts, rule violations,
 * denials and a missing persona as dialogs; validation, not-found and
 * unexpected errors as toasts. Mounted ONCE per window, inside the engine
 * (components/providers.tsx), so the launcher, the Demo Wall and the demo
 * panel get it too.
 */
export function EngineFeedbackHost() {
  const { t } = useLocale()
  const current = useEngineFeedback((state) => state.current)
  const clear = useEngineFeedback((state) => state.clear)

  React.useEffect(() => {
    if (!current) return
    let message: string | null = null
    if (current.kind === "validation") {
      const detail = current.error.issues
        .slice(0, 2)
        .map((issue) =>
          issue.path ? `${issue.path}: ${issue.message}` : issue.message
        )
        .join("; ")
      message = t("shell.feedback.validation", { detail })
    } else if (current.kind === "not-found") {
      message = t("shell.feedback.notFound")
    } else if (current.kind === "unexpected") {
      message = t("shell.feedback.unexpected", { message: current.message })
    }
    if (message) {
      toast.error(message, { id: `engine:${current.command}` })
      clear()
    }
  }, [current, clear, t])

  if (!current) return null
  switch (current.kind) {
    case "conflict":
      return <ConflictDialog open conflict={current.error} onReload={clear} />
    case "rule":
      return (
        <RuleViolationDialog
          open
          violation={current.error}
          command={current.command}
          onClose={clear}
        />
      )
    case "denied":
      return (
        <DeniedDialog
          open
          // The engine's PermissionDenied carries the command's allowed roles.
          roles={current.error.roles}
          actorRole={current.error.role}
          onClose={clear}
        />
      )
    case "no-persona":
      return <NoPersonaDialog open onClose={clear} />
    default:
      return null
  }
}
