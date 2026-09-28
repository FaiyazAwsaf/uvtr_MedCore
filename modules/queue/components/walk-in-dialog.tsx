"use client"

import * as React from "react"
import { toast } from "sonner"
import { Footprints, Printer, Ticket, UserPlus } from "lucide-react"

import { IdentityBanner } from "@/components/shared/identity-banner"
import { PatientPicker } from "@/components/shared/patient-picker"
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
import { atDhaka } from "@/core/clock/dates"
import type { AppointmentRow, VisitType } from "@/core/db/schema"
import type { RuleViolation } from "@/core/engine/errors"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { useDeskCommand } from "@/modules/identity/components/desk-command"
import { ChoicePills, RuleAlert } from "@/modules/identity/components/desk-ui"
import { RegisterSheet } from "@/modules/identity/components/register-sheet"
import type { SessionInfo } from "@/modules/scheduling/components/use-session-info"
import { isSessionBookable, isSessionOver, sessionLoad } from "@/modules/scheduling/slots"

import { walkIn } from "../commands"

type Issued = { label: string; position: number; tokenId: string; sessionId: string }

/**
 * A walk-in in one flow (plan §9 `/reception/queue`): find the patient (or
 * register them), pick today's session with walk-in places left, and issue
 * the token. Booking (source walk-in) and check-in are one commit.
 */
export function WalkInDialog({
  open,
  onOpenChange,
  sessions,
  appointments,
  nowMs,
  defaultSessionId,
  initialPatientId,
  onIssued,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Today's sessions at this branch */
  sessions: SessionInfo[]
  /** Today's appointments at this branch (for places left) */
  appointments: AppointmentRow[]
  nowMs: number
  defaultSessionId: string | null
  initialPatientId?: string | null
  onIssued: (issued: Issued) => void
}) {
  const { t } = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="walkin-dialog" className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Footprints className="size-5 text-link" />
            {t("queue.walkIn.title")}
          </DialogTitle>
          <DialogDescription>{t("queue.walkIn.subtitle")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <WalkInForm
            sessions={sessions}
            appointments={appointments}
            nowMs={nowMs}
            defaultSessionId={defaultSessionId}
            initialPatientId={initialPatientId ?? null}
            onClose={() => onOpenChange(false)}
            onIssued={onIssued}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function WalkInForm({
  sessions,
  appointments,
  nowMs,
  defaultSessionId,
  initialPatientId,
  onClose,
  onIssued,
}: {
  sessions: SessionInfo[]
  appointments: AppointmentRow[]
  nowMs: number
  defaultSessionId: string | null
  initialPatientId: string | null
  onClose: () => void
  onIssued: (issued: Issued) => void
}) {
  const { t, locale, num, time } = useLocale()
  const command = useDeskCommand(walkIn)
  const [patientId, setPatientId] = React.useState<string | null>(initialPatientId)
  const [registerOpen, setRegisterOpen] = React.useState(false)
  const [visitType, setVisitType] = React.useState<VisitType>("first")
  const [rule, setRule] = React.useState<RuleViolation | null>(null)
  const [issued, setIssued] = React.useState<Issued | null>(null)

  const options = React.useMemo(
    () =>
      sessions
        .filter((s) => isSessionBookable(s.session) && !isSessionOver(s.session, nowMs))
        .map((s) => ({
          ...s,
          load: sessionLoad(
            s.session,
            appointments.filter((a) => a.sessionId === s.session.id)
          ),
        }))
        .sort((a, b) => a.session.start.localeCompare(b.session.start)),
    [sessions, appointments, nowMs]
  )
  const [sessionId, setSessionId] = React.useState<string | null>(() => {
    const preferred = options.find((o) => o.session.id === defaultSessionId && o.load.walkInLeft > 0)
    return (preferred ?? options.find((o) => o.load.walkInLeft > 0))?.session.id ?? null
  })

  const onIssue = async () => {
    if (!patientId || !sessionId) return
    setRule(null)
    const outcome = await command.run({ sessionId, patientId, visitType })
    if (outcome.ok) {
      const next = {
        label: outcome.result.label,
        position: outcome.result.position,
        tokenId: outcome.result.tokenId,
        sessionId,
      }
      setIssued(next)
      onIssued(next)
    } else if (outcome.rule) {
      setRule(outcome.rule)
    }
  }

  if (issued) {
    return (
      <div data-testid="walkin-success" className="flex flex-col items-center gap-3 py-2 text-center">
        <span className="icon-well flex size-12 items-center justify-center text-link">
          <Ticket className="size-6" />
        </span>
        <p className="text-sm text-muted-foreground">{t("queue.walkIn.issued")}</p>
        <p data-testid="walkin-token" lang="en" className="font-mono text-5xl font-bold text-link">
          {issued.label}
        </p>
        <p className="nums text-sm">{t("queue.walkIn.position", { position: num(issued.position) })}</p>
        <DialogFooter className="w-full pt-2">
          <Button
            variant="neutral"
            onClick={() => toast.success(t("queue.walkIn.printed", { token: issued.label }))}
          >
            <Printer />
            {t("queue.walkIn.print")}
            <SimulatedBadge className="h-5" />
          </Button>
          <Button onClick={onClose}>{t("common.done")}</Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-[0.8125rem] font-medium">{t("queue.walkIn.patient")}</p>
        {patientId ? (
          <IdentityBanner
            patientId={patientId}
            compact
            actions={
              <Button variant="link" size="sm" onClick={() => setPatientId(null)}>
                {t("queue.walkIn.change")}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            <PatientPicker autoFocus onSelect={(patient) => setPatientId(patient.id)} />
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              data-testid="walkin-register"
              onClick={() => setRegisterOpen(true)}
            >
              <UserPlus />
              {t("identity.desk.registerNew")}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[0.8125rem] font-medium">{t("queue.walkIn.session")}</p>
        {options.length ? (
          <div role="radiogroup" className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {options.map(({ session, staff, room, specialty, load }) => {
              const full = load.walkInLeft <= 0
              const active = session.id === sessionId
              return (
                <button
                  key={session.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid="walkin-session"
                  data-session-id={session.id}
                  disabled={full}
                  onClick={() => setSessionId(session.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    active ? "border-primary bg-primary-soft" : "border-border/70 hover:bg-surface-raised"
                  )}
                >
                  <span lang="en" className="w-9 shrink-0 font-mono text-sm font-semibold text-link">
                    {session.tokenPrefix}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[0.8125rem] font-medium">
                      {staff ? (locale === "bn" ? staff.nameBn : staff.nameEn) : ""}
                    </span>
                    <span className="nums truncate text-xs text-muted-foreground">
                      {[specialty?.name[locale], room?.name[locale]].filter(Boolean).join(" · ")} ·{" "}
                      {time(atDhaka(session.date, session.start))} - {time(atDhaka(session.date, session.end))}
                    </span>
                  </span>
                  <span className={cn("nums shrink-0 text-xs", full ? "text-destructive" : "text-muted-foreground")}>
                    {full
                      ? t("queue.walkIn.full")
                      : t("scheduling.sessions.walkIns", { left: num(load.walkInLeft) })}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t("queue.walkIn.noSession")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">{t("scheduling.book.visitType")}</span>
        <ChoicePills
          name="walkin-visit"
          value={visitType}
          onChange={setVisitType}
          options={(["first", "follow-up", "report"] as const).map((v) => ({
            value: v,
            label: t(`scheduling.visitTypes.${v}`),
          }))}
        />
      </div>

      {rule ? <RuleAlert rule={rule} /> : null}

      <DialogFooter>
        <Button variant="neutral" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          data-testid="walkin-confirm"
          disabled={!patientId || !sessionId || command.pending}
          onClick={onIssue}
        >
          <Ticket />
          {t("queue.walkIn.issue")}
        </Button>
      </DialogFooter>

      <RegisterSheet
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        onDone={(id) => setPatientId(id)}
      />
    </div>
  )
}
