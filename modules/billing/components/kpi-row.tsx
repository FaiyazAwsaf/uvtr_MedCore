"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Banknote, Hourglass, Smartphone, Wallet } from "lucide-react"

import { KpiCard } from "@/components/shared/kpi-card"
import type { BranchCode } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import { useLocale } from "@/lib/i18n/provider"

import { todayKpisAt } from "../queries"

/** A KPI value that shrinks in a narrow card instead of being cut off. */
function Figure({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[1.25rem] @min-[15rem]/kpi:text-[1.625rem]">{children}</span>
  )
}

/** A caption that only shows when the card is wide enough for it. */
function Caption({ children }: { children: React.ReactNode }) {
  return <span className="hidden @min-[14rem]/kpi:inline">{children}</span>
}

/** Compact in a quadrant; the full sample size once the row is wide (row container). */
const CARD = "min-h-[5.75rem] gap-2.5 p-4 @min-[60rem]/kpis:min-h-[7rem] @min-[60rem]/kpis:p-5"

/**
 * Today's collections at this branch, live (plan §9 `/cashier`): collected by
 * tender, bKash and Nagad still waiting for approval, and invoices issued.
 * Four across even in a 960x600 quadrant, where the cards turn compact.
 */
export function CashierKpis({ branch, today }: { branch: BranchCode; today: string }) {
  const db = useDb()
  const { t, money, num } = useLocale()
  const kpis = useLiveQuery(() => todayKpisAt(db, branch, today), [db, branch, today])

  const cardMfs = kpis ? kpis.byTender.card + kpis.byTender.bkash + kpis.byTender.nagad : 0
  const cardMfsCount = kpis
    ? (kpis.payments.card ?? 0) + (kpis.payments.bkash ?? 0) + (kpis.payments.nagad ?? 0)
    : 0

  return (
    <section
      aria-label={t("billing.cashier.kpi.label")}
      data-testid="cashier-kpis"
      className="@container/kpis"
    >
      <div className="grid grid-cols-2 gap-3 @min-[44rem]/kpis:grid-cols-4 @min-[66rem]/kpis:gap-4">
        <KpiCard
          variant="cyan"
          icon={Wallet}
          className={CARD}
          title={t("billing.cashier.kpi.collected")}
          value={<Figure>{money(kpis?.collectedP ?? 0)}</Figure>}
          caption={
            <Caption>{t("billing.cashier.kpi.invoices", { count: num(kpis?.invoices ?? 0) })}</Caption>
          }
        />
        <KpiCard
          variant="yellow"
          icon={Banknote}
          className={CARD}
          title={t("billing.tender.cash")}
          value={<Figure>{money(kpis?.byTender.cash ?? 0)}</Figure>}
          caption={
            <Caption>
              {t("billing.cashier.kpi.payments", { count: num(kpis?.payments.cash ?? 0) })}
            </Caption>
          }
        />
        <KpiCard
          variant="pink"
          icon={Smartphone}
          className={CARD}
          title={t("billing.cashier.kpi.cardMfs")}
          value={
            <span
              title={`${t("billing.tender.card")} ${money(kpis?.byTender.card ?? 0)} · ${t("billing.tender.bkash")} ${money(kpis?.byTender.bkash ?? 0)} · ${t("billing.tender.nagad")} ${money(kpis?.byTender.nagad ?? 0)}`}
            >
              <Figure>{money(cardMfs)}</Figure>
            </span>
          }
          caption={
            <Caption>{t("billing.cashier.kpi.payments", { count: num(cardMfsCount) })}</Caption>
          }
        />
        <KpiCard
          variant="purple"
          icon={Hourglass}
          className={CARD}
          title={t("billing.cashier.kpi.pendingMfs")}
          value={<Figure>{money(kpis?.pendingP ?? 0)}</Figure>}
          caption={
            <Caption>
              {t("billing.cashier.kpi.waiting", { count: num(kpis?.pendingCount ?? 0) })}
            </Caption>
          }
        />
      </div>
    </section>
  )
}
