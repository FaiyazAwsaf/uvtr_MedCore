"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  BedDouble,
  BedSingle,
  BellRing,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Sparkles,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"

import { SegmentedPills } from "@/components/motion/segmented"
import { DateText } from "@/components/shared/date-text"
import { EmptyState } from "@/components/shared/empty-state"
import { ageOf, nameIn } from "@/components/shared/person"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { rules } from "@/config/rules.config"
import type { BranchCode } from "@/config/brand.config"
import { useDb } from "@/core/db/DbProvider"
import type { BedRow, Id, WardRow } from "@/core/db/schema"
import type { InterimBill } from "@/core/inpatient/interim"
import { useFlashOnChange } from "@/hooks/use-flash-on-change"
import { LiveChip, PageBody, PageHeader } from "@/modules/pharmacy/components/shared"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { setBedStatus } from "../commands"
import { billOf, boardAt, type StayView } from "../queries"
import { admittable } from "../stay"
import { AdmissionDrawer } from "./admission-drawer"
import { AdmitDialog } from "./admit-dialog"
import { InterimBillDialog } from "./interim-bill"
import {
  BED_ACCENT,
  BED_DOT,
  BedStatusText,
  KpiRow,
  NotClinicalNote,
  ProblemAlert,
  useDemoNow,
  useInpatientCommand,
  useInpatientContext,
  useWardText,
} from "./shared"

/**
 * `/reception/inpatient` (plan §9): "Inpatient billing and beds". The bed
 * board of the receptionist's branch, live in every window: wards as grids of
 * bed tiles coloured by status, the patient, admission number, day and a
 * low-deposit marker on occupied beds. Admit, transfer, housekeeping and the
 * interim bill. Administrative only, never a clinical record.
 */
export function BedBoardScreen() {
  const { branch } = useInpatientContext()
  const { t } = useLocale()
  if (!branch) return <EmptyState icon={BedDouble} title={t("inpatient.common.noBranch")} />
  return <BedBoard branch={branch} />
}

function BedBoard({ branch }: { branch: BranchCode }) {
  const db = useDb()
  const { t, num, money } = useLocale()
  const { branchText } = useInpatientContext()
  const nowMs = useDemoNow()
  const board = useLiveQuery(() => boardAt(db, branch), [db, branch])
  const [wardFilter, setWardFilter] = React.useState<string>("all")
  /** The bed as it was when its dialog opened (its version guards the change) */
  const [bedDialog, setBedDialog] = React.useState<BedRow | null>(null)
  const [admitFor, setAdmitFor] = React.useState<{ bed: Pick<BedRow, "id" | "version"> | null } | null>(
    null
  )
  const [drawer, setDrawer] = React.useState<Id | null>(null)
  const [interim, setInterim] = React.useState<Id | null>(null)

  const stayByBed = React.useMemo(() => {
    const map = new Map<Id, StayView>()
    for (const stay of board?.stays ?? []) map.set(stay.admission.bedId, stay)
    return map
  }, [board])
  const bills = React.useMemo(() => {
    const map = new Map<Id, InterimBill>()
    for (const stay of board?.stays ?? []) {
      const bill = billOf(stay, nowMs)
      if (bill) map.set(stay.admission.id, bill)
    }
    return map
  }, [board, nowMs])

  const beds = board?.beds ?? []
  const count = (status: BedRow["status"]) => beds.filter((b) => b.status === status).length
  const alerts = (board?.stays ?? []).filter((s) => s.admission.depositAlertAt !== undefined).length
  const wards = (board?.wards ?? []).filter((w) => wardFilter === "all" || w.id === wardFilter)

  return (
    <PageBody data-testid="bed-board">
      <PageHeader
        title={t("inpatient.board.title")}
        subtitle={t("inpatient.board.subtitle", { branch: branchText })}
        actions={
          <>
            <LiveChip />
            <Button
              type="button"
              // One "admit-open" on the page: the bed dialog has its own while it is open.
              data-testid={bedDialog ? undefined : "admit-open"}
              onClick={() => setAdmitFor({ bed: null })}
            >
              <Plus />
              {t("inpatient.board.admit")}
            </Button>
          </>
        }
      />
      <NotClinicalNote className="-mt-2" />

      <KpiRow
        label={t("inpatient.board.title")}
        items={[
          {
            key: "occupied",
            icon: BedDouble,
            variant: "cyan",
            title: t("inpatient.board.kpi.occupied"),
            value: `${num(count("occupied"))}/${num(beds.length)}`,
            caption: t("inpatient.board.kpi.occupiedOf", {
              occupied: num(count("occupied")),
              total: num(beds.length),
            }),
          },
          {
            key: "vacant",
            icon: BedSingle,
            variant: "yellow",
            title: t("inpatient.board.kpi.vacant"),
            value: num(count("vacant")),
            caption: t("inpatient.board.kpi.vacantHint"),
          },
          {
            key: "cleaning",
            icon: Sparkles,
            variant: "pink",
            title: t("inpatient.board.kpi.cleaning"),
            value: num(count("cleaning")),
            caption: t("inpatient.board.kpi.cleaningHint"),
          },
          {
            key: "alerts",
            icon: BellRing,
            variant: "purple",
            title: t("inpatient.board.kpi.alerts"),
            value: num(alerts),
            caption: t("inpatient.board.kpi.alertsHint", { amount: money(rules.depositThresholdP) }),
          },
        ]}
      />

      {board === undefined ? (
        <Skeleton className="h-72 w-full rounded-lg" />
      ) : board.wards.length === 0 ? (
        <EmptyState
          icon={BedDouble}
          title={t("inpatient.board.empty")}
          description={t("inpatient.board.emptyHint")}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <SegmentedPills
              size="sm"
              value={wardFilter}
              onChange={setWardFilter}
              options={[
                { value: "all", label: t("inpatient.board.allWards") },
                ...board.wards.map((w) => ({ value: w.id, label: w.code })),
              ]}
            />
            <Legend beds={beds} />
          </div>
          <div className="flex flex-col gap-4">
            {wards.map((ward) => (
              <WardSection
                key={ward.id}
                ward={ward}
                beds={beds.filter((b) => b.wardId === ward.id)}
                stayByBed={stayByBed}
                bills={bills}
                nowMs={nowMs}
                onOpen={(bed) => {
                  const stay = stayByBed.get(bed.id)
                  if (bed.status === "occupied" && stay) setDrawer(stay.admission.id)
                  else setBedDialog(bed)
                }}
              />
            ))}
          </div>
        </>
      )}

      <BedDialog
        seen={bedDialog}
        live={beds.find((b) => b.id === bedDialog?.id)}
        wards={board?.wards ?? []}
        onOpenChange={(open) => !open && setBedDialog(null)}
        onAdmit={(bed) => {
          setBedDialog(null)
          setAdmitFor({ bed })
        }}
      />
      <AdmitDialog
        open={!!admitFor}
        onOpenChange={(open) => !open && setAdmitFor(null)}
        branch={branch}
        initialBed={admitFor?.bed ?? null}
        onOpenStay={setDrawer}
      />
      <AdmissionDrawer
        admissionId={drawer}
        onOpenChange={(open) => !open && setDrawer(null)}
        onInterim={setInterim}
      />
      <InterimBillDialog admissionId={interim} onOpenChange={(open) => !open && setInterim(null)} />
    </PageBody>
  )
}

function Legend({ beds }: { beds: BedRow[] }) {
  const { num } = useLocale()
  const statuses: BedRow["status"][] = ["vacant", "occupied", "cleaning", "reserved"]
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {statuses.map((status) => (
        <li key={status} className="flex items-center gap-1">
          <BedStatusText status={status} />
          <span className="nums text-muted-foreground">{num(beds.filter((b) => b.status === status).length)}</span>
        </li>
      ))}
    </ul>
  )
}

function WardSection({
  ward,
  beds,
  stayByBed,
  bills,
  nowMs,
  onOpen,
}: {
  ward: WardRow
  beds: BedRow[]
  stayByBed: Map<Id, StayView>
  bills: Map<Id, InterimBill>
  nowMs: number
  onOpen: (bed: BedRow) => void
}) {
  const { t, num, money } = useLocale()
  const wardText = useWardText()
  const occupied = beds.filter((b) => b.status === "occupied").length
  return (
    <section
      data-testid="bed-board-ward"
      data-ward-id={ward.id}
      className="@container/ward surface-card flex min-w-0 flex-col gap-3 p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[0.9375rem] font-semibold">{wardText(ward).name}</h2>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span>
            {t("inpatient.board.wardMeta", { kind: wardText(ward).kind, rate: money(ward.bedDayRateP) })}
          </span>
          <span className="nums">
            {t("inpatient.board.occupancy", { occupied: num(occupied), total: num(beds.length) })}
          </span>
        </p>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.75rem,1fr))] gap-2">
        {beds.map((bed) => {
          const stay = bed.status === "occupied" ? stayByBed.get(bed.id) : undefined
          return (
            <BedTile
              key={bed.id}
              bed={bed}
              stay={stay}
              bill={stay ? bills.get(stay.admission.id) : undefined}
              nowMs={nowMs}
              onOpen={() => onOpen(bed)}
            />
          )
        })}
      </div>
    </section>
  )
}

function BedTile({
  bed,
  stay,
  bill,
  nowMs,
  onOpen,
}: {
  bed: BedRow
  stay?: StayView
  bill?: InterimBill
  nowMs: number
  onOpen: () => void
}) {
  const { t, tk, num, locale } = useLocale()
  const flash = useFlashOnChange(bed.version)
  const patient = stay?.patient
  const age = patient ? ageOf(patient.dob, nowMs) : null
  const alert = stay?.admission.depositAlertAt !== undefined && !!stay
  const low = alert || !!bill?.low
  return (
    <button
      type="button"
      data-testid="bed-tile"
      data-bed-id={bed.id}
      data-bed-code={bed.code}
      data-status={bed.status}
      data-admission-id={stay?.admission.id}
      data-low={stay ? String(low) : undefined}
      aria-label={t("inpatient.board.bedLabel", { bed: bed.code, status: tk(`inpatient.bedStatus.${bed.status}`) })}
      onClick={onOpen}
      className={cn(
        "flex min-h-[6.25rem] min-w-0 flex-col gap-1 rounded-md border-l-[3px] bg-surface-raised/60 px-2.5 py-2 text-left transition-colors outline-none hover:bg-surface-raised focus-visible:ring-[3px] focus-visible:ring-ring/40 dark:bg-surface-raised/45",
        BED_ACCENT[bed.status],
        flash
      )}
    >
      <span className="flex items-center justify-between gap-1.5">
        <span lang="en" className="font-mono text-[0.8125rem] font-semibold whitespace-nowrap">
          {bed.code}
        </span>
        {bed.status === "occupied" && bill ? (
          <span className="nums shrink-0 text-[0.6875rem] font-medium text-link">
            {t("inpatient.common.day", { count: num(bill.days) })}
          </span>
        ) : (
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", BED_DOT[bed.status])} />
        )}
      </span>
      {bed.status === "occupied" && stay ? (
        <>
          <span className="truncate text-[0.8125rem] font-medium" title={patient ? nameIn(patient, locale) : ""}>
            {patient ? nameIn(patient, locale) : ""}
          </span>
          <span className="nums truncate text-[0.6875rem] text-muted-foreground">
            {age
              ? `${tk(age.unit === "years" ? "common.years" : "common.months", { count: num(age.value) })} · ${tk(`common.sexShort.${patient!.sex}`)}`
              : ""}
          </span>
          <span lang="en" className="truncate font-mono text-[0.6875rem] text-muted-foreground">
            {stay.admission.admissionNo}
          </span>
          {alert ? (
            <span
              data-testid="deposit-alert"
              className="mt-auto inline-flex items-center gap-1 text-[0.6875rem] font-medium text-destructive"
            >
              <Wallet className="size-3 shrink-0" />
              <span className="truncate">{t("inpatient.common.lowDeposit")}</span>
            </span>
          ) : null}
        </>
      ) : (
        <span className="mt-auto flex min-w-0 flex-col gap-0.5 text-[0.6875rem]">
          <BedStatusText status={bed.status} />
          <span className="truncate text-muted-foreground">
            {bed.status === "cleaning" ? (
              <DateText value={bed.updatedAt} variant="relative" />
            ) : bed.status === "reserved" ? (
              t("inpatient.board.tile.reserved")
            ) : (
              t("inpatient.board.tile.vacant")
            )}
          </span>
        </span>
      )}
    </button>
  )
}

/** Housekeeping and admission for a bed that is not occupied. */
function BedDialog({
  seen,
  live,
  wards,
  onOpenChange,
  onAdmit,
}: {
  seen: BedRow | null
  live: BedRow | undefined
  wards: WardRow[]
  onOpenChange: (open: boolean) => void
  onAdmit: (bed: Pick<BedRow, "id" | "version">) => void
}) {
  return (
    <Dialog open={!!seen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="bed-dialog" data-bed-id={seen?.id}>
        {seen ? (
          <BedDialogBody
            key={seen.id}
            seen={seen}
            status={live?.status ?? seen.status}
            ward={wards.find((w) => w.id === seen.wardId)}
            onClose={() => onOpenChange(false)}
            onAdmit={onAdmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function BedDialogBody({
  seen,
  status,
  ward,
  onClose,
  onAdmit,
}: {
  seen: BedRow
  status: BedRow["status"]
  ward?: WardRow
  onClose: () => void
  onAdmit: (bed: Pick<BedRow, "id" | "version">) => void
}) {
  const { t, tk, relative } = useLocale()
  const wardText = useWardText()
  const command = useInpatientCommand(setBedStatus)

  const change = async (to: "vacant" | "reserved") => {
    const done = await command.run({ bedId: seen.id, status: to, expectedVersion: seen.version })
    if (!done) return
    toast(tk(`inpatient.bedDialog.done.${to}`, { bed: seen.code }), {
      icon: <CheckCircle2 className="size-4 text-success" />,
    })
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("inpatient.bedDialog.title", { bed: seen.code })}</DialogTitle>
        <DialogDescription>
          {t("inpatient.bedDialog.subtitle", {
            ward: ward ? wardText(ward).name : "",
            status: tk(`inpatient.bedStatus.${status}`),
          })}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1 text-[0.8125rem] text-muted-foreground">
        <p>
          {status === "cleaning"
            ? t("inpatient.bedDialog.cleaningHint")
            : status === "reserved"
              ? t("inpatient.bedDialog.reservedHint")
              : t("inpatient.bedDialog.vacantHint")}
        </p>
        <p className="text-xs">{t("inpatient.bedDialog.since", { time: relative(seen.updatedAt) })}</p>
      </div>
      <ProblemAlert problem={command.problem} />
      <DialogFooter className="flex-wrap">
        {status === "cleaning" ? (
          <Button
            type="button"
            data-testid="bed-ready"
            disabled={command.pending}
            onClick={() => void change("vacant")}
          >
            {command.pending ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {t("inpatient.bedDialog.markReady")}
          </Button>
        ) : null}
        {status === "vacant" ? (
          <Button
            type="button"
            variant="neutral"
            data-testid="bed-reserve"
            disabled={command.pending}
            onClick={() => void change("reserved")}
          >
            {t("inpatient.bedDialog.reserve")}
          </Button>
        ) : null}
        {status === "reserved" ? (
          <Button
            type="button"
            variant="neutral"
            data-testid="bed-release"
            disabled={command.pending}
            onClick={() => void change("vacant")}
          >
            {t("inpatient.bedDialog.release")}
          </Button>
        ) : null}
        {admittable({ status }) ? (
          <Button
            type="button"
            data-testid="admit-open"
            onClick={() => onAdmit({ id: seen.id, version: seen.version })}
          >
            <BedDouble />
            {t("inpatient.bedDialog.admit")}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}
