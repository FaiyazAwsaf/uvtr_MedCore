"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowRightLeft, BedDouble, FileText, LoaderCircle, Wallet } from "lucide-react"
import { toast } from "sonner"

import { DateText } from "@/components/shared/date-text"
import { IdentityBanner } from "@/components/shared/identity-banner"
import { KeyValueGrid } from "@/components/shared/key-value"
import { MoneyText } from "@/components/shared/money-text"
import { nameIn } from "@/components/shared/person"
import { StatusPill } from "@/components/shared/status"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import { TENDER_TAG } from "@/modules/billing/components/labels"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { transferBed } from "../commands"
import { billOf, stayById, type StayView } from "../queries"
import {
  BalanceText,
  NotClinicalNote,
  ProblemAlert,
  useDemoNow,
  useInpatientCommand,
  useReasonText,
  useWardText,
} from "./shared"

/**
 * One stay on the bed board (plan §9): identity, admitted at, day count,
 * consultant, ward and bed, deposits with their receipts and the interim
 * bill so far. Reception can move the patient to another bed and open the
 * interim bill; deposits are taken at the cashier. Administrative only.
 */
export function AdmissionDrawer({
  admissionId,
  onOpenChange,
  onInterim,
}: {
  admissionId: Id | null
  onOpenChange: (open: boolean) => void
  onInterim: (admissionId: Id) => void
}) {
  const db = useDb()
  const { t } = useLocale()
  const stay = useLiveQuery(
    async () => (admissionId ? await stayById(db, admissionId) : null),
    [db, admissionId]
  )
  return (
    <Sheet open={!!admissionId} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-[92vw] data-[side=right]:sm:max-w-[30rem]"
        data-testid="admission-drawer"
        data-admission-id={admissionId ?? undefined}
        data-admission-no={stay?.admission.admissionNo}
        data-bed-id={stay?.admission.bedId}
      >
        <SheetHeader className="pb-3">
          <SheetTitle>{t("inpatient.drawer.title")}</SheetTitle>
          <SheetDescription>
            {stay ? (
              <span lang="en" className="font-mono">
                {stay.admission.admissionNo}
              </span>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          {stay ? (
            <StayBody stay={stay} onInterim={onInterim} />
          ) : stay === null ? (
            <p className="text-sm text-muted-foreground">{t("inpatient.drawer.gone")}</p>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function StayBody({ stay, onInterim }: { stay: StayView; onInterim: (admissionId: Id) => void }) {
  const { t, tk, num, locale } = useLocale()
  const nowMs = useDemoNow()
  const wardText = useWardText()
  const reasonText = useReasonText()
  const [transferring, setTransferring] = React.useState(false)
  const bill = billOf(stay, nowMs)
  const { admission, ward, bed, consultant } = stay
  const admitted = admission.status === "admitted"

  return (
    <>
      <IdentityBanner patientId={admission.patientId} compact />
      <KeyValueGrid
        items={[
          {
            label: t("inpatient.drawer.admittedAt"),
            value: <DateText value={admission.admittedAt} variant="dmyTime" />,
          },
          {
            label: t("inpatient.drawer.dayCount"),
            value: bill ? t("inpatient.common.day", { count: num(bill.days) }) : "",
          },
          {
            label: t("inpatient.drawer.wardBed"),
            value:
              ward && bed ? t("inpatient.common.wardBed", { ward: wardText(ward).name, bed: bed.code }) : "",
            wide: true,
          },
          {
            label: t("inpatient.common.consultant"),
            value: consultant?.staff ? nameIn(consultant.staff, locale) : "",
          },
          { label: t("inpatient.common.reason"), value: reasonText(admission.reason) },
          ...(stay.corporate
            ? [{ label: t("inpatient.common.corporate"), value: stay.corporate.name[locale], wide: true }]
            : []),
        ]}
      />

      {bill ? (
        <section
          className="flex flex-col gap-2 rounded-md bg-surface-raised px-4 py-3"
          data-testid="drawer-interim"
          data-balance={bill.balanceP}
          data-days={bill.days}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[0.8125rem] font-semibold">{t("inpatient.drawer.interimSummary")}</h3>
            {admission.depositAlertAt !== undefined ? (
              <StatusPill tone="destructive" data-testid="deposit-alert">
                <Wallet />
                {t("inpatient.common.lowDeposit")}
              </StatusPill>
            ) : null}
          </div>
          <dl className="grid grid-cols-3 gap-2 text-[0.8125rem]">
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{t("inpatient.drawer.charges")}</dt>
              <dd>
                <MoneyText poisha={bill.chargesP} className="font-semibold" />
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{t("inpatient.drawer.received")}</dt>
              <dd>
                <MoneyText poisha={bill.depositsP} className="font-semibold" />
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{t("inpatient.drawer.left")}</dt>
              <dd>
                <BalanceText balanceP={bill.balanceP} low={bill.low} />
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {admitted ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="transfer-open"
            aria-expanded={transferring}
            onClick={() => setTransferring((open) => !open)}
          >
            <ArrowRightLeft />
            {t("inpatient.drawer.transfer")}
          </Button>
          <Button
            type="button"
            variant="neutral"
            size="sm"
            data-testid="interim-open"
            onClick={() => onInterim(admission.id)}
          >
            <FileText />
            {t("inpatient.drawer.interim")}
          </Button>
        </div>
      ) : null}

      {admitted && transferring ? (
        <TransferPanel stay={stay} onDone={() => setTransferring(false)} />
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-[0.8125rem] font-semibold">{t("inpatient.drawer.deposits")}</h3>
        {stay.deposits.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t("inpatient.drawer.noDeposits")} {t("inpatient.drawer.depositsHint")}
          </p>
        ) : (
          <ul className="flex flex-col" data-testid="drawer-deposits">
            {stay.deposits.map((deposit) => (
              <li
                key={deposit.id}
                className="flex items-center justify-between gap-3 border-b border-hairline py-2 text-[0.8125rem] last:border-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2">
                    <span className={cn("tag h-5 px-2 text-[0.6875rem]", TENDER_TAG[deposit.tender])}>
                      {tk(`billing.tender.${deposit.tender}`)}
                    </span>
                    {deposit.receiptNo ? (
                      <span lang="en" className="font-mono text-xs">
                        {deposit.receiptNo}
                      </span>
                    ) : null}
                  </span>
                  <DateText value={deposit.at} variant="dmyTime" className="text-xs text-muted-foreground" />
                </span>
                <MoneyText poisha={deposit.amountP} className="font-medium" />
              </li>
            ))}
          </ul>
        )}
      </section>
      <NotClinicalNote />
    </>
  )
}

/** Vacant beds at the branch to move the patient to (the old bed goes for cleaning). */
function TransferPanel({ stay, onDone }: { stay: StayView; onDone: () => void }) {
  const db = useDb()
  const { t } = useLocale()
  const wardText = useWardText()
  const command = useInpatientCommand(transferBed)
  const branch = stay.admission.branchId
  const data = useLiveQuery(async () => {
    const [wards, beds] = await Promise.all([
      db.wards.where("branchId").equals(branch).toArray(),
      db.beds.where("branchId").equals(branch).toArray(),
    ])
    return {
      groups: wards
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((ward) => ({
          ward,
          beds: beds
            .filter((b) => b.wardId === ward.id && b.status === "vacant")
            .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })),
        }))
        .filter((group) => group.beds.length > 0),
    }
  }, [db, branch])

  const move = async (bedId: Id, version: number, code: string) => {
    const done = await command.run({
      admissionId: stay.admission.id,
      toBedId: bedId,
      toBedVersion: version,
      admissionVersion: stay.admission.version,
    })
    if (!done) return
    toast(t("inpatient.drawer.moved", { bed: code }), {
      icon: <BedDouble className="size-4 text-primary" />,
    })
    onDone()
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3" data-testid="transfer-panel">
      <div>
        <h3 className="text-[0.8125rem] font-semibold">{t("inpatient.drawer.transferTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("inpatient.drawer.transferHint")}</p>
      </div>
      {data && data.groups.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground">{t("inpatient.drawer.noVacant")}</p>
      ) : null}
      {data?.groups.map(({ ward, beds }) => (
        <div key={ward.id} className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {wardText(ward).name} · {wardText(ward).kind}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {beds.map((bed) => (
              <Button
                key={bed.id}
                type="button"
                size="xs"
                variant="neutral"
                data-testid="transfer-bed"
                data-bed-id={bed.id}
                disabled={command.pending}
                aria-label={t("inpatient.drawer.moveTo", { bed: bed.code })}
                onClick={() => void move(bed.id, bed.version, bed.code)}
                className="font-mono"
              >
                {command.pending ? <LoaderCircle className="animate-spin" /> : null}
                {bed.code}
              </Button>
            ))}
          </div>
        </div>
      ))}
      <ProblemAlert problem={command.problem} />
    </section>
  )
}
