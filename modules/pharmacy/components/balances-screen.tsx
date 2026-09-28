"use client"

import * as React from "react"
import Link from "next/link"
import { useLiveQuery } from "dexie-react-hooks"
import { BellRing, CalendarClock } from "lucide-react"
import { toast } from "sonner"

import { rules } from "@/config/rules.config"
import { PatientAvatar } from "@/components/shared/avatars"
import { EmptyState } from "@/components/shared/empty-state"
import { nameIn } from "@/components/shared/person"
import { StatusText } from "@/components/shared/status"
import { StockBadge } from "@/components/shared/stock-badge"
import { UhidText } from "@/components/shared/uhid-text"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { now } from "@/core/clock/clock"
import { dhakaDate } from "@/core/clock/dates"
import { useNow } from "@/core/clock/useNow"
import { useDb } from "@/core/db/DbProvider"
import type { BatchRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"
import { usableUnits } from "@/modules/inventory/stock"

import { notifyBalanceReady } from "../commands"
import { balanceDaysLeft, balanceExpired, outstandingOf } from "../rules"
import {
  brandText,
  PageBody,
  PageHeader,
  unique,
  useModuleCommand,
  usePharmacyContext,
} from "./shared"

export function BalancesScreen() {
  const { t, num, dmy, locale } = useLocale()
  const db = useDb()
  const { branch, branchLabel } = usePharmacyContext()
  const nowMs = useNow(60_000) || now()
  const [showExpired, setShowExpired] = React.useState(false)
  const notify = useModuleCommand(notifyBalanceReady)

  const rows = useLiveQuery(async () => {
    if (!branch) return []
    const lines = (await db.rxLines.where("status").equals("partial").toArray()).filter(
      (l) => l.branchId === branch
    )
    const [rxs, patients, brands] = await Promise.all([
      db.prescriptions.bulkGet(unique(lines.map((l) => l.rxId))),
      db.patients.bulkGet(unique(lines.map((l) => l.patientId))),
      db.brands.bulkGet(unique(lines.map((l) => l.brandId))),
    ])
    const levels = (
      await db.stockLevels.where("brandId").anyOf(unique(lines.map((l) => l.brandId))).toArray()
    ).filter((l) => l.branchId === branch)
    const batches = (await db.batches.bulkGet(unique(levels.map((l) => l.batchId)))).filter(
      (b): b is BatchRow => !!b
    )
    const today = dhakaDate(now())
    return lines.map((line) => ({
      line,
      rx: rxs.find((r) => r?.id === line.rxId),
      patient: patients.find((p) => p?.id === line.patientId),
      brand: brands.find((b) => b?.id === line.brandId),
      usable: usableUnits(levels.filter((l) => l.brandId === line.brandId), batches, today),
    }))
  }, [db, branch])

  const visible = (rows ?? [])
    .filter((r) => showExpired || !balanceExpired(r.line, nowMs))
    .sort((a, b) => (a.line.balanceUntil ?? 0) - (b.line.balanceUntil ?? 0))

  return (
    <PageBody data-testid="balances-screen">
      <PageHeader
        title={t("pharmacy.balances.title")}
        subtitle={`${branchLabel} · ${t("pharmacy.balances.subtitle", {
          days: num(rules.dispenseBalanceDays),
        })}`}
        actions={
          <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <Switch checked={showExpired} onCheckedChange={setShowExpired} />
            {t("pharmacy.balances.showExpired")}
          </label>
        }
      />
      <section className="@container/b surface-card flex min-w-0 flex-col gap-3 p-4">
        {rows && visible.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t("pharmacy.balances.empty")}
            description={t("pharmacy.balances.emptyHint")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pharmacy.balances.col.patient")}</TableHead>
                <TableHead>{t("pharmacy.balances.col.medicine")}</TableHead>
                <TableHead className="hidden text-right @min-[40rem]/b:table-cell">
                  {t("pharmacy.balances.col.given")}
                </TableHead>
                <TableHead className="text-right">{t("pharmacy.balances.col.outstanding")}</TableHead>
                <TableHead>{t("pharmacy.balances.col.until")}</TableHead>
                <TableHead className="hidden @min-[48rem]/b:table-cell">
                  {t("pharmacy.balances.col.stock")}
                </TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(({ line, rx, patient, brand, usable }) => {
                const expired = balanceExpired(line, nowMs)
                const days = line.balanceUntil ? balanceDaysLeft(line.balanceUntil, nowMs) : 0
                const outstanding = outstandingOf(line)
                const ready = !expired && usable >= outstanding
                return (
                  <TableRow key={line.id} data-testid="balance-row" data-rx-line-id={line.id}>
                    <TableCell>
                      {patient ? (
                        <span className="flex min-w-0 items-center gap-2.5">
                          <PatientAvatar patient={patient} size={28} />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{nameIn(patient, locale)}</span>
                            <UhidText uhid={patient.uhid} className="text-[0.6875rem] text-muted-foreground" />
                          </span>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="block font-medium" lang="en">
                        {brandText(brand)}
                      </span>
                      <span className="font-mono text-[0.6875rem] text-muted-foreground" lang="en">
                        {rx?.rxNo}
                      </span>
                    </TableCell>
                    <TableCell className="nums hidden text-right @min-[40rem]/b:table-cell">
                      {num(line.dispensedQty)} / {num(line.qtyPrescribed)}
                    </TableCell>
                    <TableCell className="nums text-right font-semibold text-warning">
                      {num(outstanding)}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="nums">{line.balanceUntil ? dmy(line.balanceUntil) : ""}</span>
                        <StatusText
                          tone={expired ? "destructive" : days <= 1 ? "warning" : "muted"}
                          className="text-[0.6875rem]"
                        >
                          {expired
                            ? t("pharmacy.balances.expired")
                            : days <= 0
                              ? t("pharmacy.balances.lastDay")
                              : t("pharmacy.balances.daysLeft", { count: num(days) })}
                        </StatusText>
                      </span>
                    </TableCell>
                    <TableCell className="hidden @min-[48rem]/b:table-cell">
                      <StockBadge status={usable > 0 ? (ready ? "in-stock" : "low") : "out"} qty={usable} />
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center justify-end gap-2">
                        {ready ? (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={notify.pending}
                            onClick={async () => {
                              const done = await notify.run({
                                rxLineId: line.id,
                                smsLang: "bn",
                              })
                              if (done) toast.success(t("pharmacy.balances.notified"))
                            }}
                          >
                            <BellRing />
                            {t("pharmacy.balances.notify")}
                          </Button>
                        ) : null}
                        {!expired ? (
                          <Link
                            href={`/pharmacy/dispense/${line.rxId}`}
                            className={cn(
                              "text-[0.8125rem] font-medium whitespace-nowrap text-link underline-offset-4 hover:underline"
                            )}
                          >
                            {t("pharmacy.balances.dispense")}
                          </Link>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </PageBody>
  )
}
