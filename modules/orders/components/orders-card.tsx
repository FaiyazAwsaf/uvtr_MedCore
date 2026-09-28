"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { FlaskConical, ScanLine, Search, Send, X } from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { MoneyText } from "@/components/shared/money-text"
import { SectionCard } from "@/components/shared/section-card"
import { StatusPill, StatusText, type Tone } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDb } from "@/core/db/DbProvider"
import type { EncounterRow, LabTestRow } from "@/core/db/schema"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/provider"
import { useClinicalCommand } from "@/modules/consultation/components/use-clinical-command"

import { COMMON_TEST_CODES, searchTests } from "../catalog"
import { placeImaging, placeTests } from "../commands"

const STATUS_TONE: Record<string, Tone> = {
  ordered: "muted",
  paid: "info",
  collected: "info",
  received: "info",
  resulted: "warning",
  validated: "warning",
  signed: "success",
  released: "success",
  reported: "success",
  done: "success",
  cancelled: "muted",
  rejected: "destructive",
}

type Placed = {
  id: string
  testId: string
  orderNo: string
  status: string
  paymentCleared: boolean
  kind: "lab" | "imaging"
}

/**
 * Test and imaging orders from the consultation (plan §6 `orders.*`): one
 * click puts the order on the lab worklist and in the billing basket at the
 * same time. Payment unlocks collection (INV-10); results never gate.
 */
export function OrdersCard({
  encounter,
  tests,
  indicationHint,
  readOnly,
}: {
  encounter: EncounterRow
  tests: { tests: LabTestRow[]; byId: Map<string, LabTestRow> } | undefined
  indicationHint: string
  readOnly: boolean
}) {
  const { t, tk } = useLocale()
  const db = useDb()
  const labCmd = useClinicalCommand(placeTests)
  const imgCmd = useClinicalCommand(placeImaging)
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const [selected, setSelected] = React.useState<string[]>([])
  const [priority, setPriority] = React.useState<"routine" | "urgent">(
    "routine"
  )
  const [indication, setIndication] = React.useState("")

  const placed = useLiveQuery(async (): Promise<Placed[]> => {
    const [orders, imaging] = await Promise.all([
      db.labOrders.where("encounterId").equals(encounter.id).toArray(),
      db.imagingOrders.where("encounterId").equals(encounter.id).toArray(),
    ])
    const items = orders.length
      ? await db.labOrderItems
          .where("labOrderId")
          .anyOf(orders.map((o) => o.id))
          .toArray()
      : []
    const orderNo = new Map(orders.map((o) => [o.id, o.orderNo]))
    return [
      ...items.map((i) => ({
        id: i.id,
        testId: i.testId,
        orderNo: orderNo.get(i.labOrderId) ?? "",
        status: i.status,
        paymentCleared: i.paymentCleared,
        kind: "lab" as const,
      })),
      ...imaging.map((o) => ({
        id: o.id,
        testId: o.testId,
        orderNo: o.orderNo,
        status: o.status,
        paymentCleared: o.paymentCleared,
        kind: "imaging" as const,
      })),
    ]
  }, [db, encounter.id])

  const ordered = new Set(
    (placed ?? []).filter((p) => p.status !== "cancelled").map((p) => p.testId)
  )
  const catalog = tests?.tests ?? []
  const hits = searchTests(query, catalog).filter(
    (test) => !selected.includes(test.id)
  )
  const common = COMMON_TEST_CODES.flatMap((code) => {
    const test = catalog.find((x) => x.code === code)
    return test ? [test] : []
  })
  const chosen = selected.flatMap((id) => {
    const test = tests?.byId.get(id)
    return test ? [test] : []
  })
  const total = chosen.reduce((sum, test) => sum + test.priceP, 0)
  const imagingChosen = chosen.some((test) => test.kind === "imaging")

  const choose = (test: LabTestRow) => {
    if (ordered.has(test.id) || selected.includes(test.id)) return
    setSelected((s) => [...s, test.id])
    setQuery("")
    setActive(0)
  }

  const place = async () => {
    const lab = chosen.filter((test) => test.kind === "lab")
    const img = chosen.filter((test) => test.kind === "imaging")
    const names: string[] = []
    if (lab.length) {
      const out = await labCmd.run({
        patientId: encounter.patientId,
        encounterId: encounter.id,
        testIds: lab.map((test) => test.id),
        priority,
      })
      if (!out.ok) return
      names.push(...lab.map((test) => test.code))
      setSelected((s) => s.filter((id) => !lab.some((test) => test.id === id)))
    }
    if (img.length) {
      const out = await imgCmd.run({
        patientId: encounter.patientId,
        encounterId: encounter.id,
        testIds: img.map((test) => test.id),
        indication:
          indication.trim() ||
          indicationHint.trim() ||
          t("orders.card.indicationPlaceholder"),
      })
      if (!out.ok) return
      names.push(...img.map((test) => test.code))
      setSelected((s) => s.filter((id) => !img.some((test) => test.id === id)))
    }
    if (names.length)
      toast.success(t("orders.card.placed", { tests: names.join(", ") }))
  }

  const busy = labCmd.pending || imgCmd.pending

  return (
    <SectionCard
      size="sm"
      icon={FlaskConical}
      title={t("orders.card.title")}
      subtitle={t("orders.card.subtitle")}
    >
      <div className="flex flex-col gap-4" data-testid="orders-card">
        {!readOnly ? (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                data-testid="order-search"
                placeholder={t("orders.card.search")}
                className="pl-9"
                role="combobox"
                aria-expanded={open && !!query}
                onFocus={() => setOpen(true)}
                onBlur={() => window.setTimeout(() => setOpen(false), 150)}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                  setOpen(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault()
                    setActive((i) => Math.min(hits.length - 1, i + 1))
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault()
                    setActive((i) => Math.max(0, i - 1))
                  } else if (e.key === "Enter" && hits[active]) {
                    e.preventDefault()
                    choose(hits[active])
                  }
                }}
              />
              {open && query.trim() ? (
                <ul
                  role="listbox"
                  className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-border/60 bg-popover p-1 shadow-xl"
                >
                  {hits.length ? (
                    hits.map((test, i) => {
                      const done = ordered.has(test.id)
                      return (
                        <li
                          key={test.id}
                          role="option"
                          aria-selected={i === active}
                          aria-disabled={done}
                          data-testid="order-option"
                          data-test-code={test.code}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            choose(test)
                          }}
                          onMouseEnter={() => setActive(i)}
                          className={cn(
                            "flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5",
                            i === active && "bg-primary-soft",
                            done && "cursor-default opacity-50"
                          )}
                        >
                          {test.kind === "imaging" ? (
                            <ScanLine className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-[0.8125rem] font-medium"
                              lang="en"
                            >
                              {test.name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              <span className="font-mono" lang="en">
                                {test.code}
                              </span>
                              {test.glossBn ? ` · ${test.glossBn}` : ""}
                            </div>
                          </div>
                          {done ? (
                            <StatusPill
                              tone="muted"
                              className="h-5 px-2 text-[0.625rem]"
                            >
                              {t("orders.card.already")}
                            </StatusPill>
                          ) : (
                            <MoneyText
                              poisha={test.priceP}
                              className="text-xs text-muted-foreground"
                            />
                          )}
                        </li>
                      )
                    })
                  ) : (
                    <li className="px-2.5 py-2 text-[0.8125rem] text-muted-foreground">
                      {t("orders.card.noMatch")}
                    </li>
                  )}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="micro mr-1">{t("orders.card.common")}</span>
              {common.map((test) => {
                const done = ordered.has(test.id)
                const picked = selected.includes(test.id)
                return (
                  <button
                    key={test.id}
                    type="button"
                    disabled={done}
                    data-testid="order-quick"
                    data-test-code={test.code}
                    onClick={() =>
                      picked
                        ? setSelected((s) => s.filter((id) => id !== test.id))
                        : choose(test)
                    }
                    className={cn(
                      "h-7 rounded-full px-3 font-mono text-[0.6875rem] transition-colors disabled:opacity-40",
                      picked
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-raised text-foreground/85 hover:text-foreground"
                    )}
                    lang="en"
                  >
                    {test.code}
                  </button>
                )
              })}
            </div>

            <div className="rounded-md border border-dashed border-border p-3">
              <div className="micro mb-2">{t("orders.card.selected")}</div>
              {chosen.length ? (
                <ul className="flex flex-col" data-testid="orders-selected">
                  {chosen.map((test) => (
                    <li
                      key={test.id}
                      className="flex items-center gap-2 border-b border-hairline py-1.5 last:border-0"
                    >
                      {test.kind === "imaging" ? (
                        <ScanLine className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className="min-w-0 flex-1 truncate text-[0.8125rem]"
                        lang="en"
                      >
                        {test.name}
                      </span>
                      <StatusPill
                        tone="muted"
                        className="h-5 px-2 text-[0.625rem]"
                      >
                        {test.kind === "imaging"
                          ? t("orders.card.imaging")
                          : t("orders.card.lab")}
                      </StatusPill>
                      <MoneyText poisha={test.priceP} className="text-xs" />
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("orders.card.remove")}
                        title={t("orders.card.remove")}
                        onClick={() =>
                          setSelected((s) => s.filter((id) => id !== test.id))
                        }
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[0.8125rem] text-muted-foreground">
                  {t("orders.card.none")}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("orders.card.priority")}
                </span>
                <SegmentedPills
                  size="sm"
                  value={priority}
                  onChange={setPriority}
                  options={[
                    {
                      value: "routine",
                      label: t("orders.card.priorities.routine"),
                    },
                    {
                      value: "urgent",
                      label: t("orders.card.priorities.urgent"),
                    },
                  ]}
                />
              </div>
              {imagingChosen ? (
                <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {t("orders.card.indication")}
                  </span>
                  <Input
                    className="h-8"
                    value={indication}
                    data-testid="orders-indication"
                    placeholder={
                      indicationHint || t("orders.card.indicationPlaceholder")
                    }
                    onChange={(e) => setIndication(e.target.value)}
                  />
                </label>
              ) : null}
              <Button
                size="sm"
                className="ml-auto"
                onClick={place}
                disabled={!chosen.length || busy}
                data-testid="orders-place"
              >
                <Send />
                {chosen.length ? (
                  <>
                    {t("orders.card.place")} · <MoneyText poisha={total} />
                  </>
                ) : (
                  t("orders.card.place")
                )}
              </Button>
            </div>
          </div>
        ) : null}

        <div>
          <div className="micro mb-2">{t("orders.card.ordered")}</div>
          {placed?.length ? (
            <ul className="flex flex-col" data-testid="orders-placed">
              {placed.map((p) => {
                const test = tests?.byId.get(p.testId)
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline py-2 last:border-0"
                    data-testid="order-placed"
                    data-test-code={test?.code}
                    data-status={p.status}
                  >
                    {p.kind === "imaging" ? (
                      <ScanLine className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-[0.8125rem] font-medium"
                        lang="en"
                      >
                        {test?.name}
                      </div>
                      <div
                        className="font-mono text-[0.6875rem] text-muted-foreground"
                        lang="en"
                      >
                        {p.orderNo}
                      </div>
                    </div>
                    <StatusText
                      tone={STATUS_TONE[p.status] ?? "muted"}
                      dot
                      className="text-xs"
                    >
                      {tk(`orders.card.status.${p.status}`)}
                    </StatusText>
                    <StatusPill
                      tone={p.paymentCleared ? "success" : "warning"}
                      className="h-5 px-2 text-[0.625rem]"
                    >
                      {p.paymentCleared
                        ? t("orders.card.paid")
                        : t("orders.card.unpaid")}
                    </StatusPill>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t("orders.card.nothingOrdered")}
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  )
}
