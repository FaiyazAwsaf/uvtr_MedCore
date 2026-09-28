"use client"

import * as React from "react"
import { FileQuestion } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { OrdersCard } from "@/modules/orders/components/orders-card"
import { RxPad } from "@/modules/prescribing/components/rx-pad"

import {
  useEncounterCore,
  useLabCatalog,
  useMedicineCatalog,
  useNotes,
  useScribeDraft,
} from "../data"
import { EncounterHeader, scrollToSection } from "./encounter-header"
import { NoteEditor } from "./note-editor"
import { PatientSummary } from "./patient-summary"
import { ScribePanel } from "./scribe-panel"
import { VitalsCard } from "./vitals-card"

const SECTIONS = [
  { id: "enc-summary", key: "summary" },
  { id: "enc-note", key: "note" },
  { id: "enc-rx", key: "prescription" },
  { id: "enc-tests", key: "tests" },
] as const

/**
 * The consultation screen (plan §9 `/doctor/encounter/[id]`): identity and
 * visit context, the patient summary and vitals, the AI scribe beside the
 * note, the Rx pad and the test orders. One scrolling page with a sticky
 * section bar, so it works in a 960x600 quadrant and at full width.
 */
export function EncounterScreen({
  encounterId,
  addBrandId,
}: {
  encounterId: string
  /** A brand to open on the Rx pad (the library's "Add to prescription") */
  addBrandId?: string
}) {
  const { t } = useLocale()
  const core = useEncounterCore(encounterId)
  const notes = useNotes(encounterId)
  const scribe = useScribeDraft(encounterId)
  const catalog = useMedicineCatalog()
  const labs = useLabCatalog()
  const flushRef = React.useRef<() => Promise<void>>(async () => undefined)
  const registerFlush = React.useCallback((flush: () => Promise<void>) => {
    flushRef.current = flush
  }, [])
  const flushNote = React.useCallback(() => flushRef.current(), [])
  const labTestName = React.useCallback(
    (testId: string) => labs?.byId.get(testId)?.name ?? testId,
    [labs]
  )

  if (core === undefined) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-20 rounded-lg" />
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </div>
    )
  }
  if (core === null) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={t("consultation.encounter.notFound")}
        description={t("consultation.encounter.notFoundHint")}
        action={{
          label: t("consultation.encounter.backToWorklist"),
          href: "/doctor",
        }}
      />
    )
  }

  const { encounter, patient } = core
  const closed = encounter.status === "closed"
  const latest = notes?.[0]
  const diagnoses = latest?.diagnoses ?? []

  return (
    <div
      className="@container/enc flex flex-col gap-4"
      data-testid="encounter-page"
      data-encounter-id={encounter.id}
      data-patient-id={patient.id}
      data-status={encounter.status}
    >
      <EncounterHeader core={core} latestNote={latest} />

      <nav
        aria-label={t("consultation.title")}
        className="sticky -top-2 z-20 -mx-1 -mt-2 flex gap-1 overflow-x-auto bg-background px-1 pt-3 pb-2"
      >
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => scrollToSection(section.id)}
            data-testid={`encounter-nav-${section.key}`}
            className="h-8 shrink-0 rounded-full bg-surface-raised px-3.5 text-[0.8125rem] font-medium text-foreground/85 transition-colors hover:bg-primary-soft hover:text-foreground"
          >
            {t(`consultation.encounter.nav.${section.key}`)}
          </button>
        ))}
      </nav>

      <div
        className={cn(
          "grid items-start gap-4",
          "[grid-template-areas:'profile'_'work'_'history']",
          "@min-[78rem]/enc:grid-cols-[minmax(0,1fr)_22rem] @min-[78rem]/enc:grid-rows-[auto_1fr]",
          "@min-[78rem]/enc:[grid-template-areas:'work_profile'_'work_history']"
        )}
      >
        <div
          className="flex min-w-0 scroll-mt-14 flex-col gap-4 [grid-area:profile]"
          id="enc-summary"
        >
          <VitalsCard encounter={encounter} readOnly={closed} />
          <PatientSummary
            patient={patient}
            encounterId={encounter.id}
            tests={labs?.byId}
            part="profile"
          />
        </div>

        <div className="@container/work flex min-w-0 flex-col gap-4 [grid-area:work]">
          <div className="grid items-start gap-4 @min-[60rem]/work:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <ScribePanel
              encounter={encounter}
              draft={scribe}
              note={latest}
              readOnly={closed}
              flushNote={flushNote}
            />
            <div id="enc-note" className="min-w-0 scroll-mt-14">
              <NoteEditor
                encounter={encounter}
                notes={notes}
                specialtyCode={core.specialty?.code}
                readOnly={closed}
                registerFlush={registerFlush}
              />
            </div>
          </div>
          <div id="enc-rx" className="min-w-0 scroll-mt-14">
            <RxPad
              addBrandId={addBrandId}
              encounter={encounter}
              patient={patient}
              doctor={core.doctor}
              doctorStaff={core.doctorStaff}
              catalog={catalog}
              labTestName={labTestName}
              diagnoses={diagnoses}
              readOnly={closed}
            />
          </div>
          <div id="enc-tests" className="min-w-0 scroll-mt-14">
            <OrdersCard
              encounter={encounter}
              tests={labs}
              indicationHint={latest?.sections.chiefComplaint ?? ""}
              readOnly={closed}
            />
          </div>
        </div>

        <div className="min-w-0 [grid-area:history]">
          <PatientSummary
            patient={patient}
            encounterId={encounter.id}
            tests={labs?.byId}
            part="history"
          />
        </div>
      </div>
    </div>
  )
}
