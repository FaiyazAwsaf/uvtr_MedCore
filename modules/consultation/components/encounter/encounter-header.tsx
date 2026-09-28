"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  DoorOpen,
  LogOut,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"

import { IdentityBanner } from "@/components/shared/identity-banner"
import { nameIn } from "@/components/shared/person"
import { ReportSafetyConcernButton } from "@/components/shared/report-safety-concern"
import { StatusPill } from "@/components/shared/status"
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
import type { NoteRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { finishConsultation, startConsultation } from "../../commands"
import type { EncounterCore } from "../data"
import { useClinicalCommand } from "../use-clinical-command"

export function scrollToSection(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" })
}

/**
 * The encounter's identity strip (HAZ-01) with the visit context, the safety
 * concern button and "Finish consultation". Finishing needs a signed note
 * and no prescription left as a draft; otherwise a checklist explains why.
 */
export function EncounterHeader({
  core,
  latestNote,
}: {
  core: EncounterCore
  latestNote: NoteRow | undefined
}) {
  const { t, tk, time, locale } = useLocale()
  const router = useRouter()
  const db = useDb()
  const finish = useClinicalCommand(finishConsultation)
  const reopen = useClinicalCommand(startConsultation)
  const [checkOpen, setCheckOpen] = React.useState(false)
  const { encounter, patient, appointment, token } = core
  const closed = encounter.status === "closed"

  const state = useLiveQuery(async () => {
    const rxs = await db.prescriptions
      .where("encounterId")
      .equals(encounter.id)
      .toArray()
    let draftOpen = false
    for (const rx of rxs.filter((r) => r.status === "draft")) {
      const lines = await db.rxLines.where("rxId").equals(rx.id).toArray()
      if (lines.some((l) => l.status !== "cancelled")) draftOpen = true
    }
    const labOrders = await db.labOrders
      .where("encounterId")
      .equals(encounter.id)
      .toArray()
    const items = labOrders.length
      ? await db.labOrderItems
          .where("labOrderId")
          .anyOf(labOrders.map((o) => o.id))
          .count()
      : 0
    const imaging = await db.imagingOrders
      .where("encounterId")
      .equals(encounter.id)
      .count()
    return { draftOpen, orders: items + imaging }
  }, [db, encounter.id])

  const noteSigned = !!latestNote && latestNote.status !== "draft"
  const ready = noteSigned && !state?.draftOpen

  const doFinish = async () => {
    const out = await finish.run({ encounterId: encounter.id })
    if (out.ok) {
      toast.success(
        t("consultation.encounter.finished", { name: nameIn(patient, locale) })
      )
      setCheckOpen(false)
      router.push("/doctor")
    }
  }
  const onFinish = () => (ready ? void doFinish() : setCheckOpen(true))
  const onReopen = async () => {
    if (!appointment) return
    const out = await reopen.run({ appointmentId: appointment.id })
    if (out.ok) toast.success(t("consultation.encounter.reopened"))
  }

  const statusTone =
    encounter.status === "closed"
      ? "success"
      : encounter.status === "signed"
        ? "info"
        : "warning"

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted-foreground">
        <Link
          href="/doctor"
          className="inline-flex items-center gap-1 text-link underline-offset-4 hover:underline"
          data-testid="encounter-back"
        >
          <ArrowLeft className="size-4" />
          {t("consultation.encounter.backToWorklist")}
        </Link>
        <span aria-hidden className="text-border">
          |
        </span>
        {token ? (
          <span className="font-mono font-semibold text-foreground" lang="en">
            {t("consultation.encounter.tokenLine", { token: token.label })}
          </span>
        ) : null}
        {appointment ? (
          <span>{tk(`consultation.visitType.${appointment.visitType}`)}</span>
        ) : null}
        <span>
          {t("consultation.encounter.startedAt", {
            time: time(encounter.startedAt),
          })}
        </span>
        <StatusPill
          tone={statusTone}
          dot
          data-testid="encounter-status"
          data-status={encounter.status}
        >
          {tk(`consultation.encounter.status.${encounter.status}`)}
        </StatusPill>
      </div>
      <IdentityBanner
        patient={patient}
        actions={
          <>
            <ReportSafetyConcernButton
              iconOnly
              context={t("consultation.encounter.safetyContext", {
                token: token?.label ?? "",
              })}
            />
            {closed ? (
              appointment ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onReopen}
                  disabled={reopen.pending}
                  data-testid="consult-reopen"
                >
                  <RotateCcw />
                  {t("consultation.encounter.reopen")}
                </Button>
              ) : null
            ) : (
              <Button
                size="sm"
                onClick={onFinish}
                disabled={finish.pending}
                data-testid="consult-finish"
              >
                <LogOut />
                {t("consultation.encounter.finish")}
              </Button>
            )}
          </>
        }
      />
      {closed && encounter.endedAt ? (
        <div className="flex items-center gap-2 rounded-md bg-surface-raised px-3 py-2 text-[0.8125rem] text-muted-foreground">
          <DoorOpen className="size-4" />
          {t("consultation.encounter.closedBanner", {
            time: time(encounter.endedAt),
          })}
        </div>
      ) : null}

      <Dialog open={checkOpen} onOpenChange={setCheckOpen}>
        <DialogContent className="sm:max-w-md" data-testid="finish-dialog">
          <DialogHeader>
            <DialogTitle>{t("consultation.encounter.finishTitle")}</DialogTitle>
            <DialogDescription>
              {t("consultation.encounter.finishBody")}
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2 text-[0.8125rem]">
            <Check
              ok={noteSigned}
              label={t("consultation.encounter.checks.noteSigned")}
            />
            <Check
              ok={!state?.draftOpen}
              label={t("consultation.encounter.checks.rxSigned")}
            />
            <Check
              ok
              neutral
              label={t("consultation.encounter.checks.ordersPlaced", {
                count: state?.orders ?? 0,
              })}
            />
          </ul>
          <DialogFooter>
            {!noteSigned ? (
              <Button
                variant="neutral"
                onClick={() => {
                  setCheckOpen(false)
                  scrollToSection("enc-note")
                }}
              >
                {t("consultation.encounter.goToNote")}
              </Button>
            ) : null}
            {state?.draftOpen ? (
              <Button
                variant="neutral"
                onClick={() => {
                  setCheckOpen(false)
                  scrollToSection("enc-rx")
                }}
              >
                {t("consultation.encounter.goToRx")}
              </Button>
            ) : null}
            <Button
              onClick={doFinish}
              disabled={!ready || finish.pending}
              data-testid="consult-finish-confirm"
            >
              {t("consultation.encounter.finishAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Check({
  ok,
  label,
  neutral = false,
}: {
  ok: boolean
  label: string
  neutral?: boolean
}) {
  const Icon = ok ? CheckCircle2 : Circle
  return (
    <li className="flex items-center gap-2">
      <Icon
        className={cn(
          "size-4",
          neutral
            ? "text-muted-foreground"
            : ok
              ? "text-success"
              : "text-warning"
        )}
      />
      <span className={cn(!ok && "font-medium")}>{label}</span>
    </li>
  )
}
