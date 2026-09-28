"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { PackageOpen, ShieldQuestion, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { TableSearch } from "@/components/motion/data-table"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { nameIn } from "@/components/shared/person"
import { SectionCard } from "@/components/shared/section-card"
import { StatusText } from "@/components/shared/status"
import { UhidText } from "@/components/shared/uhid-text"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/core/db/DbProvider"
import type {
  BatchRow,
  BrandRow,
  DispenseRow,
  PatientRow,
  PrescriptionRow,
} from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

import { resolveReturn, returnToQuarantine } from "../commands"
import {
  brandText,
  PageBody,
  PageHeader,
  unique,
  useActionKey,
  useModuleCommand,
  usePharmacyContext,
} from "./shared"

type ReturnFacts = { returned: number; inQuarantine: number; accepted: number; discarded: number }

type DispenseItem = {
  dispense: DispenseRow
  brand?: BrandRow
  batch?: BatchRow
  patient?: PatientRow
  rx?: PrescriptionRow
  state: ReturnFacts
}

const RECENT = 80

export function ReturnsScreen() {
  const { t, num, locale } = useLocale()
  const db = useDb()
  const { branch, branchLabel } = usePharmacyContext()
  const [query, setQuery] = React.useState("")
  const [returning, setReturning] = React.useState<DispenseItem | null>(null)
  const resolve = useModuleCommand(resolveReturn)

  const items = useLiveQuery(async (): Promise<DispenseItem[]> => {
    if (!branch) return []
    const dispenses = (await db.dispenses.where("branchId").equals(branch).toArray()).sort(
      (a, b) => b.at - a.at
    )
    const movements = (
      await db.stockMovements.where("type").anyOf(["return", "release", "write-off"]).toArray()
    ).filter((m) => m.branchId === branch && m.refs.dispenseId)
    const withReturns = new Set(movements.map((m) => m.refs.dispenseId))
    const shown = [
      ...dispenses.filter((d) => withReturns.has(d.id)),
      ...dispenses.filter((d) => !withReturns.has(d.id)).slice(0, RECENT),
    ]
    const [brands, batches, patients, rxs] = await Promise.all([
      db.brands.bulkGet(unique(shown.map((d) => d.brandId))),
      db.batches.bulkGet(unique(shown.map((d) => d.batchId))),
      db.patients.bulkGet(unique(shown.map((d) => d.patientId))),
      db.prescriptions.bulkGet(unique(shown.map((d) => d.rxId))),
    ])
    return shown.map((dispense) => {
      const own = movements.filter((m) => m.refs.dispenseId === dispense.id)
      const sum = (type: string) =>
        own.filter((m) => m.type === type).reduce((total, m) => total + m.qty, 0)
      const returned = sum("return")
      const released = sum("release")
      const discarded = -sum("write-off")
      return {
        dispense,
        brand: brands.find((b) => b?.id === dispense.brandId),
        batch: batches.find((b) => b?.id === dispense.batchId),
        patient: patients.find((p) => p?.id === dispense.patientId),
        rx: rxs.find((r) => r?.id === dispense.rxId),
        state: {
          returned,
          inQuarantine: returned - released,
          accepted: released - discarded,
          discarded,
        },
      }
    })
  }, [db, branch])

  const quarantined = (items ?? []).filter((i) => i.state.inQuarantine > 0)
  const q = query.trim().toLowerCase()
  const listed = (items ?? [])
    .filter((i) => {
      if (!q) return true
      return (
        (i.rx?.rxNo.toLowerCase().includes(q) ?? false) ||
        brandText(i.brand).toLowerCase().includes(q) ||
        (i.patient?.nameEn.toLowerCase().includes(q) ?? false) ||
        (i.patient?.uhid.includes(q.replace(/\D/g, "") || "~") ?? false)
      )
    })
    .sort((a, b) => b.dispense.at - a.dispense.at)
    .slice(0, 40)

  const decide = async (item: DispenseItem, action: "accept" | "discard") => {
    const done = await resolve.run({ dispenseId: item.dispense.id, action })
    if (done) {
      toast.success(
        t(action === "accept" ? "pharmacy.returns.accepted" : "pharmacy.returns.discarded")
      )
    }
  }

  return (
    <PageBody data-testid="returns-screen">
      <PageHeader title={t("pharmacy.returns.title")} subtitle={t("pharmacy.returns.subtitle")} />

      <SectionCard title={t("pharmacy.returns.quarantine")} icon={ShieldQuestion} size="sm">
        {quarantined.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("pharmacy.returns.quarantineEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline">
            {quarantined.map((item) => (
              <li
                key={item.dispense.id}
                data-testid="quarantine-row"
                className="flex flex-wrap items-center gap-3 py-2 text-[0.8125rem]"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium" lang="en">
                    {num(item.state.inQuarantine)} × {brandText(item.brand)}
                  </span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground" lang="en">
                    {item.batch?.batchNo}
                  </span>
                </span>
                <StatusText tone="warning" dot>
                  {t("pharmacy.returns.state.inQuarantine")}
                </StatusText>
                <Button size="xs" variant="outline" disabled={resolve.pending} onClick={() => decide(item, "accept")}>
                  {t("pharmacy.returns.accept")}
                </Button>
                <Button
                  size="xs"
                  variant="destructive-outline"
                  disabled={resolve.pending}
                  onClick={() => decide(item, "discard")}
                >
                  {t("pharmacy.returns.discard")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <section className="@container/r surface-card flex min-w-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[0.9375rem] font-semibold">
            {t("pharmacy.returns.recent", { branch: branchLabel })}
          </h2>
          <TableSearch
            value={query}
            onChange={setQuery}
            placeholder={t("pharmacy.returns.search")}
            className="ml-auto max-w-72"
          />
        </div>
        {items && listed.length === 0 ? (
          <EmptyState icon={PackageOpen} title={t("pharmacy.returns.empty")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pharmacy.returns.col.time")}</TableHead>
                <TableHead>{t("pharmacy.returns.col.medicine")}</TableHead>
                <TableHead className="hidden @min-[40rem]/r:table-cell">
                  {t("pharmacy.returns.col.batch")}
                </TableHead>
                <TableHead className="text-right">{t("pharmacy.returns.col.qty")}</TableHead>
                <TableHead className="hidden @min-[50rem]/r:table-cell">
                  {t("pharmacy.returns.col.to")}
                </TableHead>
                <TableHead>{t("pharmacy.returns.col.returned")}</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {listed.map((item) => {
                const returnable = item.dispense.qty - item.state.returned
                return (
                  <TableRow key={item.dispense.id} data-testid="return-dispense-row">
                    <TableCell className="text-muted-foreground">
                      <DateText value={item.dispense.at} variant="dmyTime" />
                    </TableCell>
                    <TableCell>
                      <span className="block font-medium" lang="en">
                        {brandText(item.brand)}
                      </span>
                      <span className="font-mono text-[0.6875rem] text-muted-foreground" lang="en">
                        {item.rx?.rxNo ?? t("pharmacy.common.counterSale")}
                      </span>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs @min-[40rem]/r:table-cell" lang="en">
                      {item.batch?.batchNo}
                    </TableCell>
                    <TableCell className="nums text-right">{num(item.dispense.qty)}</TableCell>
                    <TableCell className="hidden @min-[50rem]/r:table-cell">
                      {item.patient ? (
                        <span className="flex flex-col">
                          <span>{nameIn(item.patient, locale)}</span>
                          <UhidText uhid={item.patient.uhid} className="text-[0.6875rem] text-muted-foreground" />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("pharmacy.common.counterSale")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.state.returned > 0 ? (
                        <StatusText
                          tone={item.state.inQuarantine > 0 ? "warning" : item.state.discarded ? "destructive" : "success"}
                          className="text-xs"
                        >
                          {num(item.state.returned)} ·{" "}
                          {item.state.inQuarantine > 0
                            ? t("pharmacy.returns.state.inQuarantine")
                            : item.state.discarded
                              ? t("pharmacy.returns.state.discarded")
                              : t("pharmacy.returns.state.accepted")}
                        </StatusText>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Button
                        data-testid="return-open"
                        variant="link"
                        size="xs"
                        disabled={returnable <= 0}
                        onClick={() => setReturning(item)}
                      >
                        <Undo2 />
                        {t("pharmacy.returns.return")}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <ReturnDialog item={returning} onClose={() => setReturning(null)} />
    </PageBody>
  )
}

function ReturnDialog({ item, onClose }: { item: DispenseItem | null; onClose: () => void }) {
  const { t, num } = useLocale()
  const [qty, setQty] = React.useState("1")
  const [reason, setReason] = React.useState("")
  const [key, renewKey] = useActionKey()
  const command = useModuleCommand(returnToQuarantine)
  const max = item ? item.dispense.qty - item.state.returned : 0
  const units = Math.round(Number(qty) || 0)

  const close = () => {
    setQty("1")
    setReason("")
    onClose()
  }
  const submit = async () => {
    if (!item) return
    const done = await command.run({
      dispenseId: item.dispense.id,
      qty: units,
      reason: reason.trim(),
      idempotencyKey: key,
    })
    if (done) {
      renewKey()
      toast.success(t("pharmacy.returns.done", { qty: num(units), medicine: brandText(item.brand) }))
      close()
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pharmacy.returns.dialog.title")}</DialogTitle>
          <DialogDescription>
            {item
              ? t("pharmacy.returns.dialog.body", {
                  qty: num(item.dispense.qty),
                  medicine: brandText(item.brand),
                  batch: item.batch?.batchNo ?? "",
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="return-qty">{t("pharmacy.returns.dialog.qty")}</Label>
          <div className="flex items-center gap-3">
            <Input
              id="return-qty"
              type="number"
              min={1}
              max={max}
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              className="nums w-24"
            />
            <span className="text-xs text-muted-foreground">
              {t("pharmacy.returns.dialog.max", { count: num(max) })}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="return-reason">{t("pharmacy.returns.dialog.reason")}</Label>
          <Textarea
            id="return-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("pharmacy.returns.dialog.reasonPlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="return-confirm"
            onClick={submit}
            disabled={units < 1 || units > max || reason.trim().length < 2 || command.pending}
          >
            {t("pharmacy.returns.dialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
