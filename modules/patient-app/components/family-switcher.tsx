"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Check, ChevronDown, ShieldCheck } from "lucide-react"

import { PatientAvatar } from "@/components/shared/avatars"
import { UhidText } from "@/components/shared/uhid-text"
import { ageOn } from "@/core/clock/dates"
import { useDb } from "@/core/db/DbProvider"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"

import type { FamilyMember } from "../lib/family"
import { patientName, useFamily, useToday } from "./data"
import { PhoneSheet } from "./phone"

type SheetState = { open: boolean; setOpen: (open: boolean) => void }
const SheetContext = React.createContext<SheetState | null>(null)

/** Holds the switcher sheet's open state so any screen can open it ("Change"). */
export function FamilySheetProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const value = React.useMemo(() => ({ open, setOpen }), [open])
  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>
}

/** Opens the family switcher sheet. */
export function useOpenFamilySheet(): () => void {
  const state = React.useContext(SheetContext)
  return React.useCallback(() => state?.setOpen(true), [state])
}

/** "Account holder" / "Guardian of a child under 18" / "Adult proxy, consent given". */
export function useMemberKindLabel() {
  const { t } = useLocale()
  return (member: FamilyMember) => t(`patientApp.family.kind.${member.kind}`)
}

/** Unread notification count per allowed member (for the switcher dots). */
function useUnreadByMember(ids: string[]): Map<string, number> {
  const db = useDb()
  const key = ids.join(",")
  const rows = useLiveQuery(
    () => db.notifications.where("patientId").anyOf(key.split(",")).toArray(),
    [db, key]
  )
  return React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows ?? []) {
      if (!row.read && !row.held)
        counts.set(row.patientId, (counts.get(row.patientId) ?? 0) + 1)
    }
    return counts
  }, [rows])
}

/**
 * The family switcher (HAZ-14): the header button shows whose records are on
 * screen; the sheet lists only the account holder and consented members.
 */
export function FamilySwitcher() {
  const { t, locale, dmy, num } = useLocale()
  const { members, member, selectMember } = useFamily()
  const sheet = React.useContext(SheetContext)
  const [localOpen, setLocalOpen] = React.useState(false)
  const open = sheet ? sheet.open : localOpen
  const setOpen = sheet ? sheet.setOpen : setLocalOpen
  const today = useToday()
  const kindLabel = useMemberKindLabel()
  const unread = useUnreadByMember(members.map((m) => m.patient.id))
  const otherUnread = members.some(
    (m) =>
      m.patient.id !== member.patient.id && (unread.get(m.patient.id) ?? 0) > 0
  )

  return (
    <>
      <button
        type="button"
        data-testid="app-family-switch"
        data-patient-id={member.patient.id}
        onClick={() => setOpen(true)}
        aria-label={t("patientApp.header.viewing", {
          name: patientName(member.patient, locale),
        })}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-raised py-1 pr-3 pl-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <span className="relative shrink-0">
          <PatientAvatar patient={member.patient} size={34} />
          {otherUnread ? (
            <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-surface-raised bg-destructive" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] leading-tight font-semibold">
            {patientName(member.patient, locale)}
          </span>
          <span className="block truncate text-[0.6875rem] leading-tight text-muted-foreground">
            {member.kind === "self"
              ? t("patientApp.family.you")
              : t(`patientApp.family.short.${member.kind}`)}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <PhoneSheet
        open={open}
        onOpenChange={setOpen}
        title={t("patientApp.family.title")}
        description={t("patientApp.family.description")}
        testId="app-family-sheet"
      >
        <ul className="flex flex-col gap-2">
          {members.map((m) => {
            const selected = m.patient.id === member.patient.id
            const count = unread.get(m.patient.id) ?? 0
            return (
              <li key={m.patient.id}>
                <button
                  type="button"
                  data-testid="app-family-member"
                  data-patient-id={m.patient.id}
                  aria-pressed={selected}
                  onClick={() => {
                    selectMember(m.patient.id)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    selected
                      ? "border-primary bg-primary-soft"
                      : "border-border hover:border-primary/60"
                  )}
                >
                  <PatientAvatar patient={m.patient} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[0.9375rem] font-semibold">
                        {patientName(m.patient, locale)}
                      </span>
                      {m.kind === "self" ? (
                        <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                          {t("patientApp.family.you")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t("patientApp.common.years", {
                        count: num(ageOn(m.patient.dob, today)),
                      })}
                      {" · "}
                      {t(`common.sexLong.${m.patient.sex}`)}
                      {" · "}
                      <UhidText uhid={m.patient.uhid} />
                    </span>
                    <span className="mt-1 flex items-start gap-1.5 text-xs font-medium text-link">
                      <ShieldCheck className="mt-px size-3.5 shrink-0" />
                      <span className="leading-snug">{kindLabel(m)}</span>
                    </span>
                    {m.link?.grantedAt ? (
                      <span className="mt-0.5 block pl-5 text-[0.6875rem] text-muted-foreground">
                        {t("patientApp.family.since", {
                          date: dmy(m.link.grantedAt),
                        })}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    {selected ? (
                      <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-4" />
                        <span className="sr-only">
                          {t("patientApp.family.selected")}
                        </span>
                      </span>
                    ) : null}
                    {count > 0 ? (
                      <span className="rounded-full bg-destructive px-2 py-0.5 text-[0.6875rem] font-semibold text-white">
                        {t("patientApp.family.newCount", { count: num(count) })}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-surface-raised p-3 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-link" />
          {t("patientApp.family.consentNote")}
        </p>
      </PhoneSheet>
    </>
  )
}
