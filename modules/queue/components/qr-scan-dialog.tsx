"use client"

import * as React from "react"
import { QrCode as QrIcon, ScanLine, Ticket } from "lucide-react"

import { nameIn } from "@/components/shared/person"
import { QrCode } from "@/components/shared/qr-code"
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
import { atDhaka } from "@/core/clock/dates"
import type { AppointmentRow, PatientRow } from "@/core/db/schema"
import type { RuleViolation } from "@/core/engine/errors"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { useDeskCommand } from "@/modules/identity/components/desk-command"
import { RuleAlert } from "@/modules/identity/components/desk-ui"
import type { SessionInfo } from "@/modules/scheduling/components/use-session-info"

import { checkIn } from "../commands"
import { findByQr } from "../qr"

type Scanned = { label: string; appointmentId: string; sessionId: string; tokenId: string }

/**
 * QR check-in (plan §9, simulated): a scan is simulated by picking one of
 * today's booked slips, or by typing or pasting the code. The match is made
 * against today's appointments at this branch, then `queue.checkIn` runs with
 * method "qr".
 */
export function QrScanDialog({
  open,
  onOpenChange,
  appointments,
  patients,
  sessions,
  onCheckedIn,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Today's appointments at this branch */
  appointments: AppointmentRow[]
  patients: Map<string, PatientRow>
  sessions: Map<string, SessionInfo>
  onCheckedIn: (scanned: Scanned) => void
}) {
  const { t } = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="qr-dialog" className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrIcon className="size-5 text-link" />
            {t("queue.qr.title")}
            <SimulatedBadge />
          </DialogTitle>
          <DialogDescription>{t("queue.qr.subtitle")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <QrScanner
            appointments={appointments}
            patients={patients}
            sessions={sessions}
            onClose={() => onOpenChange(false)}
            onCheckedIn={onCheckedIn}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function QrScanner({
  appointments,
  patients,
  sessions,
  onClose,
  onCheckedIn,
}: {
  appointments: AppointmentRow[]
  patients: Map<string, PatientRow>
  sessions: Map<string, SessionInfo>
  onClose: () => void
  onCheckedIn: (scanned: Scanned) => void
}) {
  const { t, locale, time } = useLocale()
  const command = useDeskCommand(checkIn)
  const [code, setCode] = React.useState("")
  const [problem, setProblem] = React.useState<string | null>(null)
  const [rule, setRule] = React.useState<RuleViolation | null>(null)
  const [scanned, setScanned] = React.useState<Scanned | null>(null)
  const booked = React.useMemo(
    () =>
      appointments
        .filter((a) => a.status === "booked")
        .sort((a, b) => a.slotStart.localeCompare(b.slotStart)),
    [appointments]
  )

  const scan = async (raw: string) => {
    setProblem(null)
    setRule(null)
    const value = raw.trim()
    if (!value) return
    const appointment = findByQr(appointments, value)
    if (!appointment) {
      setProblem(t("queue.qr.notFound"))
      return
    }
    if (appointment.status !== "booked") {
      setProblem(t("queue.qr.alreadyIn"))
      return
    }
    const outcome = await command.run({ appointmentId: appointment.id, method: "qr" })
    if (outcome.ok) {
      const next = {
        label: outcome.result.label,
        appointmentId: appointment.id,
        sessionId: appointment.sessionId,
        tokenId: outcome.result.tokenId,
      }
      setScanned(next)
      onCheckedIn(next)
    } else if (outcome.rule) {
      setRule(outcome.rule)
    }
  }

  if (scanned) {
    const appointment = appointments.find((a) => a.id === scanned.appointmentId)
    const patient = appointment ? patients.get(appointment.patientId) : undefined
    return (
      <div data-testid="qr-success" className="flex flex-col items-center gap-2 py-2 text-center">
        <span className="icon-well flex size-12 items-center justify-center text-link">
          <Ticket className="size-6" />
        </span>
        <p className="text-sm text-muted-foreground">
          {t("queue.qr.checkedIn", { name: patient ? nameIn(patient, locale) : "" })}
        </p>
        <p lang="en" className="font-mono text-5xl font-bold text-link">
          {scanned.label}
        </p>
        <DialogFooter className="w-full pt-3">
          <Button variant="neutral" onClick={() => setScanned(null)}>
            <ScanLine />
            {t("queue.qr.scanAnother")}
          </Button>
          <Button onClick={onClose}>{t("common.done")}</Button>
        </DialogFooter>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative flex h-24 items-center justify-center overflow-hidden rounded-lg border border-dashed border-primary/60 bg-surface-raised/60">
        <span className="absolute inset-x-6 top-1/2 h-0.5 animate-pulse rounded-full bg-primary/80 shadow-[0_0_12px_var(--primary)]" />
        <span className="relative text-xs text-muted-foreground">{t("queue.qr.viewfinder")}</span>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void scan(code)
        }}
      >
        <Input
          data-testid="qr-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("queue.qr.placeholder")}
          aria-label={t("queue.qr.placeholder")}
          className="font-mono"
          autoComplete="off"
        />
        <Button data-testid="qr-submit" type="submit" disabled={!code.trim() || command.pending}>
          {t("queue.actions.checkIn")}
        </Button>
      </form>

      {problem ? (
        <p role="alert" className="text-[0.8125rem] text-destructive">
          {problem}
        </p>
      ) : null}
      {rule ? <RuleAlert rule={rule} /> : null}

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">{t("queue.qr.pickHint")}</p>
        {booked.length ? (
          <ul className="grid max-h-60 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {booked.map((appointment) => {
              const patient = patients.get(appointment.patientId)
              const info = sessions.get(appointment.sessionId)
              return (
                <li key={appointment.id}>
                  <button
                    type="button"
                    data-testid="qr-slip"
                    data-appointment-id={appointment.id}
                    disabled={command.pending}
                    onClick={() => {
                      setCode(appointment.qrCode)
                      void scan(appointment.qrCode)
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md border border-border/70 p-2 text-left transition-colors hover:border-primary hover:bg-primary-soft"
                    )}
                  >
                    <QrCode value={appointment.qrCode} size={40} className="p-1" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[0.8125rem] font-medium">
                        {patient ? nameIn(patient, locale) : ""}
                      </span>
                      <span className="nums truncate text-xs text-muted-foreground">
                        {time(atDhaka(appointment.date, appointment.slotStart))}
                        {info?.session ? ` · ${info.session.tokenPrefix}` : ""}
                        {info?.room ? ` · ${info.room.name[locale]}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t("queue.arrivals.empty")}</p>
        )}
      </div>
    </div>
  )
}
