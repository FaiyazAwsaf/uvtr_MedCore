"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { ClipboardPlus, Info, SearchX } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { nameIn } from "@/components/shared/person"
import { UhidText } from "@/components/shared/uhid-text"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDb } from "@/core/db/DbProvider"
import { usePersona } from "@/core/session/persona"
import { canAccess } from "@/core/rbac/routes"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import { useLibraryHref, useRxEncounter } from "../hooks"
import { addToRxPath, encounterPath, libraryPaths } from "../paths"

export type Crumb = { label: React.ReactNode; href?: string }

/**
 * Frame for every library page: breadcrumbs, the Rx-pad bar when the library
 * was opened from a prescription, the page, and the demo-data footer
 * (plan §11: "Demo data: not for clinical use" in the library).
 */
export function LibraryShell({
  crumbs,
  rxBrandId,
  className,
  children,
}: {
  /** Trail after "Medicine library"; the last one is the current page */
  crumbs?: Crumb[]
  /** On a brand page in Rx-pad mode: offers "Add to prescription" */
  rxBrandId?: string
  className?: string
  children: React.ReactNode
}) {
  const { t } = useLocale()
  const href = useLibraryHref()
  const encounterId = useRxEncounter()
  const trail = crumbs ?? []

  return (
    <div
      data-slot="library-shell"
      className={cn("flex w-full flex-1 flex-col gap-4 py-2", className)}
    >
      {encounterId ? <RxBar encounterId={encounterId} brandId={rxBrandId} /> : null}
      {trail.length ? (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={href(libraryPaths.home)} />}>
                {t("library.title")}
              </BreadcrumbLink>
            </BreadcrumbItem>
            {trail.map((crumb, index) => (
              <React.Fragment key={index}>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  {index === trail.length - 1 ? (
                    <BreadcrumbPage lang="en" className="truncate">
                      {crumb.label}
                    </BreadcrumbPage>
                  ) : crumb.href ? (
                    <BreadcrumbLink render={<Link href={href(crumb.href)} />}>
                      {crumb.label}
                    </BreadcrumbLink>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      {children}
      <LibraryFooter />
    </div>
  )
}

/** "Demo data: not for clinical use" (plan §11), on every library page. */
export function LibraryFooter() {
  const { t } = useLocale()
  return (
    <footer
      data-testid="library-footer"
      className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-hairline pt-3 text-xs text-muted-foreground"
    >
      <Info className="size-3.5 shrink-0" />
      <span className="font-medium text-foreground/85">{t("common.demoData")}</span>
      <span>{t("library.footer.note")}</span>
    </footer>
  )
}

/**
 * Rx-pad mode (WS-B): the patient this prescription is for, a way back, and
 * on a brand page "Add to prescription", which returns to the consultation
 * with `?addBrand=<brandId>`. Offered only to roles that can open the
 * consultation screen.
 */
function RxBar({ encounterId, brandId }: { encounterId: string; brandId?: string }) {
  const { t, locale } = useLocale()
  const db = useDb()
  const persona = usePersona()
  const target = encounterPath(encounterId)
  const canPrescribe = !!persona && canAccess(persona.role, target)
  const patient = useLiveQuery(async () => {
    const encounter = await db.encounters.get(encounterId)
    return encounter ? ((await db.patients.get(encounter.patientId)) ?? null) : null
  }, [db, encounterId])

  return (
    <section
      data-testid="rx-mode-bar"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/35 bg-primary-soft px-4 py-3"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <ClipboardPlus className="size-[1.0625rem]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t("library.rx.title")}</p>
        <p className="flex flex-wrap items-baseline gap-x-2 text-[0.8125rem] text-muted-foreground">
          {patient ? (
            <>
              <span>{t("library.rx.forPatient", { name: nameIn(patient, locale) })}</span>
              <UhidText uhid={patient.uhid} className="text-xs" />
            </>
          ) : (
            <span>{t("library.rx.hint")}</span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canPrescribe ? (
          <Button variant="neutral" size="sm" nativeButton={false} render={<Link href={target} />}>
            {t("library.rx.back")}
          </Button>
        ) : null}
        {canPrescribe && brandId ? (
          <Button
            size="sm"
            data-testid="add-to-rx"
            nativeButton={false}
            render={<Link href={addToRxPath(encounterId, brandId)} />}
          >
            <ClipboardPlus />
            {t("library.rx.add")}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

/** Placeholder while a window reads the dictionary for the first time. */
export function LibraryLoading() {
  const { t } = useLocale()
  return (
    <div className="flex flex-col gap-4 py-2" aria-busy="true" aria-label={t("library.loading")}>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  )
}

/** A library page whose id is unknown (an old link or a typo). */
export function LibraryNotFound({ title }: { title: React.ReactNode }) {
  const { t } = useLocale()
  const href = useLibraryHref()
  return (
    <LibraryShell>
      <div className="surface-card flex flex-1 flex-col">
        <EmptyState
          icon={SearchX}
          title={title}
          description={t("library.brand.notFoundHint")}
          action={{ label: t("library.title"), href: href(libraryPaths.home) }}
        />
      </div>
    </LibraryShell>
  )
}
