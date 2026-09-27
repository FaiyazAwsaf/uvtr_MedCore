"use client"

import * as React from "react"
import { Check, KeyRound, ShieldCheck } from "lucide-react"

import { approversFor } from "@/components/shared/authority"
import { PersonaAvatar } from "@/components/shared/avatars"
import { SimulatedBadge } from "@/components/shared/simulated-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { branches, headquarters } from "@/config/brand.config"
import { rules } from "@/config/rules.config"
import { useActor } from "@/core/session/persona"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

/** What an approved override resolves with (record it on the approval row). */
export type SupervisorApproval = {
  /** The approver's staff id (for `approvals.approverId` / `auditContext`) */
  approverStaffId: string
  approverPersonaId: string
  approverName: string
  authority: string
  reason: string
  pinVerified: true
}

export type SupervisorOverrideDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Authority the step needs, e.g. "approve:variance" or "discount:15" */
  authority: string
  title?: React.ReactNode
  /** What is being approved (amount, patient, line) */
  description?: React.ReactNode
  /** Ask for a reason (default true) */
  requireReason?: boolean
  onApproved: (approval: SupervisorApproval) => void
}

/**
 * Inline, POS-style supervisor override (plan §3.10): pick an approver whose
 * staff record holds the needed authority, the approver enters their PIN on
 * this device (simulated, rules.simulated.supervisorPin), and the dialog
 * resolves with the approver's staff id. No window switch is needed.
 */
export function SupervisorOverrideDialog({
  open,
  onOpenChange,
  authority,
  title,
  description,
  requireReason = true,
  onApproved,
}: SupervisorOverrideDialogProps) {
  const { t, locale } = useLocale()
  const actor = useActor()
  const candidates = React.useMemo(
    () =>
      approversFor(authority, {
        excludeStaffId: actor?.staffId,
        branchId: actor?.branchId,
      }),
    [authority, actor?.staffId, actor?.branchId]
  )
  const [approverId, setApproverId] = React.useState<string | null>(null)
  const [pin, setPin] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [wrongPin, setWrongPin] = React.useState(false)

  const selected =
    candidates.find((persona) => persona.id === approverId) ?? candidates[0]
  const canApprove =
    !!selected && pin.length === 4 && (!requireReason || reason.trim().length > 0)

  const reset = () => {
    setApproverId(null)
    setPin("")
    setReason("")
    setWrongPin(false)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected?.staff || !canApprove) return
    if (pin !== rules.simulated.supervisorPin) {
      setWrongPin(true)
      setPin("")
      return
    }
    onApproved({
      approverStaffId: selected.staff.id,
      approverPersonaId: selected.id,
      approverName: selected.staff.nameEn,
      authority,
      reason: reason.trim(),
      pinVerified: true,
    })
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span className="icon-well flex size-10 shrink-0 items-center justify-center text-link">
                <ShieldCheck className="size-5" />
              </span>
              <DialogTitle>{title ?? t("common.override.title")}</DialogTitle>
            </div>
            <DialogDescription>
              {t("common.override.body", { authority })}
            </DialogDescription>
          </DialogHeader>
          {description ? (
            <div className="-mt-1 rounded-md bg-surface-raised px-3 py-2 text-[0.8125rem] text-foreground">
              {description}
            </div>
          ) : null}

          {candidates.length === 0 ? (
            <p className="rounded-md bg-surface-raised px-4 py-3 text-[0.8125rem] text-muted-foreground">
              {t("common.override.noApprover", { authority })}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t("common.override.approver")}</Label>
                <div
                  role="radiogroup"
                  aria-label={t("common.override.approver")}
                  className="flex flex-col gap-1.5"
                >
                  {candidates.map((persona) => {
                    const active = persona.id === selected?.id
                    const branch = persona.branchId
                      ? branches.find((b) => b.code === persona.branchId)?.name[locale]
                      : headquarters.name[locale]
                    return (
                      <button
                        key={persona.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setApproverId(persona.id)
                          setWrongPin(false)
                        }}
                        className={cn(
                          "flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                          active
                            ? "border-primary bg-primary-soft"
                            : "border-border hover:bg-surface-raised"
                        )}
                      >
                        <PersonaAvatar persona={persona} size={34} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {locale === "bn"
                              ? persona.staff?.nameBn
                              : persona.staff?.nameEn}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {persona.staff?.designation[locale]} · {branch}
                          </span>
                        </span>
                        {active ? <Check className="size-4 text-primary" /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              {requireReason ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="override-reason">{t("common.override.reason")}</Label>
                  <Textarea
                    id="override-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={t("common.override.reasonPlaceholder")}
                    className="min-h-16"
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="override-pin">{t("common.override.pin")}</Label>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t("common.override.pinHint", { pin: rules.simulated.supervisorPin })}
                    <SimulatedBadge />
                  </span>
                </div>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="override-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={4}
                    value={pin}
                    aria-invalid={wrongPin}
                    onChange={(event) => {
                      setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
                      setWrongPin(false)
                    }}
                    className="pl-9 font-mono tracking-[0.5em]"
                  />
                </div>
                {wrongPin ? (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {t("common.override.wrongPin")}
                  </p>
                ) : null}
              </div>
            </>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="neutral"
              onClick={() => {
                reset()
                onOpenChange(false)
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canApprove}>
              <ShieldCheck />
              {t("common.override.approve")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type OverrideRequest = Omit<
  SupervisorOverrideDialogProps,
  "open" | "onOpenChange" | "onApproved"
>

/**
 * Promise style: `const override = useSupervisorOverride()`, render
 * `{override.dialog}`, then `const approval = await override.request({ authority })`.
 * Resolves with the approval, or null when cancelled.
 */
export function useSupervisorOverride(): {
  request: (options: OverrideRequest) => Promise<SupervisorApproval | null>
  dialog: React.ReactNode
} {
  const [current, setCurrent] = React.useState<OverrideRequest | null>(null)
  const resolver = React.useRef<((value: SupervisorApproval | null) => void) | null>(
    null
  )

  const request = React.useCallback((options: OverrideRequest) => {
    resolver.current?.(null)
    setCurrent(options)
    return new Promise<SupervisorApproval | null>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const dialog = current ? (
    <SupervisorOverrideDialog
      {...current}
      open
      onOpenChange={(open) => {
        if (!open) {
          resolver.current?.(null)
          resolver.current = null
          setCurrent(null)
        }
      }}
      onApproved={(approval) => {
        resolver.current?.(approval)
        resolver.current = null
        setCurrent(null)
      }}
    />
  ) : null

  return { request, dialog }
}
