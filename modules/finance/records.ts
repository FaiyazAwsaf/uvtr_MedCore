import { getBranch, type BranchCode, type CompanyCode } from "@/config/brand.config"
import { dhakaDate } from "@/core/clock/dates"
import type { MedcoreDb } from "@/core/db/database"
import type { Id, ISODate, ServiceType } from "@/core/db/schema"
import type { Row, TableName } from "@/core/db/tables"
import type { IndexValue } from "@/core/engine/types"

import type { JournalRecords } from "./journal"
import { moneyReceived, paymentDay } from "./rules"

/**
 * Reads shared by the finance commands (inside a transaction) and the
 * finance screens (inside `useLiveQuery`): the same record selection feeds
 * the journal preview and the export command, so what the screen shows is
 * exactly what the command records.
 */
export type Reader = {
  find<T extends TableName>(table: T, id: Id): Promise<Row<T> | undefined>
  list<T extends TableName>(table: T, index: string, value: IndexValue): Promise<Row<T>[]>
  all<T extends TableName>(table: T): Promise<Row<T>[]>
}

/** A Reader over a database (screens); a transaction already is one. */
export function readerOf(db: MedcoreDb): Reader {
  return {
    find: <T extends TableName>(table: T, id: Id) =>
      db.t(table).get(id) as Promise<Row<T> | undefined>,
    list: <T extends TableName>(table: T, index: string, value: IndexValue) =>
      db
        .t(table)
        .where(index)
        .equals(value as string | number | (string | number)[])
        .toArray() as Promise<Row<T>[]>,
    all: <T extends TableName>(table: T) => db.t(table).toArray() as Promise<Row<T>[]>,
  }
}

const companyOfBranch = (branch: BranchCode): CompanyCode => getBranch(branch).company

/**
 * Every record that posts to the books on one day, for all companies
 * (`buildJournal` keeps one company's): invoices issued, money received,
 * credit notes, fee-share accruals and reversals, inpatient deposits, and
 * vendor payables created or paid.
 */
export async function loadJournalRecords(reader: Reader, date: ISODate): Promise<JournalRecords> {
  const invoiceCompany = new Map<Id, CompanyCode | undefined>()
  const companyOfInvoice = async (invoiceId: Id) => {
    if (!invoiceCompany.has(invoiceId)) {
      invoiceCompany.set(invoiceId, (await reader.find("invoices", invoiceId))?.companyId)
    }
    return invoiceCompany.get(invoiceId)
  }

  const invoices: JournalRecords["invoices"] = []
  for (const invoice of await reader.list("invoices", "date", date)) {
    if (invoice.status === "void") continue
    invoiceCompany.set(invoice.id, invoice.companyId)
    const lines = await reader.list("invoiceLines", "invoiceId", invoice.id)
    invoices.push({
      companyId: invoice.companyId,
      invoiceNo: invoice.invoiceNo,
      lines: lines.map((line) => ({ serviceType: line.serviceType, netP: line.netP })),
    })
  }

  const payments = (await reader.all("payments"))
    .filter((p) => moneyReceived(p) && paymentDay(p) === date)
    .map((p) => ({ companyId: companyOfBranch(p.branchId), tender: p.tender, amountP: p.amountP }))

  const creditNotes: JournalRecords["creditNotes"] = []
  for (const note of await reader.all("creditNotes")) {
    if (dhakaDate(note.createdAt) !== date) continue
    const companyId = await companyOfInvoice(note.invoiceId)
    if (!companyId) continue
    const lines: { serviceType: ServiceType; amountP: number }[] = []
    for (const part of note.lines) {
      const line = await reader.find("invoiceLines", part.invoiceLineId)
      lines.push({ serviceType: line?.serviceType ?? "other", amountP: part.amountP })
    }
    const refunds = (await reader.list("refunds", "invoiceId", note.invoiceId))
      .filter((r) => r.creditNoteId === note.id && r.status === "completed")
      .map((r) => ({ tender: r.tender, amountP: r.amountP }))
    creditNotes.push({
      companyId,
      creditNoteNo: note.creditNoteNo,
      kind: note.kind === "corporate-dispute" ? "corporate-dispute" : "refund",
      lines,
      refunds,
    })
  }

  const accruals: JournalRecords["accruals"] = []
  for (const accrual of await reader.list("feeShareAccruals", "month", date.slice(0, 7))) {
    if (dhakaDate(accrual.at) !== date) continue
    const companyId = await companyOfInvoice(accrual.invoiceId)
    if (companyId) accruals.push({ companyId, shareP: accrual.shareP, whtP: accrual.whtP })
  }

  const deposits = (await reader.all("deposits"))
    .filter((d) => dhakaDate(d.at) === date)
    .map((d) => ({ companyId: companyOfBranch(d.branchId), tender: d.tender, amountP: d.amountP }))

  const poCompany = new Map<Id, CompanyCode | undefined>()
  const companyOfPo = async (poId: Id) => {
    if (!poCompany.has(poId)) {
      const po = await reader.find("purchaseOrders", poId)
      poCompany.set(poId, po ? companyOfBranch(po.branchId) : undefined)
    }
    return poCompany.get(poId)
  }
  const payablesCreated: JournalRecords["payablesCreated"] = []
  const payablesPaid: JournalRecords["payablesPaid"] = []
  for (const payable of await reader.all("payables")) {
    const created = dhakaDate(payable.createdAt) === date
    const paid = payable.paidAt !== undefined && dhakaDate(payable.paidAt) === date
    if (!created && !paid) continue
    const companyId = await companyOfPo(payable.poId)
    if (!companyId) continue
    if (created) payablesCreated.push({ companyId, amountP: payable.amountP })
    if (paid) payablesPaid.push({ companyId, amountP: payable.amountP })
  }

  return { date, invoices, payments, creditNotes, accruals, deposits, payablesCreated, payablesPaid }
}
