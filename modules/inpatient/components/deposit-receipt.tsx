"use client"

import * as React from "react"

import { Barcode } from "@/components/shared/barcode"
import { nameIn } from "@/components/shared/person"
import { PrintLayout } from "@/components/shared/print-layout"
import type { DepositRow, Poisha, StaffRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

import type { StayView } from "../queries"
import { useWardText } from "./shared"

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
    <div className={strong ? "flex justify-between gap-2 font-bold" : "flex justify-between gap-2"}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

/**
 * The deposit money receipt (80 mm roll): hospital brand and branch, receipt
 * number, the stay (admission, ward and bed), the amount and tender with its
 * simulated reference, the deposit left after it and the cashier, with a
 * Code128 barcode of the receipt number. Identifiers stay in Latin digits.
 */
export function DepositReceiptSheet({
  stay,
  deposit,
  balanceP,
  changeDueP,
  cashier,
}: {
  stay: StayView
  deposit: DepositRow
  balanceP: Poisha
  changeDueP?: Poisha
  cashier?: Pick<StaffRow, "nameEn" | "nameBn">
}) {
  const { t, tk, money, dmy, time, uhid, locale } = useLocale()
  const wardText = useWardText()
  const { admission, patient, ward, bed } = stay
  return (
    <PrintLayout
      size="receipt"
      branch={deposit.branchId}
      title={t("inpatient.receipt.title")}
      docNo={deposit.receiptNo}
      meta={`${dmy(deposit.at)}, ${time(deposit.at)}`}
      footer={t("inpatient.receipt.note")}
    >
      <div className="flex flex-col gap-2" data-testid="deposit-receipt-sheet">
        <div className="flex flex-col gap-0.5">
          <Row
            label={t("inpatient.receipt.admission")}
            value={
              <span lang="en" className="font-mono">
                {admission.admissionNo}
              </span>
            }
          />
          {patient ? (
            <>
              <Row label={t("inpatient.receipt.patient")} value={nameIn(patient, locale)} />
              <Row
                label={t("common.uhid")}
                value={
                  <span lang="en" className="font-mono">
                    {uhid(patient.uhid)}
                  </span>
                }
              />
            </>
          ) : null}
          {ward && bed ? (
            <Row
              label={t("inpatient.receipt.wardBed")}
              value={t("inpatient.common.wardBed", { ward: ward.code, bed: bed.code })}
            />
          ) : null}
          {ward ? <div className="text-right text-[#555]">{wardText(ward).kind}</div> : null}
        </div>
        <div className="border-y border-dashed border-[#999] py-1.5">
          <Row label={t("inpatient.receipt.amount")} value={money(deposit.amountP)} strong />
          <Row
            label={t("inpatient.receipt.tender")}
            value={
              <span>
                {tk(`billing.tender.${deposit.tender}`)}
                {deposit.ref ? (
                  <span lang="en" className="ml-1 font-mono text-[#555]">
                    {deposit.ref}
                  </span>
                ) : null}
              </span>
            }
          />
          {deposit.tender === "cash" && changeDueP !== undefined && changeDueP > 0 ? (
            <>
              <Row label={t("inpatient.receipt.cashReceived")} value={money(deposit.amountP + changeDueP)} />
              <Row label={t("inpatient.receipt.change")} value={money(changeDueP)} />
            </>
          ) : null}
        </div>
        <Row
          label={balanceP < 0 ? t("inpatient.receipt.owed") : t("inpatient.receipt.left")}
          value={money(Math.abs(balanceP))}
        />
        {cashier ? (
          <div className="text-[#555]">{t("inpatient.receipt.cashier", { name: nameIn(cashier, locale) })}</div>
        ) : null}
        {deposit.receiptNo ? (
          <div className="flex justify-center pt-1">
            <Barcode value={deposit.receiptNo} height={34} barWidth={1.2} fontSize={10} plate={false} />
          </div>
        ) : null}
      </div>
    </PrintLayout>
  )
}
