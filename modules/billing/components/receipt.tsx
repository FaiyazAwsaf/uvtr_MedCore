"use client"

import * as React from "react"
import { Printer } from "lucide-react"

import { Barcode } from "@/components/shared/barcode"
import { nameIn } from "@/components/shared/person"
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
import { getBranch } from "@/config/brand.config"
import type { Poisha } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"

import type { InvoiceDetail } from "../queries"
import { lineNames, SOURCE_ORDER } from "./labels"

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
 * The printed money receipt (80 mm roll, plan §9 `/cashier`): hospital brand
 * and branch, invoice and receipt numbers, lines, discount, tenders with
 * their references, the cashier and a Code128 barcode of the receipt number.
 * Printed in the window's language; identifiers stay in Latin digits.
 */
export function ReceiptSheet({
  detail,
  changeDueP,
}: {
  detail: InvoiceDetail
  /** Change given back for cash at this counter, when known */
  changeDueP?: Poisha
}) {
  const { t, tk, money, num, locale, dmy, time, uhid } = useLocale()
  const { invoice, receipt, patient } = detail
  const lines = [...detail.lines].sort(
    (a, b) =>
      SOURCE_ORDER.indexOf(a.sourceType) - SOURCE_ORDER.indexOf(b.sourceType) ||
      (detail.lineOrder[a.id] ?? 0) - (detail.lineOrder[b.id] ?? 0)
  )
  const confirmed = detail.payments.filter((p) => p.status === "confirmed")
  const cashP = confirmed.filter((p) => p.tender === "cash").reduce((s, p) => s + p.amountP, 0)
  const corporateP = confirmed
    .filter((p) => p.tender === "corporate")
    .reduce((s, p) => s + p.amountP, 0)
  const approver = detail.approver
  const branch = getBranch(invoice.branchId)
  const at = receipt?.at ?? invoice.createdAt

  return (
    <PrintLayout
      size="receipt"
      branch={invoice.branchId}
      title={t("billing.receipt.title")}
      docNo={receipt?.receiptNo ?? invoice.invoiceNo}
      meta={`${dmy(at)} ${time(at)}`}
      footer={t("billing.receipt.thanks")}
    >
      <div className="flex flex-col gap-2" data-testid="receipt-sheet">
        <div className="flex flex-col gap-0.5">
          <Row
            label={t("billing.receipt.invoice")}
            value={
              <span lang="en" className="font-mono">
                {invoice.invoiceNo}
              </span>
            }
          />
          <Row label={t("billing.receipt.branch")} value={`${branch.name[locale]} (${branch.code})`} />
          {patient ? (
            <>
              <Row label={t("billing.receipt.patient")} value={nameIn(patient, locale)} />
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
        </div>

        <div className="border-y border-dashed border-[#999] py-1.5">
          <div className="flex justify-between gap-2 pb-1 font-semibold">
            <span>{t("billing.receipt.item")}</span>
            <span>{t("billing.receipt.amount")}</span>
          </div>
          {lines.map((line) => {
            const names = lineNames(
              { ...line, descriptionBn: detail.descriptionBn[line.id] },
              locale
            )
            return (
              <div key={line.id} className="flex justify-between gap-2 py-0.5">
                <span className="min-w-0">
                  <span className="block">{names.primary}</span>
                  {line.qty > 1 || line.sourceType === "rx-line" ? (
                    <span className="block text-[#555]">
                      {t("billing.cashier.basket.qtyTimes", {
                        qty: num(line.qty),
                        price: money(line.unitPriceP),
                      })}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums">{money(line.amountP)}</span>
              </div>
            )
          })}
        </div>

        <div className="flex flex-col gap-0.5">
          <Row label={t("billing.receipt.subtotal")} value={money(invoice.subtotalP)} />
          {invoice.discountP > 0 ? (
            <Row
              label={t("billing.receipt.discount", { pct: num(invoice.discountPct) })}
              value={money(-invoice.discountP)}
            />
          ) : null}
          {invoice.discountP > 0 && approver ? (
            <div className="text-[#555]">
              {t("billing.receipt.approvedBy", { name: approver[locale] })}
            </div>
          ) : null}
          <Row label={t("billing.receipt.total")} value={money(invoice.totalP)} strong />
          {corporateP > 0 ? (
            <Row
              label={t("billing.receipt.corporate", {
                client: detail.corporateClient?.[locale] ?? "",
              })}
              value={money(corporateP)}
            />
          ) : null}
        </div>

        <div className="border-t border-dashed border-[#999] pt-1.5">
          <div className="pb-1 font-semibold">{t("billing.receipt.tenders")}</div>
          {confirmed
            .filter((p) => p.tender !== "corporate")
            .map((payment) => (
              <div key={payment.id} className="flex justify-between gap-2 py-0.5">
                <span className="min-w-0">
                  {tk(`billing.tender.${payment.tender}`)}
                  {payment.ref ? (
                    <span lang="en" className="ml-1 font-mono text-[#555]">
                      {payment.ref}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums">{money(payment.amountP)}</span>
              </div>
            ))}
          {changeDueP !== undefined && changeDueP > 0 && cashP > 0 ? (
            <>
              <Row label={t("billing.receipt.cashReceived")} value={money(cashP + changeDueP)} />
              <Row label={t("billing.receipt.change")} value={money(changeDueP)} />
            </>
          ) : null}
          <Row
            label={t("billing.receipt.paid")}
            value={money(receipt?.amountP ?? invoice.paidP - corporateP)}
            strong
          />
        </div>

        <div className="text-[#555]">
          {detail.cashier
            ? t("billing.receipt.cashier", { name: detail.cashier[locale] })
            : t("billing.receipt.online")}
        </div>
        {receipt ? (
          <div className="flex justify-center pt-1">
            <Barcode value={receipt.receiptNo} height={34} barWidth={1.2} fontSize={10} plate={false} />
          </div>
        ) : null}
      </div>
    </PrintLayout>
  )
}

/** Receipt preview with a Print button (the sheet alone goes to the printer). */
export function ReceiptDialog({
  open,
  onOpenChange,
  detail,
  changeDueP,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: InvoiceDetail
  changeDueP?: Poisha
}) {
  const { t } = useLocale()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-104" data-testid="receipt-dialog">
        <DialogHeader>
          <DialogTitle>{t("billing.receipt.previewTitle")}</DialogTitle>
          <DialogDescription>{t("billing.receipt.previewBody")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 max-h-[60svh] overflow-y-auto rounded-md bg-surface-raised p-3">
          <ReceiptSheet detail={detail} changeDueP={changeDueP} />
        </div>
        <DialogFooter>
          <Button type="button" variant="neutral" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button type="button" data-testid="receipt-print-now" onClick={() => window.print()}>
            <Printer />
            {t("common.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
