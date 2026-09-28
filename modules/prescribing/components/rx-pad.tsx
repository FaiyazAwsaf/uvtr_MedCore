"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { FileSignature, History, Pill, Printer, RefreshCcw, Send, X } from "lucide-react"
import { toast } from "sonner"

import { SectionCard } from "@/components/shared/section-card"
import { StatusPill } from "@/components/shared/status"
import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { now } from "@/core/clock/clock"
import { addDaysISO, dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type {
  Diagnosis,
  DoctorRow,
  EncounterRow,
  PatientRow,
  PrescriptionRow,
  RxLineRow,
  StaffRow,
} from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import type { MedicineCatalogRows } from "@/modules/consultation/components/data"
import { appendQuickText, expandQuickText, QuickTextMenu } from "@/modules/consultation/components/quick-text"
import { useClinicalCommand } from "@/modules/consultation/components/use-clinical-command"

import type { AlertOverride, DuplicateContext } from "../alerts"
import {
  addRxLine,
  removeRxLine,
  reviseRxCommand,
  saveRxDraft,
  signRx,
  updateRxLine,
  type RxLineInput,
} from "../commands"
import { instructionsFor, normaliseDoseCode, quantityFor } from "../dose"
import { FollowUpBooking } from "./follow-up-booking"
import { brandLabel, MedicineSearch, type MedicinePick } from "./medicine-search"
import { PickPanel, type AlertContext, type PickInitial } from "./pick-panel"
import { RxLines, type LineView } from "./rx-lines"
import { RxPrintDialog, type RxPrintData } from "./rx-print"
import { useStock } from "./stock"

const AUTOSAVE_MS = 1000

type LocalLine = {
  key: string
  keepLineId?: string
  content: RxLineInput
  overrides?: AlertOverride[]
}

function viewOfRow(line: RxLineRow): LineView {
  return {
    key: line.id,
    brandId: line.brandId,
    genericId: line.genericId,
    nonDictionaryName: line.nonDictionaryName,
    strength: line.strength,
    form: line.form,
    dosePattern: line.dosePattern,
    mealTiming: line.mealTiming,
    durationDays: line.durationDays,
    qtyPrescribed: line.qtyPrescribed,
    instructionsEn: line.instructionsEn,
    instructionsBn: line.instructionsBn,
    isAntibiotic: line.isAntibiotic,
    isControlled: line.isControlled,
    status: line.status,
    dispensedQty: line.dispensedQty,
    substituted: !!line.substitutedFromLineId,
  }
}

function viewOfLocal(line: LocalLine, catalog: MedicineCatalogRows | undefined): LineView {
  const c = line.content
  const brand = c.brandId ? catalog?.brandById.get(c.brandId) : undefined
  const generic = brand ? catalog?.genericById.get(brand.genericId) : undefined
  const code = normaliseDoseCode(c.dosePattern)
  const words = instructionsFor(code, c.mealTiming, c.durationDays)
  return {
    key: line.key,
    brandId: c.brandId,
    genericId: brand?.genericId,
    nonDictionaryName: c.nonDictionaryName,
    strength: brand?.strength ?? c.strength ?? "",
    form: brand?.form ?? c.form ?? "",
    dosePattern: code,
    mealTiming: c.mealTiming,
    durationDays: c.durationDays,
    qtyPrescribed: c.qtyPrescribed ?? quantityFor(code, c.durationDays),
    instructionsEn: words.en,
    instructionsBn: words.bn,
    isAntibiotic: !!(brand?.isAntibiotic || generic?.isAntibiotic),
    isControlled: brand?.category === "controlled",
  }
}

const contentOfRow = (l: RxLineRow): RxLineInput => ({
  brandId: l.brandId,
  nonDictionaryName: l.nonDictionaryName,
  strength: l.strength,
  form: l.form,
  dosePattern: l.dosePattern,
  mealTiming: l.mealTiming,
  durationDays: l.durationDays,
  qtyPrescribed: l.qtyPrescribed,
})

/**
 * The Rx pad (objective §3B): search, live stock, alternatives, the three
 * interruptive alerts, dose shortcuts, advice and follow-up, then sign. A
 * signed Rx is immutable; "Revise" makes v2 (or a new Rx after dispensing).
 */
export function RxPad({
  encounter,
  patient,
  doctor,
  doctorStaff,
  catalog,
  labTestName,
  diagnoses,
  readOnly,
}: {
  encounter: EncounterRow
  patient: PatientRow
  doctor?: DoctorRow
  doctorStaff?: StaffRow
  catalog: MedicineCatalogRows | undefined
  labTestName: (testId: string) => string
  diagnoses: Diagnosis[]
  readOnly: boolean
}) {
  const { t, tk, num, locale, time } = useLocale()
  const db = useDb()
  const nowMs = useNow(60_000) || now()
  const today = dhakaDate(nowMs)

  const data = useLiveQuery(async () => {
    const rxs = (await db.prescriptions.where("encounterId").equals(encounter.id).toArray()).sort(
      (a, b) => b.createdAt - a.createdAt
    )
    const ids = rxs.map((r) => r.id)
    const [lines, queue, patientLines, results, labOrders, imaging] = await Promise.all([
      ids.length ? db.rxLines.where("rxId").anyOf(ids).toArray() : [],
      ids.length ? db.pharmacyQueue.where("rxId").anyOf(ids).toArray() : [],
      db.rxLines.where("patientId").equals(patient.id).toArray(),
      db.results.where("patientId").equals(patient.id).toArray(),
      db.labOrders.where("encounterId").equals(encounter.id).toArray(),
      db.imagingOrders.where("encounterId").equals(encounter.id).toArray(),
    ])
    const own = new Set(ids)
    const others = patientLines.filter((l) => !own.has(l.rxId))
    const otherRx = new Map(
      (await db.prescriptions.bulkGet([...new Set(others.map((l) => l.rxId))]))
        .filter(Boolean)
        .map((r) => [r!.id, r!])
    )
    const items = labOrders.length
      ? await db.labOrderItems.where("labOrderId").anyOf(labOrders.map((o) => o.id)).toArray()
      : []
    const testIds = [
      ...items.filter((i) => i.status !== "cancelled").map((i) => i.testId),
      ...imaging.filter((o) => o.status !== "cancelled").map((o) => o.testId),
    ]
    return { rxs, lines, queue, others, otherRx, results, testIds }
  }, [db, encounter.id, patient.id])

  const rxs = data?.rxs ?? []
  const signed = rxs.find((r) => r.status === "signed")
  const draft = signed ? undefined : rxs.find((r) => r.status === "draft")
  const history = rxs.filter((r) => r.status === "superseded" || r.status === "replaced")
  const linesOf = React.useCallback(
    (rx: PrescriptionRow | undefined) =>
      rx
        ? (data?.lines ?? [])
            .filter((l) => l.rxId === rx.id && l.status !== "cancelled")
            .sort((a, b) => a.lineNo - b.lineNo)
        : [],
    [data?.lines]
  )
  const draftLines = linesOf(draft)
  const signedLines = linesOf(signed)
  const tests = [...new Set((data?.testIds ?? []).map(labTestName))]

  const [pick, setPick] = React.useState<MedicinePick | null>(null)
  const [editKey, setEditKey] = React.useState<string | null>(null)
  const [revising, setRevising] = React.useState(false)
  const [local, setLocal] = React.useState<LocalLine[]>([])
  const [reason, setReason] = React.useState("")
  const [printOpen, setPrintOpen] = React.useState(false)

  const add = useClinicalCommand(addRxLine)
  const update = useClinicalCommand(updateRxLine)
  const remove = useClinicalCommand(removeRxLine)
  const saveDraft = useClinicalCommand(saveRxDraft)
  const sign = useClinicalCommand(signRx)
  const revise = useClinicalCommand(reviseRxCommand)

  /* ---------------- advice and follow-up (autosaved on the draft) ---------------- */
  const [advice, setAdvice] = React.useState("")
  const [followUp, setFollowUp] = React.useState("")
  const dirty = React.useRef(false)
  const timer = React.useRef<number | undefined>(undefined)
  const syncedFrom = React.useRef<string>("")
  const source = revising ? signed : draft
  React.useEffect(() => {
    const key = source ? `${source.id}:${source.version}` : "none"
    if (dirty.current || syncedFrom.current === key) return
    syncedFrom.current = key
    setAdvice(source?.advice ?? "")
    setFollowUp(source?.followUpDate ?? "")
  }, [source])
  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  const saveRun = saveDraft.run
  const persist = React.useCallback(
    async (nextAdvice: string, nextFollowUp: string) => {
      const out = await saveRun(
        { encounterId: encounter.id, advice: nextAdvice, followUpDate: nextFollowUp || null },
        { quiet: true }
      )
      if (out.ok) dirty.current = false
    },
    [encounter.id, saveRun]
  )
  const changeDraftMeta = (nextAdvice: string, nextFollowUp: string) => {
    setAdvice(nextAdvice)
    setFollowUp(nextFollowUp)
    if (revising) return
    dirty.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void persist(nextAdvice, nextFollowUp), AUTOSAVE_MS)
  }

  /* ---------------- lines on the pad ---------------- */
  const views: LineView[] = revising ? local.map((l) => viewOfLocal(l, catalog)) : (signed ? signedLines : draftLines).map(viewOfRow)
  const stock = useStock(views.flatMap((v) => (v.brandId ? [v.brandId] : [])))

  const thisRx: DuplicateContext["thisRx"] = revising
    ? local.map((l) => ({
        id: l.key,
        brandId: l.content.brandId,
        genericId: l.content.brandId ? catalog?.brandById.get(l.content.brandId)?.genericId : undefined,
        nonDictionaryName: l.content.nonDictionaryName,
        status: "open" as const,
        strength: l.content.strength ?? "",
      }))
    : draftLines
  const nameOf = (id: string) => {
    const v = views.find((x) => x.key === id)
    if (!v) return ""
    const brand = v.brandId ? catalog?.brandById.get(v.brandId) : undefined
    return brand ? brandLabel(brand) : (v.nonDictionaryName ?? "")
  }
  const alertContext: AlertContext = {
    thisRx,
    nameOf,
    otherLines: (data?.others ?? []).flatMap((line) => {
      const rx = data?.otherRx.get(line.rxId)
      if (!rx) return []
      const brand = line.brandId ? catalog?.brandById.get(line.brandId) : undefined
      return [{ line, rx, name: brand ? brandLabel(brand) : (line.nonDictionaryName ?? "") }]
    }),
    results: data?.results ?? [],
    now: nowMs,
    exceptLineId: editKey ?? undefined,
  }

  const editingView = editKey ? views.find((v) => v.key === editKey) : undefined
  const initial: PickInitial | undefined = editingView
    ? {
        dosePattern: editingView.dosePattern,
        mealTiming: editingView.mealTiming,
        durationDays: editingView.durationDays,
        qtyPrescribed: editingView.qtyPrescribed,
      }
    : undefined

  const closePick = () => {
    setPick(null)
    setEditKey(null)
  }

  const onSubmit = async (line: RxLineInput, overrides: AlertOverride[]): Promise<boolean> => {
    if (revising) {
      setLocal((current) =>
        editKey
          ? current.map((l) => (l.key === editKey ? { ...l, content: { ...l.content, ...line } } : l))
          : [...current, { key: `new-${current.length}-${line.brandId ?? line.nonDictionaryName}`, content: line, overrides }]
      )
      closePick()
      return true
    }
    if (editKey) {
      const out = await update.run({
        lineId: editKey,
        dosePattern: line.dosePattern,
        mealTiming: line.mealTiming,
        durationDays: line.durationDays,
        qtyPrescribed: line.qtyPrescribed,
      })
      if (out.ok) closePick()
      return out.ok
    }
    const out = await add.run({ encounterId: encounter.id, line, overrides })
    if (out.ok) closePick()
    return out.ok
  }

  const onEdit = (key: string) => {
    const v = views.find((x) => x.key === key)
    if (!v) return
    setEditKey(key)
    setPick(v.brandId ? { kind: "brand", brandId: v.brandId } : { kind: "free", name: v.nonDictionaryName ?? "" })
  }
  const onRemove = async (key: string) => {
    if (revising) {
      setLocal((current) => current.filter((l) => l.key !== key))
      return
    }
    const name = nameOf(key)
    const out = await remove.run({ lineId: key })
    if (out.ok) toast(t("prescribing.lines.removed", { name }))
  }

  const onSign = async () => {
    if (!draft) return
    window.clearTimeout(timer.current)
    dirty.current = false
    const out = await sign.run({ rxId: draft.id, advice, followUpDate: followUp || null, smsLang: "bn" })
    if (out.ok) {
      toast.success(t("prescribing.pad.signed", { rxNo: out.result.rxNo }), {
        description: out.result.smsQueued ? t("prescribing.followUp.smsQueued") : undefined,
      })
      closePick()
    }
  }

  const startRevision = () => {
    if (!signed) return
    setLocal(signedLines.map((l) => ({ key: l.id, keepLineId: l.id, content: contentOfRow(l) })))
    setReason("")
    syncedFrom.current = ""
    setRevising(true)
    closePick()
  }
  const cancelRevision = () => {
    setRevising(false)
    syncedFrom.current = ""
    closePick()
  }
  const submitRevision = async () => {
    if (!signed) return
    const out = await revise.run({
      rxId: signed.id,
      expectedVersion: signed.version,
      lines: local.map((l) => ({ ...l.content, keepLineId: l.keepLineId, overrides: l.overrides })),
      advice,
      followUpDate: followUp || null,
      reason,
      smsLang: "bn",
    })
    if (out.ok) {
      toast.success(
        out.result.mode === "revised"
          ? t("prescribing.pad.revised", { rxNo: out.result.rxNo, version: out.result.rxVersion })
          : t("prescribing.pad.replacedToast", { rxNo: out.result.rxNo })
      )
      setRevising(false)
      syncedFrom.current = ""
    }
  }

  const current = revising ? signed : (signed ?? draft)
  const queueEntry = signed ? data?.queue.find((q) => q.rxId === signed.id) : undefined
  const canWrite = revising || (!signed && !readOnly)

  const printData: RxPrintData | undefined = current
    ? {
        rx: signed ? current : { ...current, advice, followUpDate: followUp || undefined },
        lines: views,
        patient,
        doctor,
        doctorStaff,
        vitals: current.vitalsSnapshot ?? encounter.vitals,
        diagnoses,
        tests: signed ? [...new Set([...signed.tests, ...tests])] : tests,
      }
    : undefined

  return (
    <SectionCard
      size="sm"
      icon={Pill}
      title={t("prescribing.pad.title")}
      subtitle={
        current ? (
          <span className="font-mono" lang="en" data-testid="rx-number">
            {current.rxNo}
          </span>
        ) : undefined
      }
      action={
        signed && !revising ? (
          <StatusPill tone="success" dot data-testid="rx-status" data-status="signed">
            {t("prescribing.pad.signedV", { version: signed.rxVersion })}
          </StatusPill>
        ) : revising && signed ? (
          <StatusPill tone="warning" dot data-testid="rx-status" data-status="revising">
            {t("prescribing.pad.revising", { rxNo: signed.rxNo })}
          </StatusPill>
        ) : (
          <StatusPill tone="warning" dot data-testid="rx-status" data-status="draft">
            {t("prescribing.pad.draft")}
          </StatusPill>
        )
      }
    >
      <div id="enc-rx" className="@container/rx flex flex-col gap-4" data-testid="rx-pad">
        {canWrite && catalog ? (
          <div className="flex flex-col gap-3">
            {!pick ? <MedicineSearch catalog={catalog} onPick={(p) => setPick(p)} /> : null}
            {pick ? (
              <PickPanel
                key={`${pick.kind}:${pick.kind === "brand" ? pick.brandId : pick.name}:${editKey ?? ""}`}
                pick={pick}
                catalog={catalog}
                patient={patient}
                alerts={alertContext}
                initial={initial}
                mode={editKey ? "edit" : "add"}
                onPick={(p) => setPick(p)}
                onClear={closePick}
                onSubmit={onSubmit}
                labTestName={labTestName}
              />
            ) : null}
          </div>
        ) : null}

        {views.length ? (
          <RxLines
            lines={views}
            catalog={catalog}
            stock={stock}
            editable={canWrite}
            showStatus={!!signed && !revising}
            onEdit={canWrite ? onEdit : undefined}
            onRemove={canWrite ? onRemove : undefined}
          />
        ) : (
          <EmptyState size="sm" icon={Pill} title={t("prescribing.pad.noLines")} description={t("prescribing.pad.noLinesHint")} />
        )}

        {/* Advice, follow-up and tests */}
        <div className="grid gap-3 @min-[40rem]/rx:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
              {t("prescribing.pad.advice")}
              {canWrite ? (
                <QuickTextMenu
                  sections={["advice", "plan"]}
                  lang={locale}
                  onPick={(quick) => changeDraftMeta(appendQuickText(advice, quick, locale), followUp)}
                />
              ) : null}
            </span>
            <Textarea
              value={canWrite ? advice : (signed?.advice ?? "")}
              readOnly={!canWrite}
              data-testid="rx-advice"
              placeholder={t("prescribing.pad.advicePlaceholder")}
              className="min-h-16 text-[0.8125rem]"
              onChange={(e) => {
                const value = e.target.value
                changeDraftMeta(expandQuickText(value, locale) ?? value, followUp)
              }}
            />
          </label>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">{t("prescribing.pad.followUp")}</span>
            {canWrite ? (
              <>
                <Input
                  type="date"
                  className="h-9"
                  value={followUp}
                  min={addDaysISO(today, 1)}
                  data-testid="rx-follow-up"
                  onChange={(e) => changeDraftMeta(advice, e.target.value)}
                />
                <div className="flex flex-wrap gap-1">
                  {[7, 14].map((d) => (
                    <Button
                      key={d}
                      size="xs"
                      variant="secondary"
                      type="button"
                      data-testid="rx-follow-up-chip"
                      data-days={d}
                      onClick={() => changeDraftMeta(advice, addDaysISO(today, d))}
                    >
                      {t("prescribing.pad.followUpIn", { count: num(d) })}
                    </Button>
                  ))}
                  <Button size="xs" variant="secondary" type="button" onClick={() => changeDraftMeta(advice, addDaysISO(today, 30))}>
                    {t("prescribing.pad.followUpMonth")}
                  </Button>
                  {followUp ? (
                    <Button size="xs" variant="ghost" type="button" onClick={() => changeDraftMeta(advice, "")}>
                      <X />
                      {t("prescribing.pad.clear")}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-[0.8125rem]" data-testid="rx-follow-up-value">
                {signed?.followUpDate ? <FollowUpDate iso={signed.followUpDate} /> : t("prescribing.pad.followUpNone")}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground">{t("prescribing.pad.tests")}</span>
          {tests.length || signed?.tests.length ? (
            <p className="text-[0.8125rem]" lang="en" data-testid="rx-tests">
              {[...new Set([...(signed?.tests ?? []), ...tests])].join(", ")}
            </p>
          ) : (
            <p className="text-[0.8125rem] text-muted-foreground">{t("prescribing.pad.testsNone")}</p>
          )}
          {canWrite ? <p className="text-[0.6875rem] text-muted-foreground">{t("prescribing.pad.testsHint")}</p> : null}
        </div>

        {revising ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">{t("prescribing.pad.reviseReason")}</span>
            <Input
              value={reason}
              data-testid="rx-revise-reason"
              placeholder={t("prescribing.pad.reviseReasonPlaceholder")}
              onChange={(e) => setReason(e.target.value)}
            />
            <span className="text-[0.6875rem] text-muted-foreground">
              {t("prescribing.pad.reviseHint", { next: (signed?.rxVersion ?? 1) + 1, rxNo: signed?.rxNo ?? "" })}
            </span>
          </label>
        ) : null}

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          {signed && !revising ? (
            <span className="mr-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Send className="size-3.5 text-success" />
              {t("prescribing.pad.sentTo")}
              {queueEntry ? (
                <StatusPill tone="info" className="h-5 px-2 text-[0.6875rem]" data-testid="rx-queue-status" data-status={queueEntry.status}>
                  {t("prescribing.pad.queue.label")}: {tk(`prescribing.pad.queue.${queueEntry.status}`)}
                </StatusPill>
              ) : null}
            </span>
          ) : !signed ? (
            <span className="mr-auto text-xs text-muted-foreground">{t("prescribing.pad.signHint")}</span>
          ) : (
            <span className="mr-auto" />
          )}

          {current ? (
            <Button size="sm" variant="neutral" onClick={() => setPrintOpen(true)} data-testid="rx-print">
              <Printer />
              {t("prescribing.pad.print")}
            </Button>
          ) : null}

          {signed && !revising && doctor && signed.followUpDate ? (
            <FollowUpBooking
              patientId={patient.id}
              doctorId={doctor.id}
              doctorName={doctorStaff ? (locale === "bn" ? doctorStaff.nameBn : doctorStaff.nameEn) : ""}
              fromDate={signed.followUpDate}
              today={today}
            />
          ) : null}

          {signed && !revising ? (
            <Button size="sm" variant="outline" onClick={startRevision} data-testid="rx-revise">
              <RefreshCcw />
              {t("prescribing.pad.revise")}
            </Button>
          ) : null}

          {revising ? (
            <>
              <Button size="sm" variant="ghost" onClick={cancelRevision}>
                {t("prescribing.pad.cancelRevision")}
              </Button>
              <Button
                size="sm"
                onClick={submitRevision}
                disabled={revise.pending || !local.length || reason.trim().length < 3 || !!pick}
                data-testid="rx-revise-sign"
              >
                <FileSignature />
                {t("prescribing.pad.signRevision")}
              </Button>
            </>
          ) : null}

          {!signed && !readOnly ? (
            <Button
              size="sm"
              onClick={onSign}
              disabled={sign.pending || !draft || !draftLines.length || !!pick}
              data-testid="rx-sign"
            >
              <FileSignature />
              {sign.pending ? t("prescribing.pad.signing") : t("prescribing.pad.sign")}
            </Button>
          ) : null}
        </div>

        {history.length ? (
          <div className="border-t border-hairline pt-3">
            <h3 className="micro mb-1.5 flex items-center gap-1.5">
              <History className="size-3.5" />
              {t("prescribing.pad.history")}
            </h3>
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground" data-testid="rx-history">
              {history.map((rx) => (
                <li key={rx.id}>
                  {t("prescribing.pad.historyLine", {
                    rxNo: rx.rxNo,
                    version: rx.rxVersion,
                    status: tk(`prescribing.pad.statusWord.${rx.status}`),
                  })}
                  {rx.signedAt ? ` · ${time(rx.signedAt)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <RxPrintDialog open={printOpen} onOpenChange={setPrintOpen} data={printData} catalog={catalog} />
    </SectionCard>
  )
}

function FollowUpDate({ iso }: { iso: string }) {
  const { dmy } = useLocale()
  return <>{dmy(iso)}</>
}
