"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { toast } from "sonner"
import type { z } from "zod"

import { branches, type BranchCode } from "@/config/brand.config"
import { StatusPill, type Tone } from "@/components/shared/status"
import { useDb, useDbInfo } from "@/core/db/DbProvider"
import { newId } from "@/core/db/ids"
import type { BrandRow, PharmacyQueueRow, RxLineRow } from "@/core/db/schema"
import { commit } from "@/core/engine/commit"
import { RuleViolation } from "@/core/engine/errors"
import { feedbackFor, useEngineFeedback } from "@/core/engine/feedback"
import type { CommandDef } from "@/core/engine/types"
import { useActor, usePersona } from "@/core/session/persona"
import { dictionaries, lookup } from "@/lib/i18n"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/* ---------------- Page frame ---------------- */

/** Screen heading: 22px title, a muted context line, actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  back?: { href: string; label: React.ReactNode }
}) {
  return (
    <header className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        {back ? (
          <Link
            href={back.href}
            className="mb-1 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-link underline-offset-4 hover:underline"
          >
            <ChevronLeft className="size-4" />
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-[1.375rem] leading-tight font-semibold">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** The screen body: one column with the shell's horizontal padding. */
export function PageBody({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-4 py-2", className)} {...props}>
      {children}
    </div>
  )
}

/** A pulsing "Live" chip for worklists fed by live queries. */
export function LiveChip() {
  const { t } = useLocale()
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary-soft px-2.5 text-xs font-medium text-link">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      {t("pharmacy.common.live")}
    </span>
  )
}

/* ---------------- Branch and persona ---------------- */

export function branchName(code: BranchCode | null | undefined, locale: "en" | "bn"): string {
  const branch = branches.find((b) => b.code === code)
  return branch ? `${branch.name[locale]} (${branch.code})` : (code ?? "")
}

/** This window's pharmacist: branch, display name of the branch, database mode. */
export function usePharmacyContext() {
  const persona = usePersona()
  const { locale } = useLocale()
  const { isEdge, network } = useDbInfo()
  const branch = persona?.branchId ?? null
  return {
    persona,
    branch,
    branchLabel: branchName(branch, locale),
    staffId: persona?.staff?.id ?? null,
    isEdge,
    network,
  }
}

/* ---------------- Commands ---------------- */

const MODULE_RULE_NAMESPACES = ["pharmacy.rules", "inventory.rules"]

/**
 * Run a pharmacy or inventory command as this window's persona. Rule codes
 * this module defines messages for are explained in a toast in the window's
 * language; everything else (engine rules such as RX_REQUIRED, conflicts,
 * denials) goes to the shared engine dialogs.
 */
export function useModuleCommand<S extends z.ZodType, O>(def: CommandDef<S, O>) {
  const db = useDb()
  const actor = useActor()
  const show = useEngineFeedback((state) => state.show)
  const { tk, locale, num, money } = useLocale()
  const [pending, setPending] = React.useState(false)

  const run = React.useCallback(
    async (input: z.input<S>): Promise<O | undefined> => {
      if (!actor) {
        show({ kind: "no-persona", command: def.name })
        return undefined
      }
      setPending(true)
      try {
        return (await commit(def, input, { db, actor })).result
      } catch (error) {
        if (error instanceof RuleViolation) {
          for (const ns of MODULE_RULE_NAMESPACES) {
            const key = `${ns}.${error.code}`
            if (lookup(dictionaries[locale], key) !== key) {
              const params: Record<string, string | number> = {}
              for (const [name, value] of Object.entries(error.params)) {
                if (typeof value === "number") {
                  params[name] = name.endsWith("P") ? money(value) : num(value)
                } else if (name === "branch") {
                  params[name] = branchName(value as BranchCode, locale)
                } else if (name === "status") {
                  const label = tk(`pharmacy.lineStatus.${value}`)
                  params[name] = label.startsWith("pharmacy.") ? value : label
                } else {
                  params[name] = value
                }
              }
              toast.error(tk(key, params), { id: `rule:${def.name}` })
              return undefined
            }
          }
        }
        show(feedbackFor(error, def.name))
        return undefined
      } finally {
        setPending(false)
      }
    },
    [actor, db, def, show, tk, locale, num, money]
  )
  return { run, pending }
}

/** A fresh idempotency key per user action (double clicks commit once). */
export function useActionKey(): [string, () => void] {
  const [key, setKey] = React.useState(() => newActionKey())
  return [key, () => setKey(newActionKey())]
}

const newActionKey = () => newId("act")

/* ---------------- Labels and badges ---------------- */

export const brandText = (brand: Pick<BrandRow, "name" | "strength"> | undefined) =>
  brand ? `${brand.name} ${brand.strength}`.trim() : ""

const QUEUE_TONE: Record<PharmacyQueueRow["status"], Tone> = {
  waiting: "info",
  "in-progress": "primary",
  partial: "warning",
  done: "success",
  cancelled: "muted",
}

export function QueueStatusPill({ status }: { status: PharmacyQueueRow["status"] }) {
  const { t } = useLocale()
  return (
    <StatusPill tone={QUEUE_TONE[status]} dot>
      {t(`pharmacy.queueStatus.${status}`)}
    </StatusPill>
  )
}

const LINE_TONE: Record<RxLineRow["status"], Tone> = {
  open: "info",
  partial: "warning",
  dispensed: "success",
  "bought-elsewhere": "muted",
  "awaiting-prescriber": "primary",
  cancelled: "muted",
}

export function LineStatusPill({ status }: { status: RxLineRow["status"] }) {
  const { t } = useLocale()
  return (
    <StatusPill tone={LINE_TONE[status]} dot>
      {t(`pharmacy.lineStatus.${status}`)}
    </StatusPill>
  )
}

/** OTC, Rx only or Controlled, plus Antibiotic: the dispensing rule badges. */
export function CategoryBadges({
  brand,
  className,
}: {
  brand: Pick<BrandRow, "category" | "isAntibiotic">
  className?: string
}) {
  const { t } = useLocale()
  const tone: Tone =
    brand.category === "otc" ? "success" : brand.category === "controlled" ? "destructive" : "info"
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <StatusPill tone={tone} className="h-5 px-2 text-[0.6875rem]">
        {t(`pharmacy.category.${brand.category}`)}
      </StatusPill>
      {brand.isAntibiotic ? (
        <StatusPill tone="warning" className="h-5 px-2 text-[0.6875rem]">
          {t("pharmacy.category.antibiotic")}
        </StatusPill>
      ) : null}
    </span>
  )
}

/** Unique values, keeping order and dropping empties. */
export function unique<T>(values: (T | undefined | null)[]): T[] {
  return [...new Set(values.filter((v): v is T => v !== undefined && v !== null))]
}
