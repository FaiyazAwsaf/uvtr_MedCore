"use client"

import * as React from "react"
import { Crown, Home, Phone, SearchX, UserPlus, Users } from "lucide-react"

import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import type { PatientRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import type { DeskSearchResult } from "../search"
import { PersonLine } from "./desk-ui"

type Props = {
  result: DeskSearchResult | undefined
  selectedId: string | null
  onPick: (patient: PatientRow) => void
  /** Register someone new (prefilled from the search) */
  onRegister: () => void
  /** Add a person to the household the search found */
  onAddToHousehold: (phone: string) => void
  className?: string
}

/**
 * What the front desk search found: the whole household for a phone number
 * (name, age, sex, relation and photo only, HAZ-01), or a list of matches.
 */
export function SearchResults({
  result,
  selectedId,
  onPick,
  onRegister,
  onAddToHousehold,
  className,
}: Props) {
  const { t, num, digits } = useLocale()
  if (!result || result.kind === "idle") return null

  if (result.kind === "short") {
    return (
      <p className={cn("px-1 text-[0.8125rem] text-muted-foreground", className)}>
        {t("identity.desk.tooShort")}
      </p>
    )
  }

  if (result.kind === "household") {
    const head = result.household?.headPatientId
    return (
      <section
        data-testid="household-list"
        className={cn("surface-card @container flex min-w-0 flex-col gap-3 p-4", className)}
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="icon-well flex size-9 shrink-0 items-center justify-center text-link">
              {result.household ? <Home className="size-[1.125rem]" /> : <Phone className="size-[1.125rem]" />}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[0.9375rem] font-semibold">
                {result.household ? t("identity.desk.household.title") : t("identity.desk.household.sharedPhone")}
              </h2>
              <p className="nums truncate text-xs text-muted-foreground">
                {digits(result.phone)} ·{" "}
                {t("identity.desk.household.members", { count: num(result.members.length) })}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => onAddToHousehold(result.phone)}>
            <UserPlus />
            {t("identity.desk.household.add")}
          </Button>
        </header>
        {result.members.length ? (
          <>
            <p className="text-xs text-muted-foreground">{t("identity.desk.household.pickHint")}</p>
            <ul className="flex flex-col gap-1">
              {result.members.map((patient) => (
                <li key={patient.id}>
                  <button
                    type="button"
                    data-testid="household-member"
                    data-patient-id={patient.id}
                    aria-pressed={selectedId === patient.id}
                    onClick={() => onPick(patient)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      selectedId === patient.id ? "bg-primary-soft" : "hover:bg-surface-raised"
                    )}
                  >
                    <PersonLine
                      patient={patient}
                      showUhid={false}
                      meta={
                        patient.relationToHead ? (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            {patient.id === head ? <Crown className="size-3 text-warning" /> : null}
                            {patient.id === head
                              ? t("identity.desk.household.head")
                              : t(`common.relation.${patient.relationToHead}`)}
                          </span>
                        ) : null
                      }
                    />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            size="sm"
            icon={Users}
            title={t("identity.desk.noMatch")}
            action={{ label: t("identity.desk.registerNew"), onClick: onRegister }}
          />
        )}
      </section>
    )
  }

  return (
    <section
      data-testid="result-list"
      className={cn("surface-card @container flex min-w-0 flex-col gap-2 p-4", className)}
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-[0.9375rem] font-semibold">
          {t("identity.desk.results", { count: num(result.patients.length) })}
        </h2>
        {result.patients.length ? (
          <Button variant="link" size="sm" onClick={onRegister}>
            {t("identity.desk.notListed")}
          </Button>
        ) : null}
      </header>
      {result.patients.length ? (
        <ul className="flex flex-col gap-1">
          {result.patients.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                data-testid="reception-result"
                data-patient-id={patient.id}
                aria-pressed={selectedId === patient.id}
                onClick={() => onPick(patient)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  selectedId === patient.id ? "bg-primary-soft" : "hover:bg-surface-raised"
                )}
              >
                <PersonLine
                  patient={patient}
                  meta={
                    patient.phone ? (
                      <span className="nums whitespace-nowrap">{digits(patient.phone)}</span>
                    ) : null
                  }
                />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          size="sm"
          icon={SearchX}
          title={t("identity.desk.noMatch")}
          description={t("identity.desk.noMatchHint")}
          action={{ label: t("identity.desk.registerNew"), onClick: onRegister }}
        />
      )}
      {result.more ? (
        <p className="px-1 text-xs text-muted-foreground">{t("identity.desk.more")}</p>
      ) : null}
    </section>
  )
}
