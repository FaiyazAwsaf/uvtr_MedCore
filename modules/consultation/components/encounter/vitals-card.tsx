"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Activity } from "lucide-react"
import { toast } from "sonner"

import { SectionCard } from "@/components/shared/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDb } from "@/core/db/DbProvider"
import type { EncounterRow, Vitals } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

import { saveVitals } from "../../commands"
import { useClinicalCommand } from "../use-clinical-command"

export const cToF = (c: number) => Math.round(((c * 9) / 5) * 10 + 320) / 10
const fToC = (f: number) => Math.round((((f - 32) * 5) / 9) * 10) / 10

type Field =
  | "bpSys"
  | "bpDia"
  | "pulse"
  | "tempF"
  | "spo2"
  | "weightKg"
  | "heightCm"
  | "rbs"
type Form = Record<Field, string>

const EMPTY: Form = {
  bpSys: "",
  bpDia: "",
  pulse: "",
  tempF: "",
  spo2: "",
  weightKg: "",
  heightCm: "",
  rbs: "",
}

function formFrom(v: Vitals | undefined): Form {
  if (!v) return EMPTY
  const s = (n: number | undefined) => (n === undefined ? "" : String(n))
  return {
    bpSys: s(v.bpSys),
    bpDia: s(v.bpDia),
    pulse: s(v.pulse),
    tempF: v.tempC === undefined ? "" : String(cToF(v.tempC)),
    spo2: s(v.spo2),
    weightKg: s(v.weightKg),
    heightCm: s(v.heightCm),
    rbs: s(v.rbs),
  }
}

const numberOf = (text: string): number | undefined => {
  const value = Number(text.trim())
  return text.trim() && Number.isFinite(value) ? value : undefined
}

/** One line of vitals: "BP 138/86 · Pulse 96/min · Temp 100.8 °F ...". */
export function VitalsLine({ vitals }: { vitals: Vitals }) {
  const { t, num, dec } = useLocale()
  const parts: [string, string][] = []
  if (vitals.bpSys !== undefined && vitals.bpDia !== undefined) {
    parts.push([
      t("consultation.vitals.fields.bp"),
      `${num(vitals.bpSys)}/${num(vitals.bpDia)} ${t("consultation.vitals.units.mmHg")}`,
    ])
  }
  if (vitals.pulse !== undefined)
    parts.push([
      t("consultation.vitals.fields.pulse"),
      `${num(vitals.pulse)}${t("consultation.vitals.units.bpm")}`,
    ])
  if (vitals.tempC !== undefined)
    parts.push([
      t("consultation.vitals.fields.temp"),
      `${dec(cToF(vitals.tempC), 1)} ${t("consultation.vitals.units.f")}`,
    ])
  if (vitals.spo2 !== undefined)
    parts.push([
      t("consultation.vitals.fields.spo2"),
      `${num(vitals.spo2)}${t("consultation.vitals.units.pct")}`,
    ])
  if (vitals.weightKg !== undefined)
    parts.push([
      t("consultation.vitals.fields.weight"),
      `${num(vitals.weightKg)} ${t("consultation.vitals.units.kg")}`,
    ])
  if (vitals.heightCm !== undefined)
    parts.push([
      t("consultation.vitals.fields.height"),
      `${num(vitals.heightCm)} ${t("consultation.vitals.units.cm")}`,
    ])
  if (vitals.weightKg && vitals.heightCm) {
    const bmi = vitals.weightKg / (vitals.heightCm / 100) ** 2
    parts.push([t("consultation.vitals.fields.bmi"), dec(bmi, 1)])
  }
  if (vitals.rbs !== undefined)
    parts.push([
      t("consultation.vitals.fields.rbs"),
      `${dec(vitals.rbs, 1)} ${t("consultation.vitals.units.mmol")}`,
    ])
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @min-[22rem]/vit:grid-cols-3">
      {parts.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="nums truncate text-[0.8125rem] font-semibold">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Latest vitals (this visit, or the last visit) and the vitals entry form. */
export function VitalsCard({
  encounter,
  readOnly,
}: {
  encounter: EncounterRow
  readOnly: boolean
}) {
  const { t, time, dmy } = useLocale()
  const db = useDb()
  const save = useClinicalCommand(saveVitals)
  // A visit without vitals opens straight on the form.
  const [editing, setEditing] = React.useState(!encounter.vitals && !readOnly)
  const [form, setForm] = React.useState<Form>(EMPTY)

  const previous = useLiveQuery(async () => {
    if (encounter.vitals) return null
    const others = await db.encounters
      .where("patientId")
      .equals(encounter.patientId)
      .toArray()
    return (
      others
        .filter((e) => e.id !== encounter.id && e.vitals)
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
    )
  }, [db, encounter.id, encounter.patientId, !!encounter.vitals])

  const openForm = () => {
    setForm(formFrom(encounter.vitals))
    setEditing(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const tempF = numberOf(form.tempF)
    const out = await save.run({
      encounterId: encounter.id,
      expectedVersion: encounter.version,
      vitals: {
        bpSys: numberOf(form.bpSys),
        bpDia: numberOf(form.bpDia),
        pulse: numberOf(form.pulse),
        tempC: tempF === undefined ? undefined : fToC(tempF),
        spo2: numberOf(form.spo2),
        weightKg: numberOf(form.weightKg),
        heightCm: numberOf(form.heightCm),
        rbs: numberOf(form.rbs),
      },
    })
    if (out.ok) {
      toast.success(t("consultation.vitals.saved"))
      setEditing(false)
    }
  }

  // Last visit's values as placeholders, so the change is easy to see.
  const lastTime = formFrom(previous?.vitals)
  const field = (name: Field, label: string, unit: string, step = "1") => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {label} <span className="opacity-70">({unit})</span>
      </span>
      <Input
        className="h-8 px-2"
        type="number"
        inputMode="decimal"
        step={step}
        value={form[name]}
        placeholder={lastTime[name]}
        data-testid={`vitals-${name}`}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
      />
    </label>
  )

  const shown = encounter.vitals ?? previous?.vitals
  return (
    <SectionCard
      size="sm"
      icon={Activity}
      title={t("consultation.vitals.title")}
      subtitle={
        encounter.vitals
          ? t("consultation.vitals.recordedAt", {
              time: time(encounter.vitals.recordedAt),
            })
          : previous
            ? t("consultation.vitals.fromVisit", {
                date: dmy(previous.startedAt),
              })
            : undefined
      }
      action={
        !readOnly && !editing ? (
          <Button
            size="xs"
            variant="outline"
            onClick={openForm}
            data-testid="vitals-edit"
          >
            {encounter.vitals
              ? t("consultation.vitals.edit")
              : t("consultation.vitals.record")}
          </Button>
        ) : undefined
      }
    >
      <div className="@container/vit" data-testid="vitals-card">
        {editing ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5 @min-[22rem]/vit:grid-cols-4">
              {field(
                "bpSys",
                t("consultation.vitals.fields.bpSys"),
                t("consultation.vitals.units.mmHg")
              )}
              {field(
                "bpDia",
                t("consultation.vitals.fields.bpDia"),
                t("consultation.vitals.units.mmHg")
              )}
              {field(
                "pulse",
                t("consultation.vitals.fields.pulse"),
                t("consultation.vitals.units.bpm")
              )}
              {field(
                "tempF",
                t("consultation.vitals.fields.temp"),
                t("consultation.vitals.units.f"),
                "0.1"
              )}
              {field(
                "spo2",
                t("consultation.vitals.fields.spo2"),
                t("consultation.vitals.units.pct")
              )}
              {field(
                "weightKg",
                t("consultation.vitals.fields.weight"),
                t("consultation.vitals.units.kg"),
                "0.1"
              )}
              {field(
                "heightCm",
                t("consultation.vitals.fields.height"),
                t("consultation.vitals.units.cm")
              )}
              {field(
                "rbs",
                t("consultation.vitals.fields.rbs"),
                t("consultation.vitals.units.mmol"),
                "0.1"
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                {t("consultation.vitals.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={save.pending}
                data-testid="vitals-save"
              >
                {t("consultation.vitals.save")}
              </Button>
            </div>
          </form>
        ) : shown ? (
          <VitalsLine vitals={shown} />
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("consultation.vitals.none")}
          </p>
        )}
      </div>
    </SectionCard>
  )
}
