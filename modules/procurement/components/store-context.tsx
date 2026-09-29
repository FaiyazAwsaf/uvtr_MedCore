"use client"

import * as React from "react"
import { Building2 } from "lucide-react"
import { create } from "zustand"

import { branches, type BranchCode } from "@/config/brand.config"
import { useDbInfo } from "@/core/db/DbProvider"
import { usePersona } from "@/core/session/persona"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { NativeSelect } from "@/modules/identity/components/desk-ui"
import { branchName } from "@/modules/pharmacy/components/shared"

/** Branches that hold medicine stock (the pharmacy branches). */
export const STOCK_BRANCHES: BranchCode[] = branches
  .filter((b) => b.services.includes("pharmacy"))
  .map((b) => b.code)

type ChosenBranch = {
  branch: BranchCode | null
  set: (branch: BranchCode | null) => void
}

/** The branch a network-level persona is looking at, kept while moving between store screens. */
const useChosen = create<ChosenBranch>()((set) => ({
  branch: null,
  set: (branch) => set({ branch }),
}))

/**
 * The store screens' branch: a branch persona (Habibur at Dhanmondi) always
 * works on their own branch; a network-level persona (the head of
 * procurement, the CFO) picks one, or `null` for the network view.
 */
export function useStoreBranch() {
  const persona = usePersona()
  const { locale, t } = useLocale()
  const { isEdge } = useDbInfo()
  const chosen = useChosen((s) => s.branch)
  const setBranch = useChosen((s) => s.set)
  const own = persona?.branchId ?? null
  const branch = own ?? chosen
  return {
    persona,
    branch,
    /** True for branch personas: the branch cannot change */
    fixed: own !== null,
    setBranch,
    label: branch ? branchName(branch, locale) : t("procurement.common.allBranches"),
    staffId: persona?.staff?.id ?? null,
    authorities: persona?.staff?.authorities ?? [],
    isEdge,
  }
}

/**
 * The branch control in a store screen's header: a plain chip for branch
 * personas, a select with "All branches" for network-level personas.
 */
export function StoreBranchPicker({
  allowNetwork = true,
  className,
}: {
  /** Offer "All branches" (screens that need one branch pass false) */
  allowNetwork?: boolean
  className?: string
}) {
  const { t, locale } = useLocale()
  const { branch, fixed, setBranch } = useStoreBranch()
  if (fixed) {
    return (
      <span
        data-testid="store-branch"
        data-branch={branch ?? ""}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-raised px-3 text-[0.8125rem] font-medium",
          className
        )}
      >
        <Building2 className="size-3.5 text-link" />
        {branchName(branch, locale)}
      </span>
    )
  }
  return (
    <label className={cn("flex items-center gap-2", className)}>
      <span className="sr-only">{t("procurement.common.branch")}</span>
      <NativeSelect
        data-testid="store-branch"
        data-branch={branch ?? ""}
        value={branch ?? ""}
        onChange={(event) => setBranch((event.target.value || null) as BranchCode | null)}
        className="h-8 min-w-44 text-[0.8125rem]"
      >
        {allowNetwork || !branch ? (
          <option value="">
            {allowNetwork
              ? t("procurement.common.allBranches")
              : t("procurement.common.chooseBranch")}
          </option>
        ) : null}
        {STOCK_BRANCHES.map((code) => (
          <option key={code} value={code}>
            {branchName(code, locale)}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
}

/** Shown by single-branch screens while a network-level persona has no branch picked. */
export function ChooseBranchNote({ children }: { children?: React.ReactNode }) {
  const { t } = useLocale()
  return (
    <section className="surface-card flex flex-col items-center gap-3 p-8 text-center">
      <span className="icon-well flex size-12 items-center justify-center text-muted-foreground">
        <Building2 className="size-5" />
      </span>
      <p className="text-sm font-medium">{t("procurement.common.chooseBranch")}</p>
      <p className="max-w-[40ch] text-[0.8125rem] text-muted-foreground">
        {children ?? t("procurement.common.chooseBranchHint")}
      </p>
      <StoreBranchPicker allowNetwork={false} />
    </section>
  )
}
