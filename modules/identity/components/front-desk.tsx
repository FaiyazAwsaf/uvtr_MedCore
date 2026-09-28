"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"
import { CalendarDays, ChevronLeft, Search, UserPlus, UsersRound, X } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDb } from "@/core/db/DbProvider"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { classifyQuery, searchFrontDesk } from "../search"
import { DeskHeader, DmyInput } from "./desk-ui"
import { PatientPanel } from "./patient-panel"
import { RegisterSheet, type RegisterOutcome, type RegisterPrefill } from "./register-sheet"
import { SearchResults } from "./search-results"

/** Keep a query parameter in the address without a navigation (Next syncs useSearchParams). */
function replaceParam(name: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value) url.searchParams.set(name, value)
  else url.searchParams.delete(name)
  window.history.replaceState(window.history.state, "", url.toString())
}

/** Registration prefill from what the front desk typed. */
function prefillFrom(query: string, dob: string): RegisterPrefill {
  const parsed = classifyQuery(query)
  const prefill: RegisterPrefill = { dob: dob || undefined }
  if (parsed.kind === "phone") prefill.phone = parsed.phone
  else if (parsed.kind === "name") {
    const text = query.trim()
    if (/[ঀ-৿]/.test(text)) prefill.nameBn = text
    else prefill.nameEn = text
  }
  return prefill
}

/**
 * The front desk (plan §9 `/reception`): one search box for UHID, phone, NID,
 * BRN or name (English or Bangla) with an optional date of birth, the
 * household picker for shared phones, the picked patient's identity banner
 * with quick actions, and registration.
 */
export function FrontDesk() {
  const db = useDb()
  const { t } = useLocale()
  const params = useSearchParams()
  const [query, setQuery] = React.useState(() => params.get("q") ?? "")
  const [dob, setDob] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(() => params.get("patient"))
  const [resultsOpen, setResultsOpen] = React.useState(true)
  const [register, setRegister] = React.useState<{ open: boolean; prefill?: RegisterPrefill }>({
    open: params.get("register") === "1",
  })
  const deferredQuery = React.useDeferredValue(query)

  const result = useLiveQuery(
    () => searchFrontDesk(db, deferredQuery, { dob }),
    [db, deferredQuery, dob]
  )

  React.useEffect(() => replaceParam("patient", selectedId), [selectedId])

  const pick = (patientId: string) => {
    setSelectedId(patientId)
    setResultsOpen(false)
  }
  const onRegistered = (patientId: string, outcome: RegisterOutcome) => {
    if (outcome === "opened") toast.info(t("identity.toast.opened"))
    setQuery("")
    setDob("")
    pick(patientId)
  }
  const hasSearch = !!query.trim() || !!dob
  // On a narrow screen the picked patient replaces the results; wide screens show both.
  const collapsed = !!selectedId && !resultsOpen

  return (
    <div className="@container/desk flex flex-col gap-4 py-2">
      <DeskHeader
        title={t("identity.desk.title")}
        subtitle={t("identity.desk.subtitle")}
        actions={
          <Button
            data-testid="register-open"
            onClick={() => setRegister({ open: true, prefill: prefillFrom(query, dob) })}
          >
            <UserPlus />
            {t("identity.desk.registerNew")}
          </Button>
        }
      />

      <div className="surface-card flex flex-wrap items-end gap-3 p-4">
        <div className="flex min-w-[16rem] flex-[3] flex-col gap-1.5">
          <label htmlFor="desk-search" className="text-[0.8125rem] font-medium">
            {t("identity.desk.searchLabel")}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="desk-search"
              data-testid="reception-search"
              value={query}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={t("identity.desk.searchPlaceholder")}
              onChange={(event) => {
                setQuery(event.target.value)
                setResultsOpen(true)
              }}
              className="h-11 pr-10 pl-9 text-[0.9375rem]"
            />
            {query ? (
              <button
                type="button"
                aria-label={t("common.clear")}
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-raised hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-[11rem] flex-1 flex-col gap-1.5">
          <label htmlFor="desk-dob" className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
            <CalendarDays className="size-3.5 text-muted-foreground" />
            {t("identity.desk.dobFilter")}
          </label>
          <div className="flex gap-1.5">
            <DmyInput
              id="desk-dob"
              data-testid="reception-dob"
              value={dob}
              onChange={(iso) => {
                setDob(iso)
                setResultsOpen(true)
              }}
              className="h-11"
            />
            {dob ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t("identity.desk.clearDob")}
                onClick={() => setDob("")}
              >
                <X />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "grid min-w-0 items-start gap-4",
          hasSearch && selectedId && "@[62rem]/desk:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
        )}
      >
        {hasSearch ? (
          <SearchResults
            className={collapsed ? "hidden @[62rem]/desk:flex" : undefined}
            result={result}
            selectedId={selectedId}
            onPick={(patient) => pick(patient.id)}
            onRegister={() => setRegister({ open: true, prefill: prefillFrom(query, dob) })}
            onAddToHousehold={(phone) => setRegister({ open: true, prefill: { phone } })}
          />
        ) : null}

        {selectedId ? (
          <div className="flex min-w-0 flex-col gap-2">
            {hasSearch && collapsed ? (
              <Button
                variant="link"
                size="sm"
                className="self-start @[62rem]/desk:hidden"
                onClick={() => setResultsOpen(true)}
              >
                <ChevronLeft />
                {t("identity.desk.backToResults")}
              </Button>
            ) : null}
            <PatientPanel
              patientId={selectedId}
              onSelect={pick}
              onClose={() => {
                setSelectedId(null)
                setResultsOpen(true)
              }}
            />
          </div>
        ) : null}

        {!selectedId && !hasSearch ? (
          <div className="surface-card">
            <EmptyState
              icon={UsersRound}
              title={t("identity.desk.idleTitle")}
              description={t("identity.desk.idleHint")}
              action={{
                label: t("identity.desk.registerNew"),
                onClick: () => setRegister({ open: true }),
              }}
            />
          </div>
        ) : null}
      </div>

      <RegisterSheet
        open={register.open}
        prefill={register.prefill}
        onOpenChange={(open) => {
          setRegister((current) => ({ ...current, open }))
          if (!open) replaceParam("register", null)
        }}
        onDone={onRegistered}
      />
    </div>
  )
}
