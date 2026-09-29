"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { LoaderCircle, Printer } from "lucide-react"
import { toast } from "sonner"

import { ageOf, nameIn } from "@/components/shared/person"
import { PrintLayout } from "@/components/shared/print-layout"
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
import { useDb } from "@/core/db/DbProvider"
import type { Id } from "@/core/db/schema"
import type { InterimBill } from "@/core/inpatient/interim"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

import { issueInterimBill } from "../commands"
import { billOf, stayById, type StayView } from "../queries"
import { ProblemAlert, useDemoNow, useInpatientCommand, useWardText } from "./shared"

function Row({
  label,
  value,
  strong = false,
}: {
  label: React.ReactNode
  value: React.ReactNode
  strong?: boolean
}) {
  return (
    <div className={cn("flex justify-between gap-4 py-0.5", strong && "font-bold")}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

/**
 * The printed interim bill (A4, plan §5.8): hospital brand, the patient and
 * stay, the charges so far as bed, nursing and consultant-round lines with
 * days x rate, the deposits with their receipt numbers, and the deposit left
 * or amount owed. Clearly "Interim bill: not a final invoice". Figures are
 * as at the demo clock, so they move when it moves.
 */
export function InterimBillSheet({ stay, bill, at }: { stay: StayView; bill: InterimBill; at: number }) {
  const { t, tk, money, num, dmy, time, uhid, locale } = useLocale()
  const wardText = useWardText()
  const { admission, patient, ward, bed, consultant } = stay
  const doctor = consultant?.staff ? nameIn(consultant.staff, locale) : ""
  const age = patient ? ageOf(patient.dob, at) : null
  const lineLabel = (kind: "bed" | "nursing" | "consultant") =>
    kind === "bed"
      ? t("inpatient.interim.line.bed", { ward: ward ? wardText(ward).name : "" })
      : kind === "nursing"
        ? t("inpatient.interim.line.nursing")
        : t("inpatient.interim.line.consultant", { doctor })

  return (
    <PrintLayout
      size="A4"
      branch={admission.branchId}
      title={t("inpatient.interim.title")}
      docNo={admission.admissionNo}
      meta={t("inpatient.interim.asAt", { date: dmy(at), time: time(at) })}
      footer={t("inpatient.interim.footer")}
    >
      <div className="flex flex-col gap-4" data-testid="interim-sheet">
        <div className="rounded-sm border-2 border-[#111] px-3 py-1.5 text-center text-sm font-bold uppercase">
          {t("inpatient.interim.notFinal")}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Row
            label={t("inpatient.interim.patient")}
            value={
              patient
                ? `${nameIn(patient, locale)}${age ? ` · ${tk(age.unit === "years" ? "common.years" : "common.months", { count: num(age.value) })} · ${tk(`common.sexShort.${patient.sex}`)}` : ""}`
                : ""
            }
          />
          <Row
            label={t("common.uhid")}
            value={
              <span lang="en" className="font-mono">
                {patient ? uhid(patient.uhid) : ""}
              </span>
            }
          />
          <Row
            label={t("inpatient.interim.admission")}
            value={
              <span lang="en" className="font-mono">
                {admission.admissionNo}
              </span>
            }
          />
          <Row
            label={t("inpatient.interim.wardBed")}
            value={ward && bed ? t("inpatient.common.wardBed", { ward: wardText(ward).name, bed: bed.code }) : ""}
          />
          <Row
            label={t("inpatient.interim.admittedAt")}
            value={`${dmy(admission.admittedAt)}, ${time(admission.admittedAt)}`}
          />
          <Row label={t("inpatient.interim.consultant")} value={doctor} />
          <Row
            label={t("inpatient.interim.days")}
            value={t("inpatient.interim.daysValue", { count: num(bill.days) })}
          />
          {stay.corporate ? (
            <Row label={t("inpatient.interim.corporate")} value={stay.corporate.name[locale]} />
          ) : null}
        </div>

        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-[#999] text-[0.75rem] uppercase">
              <th className="py-1.5 font-semibold">{t("inpatient.interim.item")}</th>
              <th className="py-1.5 text-right font-semibold">{t("inpatient.interim.qtyRate")}</th>
              <th className="py-1.5 text-right font-semibold">{t("inpatient.interim.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((line) => (
              <tr key={line.kind} className="border-b border-[#e0e0e0]" data-testid="interim-line" data-kind={line.kind}>
                <td className="py-1.5 pr-2">{lineLabel(line.kind)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {t("inpatient.interim.qtyTimes", { qty: num(line.qty), rate: money(line.unitP) })}
                </td>
                <td className="py-1.5 text-right tabular-nums">{money(line.amountP)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="pt-2" colSpan={2}>
                {t("inpatient.interim.charges")}
              </td>
              <td className="pt-2 text-right tabular-nums">{money(bill.chargesP)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="flex flex-col gap-0.5">
          <div className="border-b border-[#999] pb-1 text-[0.75rem] font-semibold uppercase">
            {t("inpatient.interim.deposits")}
          </div>
          {stay.deposits.length === 0 ? (
            <div className="py-1 text-[#555]">{t("inpatient.interim.noDeposits")}</div>
          ) : (
            stay.deposits.map((deposit) => (
              <Row
                key={deposit.id}
                label={
                  <span>
                    {deposit.receiptNo ? (
                      <span lang="en" className="font-mono">
                        {deposit.receiptNo}
                      </span>
                    ) : null}
                    <span className="text-[#555]">
                      {deposit.receiptNo ? " · " : ""}
                      {dmy(deposit.at)} · {tk(`billing.tender.${deposit.tender}`)}
                    </span>
                  </span>
                }
                value={money(deposit.amountP)}
              />
            ))
          )}
          <Row label={t("inpatient.interim.depositsTotal")} value={money(bill.depositsP)} strong />
        </div>

        <div className="flex items-baseline justify-between gap-4 border-y-2 border-[#111] py-2 text-base font-bold">
          <span>{bill.balanceP < 0 ? t("inpatient.interim.owed") : t("inpatient.interim.left")}</span>
          <span className="tabular-nums">{money(Math.abs(bill.balanceP))}</span>
        </div>

        {stay.corporate ? (
          <p className="text-[0.75rem] text-[#555]">
            {t("inpatient.interim.corporateNote", { client: stay.corporate.name[locale] })}
          </p>
        ) : null}
      </div>
    </PrintLayout>
  )
}

/**
 * The interim bill preview with "Issue and print": issuing records the bill
 * in the event log (InterimBillIssued, no invoice) and prints the A4 sheet.
 */
export function InterimBillDialog({
  admissionId,
  onOpenChange,
}: {
  admissionId: Id | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={!!admissionId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[58rem]" data-testid="interim-dialog">
        {admissionId ? (
          <InterimBody key={admissionId} admissionId={admissionId} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function InterimBody({ admissionId, onClose }: { admissionId: Id; onClose: () => void }) {
  const db = useDb()
  const { t, money, dmy, time } = useLocale()
  const nowMs = useDemoNow()
  const stay = useLiveQuery(async () => await stayById(db, admissionId), [db, admissionId])
  const bill = stay ? billOf(stay, nowMs) : null
  const issue = useInpatientCommand(issueInterimBill)

  const print = async () => {
    if (!stay) return
    const done = await issue.run({ admissionId: stay.admission.id })
    if (!done) return
    toast(t("inpatient.interim.printed", { admissionNo: done.admissionNo }))
    window.print()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("inpatient.interim.title")}</DialogTitle>
        <DialogDescription>
          {t("inpatient.interim.previewBody")} {t("inpatient.interim.asAt", { date: dmy(nowMs), time: time(nowMs) })}
        </DialogDescription>
      </DialogHeader>

      {stay && bill ? (
        <>
          <div
            data-testid="interim-total"
            data-charges={bill.chargesP}
            data-deposits={bill.depositsP}
            data-balance={bill.balanceP}
            data-days={bill.days}
            className="grid grid-cols-3 gap-2 rounded-md bg-surface-raised px-4 py-3 text-[0.8125rem]"
          >
            <span className="flex flex-col">
              <span className="text-xs text-muted-foreground">{t("inpatient.drawer.charges")}</span>
              <span className="nums font-semibold">{money(bill.chargesP)}</span>
            </span>
            <span className="flex flex-col">
              <span className="text-xs text-muted-foreground">{t("inpatient.drawer.received")}</span>
              <span className="nums font-semibold">{money(bill.depositsP)}</span>
            </span>
            <span className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                {bill.balanceP < 0 ? t("inpatient.drawer.owed") : t("inpatient.drawer.left")}
              </span>
              <span className={cn("nums font-semibold", bill.low && "text-destructive")}>
                {money(Math.abs(bill.balanceP))}
              </span>
            </span>
          </div>
          <div className="-mx-2 max-h-[55svh] overflow-auto rounded-md bg-surface-raised p-3">
            <InterimBillSheet stay={stay} bill={bill} at={nowMs} />
          </div>
          <ProblemAlert problem={issue.problem} />
        </>
      ) : stay === null ? (
        <p className="text-sm text-muted-foreground">{t("inpatient.drawer.gone")}</p>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}

      <DialogFooter>
        <Button type="button" variant="neutral" onClick={onClose}>
          {t("common.close")}
        </Button>
        <Button
          type="button"
          data-testid="interim-print"
          disabled={!stay || !bill || issue.pending}
          onClick={() => void print()}
        >
          {issue.pending ? <LoaderCircle className="animate-spin" /> : <Printer />}
          {t("inpatient.interim.print")}
        </Button>
      </DialogFooter>
    </>
  )
}
