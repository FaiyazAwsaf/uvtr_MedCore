import { formatDmy } from "@/lib/i18n/format"

import { financeEn } from "./i18n/en"
import type { FeeShareStatement } from "./queries"

/**
 * CSV files finance downloads in the browser. English headings, DD-MM-YYYY
 * dates, amounts in taka with two decimals and Latin digits, so any
 * spreadsheet or accounting tool reads them.
 */

const taka = (poisha: number) => (poisha / 100).toFixed(2)

export function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvLines(rows: (string | number)[][]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

/** The fee-share statement, one row per accrual and a totals row. */
export function feeShareCsv(statement: FeeShareStatement, doctorName: string): string {
  const en = financeEn.finance.feeShare
  const rows: (string | number)[][] = [
    [
      en.col.date,
      en.col.invoice,
      en.col.uhid,
      en.col.service,
      en.col.gross,
      en.col.discount,
      en.col.net,
      en.col.basis,
      en.col.pct,
      en.col.share,
      en.col.wht,
      en.col.payable,
      "Contract version",
      "Reverses",
    ],
  ]
  for (const line of statement.lines) {
    const a = line.accrual
    rows.push([
      formatDmy(a.at, "en"),
      line.invoice?.invoiceNo ?? "",
      a.patientUhid ?? "",
      line.description ?? financeEn.finance.serviceType[a.serviceType],
      taka(a.grossP),
      taka(a.discountP),
      taka(a.netP),
      en.basis[a.basis],
      line.pct ?? "",
      taka(a.shareP),
      taka(a.whtP),
      taka(a.shareP - a.whtP),
      a.contractVersion,
      line.reverses?.invoiceNo ?? "",
    ])
  }
  const t = statement.totals
  rows.push([
    en.totals,
    `${doctorName} ${statement.month}`,
    "",
    "",
    taka(t.grossP),
    taka(t.discountP),
    taka(t.netP),
    "",
    "",
    taka(t.shareP),
    taka(t.whtP),
    taka(t.payableP),
    "",
    "",
  ])
  return csvLines(rows)
}
