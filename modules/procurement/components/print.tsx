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
import type { StaffRow } from "@/core/db/schema"
import { useLocale } from "@/lib/i18n/provider"
import { brandLabel } from "@/modules/inventory/stock"

import type { GrnItem, PoDetail } from "../queries"

const cell = "border-b border-[#e0e0e0] px-1.5 py-1 align-top"
const head = "border-b-2 border-[#111] px-1.5 py-1 text-left text-[0.6875rem] font-semibold uppercase"

/** The printed purchase order (A4): hospital brand, supplier, delivery branch, lines in packs, barcode. */
export function PoSheet({ detail, approver }: { detail: PoDetail; approver?: StaffRow }) {
  const { t, num, money, dmy, locale } = useLocale()
  const { po, vendor, pr } = detail
  const branch = getBranch(po.branchId)
  return (
    <PrintLayout
      size="A4"
      branch={po.branchId}
      title={t("procurement.orders.print.title")}
      docNo={po.poNo}
      meta={`${t("procurement.orders.print.issued")} ${dmy(po.issuedAt)}`}
      footer={t("procurement.orders.print.quote", { poNo: po.poNo })}
    >
      <div className="grid grid-cols-2 gap-6 text-[0.8125rem]">
        <div>
          <div className="text-[0.6875rem] font-semibold uppercase text-[#555]">
            {t("procurement.orders.print.to")}
          </div>
          <div className="font-semibold">{vendor?.name}</div>
          <div lang="en">
            {vendor?.code} · {vendor?.phone}
          </div>
        </div>
        <div>
          <div className="text-[0.6875rem] font-semibold uppercase text-[#555]">
            {t("procurement.orders.print.deliverTo")}
          </div>
          <div className="font-semibold">
            {branch.name[locale]} ({branch.code})
          </div>
          <div>{branch.address[locale]}</div>
          <div className="mt-1">
            {t("procurement.orders.print.expected")}: {po.expectedAt ? dmy(po.expectedAt) : "-"}
          </div>
          {pr ? (
            <div>
              {t("procurement.orders.print.request")}: <span lang="en">{pr.prNo}</span>
            </div>
          ) : null}
        </div>
      </div>
      <table className="mt-5 w-full border-collapse text-[0.8125rem]">
        <thead>
          <tr>
            <th className={head}>{t("procurement.orders.print.no")}</th>
            <th className={head}>{t("procurement.orders.print.item")}</th>
            <th className={head}>{t("procurement.orders.print.pack")}</th>
            <th className={`${head} text-right`}>{t("procurement.orders.print.qty")}</th>
            <th className={`${head} text-right`}>{t("procurement.orders.print.price")}</th>
            <th className={`${head} text-right`}>{t("procurement.orders.print.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line, index) => {
            const brand = detail.brands.get(line.brandId)
            return (
              <tr key={line.id}>
                <td className={cell}>{num(index + 1)}</td>
                <td className={cell} lang="en">
                  {brand ? brandLabel(brand) : ""}
                </td>
                <td className={cell} lang="en">
                  {line.pack?.label ?? brand?.unitLabel.en ?? ""}
                </td>
                <td className={`${cell} text-right tabular-nums`}>{num(line.qtyOrdered)}</td>
                <td className={`${cell} text-right tabular-nums`}>{money(line.unitCostP)}</td>
                <td className={`${cell} text-right tabular-nums`}>
                  {money(line.qtyOrdered * line.unitCostP)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="px-1.5 py-2 text-right font-bold">
              {t("procurement.orders.print.total")}
            </td>
            <td className="px-1.5 py-2 text-right font-bold tabular-nums">{money(po.totalP)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-6 flex items-end justify-between gap-6 text-[0.8125rem]">
        <div>
          {vendor ? (
            <p>{t("procurement.orders.print.terms", { days: num(vendor.paymentTermsDays) })}</p>
          ) : null}
          <p className="mt-8 border-t border-[#111] pt-1 text-[0.75rem]">
            {t("procurement.orders.print.authorised")}
            {approver ? `: ${nameIn(approver, locale)}` : ""}
          </p>
        </div>
        <Barcode value={po.poNo} height={40} barWidth={1.4} fontSize={11} plate={false} />
      </div>
    </PrintLayout>
  )
}

/** The printed goods received note: lots with batch, expiry, received, accepted, rejected and quarantine. */
export function GrnSheet({ detail, item }: { detail: PoDetail; item: GrnItem }) {
  const { t, num, dmy, time, locale } = useLocale()
  const { grn, lines } = item
  return (
    <PrintLayout
      size="A4"
      branch={grn.branchId}
      title={t("procurement.grn.print.title")}
      docNo={grn.grnNo}
      meta={`${dmy(grn.receivedAt)} ${time(grn.receivedAt)}`}
    >
      <div className="grid grid-cols-3 gap-4 text-[0.8125rem]">
        <div>
          <div className="text-[0.6875rem] font-semibold uppercase text-[#555]">
            {t("procurement.grn.print.order")}
          </div>
          <div className="font-mono font-semibold" lang="en">
            {detail.po.poNo}
          </div>
        </div>
        <div>
          <div className="text-[0.6875rem] font-semibold uppercase text-[#555]">
            {t("procurement.grn.print.supplier")}
          </div>
          <div className="font-semibold">{detail.vendor?.name}</div>
        </div>
        <div>
          <div className="text-[0.6875rem] font-semibold uppercase text-[#555]">
            {t("procurement.grn.print.receivedBy")}
          </div>
          <div className="font-semibold">{item.receivedBy ? nameIn(item.receivedBy, locale) : ""}</div>
        </div>
      </div>
      <table className="mt-5 w-full border-collapse text-[0.8125rem]">
        <thead>
          <tr>
            <th className={head}>{t("procurement.orders.print.item")}</th>
            <th className={head}>{t("procurement.grn.print.batch")}</th>
            <th className={head}>{t("procurement.grn.print.expiry")}</th>
            <th className={`${head} text-right`}>{t("procurement.grn.print.qtyReceived")}</th>
            <th className={`${head} text-right`}>{t("procurement.grn.print.qtyAccepted")}</th>
            <th className={`${head} text-right`}>{t("procurement.grn.print.qtyRejected")}</th>
            <th className={head}>{t("procurement.grn.print.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const brand = detail.brands.get(line.brandId)
            const poLine = detail.lines.find((l) => l.id === line.poLineId)
            return (
              <tr key={line.id}>
                <td className={cell}>
                  <span lang="en">{brand ? brandLabel(brand) : ""}</span>
                  {poLine?.pack ? (
                    <span className="block text-[0.6875rem] text-[#555]" lang="en">
                      {poLine.pack.label}
                    </span>
                  ) : null}
                </td>
                <td className={`${cell} font-mono`} lang="en">
                  {line.batchNo}
                </td>
                <td className={cell}>{dmy(line.expiry)}</td>
                <td className={`${cell} text-right tabular-nums`}>{num(line.qtyReceived)}</td>
                <td className={`${cell} text-right tabular-nums`}>{num(line.qtyAccepted)}</td>
                <td className={`${cell} text-right tabular-nums`}>{num(line.qtyRejected)}</td>
                <td className={cell}>
                  {line.rejectReason ? t(`procurement.rejectReason.${line.rejectReason}`) : ""}
                  {line.quarantine ? ` · ${t("procurement.grn.print.quarantine")}` : ""}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-8 flex items-end justify-between gap-6 text-[0.8125rem]">
        <p className="w-56 border-t border-[#111] pt-1 text-[0.75rem]">
          {t("procurement.grn.print.signature")}
        </p>
        <Barcode value={grn.grnNo} height={40} barWidth={1.4} fontSize={11} plate={false} />
      </div>
    </PrintLayout>
  )
}

/** A print preview with a Print button (only the sheet goes to the printer). */
export function PrintDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  const { t } = useLocale()
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-4xl" data-testid="print-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("procurement.orders.print.previewBody")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 max-h-[62svh] overflow-auto rounded-md bg-surface-raised p-3">
          {children}
        </div>
        <DialogFooter>
          <Button variant="neutral" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button data-testid="print-now" onClick={() => window.print()}>
            <Printer />
            {t("common.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
