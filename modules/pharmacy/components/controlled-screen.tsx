"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { Lock, ShieldCheck } from "lucide-react"

import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { nameIn } from "@/components/shared/person"
import { SectionCard } from "@/components/shared/section-card"
import { UhidText } from "@/components/shared/uhid-text"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useDb } from "@/core/db/DbProvider"
import { useLocale } from "@/lib/i18n/provider"

import { brandText, PageBody, PageHeader, unique, usePharmacyContext } from "./shared"

export function ControlledScreen() {
  const { t, num, locale } = useLocale()
  const db = useDb()
  const { branch, branchLabel } = usePharmacyContext()

  const data = useLiveQuery(async () => {
    if (!branch) return { rows: [], custody: [] }
    const register = await db.controlledRegister.where("branchId").equals(branch).toArray()
    const controlled = await db.brands.where("category").equals("controlled").toArray()
    const levels = (
      await db.stockLevels.where("brandId").anyOf(controlled.map((b) => b.id)).toArray()
    ).filter((l) => l.branchId === branch)
    const dispenses = await db.dispenses.bulkGet(register.map((r) => r.dispenseId))
    const [rxs, patients, staff] = await Promise.all([
      db.prescriptions.bulkGet(unique(register.map((r) => r.rxId))),
      db.patients.bulkGet(unique(dispenses.map((d) => d?.patientId))),
      db.staff.bulkGet(
        unique([...dispenses.map((d) => d?.pharmacistId), ...register.map((r) => r.witnessId)])
      ),
    ])
    const brandById = new Map(controlled.map((b) => [b.id, b]))
    return {
      rows: register
        .sort((a, b) => b.at - a.at)
        .map((row) => {
          const dispense = dispenses.find((d) => d?.id === row.dispenseId)
          return {
            row,
            brand: brandById.get(row.brandId),
            rx: rxs.find((r) => r?.id === row.rxId),
            patient: patients.find((p) => p?.id === dispense?.patientId),
            pharmacist: staff.find((s) => s?.id === dispense?.pharmacistId),
            witness: staff.find((s) => s?.id === row.witnessId),
          }
        }),
      custody: controlled
        .map((brand) => {
          const own = levels.filter((l) => l.brandId === brand.id)
          return {
            brand,
            units: own.reduce((sum, l) => sum + Math.max(0, l.qty) + Math.max(0, l.quarantinedQty), 0),
            stocked: own.length > 0,
          }
        })
        .filter((c) => c.stocked)
        .sort((a, b) => brandText(a.brand).localeCompare(brandText(b.brand))),
    }
  }, [db, branch])

  return (
    <PageBody data-testid="controlled-screen">
      <PageHeader
        title={t("pharmacy.controlled.title")}
        subtitle={t("pharmacy.controlled.subtitle", { branch: branchLabel })}
      />

      <SectionCard
        title={t("pharmacy.controlled.stock")}
        subtitle={t("pharmacy.controlled.stockHint")}
        icon={ShieldCheck}
        size="sm"
      >
        <div className="flex flex-wrap gap-2">
          {(data?.custody ?? []).map(({ brand, units }) => (
            <span
              key={brand.id}
              className="inline-flex h-8 items-center gap-2 rounded-full bg-surface-raised px-3 text-[0.8125rem]"
            >
              <span lang="en">{brandText(brand)}</span>
              <span className="nums font-semibold">{num(units)}</span>
            </span>
          ))}
        </div>
      </SectionCard>

      <section className="@container/c surface-card flex min-w-0 flex-col gap-3 p-4">
        {data && data.rows.length === 0 ? (
          <EmptyState
            icon={Lock}
            title={t("pharmacy.controlled.empty")}
            description={t("pharmacy.controlled.emptyHint")}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pharmacy.controlled.col.time")}</TableHead>
                <TableHead>{t("pharmacy.controlled.col.medicine")}</TableHead>
                <TableHead className="text-right">{t("pharmacy.controlled.col.qty")}</TableHead>
                <TableHead className="text-right">{t("pharmacy.controlled.col.balance")}</TableHead>
                <TableHead className="hidden @min-[40rem]/c:table-cell">
                  {t("pharmacy.controlled.col.rx")}
                </TableHead>
                <TableHead className="hidden @min-[50rem]/c:table-cell">
                  {t("pharmacy.controlled.col.patient")}
                </TableHead>
                <TableHead className="hidden @min-[58rem]/c:table-cell">
                  {t("pharmacy.controlled.col.pharmacist")}
                </TableHead>
                <TableHead className="hidden @min-[64rem]/c:table-cell">
                  {t("pharmacy.controlled.col.witness")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map(({ row, brand, rx, patient, pharmacist, witness }) => (
                <TableRow key={row.id} data-testid="controlled-row">
                  <TableCell className="text-muted-foreground">
                    <DateText value={row.at} variant="dmyTime" />
                  </TableCell>
                  <TableCell className="font-medium" lang="en">
                    {brandText(brand)}
                  </TableCell>
                  <TableCell className="nums text-right">{num(row.qty)}</TableCell>
                  <TableCell className="nums text-right font-semibold">
                    {num(row.runningBalance)}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs @min-[40rem]/c:table-cell" lang="en">
                    {rx?.rxNo}
                  </TableCell>
                  <TableCell className="hidden @min-[50rem]/c:table-cell">
                    {patient ? (
                      <span className="flex flex-col">
                        <span>{nameIn(patient, locale)}</span>
                        <UhidText uhid={patient.uhid} className="text-[0.6875rem] text-muted-foreground" />
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden @min-[58rem]/c:table-cell">
                    {pharmacist ? (
                      <span className="flex flex-col">
                        <span>{nameIn(pharmacist, locale)}</span>
                        <span className="font-mono text-[0.6875rem] text-muted-foreground" lang="en">
                          {pharmacist.regNo}
                        </span>
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground @min-[64rem]/c:table-cell">
                    {witness ? nameIn(witness, locale) : t("pharmacy.controlled.noWitness")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </PageBody>
  )
}
