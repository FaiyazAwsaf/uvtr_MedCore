"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  CircleCheck,
  Pencil,
  RefreshCw,
  Search,
  TriangleAlert,
  UserPlus,
  UserRound,
} from "lucide-react"

import { useDemoUi } from "@/components/shell/demo/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDb } from "@/core/db/DbProvider"
import type { MedcoreDb } from "@/core/db/database"
import type { PatientRow } from "@/core/db/schema"
import { ConflictError } from "@/core/engine/errors"
import { useCommand } from "@/core/engine/useCommand"
import { subscribe } from "@/core/events/bus"
import { useActor } from "@/core/session/persona"
import { useLocale } from "@/lib/i18n/provider"
import { touchPatient } from "@/modules/demo/commands"

import { staffName } from "./labels"
import { createSamplePatient } from "./sample-patient"

/** Same rule as the command's input schema, checked before submitting. */
const PHONE = /^01\d{3}-?\d{6}$/
const LIMIT = 20

function searchPatients(db: MedcoreDb, query: string): Promise<PatientRow[]> {
  const raw = query.trim()
  if (!raw) return db.patients.limit(LIMIT).toArray()
  const lower = raw.toLowerCase()
  const digits = raw.replace(/\D/g, "")
  return db.patients
    .filter(
      (p) =>
        p.nameEn.toLowerCase().includes(lower) ||
        p.nameBn.includes(raw) ||
        p.uhid.toLowerCase().includes(lower) ||
        (digits.length >= 3 && p.uhid.replace(/\D/g, "").includes(digits))
    )
    .limit(LIMIT)
    .toArray()
}

/**
 * Checkpoint-1 engine check (plan P1.9): pick a patient, then edit the phone
 * through `demo.touchPatient`. The form captures the version when it opens,
 * so two windows editing the same patient produce a real ConflictError.
 */
export function EngineCheck() {
  const { t, num, locale, uhid } = useLocale()
  const db = useDb()
  const actor = useActor()
  const [query, setQuery] = React.useState("")
  // Kept in the window's demo store so closing the drawer keeps the pick.
  const selectedId = useDemoUi((s) => s.enginePatientId)
  const setSelectedId = useDemoUi((s) => s.setEnginePatientId)
  const total = useLiveQuery(() => db.patients.count(), [db])
  const matches = useLiveQuery(() => searchPatients(db, query), [db, query])
  const sample = useCommand(createSamplePatient)

  const createSample = async () => {
    const result = await sample.run({})
    if (result) setSelectedId(result.patientId)
  }

  return (
    <section className="flex flex-col gap-3" data-testid="engine-check">
      <p className="text-xs text-muted-foreground">{t("demo.engine.hint")}</p>

      {!actor ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          {t("demo.engine.noPersona")}
        </p>
      ) : null}

      {selectedId ? (
        <SelectedPatient
          patientId={selectedId}
          onChange={() => setSelectedId(null)}
        />
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("demo.engine.search")}
              aria-label={t("demo.engine.search")}
              className="pl-8"
              data-testid="engine-search"
            />
          </div>

          {total === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-lg bg-card p-3">
              <p className="text-xs text-muted-foreground">
                {t("demo.engine.noPatients")}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={createSample}
                disabled={!actor || sample.pending}
                data-testid="engine-create-sample"
              >
                <UserPlus />
                {t("demo.engine.createSample")}
              </Button>
            </div>
          ) : matches === undefined || total === undefined ? (
            <p className="text-xs text-muted-foreground">
              {t("demo.common.loading")}
            </p>
          ) : matches.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("demo.engine.noMatch")}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-hairline overflow-hidden rounded-lg bg-card">
                {matches.map((patient) => (
                  <li key={patient.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(patient.id)}
                      data-testid="engine-patient-row"
                      data-uhid={patient.uhid}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors outline-none hover:bg-primary-soft focus-visible:bg-primary-soft"
                    >
                      <span className="icon-well flex size-7 shrink-0 items-center justify-center text-muted-foreground">
                        <UserRound className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {locale === "bn" ? patient.nameBn : patient.nameEn}
                        </span>
                        <span className="block font-mono text-[0.6875rem] text-muted-foreground">
                          {uhid(patient.uhid)}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground">
                        {patient.phone ?? ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[0.6875rem] text-muted-foreground">
                {t("demo.engine.showing", {
                  count: num(matches.length),
                  total: num(total),
                })}
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}

/** Bumps when another window commits a change to this patient (the sync flash). */
function useSyncFlash(dbName: string, patientId: string): number {
  const [tick, setTick] = React.useState(0)
  React.useEffect(
    () =>
      subscribe((message) => {
        if (message.kind !== "commit" || message.db !== dbName || message.local)
          return
        if (
          message.events.some(
            (e) => e.patientId === patientId || e.refs?.patientId === patientId
          )
        ) {
          setTick((n) => n + 1)
        }
      }),
    [dbName, patientId]
  )
  return tick
}

type Outcome =
  { kind: "saved"; version: number } | { kind: "invalid" } | { kind: "failed" }

function SelectedPatient({
  patientId,
  onChange,
}: {
  patientId: string
  onChange: () => void
}) {
  const { t, tk, locale, relative, time, uhid } = useLocale()
  const db = useDb()
  const actor = useActor()
  const patient = useLiveQuery(
    async () => (await db.patients.get(patientId)) ?? null,
    [db, patientId]
  )
  const touch = useCommand(touchPatient)
  const [editing, setEditing] = React.useState<{
    expectedVersion: number
    phone: string
  } | null>(null)
  const [outcome, setOutcome] = React.useState<Outcome | null>(null)
  const flash = useSyncFlash(db.name, patientId)

  if (patient === undefined) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("demo.common.loading")}
      </p>
    )
  }
  if (patient === null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onChange}
        className="self-start"
      >
        {t("demo.engine.change")}
      </Button>
    )
  }

  const openForm = (phone?: string) => {
    // The version is captured now: saving later against a newer record conflicts.
    setEditing({
      expectedVersion: patient.version,
      phone: phone ?? patient.phone ?? "",
    })
    setOutcome(null)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing) return
    const phone = editing.phone.trim()
    if (!PHONE.test(phone)) {
      setOutcome({ kind: "invalid" })
      return
    }
    const result = await touch.run({
      patientId: patient.id,
      phone,
      expectedVersion: editing.expectedVersion,
    })
    if (result) {
      setEditing(null)
      setOutcome({ kind: "saved", version: result.version })
    } else {
      setOutcome({ kind: "failed" })
    }
  }

  const conflict =
    outcome?.kind === "failed" && touch.error instanceof ConflictError
      ? touch.error
      : null

  return (
    <div
      className="flex flex-col gap-3 rounded-lg bg-card p-3"
      data-testid="engine-selected"
      data-version={patient.version}
    >
      <div className="flex items-start gap-3">
        <span className="icon-well flex size-9 shrink-0 items-center justify-center text-primary">
          <UserRound className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {locale === "bn" ? patient.nameBn : patient.nameEn}
          </p>
          <p
            className="font-mono text-[0.6875rem] text-muted-foreground"
            data-testid="engine-selected-uhid"
          >
            {uhid(patient.uhid)}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onChange}>
          {t("demo.engine.change")}
        </Button>
      </div>

      <div className="relative grid grid-cols-[1fr_auto] gap-2">
        {flash > 0 ? (
          // Remounts on every remote change so the turquoise tint replays on top.
          <span
            key={flash}
            aria-hidden
            className="flash-sync pointer-events-none absolute inset-0 z-10 rounded-md"
            data-testid="engine-sync-flash"
          />
        ) : null}
        <div className="rounded-md bg-surface-raised px-3 py-2">
          <p className="micro">{t("demo.engine.phone")}</p>
          <p
            className="mt-1 font-mono text-base font-semibold"
            data-testid="engine-phone"
          >
            {patient.phone ?? t("demo.engine.noPhone")}
          </p>
        </div>
        <div className="rounded-md bg-surface-raised px-3 py-2 text-right">
          <p className="micro">{t("demo.engine.version")}</p>
          <p
            className="mt-1 font-mono text-base font-semibold"
            data-testid="engine-version"
          >
            v{patient.version}
          </p>
        </div>
      </div>
      <p className="text-[0.6875rem] text-muted-foreground">
        {t("demo.engine.updated", {
          time: relative(patient.updatedAt),
          name: staffName(patient.updatedBy, locale, tk),
        })}
      </p>

      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-2" noValidate>
          <label className="text-xs font-medium" htmlFor="engine-phone-input">
            {t("demo.engine.newPhone")}
          </label>
          <div className="flex gap-2">
            <Input
              id="engine-phone-input"
              value={editing.phone}
              onChange={(e) =>
                setEditing({ ...editing, phone: e.target.value })
              }
              inputMode="tel"
              autoComplete="off"
              className="font-mono"
              aria-invalid={outcome?.kind === "invalid" || undefined}
              data-testid="engine-phone-input"
            />
            <Button
              type="submit"
              disabled={touch.pending || !actor}
              data-testid="engine-save"
            >
              {touch.pending ? t("demo.engine.saving") : t("demo.engine.save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(null)
                setOutcome(null)
              }}
            >
              {t("demo.common.cancel")}
            </Button>
          </div>
          <p
            className="text-[0.6875rem] text-muted-foreground"
            data-testid="engine-editing-version"
          >
            {t("demo.engine.editing", { version: editing.expectedVersion })}
          </p>
        </form>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => openForm()}
          disabled={!actor}
          data-testid="engine-edit"
        >
          <Pencil />
          {t("demo.engine.edit")}
        </Button>
      )}

      {outcome?.kind === "saved" ? (
        <p
          role="status"
          className="flex items-center gap-1.5 text-xs text-success"
          data-testid="engine-saved"
        >
          <CircleCheck className="size-3.5" />
          {t("demo.engine.saved", { version: outcome.version })}
        </p>
      ) : null}
      {outcome?.kind === "invalid" ? (
        <p role="alert" className="text-xs text-destructive">
          {t("demo.engine.invalid")}
        </p>
      ) : null}
      {conflict ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive"
          data-testid="engine-conflict"
        >
          <p className="flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("demo.engine.conflict", {
                name: staffName(conflict.updatedBy, locale, tk),
                time: time(conflict.updatedAt),
                from: conflict.expectedVersion,
                to: conflict.actualVersion,
              })}
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => openForm(editing?.phone)}
          >
            <RefreshCw />
            {t("demo.engine.loadLatest")}
          </Button>
        </div>
      ) : outcome?.kind === "failed" ? (
        <p role="alert" className="text-xs text-destructive">
          {t("demo.engine.failed")}
        </p>
      ) : null}
    </div>
  )
}
